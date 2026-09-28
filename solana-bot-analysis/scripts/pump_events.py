#!/usr/bin/env python3
"""Decode pump.fun TradeEvent from transaction logs."""
from __future__ import annotations

import base64
import struct
from typing import Any

import base58

# Anchor event discriminator for TradeEvent (first 8 bytes of sha256("event:TradeEvent"))
# Observed log prefix (base64 of discriminator + ...): "vdt/007mYe"
TRADE_EVENT_B64_PREFIX = "vdt/007mYe"
PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def _u64(data: bytes, off: int) -> int:
    return struct.unpack_from("<Q", data, off)[0]


def _i64(data: bytes, off: int) -> int:
    return struct.unpack_from("<q", data, off)[0]


def _pubkey(data: bytes, off: int) -> str:
    return base58.b58encode(data[off : off + 32]).decode()


def decode_trade_event_b64(b64: str) -> dict | None:
    """Decode a 'Program data: <b64>' payload if it is a TradeEvent."""
    if not b64.startswith(TRADE_EVENT_B64_PREFIX):
        return None
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    # Need at least discriminator(8) + fields through real_token (8+32+8+8+1+32+8+8+8+8+8 = 129)
    if len(raw) < 129:
        return None
    try:
        return {
            "mint": _pubkey(raw, 8),
            "sol_amount": _u64(raw, 40) / 1e9,
            "token_amount": _u64(raw, 48),
            "is_buy": raw[56] == 1,
            "user": _pubkey(raw, 57),
            "timestamp": _i64(raw, 89),
            "virtual_sol": _u64(raw, 97) / 1e9,
            "virtual_token": _u64(raw, 105),
            "real_sol": _u64(raw, 113) / 1e9,
            "real_token": _u64(raw, 121),
        }
    except Exception:
        return None


def extract_trade_events_from_tx(tx: dict) -> list[dict]:
    meta = tx.get("meta") or {}
    logs = meta.get("logMessages") or []
    events: list[dict] = []
    for line in logs:
        if not line.startswith("Program data: "):
            continue
        b64 = line[len("Program data: ") :].strip()
        ev = decode_trade_event_b64(b64)
        if ev:
            events.append(ev)
    return events


def expected_omego_size(real_sol: float) -> float:
    """omego size rule: buy ≈ 0.286 + 0.00934 × real_sol"""
    return 0.286 + 0.00934 * real_sol


def size_multiple(sol_amount: float, real_sol: float) -> float | None:
    base = expected_omego_size(real_sol)
    if base <= 0:
        return None
    return sol_amount / base
