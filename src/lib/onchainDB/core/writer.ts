// src/iqdb.ts
import idl from './../../../../public/idl/iq_database.json';
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Idl, BN } from "@coral-xyz/anchor";
import {
    Connection,
    Transaction,
    Keypair,
    sendAndConfirmTransaction,
    SystemProgram,
    PublicKey
} from "@solana/web3.js";



import { configs } from "../configs";
import {
    pdaRoot,
    pdaTxRef,
    pdaTargetTxRef,
    pdaTable,
    pdaInstructionTable,
} from "../provider/pda.provider";
import { sign } from 'crypto';

const enc = new TextEncoder();
const programId:any = new PublicKey(configs.programId);

export type EditMode = "update" | "delete";
export function enumEditMode(mode: EditMode): any {
    return mode === "update" ? { update: {} } : { delete: {} };
}
export async function txSend(
    connection: Connection,
    tx: Transaction,
    payer: Keypair,
    opts?: { skipPreflight?: boolean }
): Promise<string> {
    // Get a fresh blockhash (retry a couple times for robustness)
    let blockhashResp = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhashResp.blockhash;
    tx.lastValidBlockHeight = blockhashResp.lastValidBlockHeight;

    // Fee payer
    tx.feePayer = payer.publicKey;

    // Sign
    tx.sign(payer);

    // Send+confirm
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        skipPreflight: opts?.skipPreflight ?? false,
        commitment: "confirmed",
    });

    return sig;
}
/** Create an Anchor provider instance */
export function getProvider(): AnchorProvider {
    const connection = new Connection(configs.network, "confirmed");
    const wallet = anchor.AnchorProvider.local().wallet; // Uses ~/.config/solana/id.json
    const provider = new AnchorProvider(connection, wallet, {
        preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    return provider;
}
export async function getProgram(){
    const provider = new anchor.AnchorProvider(connection, wallet, {
        preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    // const idl = await Program.fetchIdl(programId, provider);
    const program = new Program(idl as Idl, programId);
    return program

}
/** Create a typed Program<IqDatabase> instance from the IDL */
const connection = new Connection(configs.network, "confirmed");
// 기본 Anchor 환경(예: local validator)이면 AnchorProvider.env()도 가능
const wallet = anchor.AnchorProvider.local().wallet; // ~/.config/solana/id.json 사용




/** ------------------- On-chain instruction wrappers (SDK-style) ------------------- */

/** Initialize the root + txRef PDAs */
export async function initializeRoot(
    signer: PublicKey
) {
    const rootPda = pdaRoot(signer);
    const txRefPda = pdaTxRef(signer);
    const targetTxRefPda = pdaTargetTxRef(signer);
    const program = await getProgram();

    const ix = await program.methods
        .initializeRoot()
        .accounts({
            root: rootPda,
            txRef: txRefPda,
            targetTxRef: targetTxRefPda,
            signer,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).instruction();;

    const tx = new Transaction({ feePayer: signer });
    tx.add(ix);
    return tx;
}

/** Create a table under the root */
export async function createTable(
    signer: PublicKey,
    root: PublicKey,
    tableName: string,
    columnNames: string[]
) {
    const tableSeed = new TextEncoder().encode(tableName);
    const table = pdaTable(root, tableSeed);
    const instructionTable = pdaInstructionTable(root, tableSeed);
    const tableNameBuf = Buffer.from(tableName, "utf8");
    const columnBufs   = columnNames.map(s => Buffer.from(s, "utf8"));
    const program = await getProgram();

    const ix = await program.methods
        .createTable(tableNameBuf, columnBufs)
        .accounts({
            root,
            signer,
            table,
            instructionTable,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
    const tx = new Transaction({ feePayer: signer });
    tx.add(ix);
    return tx;
}

/** Write a new row to the table (record transaction reference) */
export async function writeRow(
    signer: PublicKey,
    root: PublicKey,
    table: PublicKey,
    txRef: PublicKey,
    tableName: string,
    rowJson: string
) {

    const program = await getProgram();
    const tableNameBuf = Buffer.from(tableName, "utf8");
    const rowJsonTx =  Buffer.from(rowJson, "utf8");


    const ix = await program.methods
        .writeData(tableNameBuf,rowJsonTx)
        .accounts({
            root,
            table,
            txRef,
            signer,
        }).instruction();
    const tx = new Transaction({ feePayer: signer });
    tx.add(ix);
    return tx;


}

/** Push an “instruction” event (update/delete) for a given table */
export async function pushDbInstruction(
    signer: PublicKey,
    root: PublicKey,
    instructionTable: PublicKey,
    txRef: PublicKey,
    targetTxRef: PublicKey,
    tableName: string,
    mode: EditMode,
    targetTxSig: string,     // target row reference (tx signature, ID, etc.)
    contentJson: string      // JSON body of the change
) {
    const tableNameBytes = enc.encode(tableName);
    const targetTx = enc.encode(targetTxSig);
    const contentJsonTx = enc.encode(contentJson);
    const program = await getProgram();

    const ix = await program.methods
        .databaseInstruction(
            Array.from(tableNameBytes),
            enumEditMode(mode),
            Array.from(targetTx),
            Array.from(contentJsonTx)
        )
        .accounts({
            root,
            instructionTable,
            txRef,
            targetTxRef,
            signer,
        }).instruction();
    const tx = new Transaction({ feePayer: signer });
    tx.add(ix);
    return tx;
}

/** ------------------- Raw decoding via IDL (getAccountInfo + BorshAccountsCoder) ------------------- */
export async function decodeWithIdl(
    connection: Connection,
    pda: PublicKey,
    accountName: "Root" | "Table" | "TxRef" | "InstructionTable"
) {
    const info = await connection.getAccountInfo(pda);
    if (!info) return null;
    const coder = new anchor.BorshAccountsCoder(idl as unknown as Idl);
    const decoded: any = coder.decode(accountName, info.data);
    return decoded;
}

/** ------------------- Main entry point: sequential example execution ------------------- */
export async function main() {
    // 0. Provider & signer
    const provider = getProvider();
    const { connection } = provider;
    const signer = provider.wallet;
    const keypair = (signer as any).payer;

    //
    const _pdaRoot = pdaRoot(signer.publicKey)
    //
    // const initRootTx = await initializeRoot(signer.publicKey)
    // const initRoot = await txSend(connection,initRootTx,keypair)
    // console.log("tx:", initRoot);

    // console.log("create_table...");
    // const crateTableTx = await createTable(signer.publicKey,_pdaRoot,"youtube",["name","session_pda"]);
    // const crateTable = await txSend(connection,crateTableTx,keypair)
    //
    // console.log("tx:", crateTable);


    const _txRef = pdaTxRef(signer.publicKey)
    const tableNameBytes = enc.encode("youtube");

    const catfoodTable = pdaTable(_pdaRoot,tableNameBytes)
    const writeRowTx = await writeRow(signer.publicKey,_pdaRoot,catfoodTable,_txRef,"youtube","{ name:'cat_meme', session_pda:'fkdjskfjdlkjflkdjksakfjdaf' }");
    const _writeRow = await txSend(connection,writeRowTx,keypair)

    console.log("tx:", _writeRow);

    console.log("✅ Done.");
}
// Execute if run directly
if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}