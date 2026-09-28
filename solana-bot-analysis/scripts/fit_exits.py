#!/usr/bin/env python3
"""
Fit exit rules on the bot's own rounds in a live recording: start at each actual bot buy,
replay the mint's trades and find the first slot where a candidate rule fires. Score = how
close that slot is to the bot's actual sell slot.

Rules: trailing stop from peak, take-profit on spike (jump over N slots while in profit),
hard stop vs entry, timeout.
"""
from __future__ import annotations

import itertools
import json
import os
import statistics as st
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN = Path(os.environ.get("IN", ROOT.parent / "omego-bot" / "data" / "stream.jsonl"))
BOT = os.environ.get("BOT", "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq")


def load_rounds() -> list[dict]:
    by_mint: dict[str, list[tuple]] = defaultdict(list)
    with IN.open() as f:
        for line in f:
            tx = json.loads(line)
            for e in tx["ev"]:
                vs, vt = int(e["vs"]), int(e["vt"])
                if vs <= 0 or vt <= 0:
                    continue
                by_mint[e["m"]].append((tx["slot"], vs / vt, e["u"], e["b"], tx["rx"]))
    rounds = []
    for mint, evs in by_mint.items():
        i = 0
        while i < len(evs):
            s, p, u, b, rx = evs[i]
            if u == BOT and b:
                j = next((k for k in range(i + 1, len(evs)) if evs[k][2] == BOT and not evs[k][3]), None)
                if j is None:
                    break
                path = [(x[0], x[1], x[4]) for x in evs[i + 1 : j] if x[2] != BOT]
                rounds.append({"mint": mint, "entry_slot": s, "entry_price": p, "entry_rx": rx,
                               "exit_slot": evs[j][0], "exit_price_pre": path[-1][1] if path else p, "path": path})
                i = j + 1
            else:
                i += 1
    return rounds


def simulate(r: dict, trail: float, spike: float, tp_min: float, look: int, hard: float) -> int | None:
    peak = r["entry_price"]
    closes: list[tuple[int, float]] = [(r["entry_slot"], r["entry_price"])]
    for slot, price, _rx in r["path"]:
        if closes[-1][0] == slot:
            closes[-1] = (slot, price)
        else:
            closes.append((slot, price))
        peak = max(peak, price)
        ret = price / r["entry_price"] - 1
        if price <= peak * (1 - trail) or ret <= -hard:
            return slot
        ref = next((c[1] for c in reversed(closes) if c[0] <= slot - look), None)
        if ref and price / ref - 1 >= spike and ret >= tp_min:
            return slot
    return None


def main() -> None:
    rounds = load_rounds()
    print(f"{len(rounds)} complete bot rounds in recording")
    for r in rounds:
        path = [p for _, p, _ in r["path"]] or [r["entry_price"]]
        r["peak"] = max(path) / r["entry_price"] - 1
        r["ret"] = r["exit_price_pre"] / r["entry_price"] - 1
        r["dd"] = r["exit_price_pre"] / max(max(path), r["entry_price"]) - 1
        print(f"  {r['mint'][:8]} hold={r['exit_slot']-r['entry_slot']:5d} slots ret={r['ret']:+.3f} peak={r['peak']:+.3f} dd={r['dd']:+.3f}")
    grid = itertools.product(
        [0.04, 0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.15],  # trailing
        [0.03, 0.05, 0.08, 0.12, 1e9],  # spike
        [0.0, 0.03, 0.05, 0.08],  # tp_min
        [1, 2, 3],  # lookback
        [0.1, 0.15, 0.2, 1e9],  # hard stop
    )
    best = []
    for trail, spike, tp_min, look, hard in grid:
        errs, exact = [], 0
        for r in rounds:
            s = simulate(r, trail, spike, tp_min, look, hard)
            err = abs((s if s is not None else r["exit_slot"] + 400) - r["exit_slot"])
            errs.append(min(err, 400))
            exact += err <= 2
        best.append((exact, -st.mean(errs), dict(trail=trail, spike=spike, tp_min=tp_min, look=look, hard=hard)))
    best.sort(key=lambda x: (x[0], x[1]), reverse=True)
    for exact, neg_mean, p in best[:10]:
        print(f"exact(±2 slots)={exact}/{len(rounds)} mean_err={-neg_mean:.1f} {p}")


if __name__ == "__main__":
    main()
