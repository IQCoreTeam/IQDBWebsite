
import {
    Transaction,
    PublicKey
} from "@solana/web3.js";
import {getProgram} from "../../utils/anchorItems";
import { getTableColumns } from "../readers/reader";    


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

// async function checkColumnsExist(
//     tableName: string,
//     contentJson: string,
//     signer: PublicKey
// ) {

//     const columns = await getTableColumns({
//         idlPath: "./target/idl/idl.json",
//         userPubkey: signer.toBase58(),
//         tableName: tableName,
//     }); 

//     const jsObject = JSON.parse(contentJson);
//     for (const col of columns.columns) {
//         if (!(col in jsObject)) {
//             throw new Error(`Missing column '${col}' in provided JSON object.`);
//         } else {
//             console.log(`Column '${col}' is present with value: ${jsObject[col]}`);
//         }
//     }
//     console.log("Parsed JSON Object: ", jsObject);
// }

export async function pushDbInstruction(
    signer: PublicKey,
    root: PublicKey,
    instructionTable: PublicKey,
    txRef: PublicKey,
    targetTxRef: PublicKey,
    tableName: string,
    targetTxSig: string,
    contentJson: string
) {

    const columns = await getTableColumns({
        idlPath: "./target/idl/idl.json",
        userPubkey: signer.toBase58(),
        tableName: tableName,
    }); 

    const jsObject = JSON.parse(contentJson);
    console.log(" Validating columns for table: ", tableName);
    console.log(" Table Columns: ", columns.columns);
    console.log(" Provided JSON: ", jsObject);
    // check json for all columns in table
    // if user misses any columns, throw error
    for (const col of columns.columns) {
        if (!Object.keys(jsObject).includes(col)) {
            throw new Error(`Column '${col}' does not exist in provided JSON object.`);
        } else {
            //console.log(`Column '${col}' is valid for table '${tableName}'.`);
        }
    }
    // check table for all columns in json
    // if user submits extra columns not in table, throw error
    for (const col of Object.keys(jsObject)) {
        if (!columns.columns.includes(col)) {
            throw new Error(`Column '${col}' does not exist in table '${tableName}'.`);
        } else {
            //console.log(`Column '${col}' is valid for table '${tableName}'.`);
        }
    }
    
    // console.log("Parsed JSON Object: ", jsObject);

    // console.log(" tableName: ", columns.tableName);
    // console.log(" PDA : ", columns.tablePda.toBase58());
    // console.log(" columns ", columns.columns);
    
    
    const tableNameBuf = Buffer.from(tableName, "utf8");
    const targetTxBuf = Buffer.from(targetTxSig, "utf8");
    const rowJsonTx =  Buffer.from(contentJson, "utf8");

    const program = await getProgram();

    

    const ix = await program.methods
        .databaseInstruction(
            tableNameBuf,
            targetTxBuf,
            rowJsonTx
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
    console.log("\x1b[32m%s\x1b[0m", "Provided JSON is Valid");
    return tx;
}