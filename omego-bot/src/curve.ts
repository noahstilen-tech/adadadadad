/**
 * pump.fun bonding-curve math, exact to the lamport/raw-token for legacy buy/sell
 * (verified against 159 omego buys and 160 sells).
 */

export interface Reserves {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
}

/** Net lamports the curve takes for exactly `tokens` (fees excluded). */
export function buyCostLamports(r: Reserves, tokens: bigint): bigint {
  return (tokens * r.virtualSolReserves) / (r.virtualTokenReserves - tokens) + 1n;
}

/** Net lamports the curve pays for `tokens` (fees excluded). */
export function sellProceedsLamports(r: Reserves, tokens: bigint): bigint {
  return (tokens * r.virtualSolReserves) / (r.virtualTokenReserves + tokens);
}

/** Raw tokens received for `lamports` of net SOL. */
export function tokensForLamports(r: Reserves, lamports: bigint): bigint {
  return (r.virtualTokenReserves * lamports) / (r.virtualSolReserves + lamports);
}

export function applyBuy(r: Reserves, tokens: bigint, netLamports: bigint): Reserves {
  return {
    virtualSolReserves: r.virtualSolReserves + netLamports,
    virtualTokenReserves: r.virtualTokenReserves - tokens,
  };
}

export function applySell(r: Reserves, tokens: bigint, netLamports: bigint): Reserves {
  return {
    virtualSolReserves: r.virtualSolReserves - netLamports,
    virtualTokenReserves: r.virtualTokenReserves + tokens,
  };
}

/** Reserves right before the trade that produced `ev`. */
export function preTradeReserves(ev: Reserves & { isBuy: boolean; solAmount: bigint; tokenAmount: bigint }): Reserves {
  return ev.isBuy
    ? { virtualSolReserves: ev.virtualSolReserves - ev.solAmount, virtualTokenReserves: ev.virtualTokenReserves + ev.tokenAmount }
    : { virtualSolReserves: ev.virtualSolReserves + ev.solAmount, virtualTokenReserves: ev.virtualTokenReserves - ev.tokenAmount };
}

export function spotLamportsPerToken(r: Reserves): number {
  return Number(r.virtualSolReserves) / Number(r.virtualTokenReserves);
}
