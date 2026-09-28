import { buyCostLamports, tokensForLamports, type Reserves } from "./curve.js";

/**
 * omego's order sizing, recovered exactly from its on-chain buys:
 *   max_sol_cost = floor(virtual_sol_reserves * pct / 100)      (pct = 1 for omego, 2 for sssss)
 *   token_amount = tokens bought by max_sol_cost * 0.95 / 1.0005
 * i.e. a budget of 1% of the curve's virtual SOL with a 5% slippage cushion. The net fill
 * this produces is the previously fitted `0.286 + 0.00934 * real_sol` SOL.
 */
const SPEND_NUM = 9500n; // 0.95
const SPEND_DEN = 10005n; // 1.0005

export interface BuyOrder {
  tokenAmount: bigint;
  maxSolCostLamports: bigint;
  expectedNetLamports: bigint;
}

export function sizeBuy(r: Reserves, pctOfVirtualSol: number): BuyOrder {
  const maxSolCostLamports = BigInt(Math.floor((Number(r.virtualSolReserves) * pctOfVirtualSol) / 100));
  // The spend is fractional lamports (one lamport ≈ 10^4 raw tokens), so keep it rational.
  const tokenAmount =
    (r.virtualTokenReserves * maxSolCostLamports * SPEND_NUM) /
    (r.virtualSolReserves * SPEND_DEN + maxSolCostLamports * SPEND_NUM);
  return { tokenAmount, maxSolCostLamports, expectedNetLamports: buyCostLamports(r, tokenAmount) };
}
