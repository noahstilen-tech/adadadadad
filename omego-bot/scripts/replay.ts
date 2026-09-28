/**
 * Replays a recorded stream (scripts/record.ts) through the paper engine and compares
 * our decisions with the shadow wallet's (omego's) actual trades in the same recording.
 *   IN=data/stream.jsonl PARAMS='{"entryMinJump":0.05}' npx tsx scripts/replay.ts
 */
import { Connection } from "@solana/web3.js";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { loadConfig } from "../src/config.js";
import { Engine } from "../src/engine.js";
import type { TradeEvent } from "../src/events.js";
import { DEFAULT_PARAMS, type StrategyParams } from "../src/strategy.js";

interface RecEv {
  m: string; b: number; sol: string; tok: string; u: string; ts: number;
  vs: string; vt: string; rs: string; c: string; fb: number; cfb: number; ix: string; mh: number;
}
interface RecTx { sig: string; slot: number; idx: number | null; rx: number; ev: RecEv[] }

function toEvent(e: RecEv): TradeEvent {
  return {
    mint: e.m, isBuy: e.b === 1, solAmount: BigInt(e.sol), tokenAmount: BigInt(e.tok), user: e.u, timestamp: e.ts,
    virtualSolReserves: BigInt(e.vs), virtualTokenReserves: BigInt(e.vt), realSolReserves: BigInt(e.rs),
    realTokenReserves: 0n, feeBasisPoints: BigInt(e.fb), creator: e.c, creatorFeeBasisPoints: BigInt(e.cfb),
    ixName: e.ix, mayhemMode: e.mh === 1, cashbackFeeBasisPoints: 0n,
  };
}

export async function replay(path: string, params: StrategyParams, slotTolerance = 2) {
  process.env.MODE = "paper";
  const cfg = { ...loadConfig(), mode: "paper" as const, logFile: null };
  const shadow = cfg.shadowWallet!.toBase58();
  const records: Record<string, unknown>[] = [];
  const engine = new Engine(cfg, params, new Connection(cfg.rpcUrl), (o) => records.push(o));
  const shadowBuys: { mint: string; slot: number }[] = [];
  const rl = createInterface({ input: createReadStream(path) });
  for await (const line of rl) {
    if (!line) continue;
    const tx = JSON.parse(line) as RecTx;
    const events = tx.ev.map(toEvent);
    for (const e of events) if (e.user === shadow && e.isBuy) shadowBuys.push({ mint: e.mint, slot: tx.slot });
    engine.onTx({ signature: tx.sig, slot: tx.slot, txIndex: tx.idx, events, receivedAt: tx.rx });
  }
  const ours = records.filter((r) => r.kind === "buy") as { mint: string; slot: number }[];
  const sells = records.filter((r) => r.kind === "sell") as { pnlSol: number; reason: string; holdSec: number }[];
  const near = (a: { mint: string; slot: number }, b: { mint: string; slot: number }) =>
    a.mint === b.mint && Math.abs(a.slot - b.slot) <= slotTolerance;
  const matched = shadowBuys.filter((s) => ours.some((o) => near(o, s))).length;
  const precise = ours.filter((o) => shadowBuys.some((s) => near(o, s))).length;
  const reasons: Record<string, number> = {};
  for (const s of sells) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  return {
    omegoBuys: shadowBuys.length,
    ourBuys: ours.length,
    recall: shadowBuys.length ? matched / shadowBuys.length : 0,
    precision: ours.length ? precise / ours.length : 0,
    rounds: engine.stats.rounds,
    winRate: engine.stats.rounds ? engine.stats.wins / engine.stats.rounds : 0,
    pnlSol: engine.stats.pnlLamports / 1e9,
    exitReasons: reasons,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const params = { ...DEFAULT_PARAMS, ...(JSON.parse(process.env.PARAMS ?? "{}") as Partial<StrategyParams>) };
  const res = await replay(process.env.IN ?? "data/stream.jsonl", params);
  console.log(JSON.stringify({ params, ...res }, null, 2));
}
