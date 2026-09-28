#!/usr/bin/env python3
"""
Analyze recent trades for PnL, exit rules, and sibling wallets.

Uses already-collected signatures (newest-first) and fetches transactions
for a time window, decoding pump.fun TradeEvents.
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pump_events import (  # noqa: E402
    expected_omego_size,
    extract_trade_events_from_tx,
    size_multiple,
)
from rpc import get_transaction  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
REPORTS = Path(__file__).resolve().parents[1] / "reports"
REPORTS.mkdir(parents=True, exist_ok=True)

WALLETS = {
    "omego": "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq",
    "sssss": "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d",
}


def ts_iso(unix: int | None) -> str | None:
    if unix is None:
        return None
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat()


def load_sigs(label: str) -> list[dict]:
    path = DATA / f"{label}_signatures.json"
    with open(path) as f:
        return json.load(f)


def filter_window(sigs: list[dict], hours: float) -> list[dict]:
    if not sigs:
        return []
    newest = sigs[0].get("blockTime") or 0
    cutoff = newest - int(hours * 3600)
    return [s for s in sigs if (s.get("blockTime") or 0) >= cutoff]


def analyze_wallet(label: str, address: str, hours: float, max_txs: int) -> dict:
    sigs = load_sigs(label)
    window = filter_window(sigs, hours)
    # Prefer successful txs; still sample failures for fail-rate
    succ = [s for s in window if s.get("err") is None]
    fail = [s for s in window if s.get("err") is not None]
    to_fetch = succ[:max_txs]

    print(
        f"[{label}] window={hours}h sigs={len(window)} ok={len(succ)} fail={len(fail)} "
        f"fetching={len(to_fetch)}",
        flush=True,
    )

    trades: list[dict] = []
    fetch_errors = 0
    for i, s in enumerate(to_fetch):
        if i % 25 == 0:
            print(f"  [{label}] fetched {i}/{len(to_fetch)} trades={len(trades)}", flush=True)
        tx = get_transaction(s["signature"])
        if not tx:
            fetch_errors += 1
            continue
        events = extract_trade_events_from_tx(tx)
        for ev in events:
            if ev["user"] != address:
                continue
            trades.append(
                {
                    "signature": s["signature"],
                    "slot": s.get("slot"),
                    "blockTime": s.get("blockTime"),
                    "tx_index": s.get("transactionIndex"),
                    **ev,
                    "expected_1x": expected_omego_size(ev["real_sol"]),
                    "size_mult": size_multiple(ev["sol_amount"], ev["real_sol"]),
                }
            )

    # Position reconstruction per mint: FIFO matching buys→sells
    by_mint: dict[str, list[dict]] = defaultdict(list)
    for t in sorted(trades, key=lambda x: (x.get("blockTime") or 0, x.get("slot") or 0, x.get("tx_index") or 0)):
        by_mint[t["mint"]].append(t)

    rounds: list[dict] = []
    open_positions: list[dict] = []
    for mint, mtrades in by_mint.items():
        # Track inventory in tokens and cost basis in SOL
        tokens = 0
        cost_sol = 0.0
        entry_time = None
        entry_real_sol = None
        buys_sol = 0.0
        sells_sol = 0.0
        buy_count = 0
        sell_count = 0
        first_buy_mult = None
        peak_pnl = 0.0
        trough_pnl = 0.0

        def flush_round(exit_time, reason):
            nonlocal tokens, cost_sol, entry_time, entry_real_sol, buys_sol, sells_sol
            nonlocal buy_count, sell_count, first_buy_mult, peak_pnl, trough_pnl
            if buy_count == 0 and sell_count == 0:
                return
            pnl = sells_sol - buys_sol
            hold_s = None
            if entry_time is not None and exit_time is not None:
                hold_s = exit_time - entry_time
            # Approximate exit % vs cost
            exit_pct = None
            if buys_sol > 0:
                exit_pct = (sells_sol / buys_sol - 1.0) * 100.0
            rounds.append(
                {
                    "mint": mint,
                    "entry_time": entry_time,
                    "exit_time": exit_time,
                    "hold_seconds": hold_s,
                    "buys_sol": buys_sol,
                    "sells_sol": sells_sol,
                    "pnl_sol": pnl,
                    "exit_pct": exit_pct,
                    "buy_count": buy_count,
                    "sell_count": sell_count,
                    "entry_real_sol": entry_real_sol,
                    "first_buy_mult": first_buy_mult,
                    "tokens_left": tokens,
                    "reason": reason,
                }
            )
            tokens = 0
            cost_sol = 0.0
            entry_time = None
            entry_real_sol = None
            buys_sol = 0.0
            sells_sol = 0.0
            buy_count = 0
            sell_count = 0
            first_buy_mult = None
            peak_pnl = 0.0
            trough_pnl = 0.0

        for t in mtrades:
            if t["is_buy"]:
                if tokens == 0:
                    entry_time = t["timestamp"]
                    entry_real_sol = t["real_sol"]
                    first_buy_mult = t["size_mult"]
                tokens += t["token_amount"]
                cost_sol += t["sol_amount"]
                buys_sol += t["sol_amount"]
                buy_count += 1
            else:
                # sell
                tokens = max(0, tokens - t["token_amount"])
                sells_sol += t["sol_amount"]
                sell_count += 1
                # realized so far
                realized = sells_sol - buys_sol
                peak_pnl = max(peak_pnl, realized)
                trough_pnl = min(trough_pnl, realized)
                if tokens == 0 and buy_count > 0:
                    flush_round(t["timestamp"], "flat")

        if buy_count > 0 or sell_count > 0:
            # still open or unmatched
            open_positions.append(
                {
                    "mint": mint,
                    "tokens_left": tokens,
                    "buys_sol": buys_sol,
                    "sells_sol": sells_sol,
                    "unrealized_approx_pnl": sells_sol - buys_sol,
                    "entry_time": entry_time,
                    "first_buy_mult": first_buy_mult,
                }
            )
            # count partial as round with open reason if any sells happened
            if sell_count > 0 or buy_count > 0:
                flush_round(mtrades[-1]["timestamp"], "open_or_partial")

    closed = [r for r in rounds if r["reason"] == "flat"]
    pnls = [r["pnl_sol"] for r in closed]
    exit_pcts = [r["exit_pct"] for r in closed if r["exit_pct"] is not None]
    holds = [r["hold_seconds"] for r in closed if r["hold_seconds"] is not None]
    winners = [p for p in pnls if p > 0]
    losers = [p for p in pnls if p <= 0]

    # Time span of fetched trades
    times = [t["blockTime"] for t in trades if t.get("blockTime")]
    span_h = (max(times) - min(times)) / 3600 if len(times) >= 2 else hours

    total_pnl = sum(pnls) + sum(o["unrealized_approx_pnl"] for o in open_positions)
    # Better: closed PnL + open (sells-buys) — note open may understate if tokens remain

    def pctile(vals: list[float], p: float) -> float | None:
        if not vals:
            return None
        s = sorted(vals)
        idx = int(round((len(s) - 1) * p))
        return s[idx]

    # Size multiple distribution on buys
    buy_mults = [t["size_mult"] for t in trades if t["is_buy"] and t["size_mult"] is not None]

    summary = {
        "label": label,
        "address": address,
        "hours_requested": hours,
        "window_sigs": len(window),
        "success_sigs": len(succ),
        "fail_sigs": len(fail),
        "fail_rate": len(fail) / len(window) if window else None,
        "txs_fetched": len(to_fetch),
        "fetch_errors": fetch_errors,
        "trade_events": len(trades),
        "unique_mints": len(by_mint),
        "span_hours": span_h,
        "closed_rounds": len(closed),
        "open_or_partial": len([r for r in rounds if r["reason"] != "flat"]),
        "win_rate": len(winners) / len(closed) if closed else None,
        "total_closed_pnl_sol": sum(pnls) if pnls else 0.0,
        "avg_pnl_sol": (sum(pnls) / len(pnls)) if pnls else None,
        "median_pnl_sol": pctile(pnls, 0.5),
        "avg_winner_sol": (sum(winners) / len(winners)) if winners else None,
        "avg_loser_sol": (sum(losers) / len(losers)) if losers else None,
        "pnl_per_hour_sol": (sum(pnls) / span_h) if pnls and span_h > 0 else None,
        "median_hold_seconds": pctile(holds, 0.5) if holds else None,
        "p25_hold_seconds": pctile(holds, 0.25) if holds else None,
        "p75_hold_seconds": pctile(holds, 0.75) if holds else None,
        "median_exit_pct": pctile(exit_pcts, 0.5) if exit_pcts else None,
        "p25_exit_pct": pctile(exit_pcts, 0.25) if exit_pcts else None,
        "p75_exit_pct": pctile(exit_pcts, 0.75) if exit_pcts else None,
        "winner_exit_pct_median": pctile([r["exit_pct"] for r in closed if r["pnl_sol"] > 0 and r["exit_pct"] is not None], 0.5),
        "loser_exit_pct_median": pctile([r["exit_pct"] for r in closed if r["pnl_sol"] <= 0 and r["exit_pct"] is not None], 0.5),
        "buy_size_mult_median": pctile(buy_mults, 0.5) if buy_mults else None,
        "buy_size_mult_p10": pctile(buy_mults, 0.1) if buy_mults else None,
        "buy_size_mult_p90": pctile(buy_mults, 0.9) if buy_mults else None,
        "entry_real_sol_median": pctile([r["entry_real_sol"] for r in closed if r.get("entry_real_sol") is not None], 0.5),
        "time_start": ts_iso(min(times)) if times else None,
        "time_end": ts_iso(max(times)) if times else None,
    }

    out = {
        "summary": summary,
        "rounds": rounds,
        "open_positions": open_positions,
        "sample_trades": trades[:50],
        "all_trades_path": str(DATA / f"{label}_trades_{int(hours)}h.json"),
    }
    with open(DATA / f"{label}_trades_{int(hours)}h.json", "w") as f:
        json.dump(trades, f)
    with open(DATA / f"{label}_pnl_{int(hours)}h.json", "w") as f:
        json.dump(out, f, indent=2)
    with open(REPORTS / f"{label}_pnl_{int(hours)}h_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2), flush=True)
    return out


def main() -> None:
    hours = float(os.environ.get("HOURS", "6"))
    max_txs = int(os.environ.get("MAX_TXS", "400"))
    only = os.environ.get("ONLY")
    targets = WALLETS if not only else {only: WALLETS[only]}
    # Need signatures present
    for label, addr in targets.items():
        sig_path = DATA / f"{label}_signatures.json"
        if not sig_path.exists():
            print(f"SKIP {label}: no signatures file", flush=True)
            continue
        analyze_wallet(label, addr, hours=hours, max_txs=max_txs)


if __name__ == "__main__":
    main()
