import { PublicKey } from "@solana/web3.js";

export const configs = {
    network: process.env.NETWORK_URL || "https://api.devnet.solana.com",
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


