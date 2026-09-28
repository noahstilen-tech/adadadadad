#!/usr/bin/env python3
"""
Recover entry/exit triggers from per-round timelines (data/timelines/*.json).

Within a slot the RPC gives no reliable tx order, so events are re-ordered by chaining
reserves: each trade's pre-trade virtual SOL equals the previous trade's post value.
For every bot buy/sell we then look at what happened just before it (same slot and the
preceding slots), and for every other large trade during the hold whether the bot reacted.
"""
from __future__ import annotations

import glob
import json
import os
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOOKBACK_SLOTS = int(os.environ.get("LOOKBACK_SLOTS", "2"))


def lam(x: float) -> int:
    return round(x * 1e9)


def pre_vs(e: dict) -> int:
    return lam(e["virtual_sol"]) - lam(e["sol_amount"]) if e["is_buy"] else lam(e["virtual_sol"]) + lam(e["sol_amount"])


def chain_order(events: list[dict]) -> list[dict]:
    """Order events so each trade's pre-reserves match the previous post-reserves."""
    by_slot: dict[int, list[dict]] = {}
    for e in events:
        by_slot.setdefault(e["slot"], []).append(e)
    out: list[dict] = []
    last_post: int | None = None
    for slot in sorted(by_slot):
        pool = by_slot[slot][:]
        while pool:
            pick = None
            if last_post is not None:
                for e in pool:
                    if abs(pre_vs(e) - last_post) <= 2:
                        pick = e
                        break
            if pick is None:
                # Chain start or gap (missing tx): take the event nobody else leads into.
                posts = {lam(e["virtual_sol"]) for e in pool}
                heads = [e for e in pool if all(abs(pre_vs(e) - p) > 2 for p in posts)]
                pick = heads[0] if heads else pool[0]
            pool.remove(pick)
            out.append(pick)
            last_post = lam(pick["virtual_sol"])
    return out


def price(e: dict) -> float:
    """Post-trade spot price, SOL per raw token."""
    return e["virtual_sol"] / e["virtual_token"]


def pre_price(e: dict) -> float:
    vt = e["virtual_token"] + (e["token_amount"] if e["is_buy"] else -e["token_amount"])
    return pre_vs(e) / 1e9 / vt


def rel(e: dict) -> float:
    """Trade size relative to the curve's virtual SOL before the trade."""
    return lam(e["sol_amount"]) / pre_vs(e)


def context(evs: list[dict], i: int) -> list[dict]:
    slot = evs[i]["slot"]
    return [e for e in evs[:i] if e["slot"] >= slot - LOOKBACK_SLOTS]


def describe(e: dict) -> dict:
    return {
        "side": "B" if e["is_buy"] else "S",
        "sol": round(e["sol_amount"], 3),
        "rel": round(rel(e), 4),
        "user": e["user"][:6],
    }


def main() -> None:
    files = sorted(glob.glob(str(ROOT / "data" / "timelines" / "*.json")))
    entries, exits, ignored = [], [], []
    for f in files:
        d = json.loads(Path(f).read_text())
        bot = d["bot_wallet"]
        evs = chain_order(d["events"])
        idx = [i for i, e in enumerate(evs) if e["user"] == bot]
        buys = [i for i in idx if evs[i]["is_buy"]]
        sells = [i for i in idx if not evs[i]["is_buy"]]
        if not buys or not sells:
            continue
        b, s = buys[0], sells[-1]
        entry_price = price(evs[b])
        for kind, i, sink in (("entry", b, entries), ("exit", s, exits)):
            ctx = [e for e in context(evs, i) if e["user"] != bot]
            big = max(ctx, key=rel, default=None)
            p_now = pre_price(evs[i])
            row = {
                "file": Path(f).name,
                "slot": evs[i]["slot"],
                "real_sol": round(pre_vs(evs[i]) / 1e9 - 30, 2),
                "n_ctx": len(ctx),
                "trigger": describe(big) if big else None,
                "ctx": [describe(e) for e in ctx[-6:]],
            }
            for n in (1, 2, 5, 10):
                ref = [e for e in evs[:i] if e["slot"] < evs[i]["slot"] - n + 1]
                row[f"dp_{n}slot"] = round(p_now / price(ref[-1]) - 1, 4) if ref else None
            if kind == "exit":
                path = [price(e) for e in evs[b:i]]
                row["ret_vs_entry"] = round(p_now / entry_price - 1, 4)
                row["peak_ret"] = round(max(path) / entry_price - 1, 4)
                row["dd_from_peak"] = round(p_now / max(path) - 1, 4)
                row["hold_slots"] = evs[i]["slot"] - evs[b]["slot"]
            sink.append(row)
        # Large foreign trades during the hold that the bot did not answer within LOOKBACK_SLOTS.
        sell_slot = evs[s]["slot"]
        for e in evs[b + 1 : s]:
            if e["user"] == bot or e["slot"] >= sell_slot - LOOKBACK_SLOTS:
                continue
            ignored.append({**describe(e), "ret_vs_entry": round(price(e) / entry_price - 1, 4), "file": Path(f).name})

    def summarize(rows: list[dict], label: str) -> None:
        trig = [r["trigger"] for r in rows if r["trigger"]]
        print(f"\n== {label}: {len(rows)} (with context {len(trig)})")
        for side in ("B", "S"):
            rs = sorted(t["rel"] for t in trig if t["side"] == side)
            if rs:
                print(f"  largest prior trade = {side}: n={len(rs)} rel p10/50/90 = "
                      f"{rs[len(rs)//10]:.4f}/{st.median(rs):.4f}/{rs[9*len(rs)//10]:.4f}")

    summarize(entries, "ENTRY")
    summarize(exits, "EXIT")
    for side in ("B", "S"):
        rs = sorted(x["rel"] for x in ignored if x["side"] == side)
        if rs:
            print(f"  ignored during hold {side}: n={len(rs)} rel p50/90/99 = {st.median(rs):.4f}/"
                  f"{rs[9*len(rs)//10]:.4f}/{rs[min(len(rs)-1, 99*len(rs)//100)]:.4f}")
    out = ROOT / "reports" / "omego_triggers.json"
    out.write_text(json.dumps({"entries": entries, "exits": exits, "ignored": ignored}, indent=1))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
