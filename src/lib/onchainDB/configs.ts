import { PublicKey } from "@solana/web3.js";

export const configs = {
    network: process.env.NETWORK_URL || "https://devnet.helius-rpc.com/?api-key=fbb113ce-eeb4-4277-8c44-7153632d175a",
    programId: process.env.PROGRAM_ID || "7Vk5JJDxUBAaaAkpYQpWYCZNz4SVPm3mJFSxrBzTQuAX",
    rootSeed: "iqdb-root",
    tableSeed: "iqdb-table",
    txRefSeed: "iqdb-txref",
    instructionSeed: "instruction",
    targetSeed: "target",
  };

export const constants = {
    iqDataBaseContractId: new PublicKey("7Vk5JJDxUBAaaAkpYQpWYCZNz4SVPm3mJFSxrBzTQuAX"),

}


