import { preTradeReserves, spotLamportsPerToken, type Reserves } from "./curve.js";
import type { TradeEvent } from "./events.js";

/**
 * Entry/exit rules reverse-engineered from omego's rounds (see solana-bot-analysis/reports).
 * All thresholds are relative so the same rules apply to SOL-scale 2x/3x variants.
 */
export interface StrategyParams {
  minRealSol: number;
  maxRealSol: number;
  /** Price jump over the last `jumpLookbackSlots` slots (incl. current) that qualifies an entry. */
  entryMinJump: number;
  entryMaxJump: number;
  jumpLookbackSlots: number;
  /** Trailing stop: sell when price falls this far below the peak since entry. */
  trailingStop: number;
  /** Take profit into a spike: sell when price rose this much over `jumpLookbackSlots`… */
  tpSpikeJump: number;
  /** …and the position is at least this far in profit. */
  tpMinReturn: number;
  maxHoldSeconds: number;
  /** Ignore mints we exited within this many seconds (omego rarely re-enters immediately). */
  reentryCooldownSeconds: number;
}

export const DEFAULT_PARAMS: StrategyParams = {
  minRealSol: 6,
  maxRealSol: 65,
  entryMinJump: 0.04,
  entryMaxJump: 0.2,
  jumpLookbackSlots: 2,
  trailingStop: 0.08,
  tpSpikeJump: 0.08,
  tpMinReturn: 0.05,
  maxHoldSeconds: 1800,
  reentryCooldownSeconds: 0,
};

export interface SlotPrice {
  slot: number;
  /** Spot price after the last trade seen in the slot. */
  close: number;
}

/** Rolling per-mint view built from TradeEvents. */
export class MintState {
  readonly slots: SlotPrice[] = [];
  last: TradeEvent | null = null;
  lastSlot = 0;

  constructor(readonly mint: string, private readonly keepSlots = 32) {}

  apply(ev: TradeEvent, slot: number): void {
    const close = spotLamportsPerToken(ev);
    const tail = this.slots[this.slots.length - 1];
    if (tail && tail.slot === slot) tail.close = close;
    else this.slots.push({ slot, close });
    while (this.slots.length > 0 && this.slots[0].slot < slot - this.keepSlots) this.slots.shift();
    this.last = ev;
    this.lastSlot = slot;
  }

  reserves(): Reserves | null {
    return this.last;
  }

  price(): number {
    return this.last ? spotLamportsPerToken(this.last) : 0;
  }

  realSol(): number {
    return this.last ? Number(this.last.realSolReserves) / 1e9 : 0;
  }

  /** Relative price change versus the close before the lookback window. */
  jump(lookbackSlots: number): number | null {
    const ref = [...this.slots].reverse().find((s) => s.slot <= this.lastSlot - lookbackSlots);
    if (!ref) {
      // Window starts before our history: fall back to the reserves before the first trade seen.
      return null;
    }
    return this.price() / ref.close - 1;
  }

  /** Price just before `ev` executed, for mints first seen mid-window. */
  static prePrice(ev: TradeEvent): number {
    return spotLamportsPerToken(preTradeReserves(ev));
  }
}

export interface PositionView {
  entryPrice: number;
  peakPrice: number;
  openedAtMs: number;
}

export type ExitReason = "trailing_stop" | "take_profit" | "timeout";

export function shouldEnter(s: MintState, p: StrategyParams): boolean {
  const rs = s.realSol();
  if (rs < p.minRealSol || rs > p.maxRealSol) return false;
  const j = s.jump(p.jumpLookbackSlots);
  return j !== null && j >= p.entryMinJump && j <= p.entryMaxJump;
}

export function exitReason(s: MintState, pos: PositionView, nowMs: number, p: StrategyParams): ExitReason | null {
  const price = s.price();
  if (price <= pos.peakPrice * (1 - p.trailingStop)) return "trailing_stop";
  const j = s.jump(p.jumpLookbackSlots);
  if (j !== null && j >= p.tpSpikeJump && price / pos.entryPrice - 1 >= p.tpMinReturn) return "take_profit";
  if (nowMs - pos.openedAtMs >= p.maxHoldSeconds * 1000) return "timeout";
  return null;
}
