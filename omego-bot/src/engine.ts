import { Connection, PublicKey } from "@solana/web3.js";
import { appendFileSync } from "node:fs";
import type { Config } from "./config.js";
import { buyCostLamports, sellProceedsLamports } from "./curve.js";
import type { TradeEvent } from "./events.js";
import { BlockhashCache, sendViaSender } from "./exec/sender.js";
import { buildBuyTx, buildSellTx, type ExecParams, type MintInfo } from "./exec/tx.js";
import { TokenProgramCache } from "./mintCache.js";
import { sizeBuy } from "./sizing.js";
import { exitReason, MintState, shouldEnter, type ExitReason, type StrategyParams } from "./strategy.js";
import type { TradeTx } from "./stream.js";

const BASE_FEE_LAMPORTS = 5_000;
const SELL_RETRY_MS = 800;
const SELL_MAX_RETRIES = 12;
const BUY_CONFIRM_TIMEOUT_MS = 6_000;

interface Position {
  mint: string;
  state: "pending_buy" | "open" | "selling";
  tokenAmount: bigint;
  costLamports: number;
  entryPrice: number;
  peakPrice: number;
  openedAtMs: number;
  entrySlot: number;
  info: MintInfo;
  sellAttempts: number;
  exitReason?: ExitReason;
}

export interface Stats {
  rounds: number;
  wins: number;
  pnlLamports: number;
}

export class Engine {
  private readonly mints = new Map<string, MintState>();
  private readonly positions = new Map<string, Position>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly tokenPrograms: TokenProgramCache;
  private readonly blockhash: BlockhashCache;
  private readonly wallet: string | null;
  readonly stats: Stats = { rounds: 0, wins: 0, pnlLamports: 0 };

  constructor(
    private readonly cfg: Config,
    private readonly params: StrategyParams,
    connection: Connection,
  ) {
    this.tokenPrograms = new TokenProgramCache(connection);
    this.blockhash = new BlockhashCache(connection);
    this.wallet = cfg.keypair?.publicKey.toBase58() ?? null;
  }

  async start(): Promise<void> {
    if (this.cfg.mode === "live") await this.blockhash.start();
  }

  stop(): void {
    this.blockhash.stop();
  }

  onTx(tx: TradeTx): void {
    for (const ev of tx.events) this.onEvent(ev, tx);
  }

  private onEvent(ev: TradeEvent, tx: TradeTx): void {
    let s = this.mints.get(ev.mint);
    if (!s) {
      s = new MintState(ev.mint);
      this.mints.set(ev.mint, s);
      if (this.cfg.mode === "live") void this.tokenPrograms.get(ev.mint).catch(() => undefined);
    }
    s.apply(ev, tx.slot);

    if (this.cfg.shadowWallet && ev.user === this.cfg.shadowWallet.toBase58()) {
      this.log({ kind: "shadow", side: ev.isBuy ? "buy" : "sell", mint: ev.mint, slot: tx.slot, sol: Number(ev.solAmount) / 1e9, realSol: s.realSol(), sig: tx.signature, weHold: this.positions.has(ev.mint) });
    }
    if (this.wallet && ev.user === this.wallet) {
      this.onOwnFill(ev, tx);
      return;
    }

    const pos = this.positions.get(ev.mint);
    if (pos) {
      if (pos.state !== "open") return;
      pos.peakPrice = Math.max(pos.peakPrice, s.price());
      const reason = exitReason(s, pos, Date.now(), this.params);
      if (reason) void this.exit(pos, s, reason, tx.slot);
      return;
    }
    if (this.positions.size >= this.cfg.maxOpenPositions) return;
    if ((this.cooldownUntil.get(ev.mint) ?? 0) > Date.now()) return;
    if (shouldEnter(s, this.params)) void this.enter(s, ev, tx.slot);
  }

  private mintInfo(ev: TradeEvent, tokenProgram: PublicKey): MintInfo {
    return {
      mint: new PublicKey(ev.mint),
      creator: new PublicKey(ev.creator),
      tokenProgram,
      mayhemMode: ev.mayhemMode,
      cashback: ev.cashbackFeeBasisPoints > 0n,
    };
  }

  private feeBps(ev: TradeEvent): bigint {
    return ev.feeBasisPoints + ev.creatorFeeBasisPoints;
  }

  private async enter(s: MintState, ev: TradeEvent, slot: number): Promise<void> {
    const r = s.reserves()!;
    const order = sizeBuy(r, this.cfg.sizePctOfVirtualSol);
    const pos: Position = {
      mint: ev.mint,
      state: "pending_buy",
      tokenAmount: order.tokenAmount,
      costLamports: 0,
      entryPrice: s.price(),
      peakPrice: s.price(),
      openedAtMs: Date.now(),
      entrySlot: slot,
      info: this.mintInfo(ev, PublicKey.default),
      sellAttempts: 0,
    };
    this.positions.set(ev.mint, pos);

    if (this.cfg.mode === "paper") {
      const net = buyCostLamports(r, order.tokenAmount);
      const fees = (net * this.feeBps(ev)) / 10_000n;
      pos.costLamports = Number(net + fees) + this.txCost(true);
      pos.state = "open";
      this.log({ kind: "buy", mode: "paper", mint: ev.mint, slot, realSol: s.realSol(), tokens: order.tokenAmount.toString(), costSol: pos.costLamports / 1e9, jump: s.jump(this.params.jumpLookbackSlots) });
      return;
    }

    try {
      pos.info = this.mintInfo(ev, await this.tokenPrograms.get(ev.mint));
      const tx = await buildBuyTx(this.execParams(true), pos.info, order.tokenAmount, order.maxSolCostLamports);
      const sig = await sendViaSender(this.cfg.senderUrl, tx);
      this.log({ kind: "buy_sent", mint: ev.mint, slot, sig, maxSol: Number(order.maxSolCostLamports) / 1e9 });
      setTimeout(() => {
        if (this.positions.get(ev.mint) === pos && pos.state === "pending_buy") {
          this.positions.delete(ev.mint);
          this.log({ kind: "buy_expired", mint: ev.mint, sig });
        }
      }, BUY_CONFIRM_TIMEOUT_MS);
    } catch (e) {
      this.positions.delete(ev.mint);
      this.log({ kind: "buy_error", mint: ev.mint, error: (e as Error).message });
    }
  }

  private async exit(pos: Position, s: MintState, reason: ExitReason, slot: number): Promise<void> {
    pos.state = "selling";
    pos.exitReason = reason;
    if (this.cfg.mode === "paper") {
      const r = s.reserves()!;
      const net = sellProceedsLamports(r, pos.tokenAmount);
      const fees = (net * this.feeBps(s.last!)) / 10_000n;
      this.close(pos, Number(net - fees) - this.txCost(false), slot);
      return;
    }
    await this.sendSell(pos);
  }

  private async sendSell(pos: Position): Promise<void> {
    if (this.positions.get(pos.mint) !== pos) return;
    if (pos.sellAttempts >= SELL_MAX_RETRIES) {
      this.log({ kind: "sell_gave_up", mint: pos.mint });
      return;
    }
    pos.sellAttempts++;
    try {
      const tx = await buildSellTx(this.execParams(false), pos.info, pos.tokenAmount);
      const sig = await sendViaSender(this.cfg.senderUrl, tx);
      this.log({ kind: "sell_sent", mint: pos.mint, attempt: pos.sellAttempts, reason: pos.exitReason, sig });
    } catch (e) {
      this.log({ kind: "sell_error", mint: pos.mint, error: (e as Error).message });
    }
    // omego re-sends its sell every 1-2 slots until one lands; duplicates fail harmlessly.
    setTimeout(() => void this.sendSell(pos), SELL_RETRY_MS);
  }

  private onOwnFill(ev: TradeEvent, tx: TradeTx): void {
    const pos = this.positions.get(ev.mint);
    if (!pos) return;
    const fees = (ev.solAmount * this.feeBps(ev)) / 10_000n;
    if (ev.isBuy && pos.state === "pending_buy") {
      pos.state = "open";
      pos.tokenAmount = ev.tokenAmount;
      pos.costLamports = Number(ev.solAmount + fees) + this.txCost(true);
      this.log({ kind: "buy", mode: "live", mint: ev.mint, slot: tx.slot, sig: tx.signature, costSol: pos.costLamports / 1e9 });
    } else if (!ev.isBuy) {
      this.close(pos, Number(ev.solAmount - fees) - this.txCost(false), tx.slot, tx.signature);
    }
  }

  private close(pos: Position, proceedsLamports: number, slot: number, sig?: string): void {
    this.positions.delete(pos.mint);
    const pnl = proceedsLamports - pos.costLamports;
    this.stats.rounds++;
    if (pnl > 0) this.stats.wins++;
    this.stats.pnlLamports += pnl;
    if (this.params.reentryCooldownSeconds > 0) {
      this.cooldownUntil.set(pos.mint, Date.now() + this.params.reentryCooldownSeconds * 1000);
    }
    this.log({
      kind: "sell",
      mode: this.cfg.mode,
      mint: pos.mint,
      slot,
      sig,
      reason: pos.exitReason,
      holdSec: Math.round((Date.now() - pos.openedAtMs) / 1000),
      pnlSol: pnl / 1e9,
      pnlPct: pnl / pos.costLamports,
      totalPnlSol: this.stats.pnlLamports / 1e9,
      rounds: this.stats.rounds,
    });
  }

  private txCost(buy: boolean): number {
    const cu = buy ? this.cfg.buyCuLimit : this.cfg.sellCuLimit;
    const tip = buy ? this.cfg.buyTipLamports : this.cfg.sellTipLamports;
    return BASE_FEE_LAMPORTS + Math.ceil((cu * this.cfg.microLamportsPerCu) / 1e6) + tip;
  }

  private execParams(buy: boolean): ExecParams {
    return {
      payer: this.cfg.keypair!,
      blockhash: this.blockhash.get(),
      cuLimit: buy ? this.cfg.buyCuLimit : this.cfg.sellCuLimit,
      microLamportsPerCu: this.cfg.microLamportsPerCu,
      tipLamports: buy ? this.cfg.buyTipLamports : this.cfg.sellTipLamports,
    };
  }

  private log(o: Record<string, unknown>): void {
    const line = JSON.stringify({ t: new Date().toISOString(), ...o });
    console.log(line);
    if (this.cfg.logFile) appendFileSync(this.cfg.logFile, line + "\n");
  }
}
