import * as anchor from "@coral-xyz/anchor";
import { BorshAccountsCoder, BorshInstructionCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey, ConfirmedSignatureInfo } from "@solana/web3.js";

import { configs, constants } from "../configs";
import { pdaRoot, pdaTable, pdaInstructionTable } from "../provider/pda.provider";

// utils
import { loadIdlFromFile } from "../utils/idl";
import { toStr } from "../utils/bytes";
import { makeAccountsCoder, makeIxCoder } from "../utils/coders";
import { fetchAndDecode } from "../utils/accounts";
import { Row, tryParseJsonLoose, pushRow } from "../utils/json";
import { getSignaturesFor, decodeAllIxsFromTx } from "../utils/solana-tx";

/* ---------------------- root / table reading ---------------------- */
async function readRootAndTables(
    connection: Connection,
    coder: BorshAccountsCoder,
    user: PublicKey
) {
    const rootPda = pdaRoot(user);
    const root = await fetchAndDecode<any>(connection, coder, rootPda, "Root");
    const tableNames: string[] = root ? (root.table_names ?? []).map((v: any) => toStr(v)) : [];
    return { tableNames };
}

/* ---------------------- txref scan & instruction decode ---------------------- */
async function collectRowsFromTxRef(
    connection: Connection,
    programId: PublicKey,
    ixCoder: BorshInstructionCoder,
    txRefPda: PublicKey,
    maxCount: number
): Promise<Record<string, Row[]>> {
    const programIdB58 = programId.toBase58();
    const sigs = await getSignaturesFor(txRefPda, connection, maxCount);
    const byTable: Record<string, Row[]> = {};

    for (const s of sigs) {
        const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) continue;

        const decoded = decodeAllIxsFromTx(tx as any, programIdB58, ixCoder);
        for (const d of decoded) {
            try {
                if (d.name === "write_data") {
                    const tableName = toStr(d.data.table_name ?? d.data.table_name ?? d.data[0]);
                    const payloadStr = toStr(d.data.row_json_tx ?? d.data.row_json_tx ?? d.data[1]);
                    const row = tryParseJsonLoose(payloadStr);
                    pushRow(byTable, tableName, row);
                } else if (d.name === "database_instruction") {
                    const tableName = toStr(d.data.table_name ?? d.data.table_name ?? d.data[0]);
                    const contentStr = toStr(d.data.contentJsonTx ?? d.data.content_json_tx ?? d.data[3]);
                    const row = tryParseJsonLoose(contentStr);
                    pushRow(byTable, tableName, row);
                }
            } catch {
                // ignore malformed
            }
        }
    }

    return byTable;
}

/* ---------------------- pretty print ---------------------- */
function printTables(
    titleOrder: string[],
    tablesMeta: Record<string, { columns: string[], tablePda: PublicKey, instPda: PublicKey | null }>,
    rowsByTable: Record<string, Row[]>,
    limitPerTable?: number
) {
    for (const t of titleOrder) {
        const meta = tablesMeta[t] || { columns: [], tablePda: null as any, instPda: null as any };
        const columns = meta.columns;
        const rows = rowsByTable[t] || [];

        console.log(`${t} { columns: ${JSON.stringify(columns)} }`);
        console.log(`L rows`);
        const max = limitPerTable ? Math.min(limitPerTable, rows.length) : rows.length;
        for (let i = 0; i < max; i++) {
            const r = rows[i];
            const pretty = Object.entries(r).map(([k, v]) => {
                if (typeof v === "string") return `${k}:'${v}'`;
                return `${k}:${JSON.stringify(v)}`;
            }).join(", ");
            console.log(`  { ${pretty} }`);
        }
    }
}

// Search rows for a table by scanning transactions on its table PDA (and instruction PDA if present)
export async function searchTableByName({
    idlPath,
    userPubkey,
    programIdStr,
    tableName,
    maxTx = 100
}: {
    idlPath: string;
    userPubkey: string;
    programIdStr?: string;
    tableName: string;
    maxTx?: number;
}) {
    const idl = loadIdlFromFile(idlPath);
    const accCoder = makeAccountsCoder(idl);
    const ixCoder = makeIxCoder(idl);
    const connection = new Connection(configs.network, "confirmed");

    const user = new PublicKey(userPubkey);
    const programId = new PublicKey(programIdStr || (constants?.iqDataBaseContractId ?? configs.programId));

    // derive PDAs directly from root and table name
    const rootPda = pdaRoot(user);
    const seed = new TextEncoder().encode(tableName);
    const tablePda = pdaTable(rootPda, seed);
    const instPda = pdaInstructionTable(rootPda, seed);

    // ensure table account exists; if not, throw
    const tableInfo = await connection.getAccountInfo(tablePda);
    if (!tableInfo) {
        throw new Error(`Table PDA not found for name '${tableName}': ${tablePda.toBase58()}`);
    }
    const instTableInfo = await connection.getAccountInfo(instPda);
    if (!instTableInfo) {
        throw new Error(`Table PDA not found for name '${tableName + 'instruction'}': ${instPda.toBase58()}`);
    }

    // read columns + id_col + ext_keys from table account (best-effort)
    let columns: string[] = [];
    let idCol: string | undefined;
    let extKeys: string[] = [];
    try {
        const decoded = await fetchAndDecode<any>(connection, accCoder, tablePda, "Table");
        columns = decoded ? (decoded.column_names ?? []).map((v: any) => toStr(v)) : [];
        idCol = decoded?.id_col ? toStr(decoded.id_col) : undefined;
        extKeys = Array.isArray(decoded?.ext_keys) ? decoded.ext_keys.map((v: any) => toStr(v)) : [];
    } catch {
        columns = [];
        idCol = undefined;
        extKeys = [];
    }

    // process targets from instruction pda separately

    //const targets: PublicKey[] = [tablePda, ...(instPda ? [instPda] : [])];
    const targets: PublicKey[] = [tablePda];
    const instruTargets: PublicKey[] = [...(instPda ? [instPda] : [])];
    const programIdB58 = programId.toBase58();

    interface sigContent {
        signature: string;
        content: any;
    }

    const sigContentRows: sigContent[] = [];

    const signatureLists = await Promise.all(targets.map(addr => getSignaturesFor(addr, connection, maxTx)));
    const sigMap = new Map<string, ConfirmedSignatureInfo>();
    for (const list of signatureLists) {
        for (const s of list) {
            if (!sigMap.has(s.signature)) sigMap.set(s.signature, s);
        }
    }
    const sigs = Array.from(sigMap.values()).sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0)).slice(0, maxTx);

    const rows: Row[] = [];
    
    for (const s of sigs) {
        const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) continue;
        const decoded = decodeAllIxsFromTx(tx as any, programIdB58, ixCoder);
        for (const d of decoded) {
            try {
                if (d.name === "write_data") {
                    const nameInIx = toStr(d.data.table_name ?? d.data[0]);
                    if (nameInIx !== tableName) continue;
                    const payloadStr = toStr(d.data.row_json_tx ?? d.data[1]);

                    const sigContentObj: sigContent = {
                        signature: s.signature,
                        content: tryParseJsonLoose(payloadStr)
                    };
                    sigContentRows.push(sigContentObj);

                    rows.push(tryParseJsonLoose(payloadStr));
                } else if (d.name === "database_instruction") {
                    const nameInIx = toStr(d.data.table_name ?? d.data[0]);
                    if (nameInIx !== tableName) continue;
                    const contentStr = toStr(d.data.contentJsonTx ?? d.data.content_json_tx ?? d.data[3]);
                    rows.push(tryParseJsonLoose(contentStr));
                }
            } catch {
                // skip decode errors for this tx
            }
        }
    }


    // handle instruction table rows
    interface instructionRow {
        signature: string;
        content: any;
    }
    const targetContent: instructionRow[] = [];

    
    const instruSignatureLists = await Promise.all(instruTargets.map(addr => getSignaturesFor(addr, connection, maxTx)));
    const instruSigMap = new Map<string, ConfirmedSignatureInfo>();
    for (const list of instruSignatureLists) {
        for (const s of list) {
            if (!instruSigMap.has(s.signature)) instruSigMap.set(s.signature, s);
        }
    }
    const instruSigs = Array.from(instruSigMap.values()).sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0)).slice(0, maxTx);

    const instruRows: Row[] = [];
    
    for (const s of instruSigs) {

        const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) continue;
        const decoded = decodeAllIxsFromTx(tx as any, programIdB58, ixCoder);
        for (const d of decoded) {

            try {
                if (d.name === "database_instruction") {
                    const nameInIx = toStr(d.data.table_name ?? d.data[0]);
                    if (nameInIx !== tableName) continue;
                    const contentStr = toStr(d.data.contentJsonTx ?? d.data.content_json_tx ?? d.data[3]);
                    const targetInIx = toStr(d.data.target_tx ?? d.data[1]);
                    const targetsRowsObj: instructionRow = {
                        signature: targetInIx,
                        content: tryParseJsonLoose(contentStr)
                    };
                    targetContent.push(targetsRowsObj);
                    instruRows.push(tryParseJsonLoose(contentStr));
                }
            } catch {
                // skip decode errors for this tx
            }
        }
    }


    return {
        tableName,
        columns,
        idCol,
        extKeys,
        tablePda,
        instPda,
        rows,
        sigMap,
        instruSigMap,
        targets,
        instruTargets,
        instruRows,
        targetContent,
        sigContentRows
    };
}

export async function getTableColumns({
    idlPath,
    userPubkey,
    programIdStr,
    tableName,
    maxTx = 100
}: {
    idlPath: string;
    userPubkey: string;
    programIdStr?: string;
    tableName: string;
    maxTx?: number;
}) {
    const idl = loadIdlFromFile(idlPath);
    const accCoder = makeAccountsCoder(idl);
    const connection = new Connection(configs.network, "confirmed");

    const user = new PublicKey(userPubkey);

    // derive PDAs directly from root and table name
    const rootPda = pdaRoot(user);
    const seed = new TextEncoder().encode(tableName);
    const tablePda = pdaTable(rootPda, seed);
    const instPda = pdaInstructionTable(rootPda, seed);

    // ensure table account exists; if not, throw
    const tableInfo = await connection.getAccountInfo(tablePda);
    if (!tableInfo) {
        throw new Error(`Table PDA not found for name '${tableName}': ${tablePda.toBase58()}`);
    }

    // read columns from table account (best-effort)
    let columns: string[] = [];
    try {
        const decoded = await fetchAndDecode<any>(connection, accCoder, tablePda, "Table");
        columns = decoded ? (decoded.column_names ?? []).map((v: any) => toStr(v)) : [];
    } catch {
        columns = [];
    }

    return {
        tableName,
        columns,
        tablePda
    };
}

/* ---------------------- main read entry ---------------------- */
export async function readTxRefPretty({
    idlPath,
    userPubkey,
    programIdStr,
    maxTx = 100,
    perTableLimit,
}: {
    idlPath: string;
    userPubkey: string;
    programIdStr?: string;
    maxTx?: number;
    perTableLimit?: number;
}) {
    const idl = loadIdlFromFile(idlPath);
    const accCoder = makeAccountsCoder(idl);
    const ixCoder = makeIxCoder(idl);
    const connection = new Connection(configs.network, "confirmed");

    const user = new PublicKey(userPubkey);
    const programId = new PublicKey(programIdStr || (constants?.iqDataBaseContractId ?? configs.programId));

    const { tableNames } = await readRootAndTables(connection, accCoder, user);

    // 1) 기본 테이블들 조회
    const baseResults = await Promise.all(
        tableNames.map(async (name) => {
            try {
                const r = await searchTableByName({ idlPath, userPubkey, programIdStr, tableName: name, maxTx });
                return { name, rows: r.rows, columns: r.columns, idCol: r.idCol, extKeys: r.extKeys, tablePda: r.tablePda, instPda: r.instPda };
            } catch {
                return { name, rows: [] as Row[], columns: [] as string[], idCol: undefined, extKeys: [] as string[], tablePda: null as any, instPda: null as any };
            }
        })
    );

    // 2) 각 기본 테이블의 행을 스캔해 확장 테이블 이름 "TableName/RowId/ExtKey" 생성
    const extNameSet = new Set<string>();
    for (const r of baseResults) {
        if (!r.idCol || !r.extKeys || r.extKeys.length === 0) continue;
        for (const row of r.rows) {
            const rowIdVal = (row as any)?.[r.idCol];
            if (rowIdVal == null) continue;
            const rowIdStr = String(rowIdVal);
            for (const ek of r.extKeys) {
                extNameSet.add(`${r.name}/${rowIdStr}/${ek}`);
            }
        }
    }
    const extTableNames = Array.from(extNameSet);

    // 3) 확장 테이블들 조회
    const extResults = await Promise.all(
        extTableNames.map(async (name) => {
            try {
                const r = await searchTableByName({ idlPath, userPubkey, programIdStr, tableName: name, maxTx });
                return { name, rows: r.rows, columns: r.columns, idCol: r.idCol, extKeys: r.extKeys, tablePda: r.tablePda, instPda: r.instPda };
            } catch {
                return { name, rows: [] as Row[], columns: [] as string[], idCol: undefined, extKeys: [] as string[], tablePda: null as any, instPda: null as any };
            }
        })
    );

    // 4) 결과 합치기 + 출력
    const allNames = [...tableNames, ...extTableNames];
    const allResults = [...baseResults, ...extResults];

    const rowsByTable: Record<string, Row[]> = {};
    const tablesMeta: Record<string, { columns: string[], tablePda: PublicKey, instPda: PublicKey | null }> = {};
    for (const r of allResults) {
        rowsByTable[r.name] = r.rows;
        tablesMeta[r.name] = { columns: r.columns, tablePda: r.tablePda, instPda: r.instPda };
    }

    printTables(allNames, tablesMeta, rowsByTable, perTableLimit);
    console.log("✅ Done.");
}

// /* ---------------------- CLI ---------------------- */
// async function main() {
//     const provider = anchor.AnchorProvider.local();
//     const wallet = provider.wallet;
//     const userPubkey = wallet.publicKey.toBase58();
//     console.log("///////////////////////////IQDATABASE///////////////////////////");
//     console.log("user: ", userPubkey);
//
//     await readTxRefPretty({
//         idlPath: "target/idl/idl.json",
//         userPubkey,
//         maxTx: 100,
//         perTableLimit: 20
//     });
// }
//
// if (require.main === module) {
//     main().catch((e) => {
//         console.error(e);
//         process.exit(1);
//     });
// }
