'use client'

import type { Idl, Program } from '@coral-xyz/anchor'
import { Connection, SystemProgram } from '@solana/web3.js'
import { configs } from '../configs'
import {
  pdaRoot,
  pdaTxRef,
  pdaTargetTxRef,
  pdaTable,
  pdaInstructionTable,
} from '@/lib/onchainDB'
import { getAnchorProvider, getProgram, type WalletAdapterLike } from './provider'

const enc = new TextEncoder()

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
  const rootPda = pdaRoot(signer)
  const txRefPda = pdaTxRef(signer)
  const targetTxRefPda = pdaTargetTxRef(signer)

  // Resolve method name dynamically (camelCase or snake_case)
  const methods = (program as any).methods as Record<string, any>
  const init = methods?.initializeRoot ?? methods?.initialize_root
  if (!init) {
    throw new Error('Instruction "initializeRoot" (or initialize_root) not found in IDL')
  }

  const tx = await init()
    .accounts({
      root: rootPda,
      txRef: txRefPda,
      targetTxRef: targetTxRefPda,
      signer,
      systemProgram: SystemProgram.programId,
    })
    .transaction()

  return { tx, root: rootPda.toBase58(), txRef: txRefPda.toBase58() }
}

/**
 * createTableWeb
 * - Create a table for given name + columns under caller's root
 */
export async function createTableWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  columnNames: string[]
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const root = pdaRoot(signer)
  const seed = enc.encode(tableName)
  const table = pdaTable(root, seed)
  const instTable = pdaInstructionTable(root, seed)

  // Resolve method name dynamically (camelCase or snake_case)
  const methods = (program as any).methods as Record<string, any>
  const create = methods?.createTable ?? methods?.create_table
  if (!create) {
    throw new Error('Instruction "createTable" (or create_table) not found in IDL')
  }

  const tx = await create(Buffer.from(tableName, 'utf8'), columnNames.map((s) => Buffer.from(s, 'utf8')))
    .accounts({
      root,
      signer,
      table,
      instructionTable: instTable,
      systemProgram: SystemProgram.programId,
    })
    .transaction()

  return { tx, table: table.toBase58(), instructionTable: instTable.toBase58() }
}

/**
 * updateTableColumnsWeb
 * - Update a table's column list by name.
 * - Resolves method name dynamically (update_table | updateTableColumns | update_table_columns | setTableColumns | set_table_columns | updateColumns | update_columns).
 */
export async function updateTableColumnsWeb<T extends Idl>(
  ctx: WriterCtx<T>,
  tableName: string,
  columnNames: string[]
) {
  const program = programFromCtx(ctx)
  const signer = program.provider.publicKey!
  const root = pdaRoot(signer)
  const seed = enc.encode(tableName)
  const table = pdaTable(root, seed)

  const methods = (program as any).methods as Record<string, any>
  const upd =
    methods?.update_table ??
    methods?.updateTable ??
    methods?.updateTableColumns ??
    methods?.update_table_columns ??
    methods?.setTableColumns ??
    methods?.set_table_columns ??
    methods?.updateColumns ??
    methods?.update_columns
  if (!upd) {
    throw new Error(
      'Instruction for updating columns not found (tried: update_table/updateTable/updateTableColumns/update_table_columns/setTableColumns/set_table_columns/updateColumns/update_columns)'
    )
  }

  const tx = await upd(Buffer.from(tableName, 'utf8'), columnNames.map((s) => Buffer.from(s, 'utf8')))
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
  const root = pdaRoot(signer)
  const txRef = pdaTxRef(signer)
  const seed = enc.encode(tableName)
  const table = pdaTable(root, seed)

  // Resolve method name dynamically (camelCase or snake_case)
  const methods = (program as any).methods as Record<string, any>
  const write = methods?.writeData ?? methods?.write_data
  if (!write) {
    throw new Error('Instruction "writeData" (or write_data) not found in IDL')
  }

  const tx = await write(Buffer.from(tableName, 'utf8'), Buffer.from(rowJson, 'utf8'))
    .accounts({
      root,
      table,
      txRef,
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
  const root = pdaRoot(signer)
  const txRef = pdaTxRef(signer)
  const targetTxRef = pdaTargetTxRef(signer)
  const seed = enc.encode(tableName)
  const instTable = pdaInstructionTable(root, seed)

  // Resolve method name dynamically (camelCase or snake_case)
  const methods = (program as any).methods as Record<string, any>
  const dbInstr = methods?.databaseInstruction ?? methods?.database_instruction
  if (!dbInstr) {
    throw new Error('Instruction "databaseInstruction" (or database_instruction) not found in IDL')
  }

  const tx = await dbInstr(
      Array.from(enc.encode(tableName)),
      enumEditMode(mode),
      Array.from(enc.encode(targetTxSig)),
      Array.from(enc.encode(contentJson))
    )
    .accounts({
      root,
      instructionTable: instTable,
      txRef,
      targetTxRef,
      signer,
    })
    .transaction()

  return { tx }
}




