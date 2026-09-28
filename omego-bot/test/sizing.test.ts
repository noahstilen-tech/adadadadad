import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buyCostLamports, sellProceedsLamports } from "../src/curve.js";
import { sizeBuy } from "../src/sizing.js";

interface Row {
  signature: string;
  vsPre: string;
  vtPre: string;
  tokenAmount: string;
  solAmount: string;
  maxSolCost?: string;
}

const fx = JSON.parse(readFileSync(new URL("./fixtures/omego_trades.json", import.meta.url), "utf8")) as {
  buys: Row[];
  sells: Row[];
};
const reserves = (r: Row) => ({ virtualSolReserves: BigInt(r.vsPre), virtualTokenReserves: BigInt(r.vtPre) });

test("buy cost matches every omego buy to the lamport", () => {
  for (const b of fx.buys) assert.equal(buyCostLamports(reserves(b), BigInt(b.tokenAmount)), BigInt(b.solAmount), b.signature);
});

test("sell proceeds match every omego sell to the lamport", () => {
  for (const s of fx.sells) assert.equal(sellProceedsLamports(reserves(s), BigInt(s.tokenAmount)), BigInt(s.solAmount), s.signature);
});

test("sizing reproduces omego's max_sol_cost and token amount", () => {
  // Only buys that executed against the reserves omego saw; others had trades land ahead of them.
  const clean = fx.buys.filter((b) => {
    const cap = BigInt(Math.floor(Number(b.vsPre) / 100));
    return cap === BigInt(b.maxSolCost!);
  });
  assert.ok(clean.length >= 70, `only ${clean.length} clean buys`);
  for (const b of clean) {
    const o = sizeBuy(reserves(b), 1);
    assert.equal(o.maxSolCostLamports, BigInt(b.maxSolCost!), b.signature);
    const diff = o.tokenAmount - BigInt(b.tokenAmount);
    // omego's own float rounding lands within ~10 raw units (1e-5 tokens) of the exact quote.
    assert.ok(diff >= -20n && diff <= 20n, `${b.signature}: token diff ${diff}`);
  }
});
