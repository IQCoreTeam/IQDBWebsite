'use client'

import type { Idl, Program } from '@coral-xyz/anchor'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'
import { configs } from '../configs'
import { getAnchorProvider, getProgram, type WalletAdapterLike } from './provider'

const enc = new TextEncoder()

// Resolve program id from ctx.idl or fallback configs
function programPkFromCtx<T extends Idl>(ctx: { idl: T; programId?: string }) {
  const addr = (ctx.programId as string) || ((ctx.idl as any)?.address as string) || configs.programId
  return new PublicKey(addr)
}

// PDA helpers calculated with program id from IDL (must match on-chain seeds)
function pdaRootDyn(programId: PublicKey, signer: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('iqdb-root'), programId.toBuffer(), signer.toBuffer()],
    programId
  )[0]
}
function pdaTxRefDyn(programId: PublicKey, signer: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('iqdb-txref'), programId.toBuffer(), signer.toBuffer()],
    programId
  )[0]
}
function pdaTargetTxRefDyn(programId: PublicKey, signer: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('iqdb-txref'), programId.toBuffer(), signer.toBuffer(), Buffer.from('target')],
    programId
  )[0]
}
function pdaTableDyn(programId: PublicKey, rootPk: PublicKey, tableNameBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('iqdb-table'), programId.toBuffer(), rootPk.toBuffer(), Buffer.from(tableNameBytes)],
    programId
  )[0]
}
function pdaInstructionTableDyn(programId: PublicKey, rootPk: PublicKey, tableNameBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('iqdb-table'),
      programId.toBuffer(),
      rootPk.toBuffer(),
      Buffer.from(tableNameBytes),
      Buffer.from('instruction'),
    ],
    programId
  )[0]
}

function pdaExtTableDyn(programId: PublicKey, signer: PublicKey, tableNameBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('iqdb-ext-table'),
      programId.toBuffer(),
      signer.toBuffer(),
      Buffer.from(tableNameBytes),
    ],
    programId
  )[0]
}

function pdaExtInstructionTableDyn(programId: PublicKey, signer: PublicKey, tableNameBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('iqdb-ext-table'),
      programId.toBuffer(),
      signer.toBuffer(),
      Buffer.from(tableNameBytes),
      Buffer.from('instruction'),
    ],
    programId
  )[0]
}

export type WriterCtx<T extends Idl = Idl> = {
  connection: Connection
  wallet: WalletAdapterLike
  idl: T
  programId?: string
}

function programFromCtx<T extends Idl>(ctx: WriterCtx<T>): Program<T> {
  const provider = getAnchorProvider(ctx.connection, ctx.wallet)
  return getProgram<T>(ctx.idl, provider)
}

/**
 * initializeRootWeb
 * - Initialize root/txRef PDAs for the wallet owner
 */
export async function initializeRootWeb<T extends Idl>(ctx: WriterCtx<T>) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const programId = programPkFromCtx(ctx)

  // Derive PDAs with program id from IDL
  const rootPda = pdaRootDyn(programId, signer)
  const txRefPda = pdaTxRefDyn(programId, signer)
  const targetTxRefPda = pdaTargetTxRefDyn(programId, signer)

  // Resolve method name dynamically (camelCase or snake_case)
  const methods = (program as any).methods as Record<string, any>
  const init = methods?.initializeRoot ?? methods?.initialize_root
  if (!init) {
    throw new Error('Instruction "initializeRoot" (or initialize_root) not found in IDL')
  }

  const tx = await init()
    .accounts({
      root: rootPda,
      tx_ref: txRefPda,
      target_tx_ref: targetTxRefPda,
      signer,
      system_program: SystemProgram.programId,
    })
    .transaction()

  return { tx, root: rootPda.toBase58(), txRef: txRefPda.toBase58() }
}

/**
 * createTableWeb
 * - Create a table for given name + columns under caller's root
 * - options: { idColumn?: string|number; extKeys?: string[] }
 */
export async function createTableWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  columnNames: string[],
  options?: { idColumn?: string | number; extKeys?: string[] }
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const programId = programPkFromCtx(ctx)

  // Derive PDAs from IDL.address
  const root = pdaRootDyn(programId, signer)
  const seed = enc.encode(tableName)
  const table = pdaTableDyn(programId, root, seed)
  const instTable = pdaInstructionTableDyn(programId, root, seed)

  const methods = (program as any).methods as Record<string, any>
  const create = methods?.create_table ?? methods?.createTable
  if (!create) {
    throw new Error('Instruction "create_table" not found in IDL')
  }

  // IDL args: (table_name: bytes, column_names: Vec<bytes>, id_col: bytes, ext_keys: Vec<bytes>)
  const nameBuf = Buffer.from(tableName, 'utf8')
  const colBufs = columnNames.map((s) => Buffer.from(s, 'utf8'))

  // id_col must be a column name present in column_names
  const idOpt = options?.idColumn
  const idName =
    typeof idOpt === 'string'
      ? idOpt
      : typeof idOpt === 'number' && columnNames[idOpt]
      ? columnNames[idOpt]
      : columnNames[0]
  if (!idName) throw new Error('idColumn is required to create table')
  const idColBuf = Buffer.from(idName, 'utf8')

  const extKeys = options?.extKeys ?? []
  const extKeysBufs = extKeys.map((s) => Buffer.from(String(s), 'utf8'))

  const tx = await create(nameBuf, colBufs, idColBuf, extKeysBufs)
    .accounts({
      root,
      signer,
      table,
      instruction_table: instTable,
      system_program: SystemProgram.programId,
    })
    .transaction()

  return { tx, table: table.toBase58(), instructionTable: instTable.toBase58() }
}

export async function createExtTableWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  columnNames: string[],
  options?: { idColumn?: string | number; extKeys?: string[] }
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const programId = programPkFromCtx(ctx)

  const seed = enc.encode(tableName)
  const table = pdaExtTableDyn(programId, signer, seed)
  const instTable = pdaExtInstructionTableDyn(programId, signer, seed)

  const methods = (program as any).methods as Record<string, any>
  const createExt = methods?.create_ext_table ?? methods?.createExtTable
  if (!createExt) {
    throw new Error('Instruction "create_ext_table" not found in IDL')
  }

  const nameBuf = Buffer.from(tableName, 'utf8')
  const colBufs = columnNames.map((s) => Buffer.from(s, 'utf8'))

  const idOpt = options?.idColumn
  const idName =
    typeof idOpt === 'string'
      ? idOpt
      : typeof idOpt === 'number' && columnNames[idOpt]
      ? columnNames[idOpt]
      : columnNames[0]
  if (!idName) throw new Error('idColumn is required to create extension table')
  const idColBuf = Buffer.from(idName, 'utf8')

  const extKeys = options?.extKeys ?? []
  const extKeysBufs = extKeys.map((s) => Buffer.from(String(s), 'utf8'))

  const tx = await createExt(nameBuf, colBufs, idColBuf, extKeysBufs)
    .accounts({
      signer,
      table,
      instruction_table: instTable,
      system_program: SystemProgram.programId,
    })
    .transaction()

  return { tx, table: table.toBase58(), instructionTable: instTable.toBase58() }
}

/**
 * updateTableColumnsWeb
 * - Update a table's column list by name.
 * - options: { idColumn?: string|number; extKeys?: string[] }
 * - Resolves method name dynamically
 */
export async function updateTableColumnsWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  columnNames: string[],
  options?: { idColumn?: string | number; extKeys?: string[] }
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const programId = programPkFromCtx(ctx)

  const root = pdaRootDyn(programId, signer)
  const seed = enc.encode(tableName)
  const table = pdaTableDyn(programId, root, seed)

  const methods = (program as any).methods as Record<string, any>
  const upd = methods?.update_table ?? methods?.updateTable
  if (!upd) {
    throw new Error('Instruction "update_table" not found in IDL')
  }

  const nameBuf = Buffer.from(tableName, 'utf8')
  const colBufs = columnNames.map((s) => Buffer.from(s, 'utf8'))
  const idOpt = options?.idColumn
  const idName =
    typeof idOpt === 'string'
      ? idOpt
      : typeof idOpt === 'number' && columnNames[idOpt]
      ? columnNames[idOpt]
      : columnNames[0]
  if (!idName) throw new Error('idColumn is required to update table')
  const idColBuf = Buffer.from(idName, 'utf8')

  const extKeys = options?.extKeys ?? []
  const extKeysBufs = extKeys.map((s) => Buffer.from(String(s), 'utf8'))

  const tx = await upd(nameBuf, colBufs, idColBuf, extKeysBufs)
    .accounts({
      root,
      table,
      signer,
    })
    .transaction()

  return { tx, table: table.toBase58() }
}

/**
 * writeRowWeb
 * - Write a JSON row to table and reference TxRef
 */
export async function writeRowWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  rowJson: string
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const programId = programPkFromCtx(ctx)
  const root = pdaRootDyn(programId, signer)
  const txRef = pdaTxRefDyn(programId, signer)
  const seed = enc.encode(tableName)
  const table = pdaTableDyn(programId, root, seed)

  const methods = (program as any).methods as Record<string, any>
  const write = methods?.write_data ?? methods?.writeData
  if (!write) {
    throw new Error('Instruction "write_data" not found in IDL')
  }

  const tx = await write(Buffer.from(tableName, 'utf8'), Buffer.from(rowJson, 'utf8'))
    .accounts({
      root,
      table,
      tx_ref: txRef,
      signer,
    })
    .transaction()

  return { tx }
}

export type EditMode = 'update' | 'delete'
function enumEditMode(mode: EditMode): any {
  return mode === 'update' ? { update: {} } : { delete: {} }
}

/**
 * pushDbInstructionWeb
 * - Append update/delete instruction row for a given table
 */
export async function pushDbInstructionWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  mode: EditMode,
  targetTxSig: string,
  contentJson: string
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const programId = programPkFromCtx(ctx)
  const root = pdaRootDyn(programId, signer)
  const txRef = pdaTxRefDyn(programId, signer)
  const targetTxRef = pdaTargetTxRefDyn(programId, signer)
  const seed = enc.encode(tableName)
  const instTable = pdaInstructionTableDyn(programId, root, seed)

  const methods = (program as any).methods as Record<string, any>
  const dbInstr = methods?.database_instruction ?? methods?.databaseInstruction
  if (!dbInstr) {
    throw new Error('Instruction "database_instruction" not found in IDL')
  }

  const tx = await dbInstr(
      Array.from(enc.encode(tableName)),
      enumEditMode(mode),
      Array.from(enc.encode(targetTxSig)),
      Array.from(enc.encode(contentJson))
    )
    .accounts({
      root,
      instruction_table: instTable,
      tx_ref: txRef,
      target_tx_ref: targetTxRef,
      signer,
    })
    .transaction()

  return { tx }
}
