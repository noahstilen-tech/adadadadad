#!/usr/bin/env python3
"""Rate-limited Solana JSON-RPC helper."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

RPC_URL = "https://api.mainnet-beta.solana.com"
DEFAULT_PAUSE_MS = 220
MAX_RETRIES = 8


class RpcError(RuntimeError):
    pass


def rpc(
    method: str,
    params: list[Any] | None = None,
    *,
    pause_ms: int = DEFAULT_PAUSE_MS,
    timeout: int = 60,
) -> Any:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or [],
    }
    body = json.dumps(payload).encode()
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        req = urllib.request.Request(
            RPC_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            if "error" in data:
                err = data["error"]
                msg = str(err)
                # Rate limit / busy → backoff
                if "429" in msg or "Too many" in msg or "rate" in msg.lower():
                    sleep_s = min(2 ** attempt, 32) + pause_ms / 1000
                    time.sleep(sleep_s)
                    last_err = RpcError(msg)
                    continue
                raise RpcError(msg)
            time.sleep(pause_ms / 1000)
            return data.get("result")
        except urllib.error.HTTPError as e:
            last_err = e
            sleep_s = min(2 ** attempt, 32) + pause_ms / 1000
            time.sleep(sleep_s)
        except Exception as e:  # noqa: BLE001
            last_err = e
            sleep_s = min(2 ** attempt, 16) + pause_ms / 1000
            time.sleep(sleep_s)
    raise RpcError(f"RPC failed after retries: {last_err}")


def get_balance(pubkey: str) -> float:
    lamports = rpc("getBalance", [pubkey])["value"]
    return lamports / 1e9


def get_signatures(
    address: str,
    *,
    before: str | None = None,
    until: str | None = None,
    limit: int = 1000,
) -> list[dict]:
    opts: dict[str, Any] = {"limit": limit}
    if before:
        opts["before"] = before
    if until:
        opts["until"] = until
    return rpc("getSignaturesForAddress", [address, opts]) or []


def get_transaction(signature: str) -> dict | None:
    return rpc(
        "getTransaction",
        [
            signature,
            {
                "encoding": "jsonParsed",
                "maxSupportedTransactionVersion": 1,
                "commitment": "confirmed",
            },
        ],
        timeout=90,
    )


def get_block(slot: int, *, transactions: bool = True) -> dict | None:
    opts: dict[str, Any] = {
        "encoding": "jsonParsed",
        "maxSupportedTransactionVersion": 1,
        "transactionDetails": "full" if transactions else "signatures",
        "rewards": False,
    }
    return rpc("getBlock", [slot, opts], timeout=120, pause_ms=400)
