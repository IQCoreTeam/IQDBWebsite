// src/Lprovider/pdaprovider.ts
import { PublicKey } from "@solana/web3.js";
import { configs } from "../configs";

const PROGRAM_ID = new PublicKey(configs.programId);

export function pdaRoot(signer: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(configs.rootSeed), PROGRAM_ID.toBuffer(), signer.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function pdaTxRef(signer: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(configs.txRefSeed), PROGRAM_ID.toBuffer(), signer.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function pdaTargetTxRef(signer: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.txRefSeed),
      PROGRAM_ID.toBuffer(),
      signer.toBuffer(),
      Buffer.from(configs.targetSeed),
    ],
    PROGRAM_ID
  )[0];
}

export function pdaTable(root: PublicKey, tableNameBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.tableSeed),
      PROGRAM_ID.toBuffer(),
      root.toBuffer(),
      Buffer.from(tableNameBytes),
    ],
    PROGRAM_ID
  )[0];
}

export function pdaInstructionTable(root: PublicKey, tableNameBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.tableSeed),
      PROGRAM_ID.toBuffer(),
      root.toBuffer(),
      Buffer.from(tableNameBytes),
      Buffer.from(configs.instructionSeed),
    ],
    PROGRAM_ID
  )[0];
}