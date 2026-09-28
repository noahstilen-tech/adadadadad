/**
 * Records every pump.fun TradeEvent from the live stream to JSONL, for fitting and
 * replaying the strategy offline against what omego actually did.
 *   OUT=data/stream.jsonl npx tsx scripts/record.ts
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../src/config.js";
import { streamPumpTrades } from "../src/stream.js";

const out = process.env.OUT ?? "data/stream.jsonl";
mkdirSync(dirname(out), { recursive: true });
const file = createWriteStream(out, { flags: "a" });
const cfg = loadConfig();

let n = 0;
await streamPumpTrades({ grpcEndpoint: cfg.grpcEndpoint, grpcToken: cfg.grpcToken, rpcUrl: cfg.rpcUrl, wsUrl: cfg.wsUrl }, (tx) => {
  n++;
  file.write(
    JSON.stringify({
      sig: tx.signature,
      slot: tx.slot,
      idx: tx.txIndex,
      rx: tx.receivedAt,
      ev: tx.events.map((e) => ({
        m: e.mint,
        b: e.isBuy ? 1 : 0,
        sol: e.solAmount.toString(),
        tok: e.tokenAmount.toString(),
        u: e.user,
        ts: e.timestamp,
        vs: e.virtualSolReserves.toString(),
        vt: e.virtualTokenReserves.toString(),
        rs: e.realSolReserves.toString(),
        c: e.creator,
        fb: Number(e.feeBasisPoints),
        cfb: Number(e.creatorFeeBasisPoints),
        ix: e.ixName,
        mh: e.mayhemMode ? 1 : 0,
      })),
    }) + "\n",
  );
});
setInterval(() => console.log(`[record] ${n} txs`), 30_000);
