#!/usr/bin/env python3
"""
Estimate SOL balance trajectory by sampling transactions across time.
Gives PnL proxy without decoding every trade.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import get_transaction  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
REPORTS = Path(__file__).resolve().parents[1] / "reports"

WALLETS = {
    "omego": "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq",
    "sssss": "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d",
}


def ts_iso(unix: int | None) -> str | None:
    if unix is None:
        return None
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat()


def balance_at(tx: dict, wallet: str) -> tuple[float | None, float | None]:
    meta = tx.get("meta") or {}
    msg = (tx.get("transaction") or {}).get("message") or {}
    keys = []
    for k in msg.get("accountKeys") or []:
        keys.append(k.get("pubkey") if isinstance(k, dict) else k)
    if wallet not in keys:
        return None, None
    i = keys.index(wallet)
    pre = meta.get("preBalances") or []
    post = meta.get("postBalances") or []
    pre_s = pre[i] / 1e9 if i < len(pre) else None
    post_s = post[i] / 1e9 if i < len(post) else None
    return pre_s, post_s


def sample_trajectory(label: str, address: str, hours: float, points: int) -> dict:
    sigs = json.load(open(DATA / f"{label}_signatures.json"))
    newest_t = sigs[0].get("blockTime") or 0
    cutoff = newest_t - int(hours * 3600)
    window = [s for s in sigs if (s.get("blockTime") or 0) >= cutoff]
    if len(window) < 2:
        window = sigs[: min(len(sigs), 5000)]
    # indices evenly spaced (window is newest-first)
    n = len(window)
    idxs = sorted({int(i * (n - 1) / (points - 1)) for i in range(points)})
    series = []
    print(f"[{label}] window_sigs={n} sampling {len(idxs)} points over ~{hours}h", flush=True)
    for j, idx in enumerate(idxs):
        s = window[idx]
        tx = get_transaction(s["signature"])
        if not tx:
            continue
        pre, post = balance_at(tx, address)
        series.append(
            {
                "blockTime": s.get("blockTime"),
                "blockTimeIso": ts_iso(s.get("blockTime")),
                "slot": s.get("slot"),
                "signature": s["signature"],
                "pre_sol": pre,
                "post_sol": post,
            }
        )
        if j % 5 == 0:
            print(f"  {ts_iso(s.get('blockTime'))} bal={post}", flush=True)

    # chronological
    series.sort(key=lambda x: x.get("blockTime") or 0)
    usable = [p for p in series if p.get("post_sol") is not None]
    delta = None
    per_hour = None
    if len(usable) >= 2:
        t0, t1 = usable[0]["blockTime"], usable[-1]["blockTime"]
        b0, b1 = usable[0]["post_sol"], usable[-1]["post_sol"]
        delta = b1 - b0
        span_h = (t1 - t0) / 3600 if t1 and t0 and t1 > t0 else None
        per_hour = delta / span_h if span_h else None

    # fail rate in window
    fail = sum(1 for s in window if s.get("err") is not None)
    out = {
        "label": label,
        "address": address,
        "hours": hours,
        "window_sigs": n,
        "fail_rate": fail / n if n else None,
        "points": usable,
        "balance_start": usable[0]["post_sol"] if usable else None,
        "balance_end": usable[-1]["post_sol"] if usable else None,
        "delta_sol": delta,
        "pnl_per_hour_proxy": per_hour,
        "time_start": usable[0]["blockTimeIso"] if usable else None,
        "time_end": usable[-1]["blockTimeIso"] if usable else None,
    }
    path = REPORTS / f"{label}_balance_traj_{int(hours)}h.json"
    with open(path, "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({k: out[k] for k in out if k != "points"}, indent=2), flush=True)
    return out


def main() -> None:
    hours = float(os.environ.get("HOURS", "24"))
    points = int(os.environ.get("POINTS", "20"))
    only = os.environ.get("ONLY")
    targets = WALLETS if not only else {only: WALLETS[only]}
    for label, addr in targets.items():
        if (DATA / f"{label}_signatures.json").exists():
            sample_trajectory(label, addr, hours, points)


if __name__ == "__main__":
    main()
