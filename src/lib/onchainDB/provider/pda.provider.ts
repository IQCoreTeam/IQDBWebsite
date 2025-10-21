// src/Lprovider/pdaprovider.ts
import { PublicKey } from "@solana/web3.js";
import { configs } from "../configs";
import { deriveSeedBytes } from "../core/seed";

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

export function pdaTable(root: PublicKey, tableName: string) {
  const tableSeed = deriveSeedBytes(tableName);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.tableSeed),
      PROGRAM_ID.toBuffer(),
      root.toBuffer(),
      Buffer.from(tableSeed),
    ],
    PROGRAM_ID
  )[0];
}

export function pdaInstructionTable(root: PublicKey, tableName: string) {
  const tableSeed = deriveSeedBytes(tableName);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.tableSeed),
      PROGRAM_ID.toBuffer(),
      root.toBuffer(),
      Buffer.from(tableSeed),
      Buffer.from(configs.instructionSeed),
    ],
    PROGRAM_ID
  )[0];
}

/**
 * pdaExternalRecord
 *  tableSeed, PROGRAM_ID, root, baseTableName, idValue, extTableName
 */
export function pdaExternalRecord(
  root: PublicKey,
  baseTableSeed: Uint8Array,
  idValueBytes: Uint8Array,
  extTableSeed: Uint8Array
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.tableSeed),
      PROGRAM_ID.toBuffer(),
      root.toBuffer(),
      Buffer.from(baseTableSeed),
      Buffer.from(idValueBytes),
      Buffer.from(extTableSeed),
    ],
    PROGRAM_ID
  )[0];
}

/**
 * pdaExternalRecordFromStrings
 */
export function pdaExternalRecordFromStrings(
  root: PublicKey,
  baseTableName: string,
  idValue: string,
  extTableName: string
) {
  const baseSeed = deriveSeedBytes(baseTableName);
  const extSeed = deriveSeedBytes(extTableName);
  return pdaExternalRecord(
    root,
    baseSeed,
    Buffer.from(idValue, "utf8"),
    extSeed
  );
}

export function pdaExtTable(root: PublicKey, tableName: string) {
  const tableSeed = deriveSeedBytes(tableName);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(configs.tableSeed),
      PROGRAM_ID.toBuffer(),
      root.toBuffer(),
      Buffer.from(tableSeed),
    ],
    PROGRAM_ID
  )[0];
}
