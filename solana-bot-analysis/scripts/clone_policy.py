#!/usr/bin/env python3
"""
Behavioural cloning of the bot's entry and exit decisions from a live recording.

Each foreign trade on a mint is a decision point with features the bot could see at that
moment. Entry label: bot buys the mint within LABEL_SLOTS slots (while flat). Exit label:
bot sells within LABEL_SLOTS slots (while holding). Shallow decision trees are trained on
the first TRAIN_FRAC of the recording (by time) and evaluated on the rest, both per event
and per round (does the first firing land within ±2 slots of the bot's real action?).
"""
from __future__ import annotations

import json
import os
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier, export_text

ROOT = Path(__file__).resolve().parents[1]
IN = Path(os.environ.get("IN", ROOT.parent / "omego-bot" / "data" / "stream.jsonl"))
BOT = os.environ.get("BOT", "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq")
LABEL_SLOTS = int(os.environ.get("LABEL_SLOTS", "1"))
TRAIN_FRAC = float(os.environ.get("TRAIN_FRAC", "0.7"))
DEPTH = int(os.environ.get("DEPTH", "4"))

WINDOWS = (1, 2, 5, 10, 20)


def load() -> dict[str, list[dict]]:
    by_mint: dict[str, list[dict]] = defaultdict(list)
    with IN.open() as f:
        for line in f:
            tx = json.loads(line)
            for e in tx["ev"]:
                vs, vt, sol = int(e["vs"]), int(e["vt"]), int(e["sol"])
                pre = vs - sol if e["b"] else vs + sol
                if pre <= 0 or vt <= 0:
                    continue
                by_mint[e["m"]].append(
                    {"slot": tx["slot"], "rx": tx["rx"], "u": e["u"], "b": e["b"], "rel": sol / pre,
                     "sol": sol / 1e9, "p": vs / vt, "rs": int(e["rs"]) / 1e9}
                )
    return by_mint


def market_features(hist: deque, e: dict) -> dict:
    f = {"rs": e["rs"], "side": e["b"], "rel": e["rel"]}
    for n in WINDOWS:
        win = [h for h in hist if h["slot"] > e["slot"] - n]
        older = [h for h in hist if h["slot"] <= e["slot"] - n]
        f[f"jump{n}"] = e["p"] / older[-1]["p"] - 1 if older else 0.0
        f[f"flow{n}"] = sum((1 if h["b"] else -1) * h["rel"] for h in win)
        f[f"ntr{n}"] = len(win)
        f[f"nsell{n}"] = sum(1 for h in win if not h["b"])
        f[f"maxsell{n}"] = max((h["rel"] for h in win if not h["b"]), default=0.0)
        f[f"maxbuy{n}"] = max((h["rel"] for h in win if h["b"]), default=0.0)
    f["traders20"] = len({h["u"] for h in hist if h["slot"] > e["slot"] - 20})
    return f


def build(by_mint: dict[str, list[dict]]) -> tuple[pd.DataFrame, pd.DataFrame]:
    entry_rows, exit_rows = [], []
    for mint, evs in by_mint.items():
        hist: deque = deque()
        first_slot = evs[0]["slot"]
        pos = None  # (entry_price, entry_slot, peak)
        rounds_done = 0
        last_exit_slot = None
        bot_buy_slots = [x["slot"] for x in evs if x["u"] == BOT and x["b"]]
        bot_sell_slots = [x["slot"] for x in evs if x["u"] == BOT and not x["b"]]
        for e in evs:
            if e["u"] == BOT:
                if e["b"] and pos is None:
                    pos = [e["p"], e["slot"], e["p"], e["rx"]]
                elif not e["b"] and pos is not None:
                    pos = None
                    rounds_done += 1
                    last_exit_slot = e["slot"]
                continue
            hist.append(e)
            while hist and hist[0]["slot"] <= e["slot"] - max(WINDOWS):
                hist.popleft()
            f = market_features(hist, e)
            f.update(mint=mint, slot=e["slot"], rx=e["rx"])
            if pos is None:
                f["age"] = e["slot"] - first_slot
                f["prior_rounds"] = rounds_done
                f["since_exit"] = e["slot"] - last_exit_slot if last_exit_slot is not None else 10_000
                f["label"] = int(any(0 <= s - e["slot"] <= LABEL_SLOTS for s in bot_buy_slots))
                entry_rows.append(f)
            else:
                pos[2] = max(pos[2], e["p"])
                f["ret"] = e["p"] / pos[0] - 1
                f["peak"] = pos[2] / pos[0] - 1
                f["dd"] = e["p"] / pos[2] - 1
                f["hold"] = e["slot"] - pos[1]
                f["hold_s"] = (e["rx"] - pos[3]) / 1000
                f["label"] = int(any(0 <= s - e["slot"] <= LABEL_SLOTS for s in bot_sell_slots))
                f["entry_slot"] = pos[1]
                exit_rows.append(f)
    return pd.DataFrame(entry_rows), pd.DataFrame(exit_rows)


def fit(df: pd.DataFrame, name: str, drop: list[str]) -> None:
    df = df.sort_values("rx")
    cut = df.rx.quantile(TRAIN_FRAC)
    tr, te = df[df.rx <= cut], df[df.rx > cut]
    cols = [c for c in df.columns if c not in {"mint", "slot", "rx", "label", "entry_slot", *drop}]
    clf = DecisionTreeClassifier(max_depth=DEPTH, class_weight="balanced", min_samples_leaf=20, random_state=0)
    clf.fit(tr[cols], tr.label)
    print(f"\n===== {name}: train {len(tr)} ({tr.label.sum()} pos) / test {len(te)} ({te.label.sum()} pos)")
    for part, d in (("train", tr), ("test", te)):
        pred = clf.predict(d[cols])
        tp = int(((pred == 1) & (d.label == 1)).sum())
        print(f"  {part}: precision {tp / max(pred.sum(), 1):.3f} recall {tp / max(d.label.sum(), 1):.3f} fired {int(pred.sum())}")
    imp = sorted(zip(clf.feature_importances_, cols), reverse=True)[:10]
    print("  importance:", ", ".join(f"{c}={v:.2f}" for v, c in imp if v > 0))
    print(export_text(clf, feature_names=cols, decimals=4))


def main() -> None:
    entry, exits = build(load())
    out = ROOT / "data"
    entry.to_pickle(out / "clone_entry.pkl")
    exits.to_pickle(out / "clone_exit.pkl")
    fit(exits, "EXIT", drop=[])
    fit(entry, "ENTRY", drop=[])


if __name__ == "__main__":
    main()
