#!/usr/bin/env python3
"""
What would mirroring the bot have earned? For each bot buy/sell in a live recording we
trade the same mint once we could have reacted: at the curve state after the last trade
that landed at least LAG_SLOTS slots after the bot's trade. Sizing = 1 % of virtual SOL
(the bot's own rule), fees/tips as the bot pays them.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN = Path(os.environ.get("IN", ROOT.parent / "omego-bot" / "data" / "stream.jsonl"))
BOT = os.environ.get("BOT", "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq")
BUY_TX_COST = 92_500 + 200_000
SELL_TX_COST = 105_000 + 20_000


def main() -> None:
    by_mint: dict[str, list[dict]] = defaultdict(list)
    with IN.open() as f:
        for line in f:
            tx = json.loads(line)
            for e in tx["ev"]:
                vs, vt = int(e["vs"]), int(e["vt"])
                if vs <= 0 or vt <= 0:
                    continue
                by_mint[e["m"]].append({"slot": tx["slot"], "u": e["u"], "b": e["b"], "sol": int(e["sol"]),
                                        "vs": vs, "vt": vt, "fee": (e["fb"] + e["cfb"]) / 1e4})

    def state_after(evs: list[dict], i: int, lag: int) -> dict | None:
        """Curve state right before the first trade landing ≥ lag slots after evs[i]."""
        target = evs[i]["slot"] + lag
        last = evs[i]
        for e in evs[i + 1 :]:
            if e["slot"] >= target:
                return last if lag > 0 else evs[i]
            last = e
        return last

    print(f"{'lag':>4} {'rounds':>6} {'win':>5} {'mirror PnL':>11} {'bot PnL':>9}")
    for lag in (0, 1, 2, 3, 5):
        pnl = bot_pnl = 0.0
        n = wins = 0
        for mint, evs in by_mint.items():
            pos = None
            bot_cost = None
            for i, e in enumerate(evs):
                if e["u"] != BOT:
                    continue
                if e["b"] and pos is None:
                    s = state_after(evs, i, lag)
                    budget = s["vs"] // 100
                    spend = budget * 0.95 / 1.0005
                    tokens = int(s["vt"] * spend / (s["vs"] + spend))
                    cost = tokens * s["vs"] // (s["vt"] - tokens) + 1
                    if cost * (1 + e["fee"]) > budget:  # would have failed like omego's 6002s
                        continue
                    pos = (tokens, cost * (1 + e["fee"]) + BUY_TX_COST)
                    bot_cost = e["sol"] * (1 + e["fee"]) + BUY_TX_COST
                elif not e["b"] and pos is not None:
                    s = state_after(evs, i, lag)
                    tokens, cost = pos
                    proceeds = tokens * s["vs"] // (s["vt"] + tokens) * (1 - e["fee"]) - SELL_TX_COST
                    pnl += proceeds - cost
                    wins += proceeds > cost
                    n += 1
                    bot_pnl += e["sol"] * (1 - e["fee"]) - SELL_TX_COST - bot_cost
                    pos = None
        print(f"{lag:>4} {n:>6} {wins / max(n, 1):>5.2f} {pnl / 1e9:>+11.3f} {bot_pnl / 1e9:>+9.3f}")


if __name__ == "__main__":
    main()
