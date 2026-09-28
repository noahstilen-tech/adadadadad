/**
 * Replays a recorded stream (scripts/record.ts) through the paper engine and compares
 * our decisions with the shadow wallet's (omego's) actual trades in the same recording.
 *   IN=data/stream.jsonl PARAMS='{"entryMinJump":0.05}' npx tsx scripts/replay.ts
 */
import { Connection } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { Engine } from "../src/engine.js";
import type { TradeEvent } from "../src/events.js";
import { DEFAULT_PARAMS, type StrategyParams } from "../src/strategy.js";
import type { TradeTx } from "../src/stream.js";

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

export function loadRecording(path: string): TradeTx[] {
  const out: TradeTx[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const tx = JSON.parse(line) as RecTx;
    const events = tx.ev.map(toEvent).filter((e) => e.virtualSolReserves > 0n && e.virtualTokenReserves > 0n);
    if (events.length) out.push({ signature: tx.sig, slot: tx.slot, txIndex: tx.idx, events, receivedAt: tx.rx });
  }
  return out;
}

export interface ShadowStats {
  buys: { mint: string; slot: number }[];
  rounds: number;
  pnlSol: number;
}

/** omego's realized PnL in the recording, with its real fees, CU prices and tips. */
export function shadowStats(txs: TradeTx[], shadow: string): ShadowStats {
  const buys: { mint: string; slot: number }[] = [];
  const cost = new Map<string, number>();
  let pnl = 0;
  let rounds = 0;
  for (const tx of txs) {
    for (const e of tx.events) {
      if (e.user !== shadow) continue;
      const fee = Number(e.feeBasisPoints + e.creatorFeeBasisPoints) / 1e4;
      if (e.isBuy) {
        buys.push({ mint: e.mint, slot: tx.slot });
        cost.set(e.mint, Number(e.solAmount) * (1 + fee) + 92_500 + 200_000);
      } else if (cost.has(e.mint)) {
        pnl += Number(e.solAmount) * (1 - fee) - 105_000 - 20_000 - cost.get(e.mint)!;
        cost.delete(e.mint);
        rounds++;
      }
    }
  }
  return { buys, rounds, pnlSol: pnl / 1e9 };
}

export function replay(txs: TradeTx[], params: StrategyParams, slotTolerance = 2) {
  process.env.MODE = "paper";
  const cfg = { ...loadConfig(), mode: "paper" as const, logFile: null };
  const shadow = shadowStats(txs, cfg.shadowWallet!.toBase58());
  const records: Record<string, unknown>[] = [];
  const engine = new Engine(cfg, params, new Connection(cfg.rpcUrl), (o) => records.push(o));
  for (const tx of txs) engine.onTx(tx);
  const ours = records.filter((r) => r.kind === "buy") as { mint: string; slot: number }[];
  const sells = records.filter((r) => r.kind === "sell") as { reason: string }[];
  const near = (a: { mint: string; slot: number }, b: { mint: string; slot: number }) =>
    a.mint === b.mint && Math.abs(a.slot - b.slot) <= slotTolerance;
  const matched = shadow.buys.filter((s) => ours.some((o) => near(o, s))).length;
  const precise = ours.filter((o) => shadow.buys.some((s) => near(o, s))).length;
  const reasons: Record<string, number> = {};
  for (const s of sells) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  const minutes = (txs[txs.length - 1].receivedAt - txs[0].receivedAt) / 60_000;
  return {
    minutes: Math.round(minutes),
    omego: { buys: shadow.buys.length, rounds: shadow.rounds, pnlSol: +shadow.pnlSol.toFixed(3) },
    ours: {
      buys: ours.length,
      rounds: engine.stats.rounds,
      winRate: engine.stats.rounds ? +(engine.stats.wins / engine.stats.rounds).toFixed(3) : 0,
      pnlSol: +(engine.stats.pnlLamports / 1e9).toFixed(3),
      exitReasons: reasons,
    },
    entryRecall: shadow.buys.length ? +(matched / shadow.buys.length).toFixed(3) : 0,
    entryPrecision: ours.length ? +(precise / ours.length).toFixed(3) : 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const params = { ...DEFAULT_PARAMS, ...(JSON.parse(process.env.PARAMS ?? "{}") as Partial<StrategyParams>) };
  const res = replay(loadRecording(process.env.IN ?? "data/stream.jsonl"), params);
  console.log(JSON.stringify({ params, ...res }, null, 2));
}
