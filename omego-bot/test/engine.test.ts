import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection } from "@solana/web3.js";
import { Engine } from "../src/engine.js";
import type { Config } from "../src/config.js";
import type { TradeEvent } from "../src/events.js";
import { DEFAULT_PARAMS } from "../src/strategy.js";

const MINT = "9LDsRyhCmGCrVy4QKSrDZaBPVnJEvESmBRNVhFMtpump";

const cfg: Config = {
  mode: "paper",
  rpcUrl: "http://localhost:1",
  grpcEndpoint: null,
  grpcToken: null,
  wsUrl: "ws://localhost:1",
  senderUrl: "http://localhost:1",
  keypair: null,
  sizePctOfVirtualSol: 1,
  maxOpenPositions: 5,
  shadowWallet: null,
  buyTipLamports: 200_000,
  sellTipLamports: 20_000,
  microLamportsPerCu: 500_000,
  buyCuLimit: 175_000,
  sellCuLimit: 200_000,
  logFile: null,
};

function trade(vsSol: number, isBuy: boolean): TradeEvent {
  const k = 30e9 * 1_073_000_000e6;
  const vs = BigInt(Math.round(vsSol * 1e9));
  return {
    mint: MINT, solAmount: 1_000_000_000n, tokenAmount: 1_000_000_000n, isBuy, user: "someone", timestamp: 0,
    virtualSolReserves: vs, virtualTokenReserves: BigInt(Math.round(k / Number(vs))), realSolReserves: vs - 30_000_000_000n,
    realTokenReserves: 0n, feeBasisPoints: 95n, creator: "11111111111111111111111111111111", creatorFeeBasisPoints: 30n,
    ixName: "buy", mayhemMode: false, cashbackFeeBasisPoints: 0n,
  };
}

test("paper round: enters on a jump, exits on the trailing stop", () => {
  const recs: Record<string, unknown>[] = [];
  const engine = new Engine(cfg, { ...DEFAULT_PARAMS, minTrades: 0 }, new Connection(cfg.rpcUrl), (o) => recs.push(o));
  let slot = 100;
  const feed = (vsSol: number, isBuy = true) =>
    engine.onTx({ signature: `s${slot}`, slot: slot++, txIndex: 0, events: [trade(vsSol, isBuy)], receivedAt: slot * 400 });
  feed(45);
  feed(45);
  feed(45);
  feed(47); // ~+9% price over 2 slots → entry
  assert.equal(recs.filter((r) => r.kind === "buy").length, 1);
  feed(47.5);
  feed(44, false); // −15% from peak → trailing stop
  const sell = recs.find((r) => r.kind === "sell");
  assert.ok(sell, "expected a sell");
  assert.equal(sell!.reason, "trailing_stop");
  assert.ok((sell!.pnlSol as number) < 0);
  assert.equal(engine.stats.rounds, 1);
});
