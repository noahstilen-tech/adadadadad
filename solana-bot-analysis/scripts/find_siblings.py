#!/usr/bin/env python3
"""
Find sibling wallets that buy the same tokens with 1x/2x/3x omego size formula.

Strategy:
1. Take recent buy trades from omego (and optionally sssss).
2. For a sample of those mints, fetch the buy transaction's slot/block and
   scan other pump TradeEvents in nearby activity by re-fetching co-buyers
   from the same tokens via recent omego buy slots' getBlock — too heavy.

Lighter approach:
- From omego buy trades we already decoded, collect mints.
- For each mint, getSignaturesForAddress(mint) is token-mint not traders.

Better lighter approach using known co-occurrence:
- Fetch getTransaction for omego buys; from the SAME slot, we already know
  sssss often appears. To find OTHER siblings, fetch getBlock for a sample
  of slots where omego bought and collect all TradeEvent buyers with size
  multiples near 1/2/3x.

getBlock is ~7MB / 25s — sample carefully (e.g. 8-12 slots).
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pump_events import expected_omego_size, extract_trade_events_from_tx, size_multiple  # noqa: E402
from rpc import get_block, get_transaction  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
REPORTS = Path(__file__).resolve().parents[1] / "reports"

OMEGO = "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq"
SSSSS = "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d"
KNOWN = {"omego": OMEGO, "sssss": SSSSS}


def classify_mult(m: float | None) -> str | None:
    if m is None:
        return None
    for name, center in [("1x", 1.0), ("2x", 2.0), ("3x", 3.0), ("0.5x", 0.5), ("4x", 4.0)]:
        if abs(m - center) / center <= 0.12:  # within 12%
            return name
    return None


def main() -> None:
    trades_path = DATA / "omego_trades_6h.json"
    # Fallback names
    candidates = list(DATA.glob("omego_trades_*h.json"))
    if not trades_path.exists() and candidates:
        trades_path = max(candidates, key=lambda p: p.stat().st_mtime)
    if not trades_path.exists():
        print("No omego trades file — run analyze_pnl.py first", flush=True)
        sys.exit(1)

    with open(trades_path) as f:
        trades = json.load(f)

    buys = [t for t in trades if t.get("is_buy")]
    # Unique slots where omego bought
    slot_to_mint = {}
    for t in buys:
        slot = t.get("slot")
        if slot is not None:
            slot_to_mint[slot] = t["mint"]

    max_blocks = int(os.environ.get("MAX_BLOCKS", "10"))
    # Prefer slots that also might have competition — take spread sample
    slots = sorted(slot_to_mint.keys(), reverse=True)
    step = max(1, len(slots) // max_blocks)
    sample_slots = slots[::step][:max_blocks]
    print(f"Sampling {len(sample_slots)} blocks from {len(slots)} omego-buy slots", flush=True)

    # wallet -> list of {mult, class, mint, slot, sol, real_sol}
    observations: dict[str, list[dict]] = defaultdict(list)
    block_summaries = []

    for i, slot in enumerate(sample_slots):
        print(f"  [{i+1}/{len(sample_slots)}] getBlock({slot}) …", flush=True)
        block = get_block(slot, transactions=True)
        if not block:
            print(f"    failed/null", flush=True)
            continue
        txs = block.get("transactions") or []
        # Walk in execution order
        order_idx = 0
        mint_buyers: dict[str, list[dict]] = defaultdict(list)
        for tx_wrap in txs:
            # jsonParsed block format: {transaction, meta, version}
            meta = tx_wrap.get("meta") or {}
            if meta.get("err") is not None:
                order_idx += 1
                continue
            # Build a synthetic tx dict for our extractor
            fake = {"meta": meta, "transaction": tx_wrap.get("transaction")}
            events = extract_trade_events_from_tx(fake)
            for ev in events:
                if not ev["is_buy"]:
                    continue
                mult = size_multiple(ev["sol_amount"], ev["real_sol"])
                klass = classify_mult(mult)
                rec = {
                    "slot": slot,
                    "order_idx": order_idx,
                    "mint": ev["mint"],
                    "user": ev["user"],
                    "sol_amount": ev["sol_amount"],
                    "real_sol": ev["real_sol"],
                    "expected_1x": expected_omego_size(ev["real_sol"]),
                    "size_mult": mult,
                    "size_class": klass,
                }
                mint_buyers[ev["mint"]].append(rec)
                if klass:
                    observations[ev["user"]].append(rec)
            order_idx += 1

        # Focus on mints omego bought in this slot
        focus_mint = slot_to_mint.get(slot)
        focus = mint_buyers.get(focus_mint, []) if focus_mint else []
        formula_buyers = [b for b in focus if b.get("size_class")]
        block_summaries.append(
            {
                "slot": slot,
                "focus_mint": focus_mint,
                "formula_buyers_on_focus": formula_buyers,
                "n_formula": len(formula_buyers),
            }
        )
        print(
            f"    focus_mint={focus_mint[:8] if focus_mint else None}… "
            f"formula_buyers={len(formula_buyers)}",
            flush=True,
        )

    # Aggregate wallets
    wallet_stats = []
    for user, obs in observations.items():
        classes = [o["size_class"] for o in obs if o.get("size_class")]
        if not classes:
            continue
        from collections import Counter

        c = Counter(classes)
        dominant, dom_n = c.most_common(1)[0]
        label = None
        for k, v in KNOWN.items():
            if v == user:
                label = k
                break
        wallet_stats.append(
            {
                "user": user,
                "label": label,
                "n_obs": len(obs),
                "class_counts": dict(c),
                "dominant_class": dominant,
                "dominant_n": dom_n,
                "avg_mult": sum(o["size_mult"] for o in obs if o["size_mult"]) / max(
                    1, len([o for o in obs if o["size_mult"]])
                ),
                "mints": sorted({o["mint"] for o in obs}),
                "slots": sorted({o["slot"] for o in obs}),
            }
        )

    wallet_stats.sort(key=lambda w: (-w["n_obs"], -w["dominant_n"]))

    # Sibling candidates: not omego/sssss, >=2 obs, dominant 1x/2x/3x
    siblings = [
        w
        for w in wallet_stats
        if w["label"] is None and w["n_obs"] >= 2 and w["dominant_class"] in ("1x", "2x", "3x", "0.5x", "4x")
    ]

    report = {
        "sampled_slots": sample_slots,
        "block_summaries": block_summaries,
        "wallet_stats": wallet_stats[:50],
        "sibling_candidates": siblings[:30],
        "known": KNOWN,
    }
    out = REPORTS / "sibling_wallets.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nWrote {out}", flush=True)
    print(f"Sibling candidates: {len(siblings)}", flush=True)
    for w in siblings[:15]:
        print(
            f"  {w['dominant_class']:4} n={w['n_obs']:2} avg_mult={w['avg_mult']:.2f}  {w['user']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
