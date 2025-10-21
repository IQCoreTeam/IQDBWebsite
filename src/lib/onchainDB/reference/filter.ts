
import { PublicKey } from "@solana/web3.js";
import { getProvider } from "../utils/anchorItems";
import { readTxRefPretty, searchTableByName, getTableColumns } from "./reader";


export async function instructionFilter(tableName?: string): Promise<any> {
      const provider = getProvider();
      const { connection } = provider as any;
      const signer = provider.wallet as any;
      const keypair = signer.payer;
      const signerPk = signer.publicKey;
      const userPubkey = signerPk.toBase58();

    try {
        const table = await searchTableByName({
        idlPath: "./target/idl/idl.json",
        userPubkey: userPubkey,
        tableName: tableName || "default_table",
        maxTx: 50,
        });

        // reads table rows, finds most recent instruction for each row by matching signature
        const filteredRows = table.sigContentRows.map((row: any) => {
            const matchingTarget = table.targetContent.find((target: any) => target.signature === row.signature);
            
            if (matchingTarget) {
                // Replace content with targetContent's content
                return {
                    ...row,
                    content: matchingTarget.content
                };
            }
            
            // Return original row if no match found
            return row;
        });
        console.log(" filteredRows: ", filteredRows);

    } catch (e: any) {
        console.error("  ! searchTableByName failed:", e?.message ?? e);
    }

    return { status: "instructionFilter executed" };

}
