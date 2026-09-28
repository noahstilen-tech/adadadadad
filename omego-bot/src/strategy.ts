import { preTradeReserves, spotLamportsPerToken, type Reserves } from "./curve.js";
import type { TradeEvent } from "./events.js";

/**
 * Entry/exit rules modelled on omego's observed behaviour (see solana-bot-analysis/reports):
 * it trades the most active mid-curve coins, enters right after a sizeable buy / price jump,
 * and exits into strength, on drawdowns or big sells, with a hard 30 min time stop.
 * Thresholds are relative to curve size so they carry over to 2x/3x sizing.
 */
export interface StrategyParams {
  minRealSol: number;
  maxRealSol: number;
  /** Activity filter: foreign trades on the mint within the last `activitySlots` slots. */
  minTrades: number;
  activitySlots: number;
  /** The triggering trade must be a buy of at least this fraction of virtual SOL. */
  entryMinTriggerRel: number;
  /** Price jump over the last `jumpLookbackSlots` slots that qualifies an entry. */
  entryMinJump: number;
  entryMaxJump: number;
  jumpLookbackSlots: number;
  /** Trailing stop: sell when price falls this far below the peak since entry. */
  trailingStop: number;
  /** Hard stop versus entry price. */
  stopLoss: number;
  /** Take profit into a spike: price rose `tpSpikeJump` over `jumpLookbackSlots`… */
  tpSpikeJump: number;
  /** …and the position is at least this far in profit. */
  tpMinReturn: number;
  /** Sell when a foreign sell of at least this fraction of virtual SOL hits the curve. */
  exitOnSellRel: number;
  maxHoldSeconds: number;
  reentryCooldownSeconds: number;
}

export const DEFAULT_PARAMS: StrategyParams = {
  minRealSol: 6,
  maxRealSol: 65,
  minTrades: 10,
  activitySlots: 20,
  entryMinTriggerRel: 0.01,
  entryMinJump: 0.03,
  entryMaxJump: 0.2,
  jumpLookbackSlots: 2,
  trailingStop: 0.08,
  stopLoss: 0.15,
  tpSpikeJump: 0.08,
  tpMinReturn: 0.05,
  exitOnSellRel: 1,
  maxHoldSeconds: 1800,
  reentryCooldownSeconds: 0,
};

interface SlotStat {
  slot: number;
  /** Spot price after the last trade seen in the slot. */
  close: number;
  trades: number;
}

/** Rolling per-mint view built from TradeEvents. */
export class MintState {
  readonly slots: SlotStat[] = [];
  last: TradeEvent | null = null;
  lastSlot = 0;
  /** Trade size of `last` relative to the virtual SOL before it. */
  lastRel = 0;

  constructor(readonly mint: string, private readonly keepSlots = 64) {}

  apply(ev: TradeEvent, slot: number): void {
    const close = spotLamportsPerToken(ev);
    const tail = this.slots[this.slots.length - 1];
    if (tail && tail.slot === slot) {
      tail.close = close;
      tail.trades++;
    } else {
      this.slots.push({ slot, close, trades: 1 });
    }
    while (this.slots.length > 0 && this.slots[0].slot < slot - this.keepSlots) this.slots.shift();
    this.last = ev;
    this.lastSlot = slot;
    this.lastRel = Number(ev.solAmount) / Number(preTradeReserves(ev).virtualSolReserves);
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

  tradesWithin(slots: number): number {
    let n = 0;
    for (let i = this.slots.length - 1; i >= 0 && this.slots[i].slot > this.lastSlot - slots; i--) n += this.slots[i].trades;
    return n;
  }

  /** Relative price change versus the last close at or before `lookbackSlots` ago. */
  jump(lookbackSlots: number): number | null {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i].slot <= this.lastSlot - lookbackSlots) return this.price() / this.slots[i].close - 1;
    }
    return null;
  }
}

export interface PositionView {
  entryPrice: number;
  peakPrice: number;
  openedAtMs: number;
}

export type ExitReason = "trailing_stop" | "stop_loss" | "take_profit" | "big_sell" | "timeout";

export function shouldEnter(s: MintState, p: StrategyParams): boolean {
  const ev = s.last;
  if (!ev || !ev.isBuy || s.lastRel < p.entryMinTriggerRel) return false;
  const rs = s.realSol();
  if (rs < p.minRealSol || rs > p.maxRealSol) return false;
  if (s.tradesWithin(p.activitySlots) < p.minTrades) return false;
  const j = s.jump(p.jumpLookbackSlots);
  return j !== null && j >= p.entryMinJump && j <= p.entryMaxJump;
}

export function exitReason(s: MintState, pos: PositionView, nowMs: number, p: StrategyParams): ExitReason | null {
  const price = s.price();
  const ret = price / pos.entryPrice - 1;
  if (ret <= -p.stopLoss) return "stop_loss";
  if (price <= pos.peakPrice * (1 - p.trailingStop)) return "trailing_stop";
  if (s.last && !s.last.isBuy && s.lastRel >= p.exitOnSellRel) return "big_sell";
  const j = s.jump(p.jumpLookbackSlots);
  if (j !== null && j >= p.tpSpikeJump && ret >= p.tpMinReturn) return "take_profit";
  if (nowMs - pos.openedAtMs >= p.maxHoldSeconds * 1000) return "timeout";
  return null;
}
