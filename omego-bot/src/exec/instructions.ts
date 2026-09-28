import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "node:module";
import type * as PumpSdkModule from "@pump-fun/pump-sdk";

// The SDK's ESM build pulls in @pump-fun/agent-payments-sdk, whose ESM bundle
// imports a `BN` named export that @coral-xyz/anchor's ESM build lacks.
const require = createRequire(import.meta.url);
const { PUMP_SDK } = require("@pump-fun/pump-sdk") as typeof PumpSdkModule;

export interface BuyIxParams {
  user: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  tokenProgram: PublicKey;
  tokenAmount: bigint;
  maxSolCostLamports: bigint;
  feeRecipient: PublicKey;
  buybackFeeRecipient: PublicKey;
}

export interface SellIxParams {
  user: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  tokenProgram: PublicKey;
  tokenAmount: bigint;
  minSolOutLamports: bigint;
  feeRecipient: PublicKey;
  buybackFeeRecipient: PublicKey;
  cashback: boolean;
}

/** Legacy pump.fun `buy` (native SOL), the variant omego uses for ~2/3 of its buys. */
export async function buildPumpBuyIx(p: BuyIxParams): Promise<TransactionInstruction> {
  const ix = await PUMP_SDK.getBuyInstructionRaw({
    user: p.user,
    mint: p.mint,
    creator: p.creator,
    amount: new BN(p.tokenAmount.toString()),
    solAmount: new BN(p.maxSolCostLamports.toString()),
    feeRecipient: p.feeRecipient,
    tokenProgram: p.tokenProgram,
    buybackFeeRecipient: p.buybackFeeRecipient,
  });
  // The IDL marks global_volume_accumulator read-only; omego's buys pass it writable.
  ix.keys[GLOBAL_VOLUME_ACCUMULATOR_INDEX] = {
    ...ix.keys[GLOBAL_VOLUME_ACCUMULATOR_INDEX],
    isWritable: true,
  };
  return ix;
}

const GLOBAL_VOLUME_ACCUMULATOR_INDEX = 12;

/** Legacy pump.fun `sell`. omego always passes min_sol_output = 0. */
export function buildPumpSellIx(p: SellIxParams): Promise<TransactionInstruction> {
  return PUMP_SDK.getSellInstructionRaw({
    user: p.user,
    mint: p.mint,
    creator: p.creator,
    amount: new BN(p.tokenAmount.toString()),
    solAmount: new BN(p.minSolOutLamports.toString()),
    feeRecipient: p.feeRecipient,
    buybackFeeRecipient: p.buybackFeeRecipient,
    tokenProgram: p.tokenProgram,
    cashback: p.cashback,
  });
}
