import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  BUYBACK_FEE_RECIPIENTS,
  HELIUS_SENDER_TIP_ACCOUNTS,
  MAYHEM_FEE_RECIPIENTS,
  NORMAL_FEE_RECIPIENTS,
  pickRandom,
} from "../constants.js";
import { buildPumpBuyIx, buildPumpSellIx } from "./instructions.js";

export interface MintInfo {
  mint: PublicKey;
  creator: PublicKey;
  tokenProgram: PublicKey;
  mayhemMode: boolean;
  cashback: boolean;
}

export interface ExecParams {
  payer: Keypair;
  blockhash: string;
  cuLimit: number;
  microLamportsPerCu: number;
  tipLamports: number;
}

function budgetAndTip(p: ExecParams): { head: TransactionInstruction[]; tip: TransactionInstruction } {
  return {
    head: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: p.cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.microLamportsPerCu }),
    ],
    tip: SystemProgram.transfer({
      fromPubkey: p.payer.publicKey,
      toPubkey: pickRandom(HELIUS_SENDER_TIP_ACCOUNTS),
      lamports: p.tipLamports,
    }),
  };
}

function compile(p: ExecParams, ixs: TransactionInstruction[]): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: p.payer.publicKey,
    recentBlockhash: p.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([p.payer]);
  return tx;
}

function feeRecipient(m: MintInfo): PublicKey {
  return pickRandom(m.mayhemMode ? MAYHEM_FEE_RECIPIENTS : NORMAL_FEE_RECIPIENTS);
}

/**
 * omego's direct buy: create token ATA → legacy pump `buy` → tip. omego also wraps the
 * budget into wSOL and closes it again in the same tx; legacy `buy` pays in native SOL,
 * so that round-trip has no effect and is left out.
 */
export async function buildBuyTx(
  p: ExecParams,
  m: MintInfo,
  tokenAmount: bigint,
  maxSolCostLamports: bigint,
): Promise<VersionedTransaction> {
  const user = p.payer.publicKey;
  const ata = getAssociatedTokenAddressSync(m.mint, user, true, m.tokenProgram);
  const { head, tip } = budgetAndTip(p);
  const buy = await buildPumpBuyIx({
    user,
    mint: m.mint,
    creator: m.creator,
    tokenProgram: m.tokenProgram,
    tokenAmount,
    maxSolCostLamports,
    feeRecipient: feeRecipient(m),
    buybackFeeRecipient: pickRandom(BUYBACK_FEE_RECIPIENTS),
  });
  return compile(p, [
    ...head,
    createAssociatedTokenAccountIdempotentInstruction(user, ata, user, m.mint, m.tokenProgram),
    buy,
    tip,
  ]);
}

/** omego's sell: full balance, min_sol_output = 0, then close the token ATA to reclaim rent. */
export async function buildSellTx(p: ExecParams, m: MintInfo, tokenAmount: bigint): Promise<VersionedTransaction> {
  const user = p.payer.publicKey;
  const ata = getAssociatedTokenAddressSync(m.mint, user, true, m.tokenProgram);
  const { head, tip } = budgetAndTip(p);
  const sell = await buildPumpSellIx({
    user,
    mint: m.mint,
    creator: m.creator,
    tokenProgram: m.tokenProgram,
    tokenAmount,
    minSolOutLamports: 0n,
    feeRecipient: feeRecipient(m),
    buybackFeeRecipient: pickRandom(BUYBACK_FEE_RECIPIENTS),
    cashback: m.cashback,
  });
  return compile(p, [...head, sell, createCloseAccountInstruction(ata, user, user, [], m.tokenProgram), tip]);
}
