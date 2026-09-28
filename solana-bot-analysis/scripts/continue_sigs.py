#!/usr/bin/env python3
"""Continue paging signatures from last known signature until genesis (or max pages)."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import get_signatures  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
WALLETS = {
    "omego": "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq",
    "sssss": "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d",
}


def ts_iso(unix: int | None) -> str | None:
    if unix is None:
        return None
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat()


def continue_sigs(label: str, address: str, max_pages: int = 100) -> list[dict]:
    path = DATA / f"{label}_signatures.json"
    if path.exists():
        with open(path) as f:
            sigs = json.load(f)
        print(f"[{label}] resume {len(sigs)} existing", flush=True)
        before = sigs[-1]["signature"]
    else:
        sigs = []
        before = None

    # Dedup helper
    seen = {s["signature"] for s in sigs}
    page = 0
    empty_streak = 0
    while page < max_pages:
        page += 1
        batch = get_signatures(address, before=before, limit=1000)
        if not batch:
            empty_streak += 1
            print(f"[{label}] empty page {page}, streak={empty_streak}", flush=True)
            if empty_streak >= 2:
                break
            continue
        empty_streak = 0
        new = [s for s in batch if s["signature"] not in seen]
        if not new:
            print(f"[{label}] page {page}: no new sigs (RPC window exhausted?)", flush=True)
            break
        for s in new:
            seen.add(s["signature"])
        sigs.extend(new)
        before = batch[-1]["signature"]
        print(
            f"[{label}] page {page}: +{len(new)} total={len(sigs)} "
            f"oldest={ts_iso(batch[-1].get('blockTime'))}",
            flush=True,
        )
        if page % 5 == 0:
            with open(path, "w") as f:
                json.dump(sigs, f)
        if len(batch) < 1000:
            print(f"[{label}] reached end (batch < 1000)", flush=True)
            break

    with open(path, "w") as f:
        json.dump(sigs, f)
    print(f"[{label}] DONE total={len(sigs)} oldest={ts_iso(sigs[-1].get('blockTime'))}", flush=True)
    return sigs


def main() -> None:
    only = os.environ.get("ONLY")
    max_pages = int(os.environ.get("MAX_PAGES", "100"))
    targets = WALLETS if not only else {only: WALLETS[only]}
    for label, addr in targets.items():
        continue_sigs(label, addr, max_pages=max_pages)


if __name__ == "__main__":
    main()
