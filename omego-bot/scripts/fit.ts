/**
 * Random search over strategy parameters on the first part of a recording, scored on the
 * held-out rest. Uses the exact engine the live bot runs.
 *   IN=data/stream.jsonl N=300 TRAIN=0.6 npx tsx scripts/fit.ts
 */
import { DEFAULT_PARAMS, type StrategyParams } from "../src/strategy.js";
import { loadRecording, replay } from "./replay.js";

const txs = loadRecording(process.env.IN ?? "data/stream.jsonl");
const cut = Math.floor(txs.length * Number(process.env.TRAIN ?? 0.6));
const train = txs.slice(0, cut);
const test = txs.slice(cut);
const N = Number(process.env.N ?? 300);

const space: { [K in keyof StrategyParams]?: number[] } = {
  minRealSol: [4, 6, 8, 10],
  maxRealSol: [45, 65, 75],
  minTrades: [0, 5, 10, 20, 30, 45],
  activitySlots: [10, 20, 40],
  entryMinTriggerRel: [0, 0.005, 0.01, 0.02, 0.03],
  entryMinJump: [-1, 0, 0.02, 0.04, 0.06],
  entryMaxJump: [0.1, 0.2, 1],
  jumpLookbackSlots: [1, 2, 3],
  trailingStop: [0.05, 0.07, 0.1, 0.15, 0.2],
  stopLoss: [0.08, 0.12, 0.2, 1],
  tpSpikeJump: [0.05, 0.08, 0.12, 1e9],
  tpMinReturn: [0, 0.05, 0.1, 0.2],
  exitOnSellRel: [0.02, 0.03, 0.05, 1],
};

function sample(): StrategyParams {
  const p: StrategyParams = { ...DEFAULT_PARAMS };
  for (const [k, vals] of Object.entries(space) as [keyof StrategyParams, number[]][]) {
    p[k] = vals[Math.floor(Math.random() * vals.length)];
  }
  return p;
}

const results: { p: StrategyParams; score: number; tr: ReturnType<typeof replay> }[] = [];
for (let i = 0; i < N; i++) {
  const p = i === 0 ? DEFAULT_PARAMS : sample();
  const tr = replay(train, p);
  // Profit, but only for configurations that actually trade at a rate comparable to omego.
  const activity = Math.min(tr.ours.rounds / Math.max(tr.omego.rounds, 1), 1);
  results.push({ p, score: tr.ours.pnlSol * activity, tr });
}
results.sort((a, b) => b.score - a.score);
for (const r of results.slice(0, 5)) {
  const te = replay(test, r.p);
  console.log(JSON.stringify({ params: r.p, train: r.tr, test: te }));
}
