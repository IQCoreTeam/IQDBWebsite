import * as anchor from "@coral-xyz/anchor";
import { Idl, BorshAccountsCoder, BorshInstructionCoder } from "@coral-xyz/anchor";
import {
    Connection,
    PublicKey,
    ParsedTransactionWithMeta,
    ConfirmedSignatureInfo,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";
import bs58 from "bs58";

import { configs, constants } from "../configs"; // constants.codeInContractId 등에 프로그램ID가 있으면 사용
import { pdaRoot, pdaTable, pdaTxRef, pdaInstructionTable } from "../provider/pda.provider";

/* ---------------------- small utils ---------------------- */
function loadIdlFromFile(idlPath: string): Idl {
    const abs = path.isAbsolute(idlPath) ? idlPath : path.join(process.cwd(), idlPath);
    return JSON.parse(fs.readFileSync(abs, "utf8")) as Idl;
}
const toStr = (u8: any) => {
    try {
        if (typeof u8 === "string") return u8;
        if (u8 instanceof Uint8Array) return new TextDecoder().decode(u8);
        if (Buffer.isBuffer(u8)) return u8.toString("utf8");
        if (Array.isArray(u8)) return Buffer.from(u8).toString("utf8");
        if (u8?.data) return Buffer.from(u8.data).toString("utf8");
        return String(u8 ?? "");
    } catch {
        return String(u8 ?? "");
    }
};
const toU8 = (x: any): Uint8Array => {
    if (x instanceof Uint8Array) return x;
    if (Buffer.isBuffer(x)) return new Uint8Array(x);
    if (Array.isArray(x)) return new Uint8Array(x);
    if (x?.data) return new Uint8Array(x.data);
    return new Uint8Array();
};

/* ---------------------- account decoders ---------------------- */
function makeAccountsCoder(idl: Idl) {
    return new BorshAccountsCoder(idl);
}
function makeIxCoder(idl: Idl) {
    return new BorshInstructionCoder(idl);
}
async function fetchAndDecode<T = any>(
    connection: Connection,
    coder: BorshAccountsCoder,
    pubkey: PublicKey,
    accountName: "Root" | "Table" | "TxRef" | "InstructionTable"
): Promise<T | null> {
    const info = await connection.getAccountInfo(pubkey);
    if (!info) return null;
    return coder.decode(accountName, info.data) as T;
}

/* ---------------------- root / table reading ---------------------- */
async function readRootAndTables(
    connection: Connection,
    coder: BorshAccountsCoder,
    user: PublicKey
) {
    const rootPda = pdaRoot(user);
    const root = await fetchAndDecode<any>(connection, coder, rootPda, "Root");
    if (!root) {
        return { rootPda, creator: null, tableNames: [] as string[], tables: {} as Record<string, { columns: string[], tablePda: PublicKey, instPda: PublicKey | null }> };
    }
    const creator = new PublicKey(root.creator).toBase58();
    const tableNames: string[] = (root.table_names ?? []).map((v: any) => toStr(v));

    const tables: Record<string, { columns: string[], tablePda: PublicKey, instPda: PublicKey | null }> = {};
    for (const name of tableNames) {
        const seed = new TextEncoder().encode(name);
        const tablePda = pdaTable(rootPda, seed);
        const instPda = pdaInstructionTable(rootPda, seed);
        const tableAcc = await fetchAndDecode<any>(connection, coder, tablePda, "Table");
        const columns = tableAcc ? (tableAcc.column_names ?? []).map((v: any) => toStr(v)) : [];
        tables[name] = { columns, tablePda, instPda };
    }
    return { rootPda, creator, tableNames, tables };
}

/* ---------------------- txref scan & instruction decode ---------------------- */
type Row = Record<string, any>;

async function getSignaturesFor(address: PublicKey, connection: Connection, limit: number) {
    const out: ConfirmedSignatureInfo[] = [];
    let before: string | undefined = undefined;

    while (out.length < limit) {
        const chunk = await connection.getSignaturesForAddress(address, { limit: Math.min(1000, limit - out.length), before });
        if (chunk.length === 0) break;
        out.push(...chunk);
        before = chunk[chunk.length - 1].signature;
    }
    return out;
}

function decodeAllIxsFromTx(
    tx: ParsedTransactionWithMeta,
    programIdB58: string,
    ixCoder: BorshInstructionCoder
) {
    const accKeys = tx.transaction?.message?.accountKeys ?? [];
    const out: { name: string, data: any }[] = [];

    // outer
    const outer = tx.transaction?.message?.instructions ?? [];
    // inner
    const innerGroups = tx.meta?.innerInstructions ?? [];
    const inner = innerGroups.flatMap(g => g.instructions ?? []);

    const all = [...outer, ...inner];

    for (const ix of all) {
        // program check
        const pidIndex = (ix as any).programIdIndex;
        const pid = pidIndex != null ? (accKeys[pidIndex]?.pubkey || accKeys[pidIndex]) : (ix as any).programId;
        const pidB58 = typeof (pid as any)?.toBase58 === "function" ? (pid as any).toBase58() : String(pid);
        if (pidB58 !== programIdB58) continue;

        const data = (ix as any).data;
        if (!data) continue;

        try {
            const decoded = ixCoder.decode(typeof data === "string" ? data : bs58.encode(toU8(data)), "base58");
            if (decoded) out.push(decoded);
        } catch {
            // skip if not decodable by this IDL
        }
    }
    return out;
}

/**
 * 스캔 대상: TxRef PDA의 최근 시그니처 N개
 * - writeData(table_name: Vec<u8>, row_json_tx: Vec<u8>)
 * - databaseInstruction(table_name, mode, target_tx, content_json_tx)
 * 결과를 테이블명 기준으로 rows 배열에 누적 (최근순)
 */
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

function tryParseJsonLoose(s: string): Row {
    if (!s) return {};
    // 허용: { name:'fish', price:100 } 형식 → 쌍따옴표 보정
    let normalized = s.trim();
    if (!/^\s*\{/.test(normalized)) {
        // not an object; return a simple wrapper
        return { value: normalized };
    }
    // replace single quotes with double quotes conservatively
    // (keys/strings) '...'
    normalized = normalized
        .replace(/'([^']*)'/g, (_m, g1) => `"${g1}"`)       // value에 큰따옴표
        .replace(/(\w+)\s*:/g, `"$1":`);

    try {
        return JSON.parse(normalized);
    } catch {
        // 마지막 시도로: 키에 따옴표 없을 때 감싸기 name: → "name":
        try {
            const fixed = normalized.replace(/(\{|,)\s*([A-Za-z0-9_]+)\s*:/g, `$1 "$2":`);
            return JSON.parse(fixed);
        } catch {
            return { raw: s };
        }
    }
}

function pushRow(byTable: Record<string, Row[]>, tableName: string, row: Row) {
    if (!byTable[tableName]) byTable[tableName] = [];
    byTable[tableName].push(row);
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
            // compact print: { k:'v', ... }
            const pretty = Object.entries(r).map(([k, v]) => {
                if (typeof v === "string") return `${k}:'${v}'`;
                return `${k}:${JSON.stringify(v)}`;
            }).join(", ");
            console.log(`  { ${pretty} }`);
        }
    }
}

/* ---------------------- main read entry ---------------------- */
export async function readTxRefPretty({
                                          idlPath,
                                          userPubkey,
                                          programIdStr,
                                          maxTx = 100,
                                          perTableLimit, // optional rows printed per table
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

    // root / table meta
    const { rootPda, creator, tableNames, tables } = await readRootAndTables(connection, accCoder, user);

    // header (간단히)
    // console.log(`📦 Root PDA: ${rootPda.toBase58()}`);
    // if (creator) console.log(`  creator : ${creator}`);
    // console.log(`  tables  : ${JSON.stringify(tableNames)}`);
    //
    // // txref
    const txRefPda = pdaTxRef(user);
    // console.log(`🧾 TxRef PDA: ${txRefPda.toBase58()}`);

    // collect rows from recent txs touching txRef PDA
    const rowsByTable = await collectRowsFromTxRef(connection, programId, ixCoder, txRefPda, maxTx);

    // pretty print per table (requested style)
    printTables(tableNames, tables, rowsByTable, perTableLimit);

    console.log("✅ Done.");
}

/* ---------------------- CLI ---------------------- */
/*
Usage:
  npx ts-node src/reader.ts --idl target/idl/iq_database.json --user <PUBKEY> [--program <PROGRAM_ID>] [--limit 100] [--perTable 20]
*/
async function main() {
    // AnchorProvider.local()로 로드된 기본 지갑 사용
    const provider = anchor.AnchorProvider.local();
    const wallet = provider.wallet;
    const userPubkey = wallet.publicKey.toBase58();
    console.log("///////////////////////////IQDATABASE///////////////////////////");
    console.log("user: ", userPubkey);
    await readTxRefPretty({
        idlPath: "target/idl/idl.json",  // IDL 파일 경로
        userPubkey,                             // 현재 solana 설정의 지갑 주소 자동 사용
        maxTx: 100,                             // 최근 N개 Tx
        perTableLimit: 20                       // 테이블당 최대 표시 Row 수
    });
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}