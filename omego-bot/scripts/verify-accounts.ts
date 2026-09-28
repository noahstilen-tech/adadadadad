/**
 * Rebuilds omego's real legacy buy/sell instructions with our builder and checks
 * that program, accounts (incl. writability) and instruction data match on-chain.
 *
 *   RPC_URL=https://api.mainnet-beta.solana.com npx tsx scripts/verify-accounts.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { extractTradeEvents } from "../src/events.js";
import { buildPumpBuyIx, buildPumpSellIx } from "../src/exec/instructions.js";
import { PUMP_PROGRAM_ID } from "../src/constants.js";

const rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpcUrl, "confirmed");
const samples = JSON.parse(
  readFileSync(new URL("../../solana-bot-analysis/reports/omego_ix_accounts.json", import.meta.url), "utf8"),
) as Record<string, { signature: string }>;

async function check(kind: "buy" | "sell"): Promise<boolean> {
  const sig = samples[kind].signature;
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });
  if (!tx) throw new Error(`tx not found ${sig}`);
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });
  const msg = tx.transaction.message;
  const ix = msg.compiledInstructions.find((c) => keys.get(c.programIdIndex)!.equals(PUMP_PROGRAM_ID));
  if (!ix) throw new Error("no pump ix");
  const onchain = ix.accountKeyIndexes.map((i) => ({
    pubkey: keys.get(i)!.toBase58(),
    writable: msg.isAccountWritable(i),
  }));
  const [ev] = extractTradeEvents(tx.meta?.logMessages);
  const user = new PublicKey(ev.user);
  const mint = new PublicKey(ev.mint);
  const tokenProgram = keys.get(ix.accountKeyIndexes[kind === "buy" ? 8 : 9])!;
  const data = Buffer.from(ix.data);
  const amount = data.readBigUInt64LE(8);
  const solArg = data.readBigUInt64LE(16);
  const feeRecipient = new PublicKey(onchain[1].pubkey);
  const buybackFeeRecipient = new PublicKey(onchain[onchain.length - 1].pubkey);
  const built =
    kind === "buy"
      ? await buildPumpBuyIx({
          user, mint, creator: new PublicKey(ev.creator), tokenProgram,
          tokenAmount: amount, maxSolCostLamports: solArg, feeRecipient, buybackFeeRecipient,
        })
      : await buildPumpSellIx({
          user, mint, creator: new PublicKey(ev.creator), tokenProgram,
          tokenAmount: amount, minSolOutLamports: solArg, feeRecipient, buybackFeeRecipient,
          cashback: ev.cashbackFeeBasisPoints > 0n,
        });
  const ours = built.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), writable: k.isWritable }));
  let ok = ours.length === onchain.length && built.programId.equals(PUMP_PROGRAM_ID);
  const n = Math.max(ours.length, onchain.length);
  for (let i = 0; i < n; i++) {
    const a = onchain[i];
    const b = ours[i];
    const same = a && b && a.pubkey === b.pubkey && a.writable === b.writable;
    if (!same) ok = false;
    console.log(`${same ? "  " : "!!"} ${i} chain=${a?.pubkey}${a?.writable ? "(W)" : ""} ours=${b?.pubkey}${b?.writable ? "(W)" : ""}`);
  }
  const dataSame = Buffer.compare(Buffer.from(built.data).subarray(0, 24), data.subarray(0, 24)) === 0;
  console.log(`${kind}: accounts ${ok ? "MATCH" : "MISMATCH"}, data(disc+args) ${dataSame ? "MATCH" : "MISMATCH"}`);
  console.log(`  event: ixName=${ev.ixName} mayhem=${ev.mayhemMode} cashbackBps=${ev.cashbackFeeBasisPoints} feeBps=${ev.feeBasisPoints} creatorFeeBps=${ev.creatorFeeBasisPoints}`);
  return ok && dataSame;
}

const results = [await check("buy"), await check("sell")];
process.exit(results.every(Boolean) ? 0 : 1);
