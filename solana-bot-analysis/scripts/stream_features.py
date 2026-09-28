#!/usr/bin/env python3
"""
Entry analysis over a live pump.fun recording (omego-bot/scripts/record.ts).

Every trade on every mint is a candidate decision point. Label = the bot buys that mint
within the next LABEL_SLOTS slots while not already holding it. Features describe what the
bot could have seen at that moment. Output: data/stream_features.parquet + a quick report.
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
IN = Path(os.environ.get("IN", ROOT.parent / "omego-bot" / "data" / "stream.jsonl"))
BOT = os.environ.get("BOT", "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq")
LABEL_SLOTS = int(os.environ.get("LABEL_SLOTS", "2"))


def load() -> list[dict]:
    rows = []
    with IN.open() as f:
        for line in f:
            if not line.strip():
                continue
            tx = json.loads(line)
            for k, e in enumerate(tx["ev"]):
                vs, vt, sol, tok = int(e["vs"]), int(e["vt"]), int(e["sol"]), int(e["tok"])
                pre_vs = vs - sol if e["b"] else vs + sol
                pre_vt = vt + tok if e["b"] else vt - tok
                if pre_vs <= 0 or vt <= 0:
                    continue
                rows.append(
                    {
                        "mint": e["m"], "slot": tx["slot"], "rx": tx["rx"], "user": e["u"], "buy": e["b"],
                        "sol": sol / 1e9, "vs": vs, "vt": vt, "pre_vs": pre_vs, "pre_vt": pre_vt,
                        "rs": int(e["rs"]) / 1e9, "mh": e["mh"], "ix": e["ix"], "sig": tx["sig"],
                    }
                )
    return rows


def main() -> None:
    rows = load()
    by_mint: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_mint[r["mint"]].append(r)
    feats = []
    for mint, evs in by_mint.items():
        bot_buys = [e["slot"] for e in evs if e["user"] == BOT and e["buy"]]
        bot_sells = [e["slot"] for e in evs if e["user"] == BOT and not e["buy"]]
        first_slot = evs[0]["slot"]
        hist: deque = deque()  # (slot, price, sol_signed_rel)
        holding_until = -1
        for i, e in enumerate(evs):
            if e["user"] == BOT:
                if e["buy"]:
                    later = [s for s in bot_sells if s >= e["slot"]]
                    holding_until = later[0] if later else 10**12
                continue
            price = e["vs"] / e["vt"]
            signed = (1 if e["buy"] else -1) * e["sol"] * 1e9 / e["pre_vs"]
            hist.append((e["slot"], price, signed, e["sol"] if e["buy"] else 0.0))
            while hist and hist[0][0] < e["slot"] - 20:
                hist.popleft()
            if e["slot"] <= holding_until:
                continue

            def ref_price(n: int) -> float | None:
                older = [h for h in hist if h[0] <= e["slot"] - n]
                return older[-1][1] if older else None

            f = {
                "mint": mint, "slot": e["slot"], "sig": e["sig"], "rs": e["rs"],
                "age_slots": e["slot"] - first_slot, "side": e["buy"], "rel": e["sol"] * 1e9 / e["pre_vs"],
                "sol": e["sol"], "mayhem": e["mh"],
            }
            for n in (1, 2, 3, 5, 10, 20):
                rp = ref_price(n)
                f[f"jump{n}"] = price / rp - 1 if rp else np.nan
                f[f"flow{n}"] = sum(h[2] for h in hist if h[0] > e["slot"] - n)
                f[f"ntr{n}"] = sum(1 for h in hist if h[0] > e["slot"] - n)
            f["maxbuy_rel2"] = max((h[2] for h in hist if h[0] > e["slot"] - 2), default=0.0)
            f["label"] = int(any(0 <= s - e["slot"] <= LABEL_SLOTS for s in bot_buys))
            feats.append(f)
    df = pd.DataFrame(feats)
    out = ROOT / "data" / "stream_features.pkl"
    df.to_pickle(out)
    pos = df[df.label == 1]
    print(f"{len(df)} candidate points on {df.mint.nunique()} mints; positives {len(pos)} "
          f"({pos.mint.nunique()} mints / {sum(1 for r in rows if r['user']==BOT and r['buy'])} bot buys)")
    cols = ["rs", "rel", "jump1", "jump2", "jump5", "jump10", "flow2", "flow5", "flow10", "ntr5", "ntr20", "maxbuy_rel2", "age_slots"]
    q = lambda s: " ".join(f"{v:8.4f}" for v in s.quantile([0.1, 0.5, 0.9]))
    print(f"{'feature':12s} {'pos p10/50/90':>28s} | {'all(rs 6-65) p10/50/90':>28s}")
    base = df[(df.rs >= 6) & (df.rs <= 65)]
    for c in cols:
        print(f"{c:12s} {q(pos[c]):>28s} | {q(base[c]):>28s}")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    sys.exit(main())
