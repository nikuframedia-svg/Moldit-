"""Utility functions — PRNG, time helpers.

Port of utils/prng.ts + utils/time.ts.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from .constants import DEFAULT_MO_CAPACITY, MINUTES_PER_DAY, S0, S1, S2, T1

# ── PRNG (bit-exact port of mulberry32) ──


def mulberry32(seed: int) -> Callable[[], float]:
    """Deterministic PRNG — bit-exact port of TS mulberry32.

    TS source:
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    """
    state = [seed & 0xFFFFFFFF]

    def _imul(a: int, b: int) -> int:
        """Emulate Math.imul (32-bit signed integer multiply, low 32 bits)."""
        a &= 0xFFFFFFFF
        b &= 0xFFFFFFFF
        ah = (a >> 16) & 0xFFFF
        al = a & 0xFFFF
        bh = (b >> 16) & 0xFFFF
        bl = b & 0xFFFF
        return ((al * bl) + (((ah * bl + al * bh) & 0xFFFF) << 16)) & 0xFFFFFFFF

    def _next() -> float:
        s = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = s
        t = _imul(s ^ (s >> 15), 1 | s)
        t2 = _imul(t ^ (t >> 7), 61 | t)
        t = ((t + t2) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return _next


# ── Time helpers ──

ShiftId = Literal["X", "Y", "Z"]


def fmt_min(m: int) -> str:
    """Format minutes as HH:MM."""
    wrapped = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
    h = wrapped // 60
    mn = round(wrapped % 60)
    return f"{h:02d}:{mn:02d}"


def to_abs(day: int, minute: int) -> int:
    """Convert (dayIdx, minuteInDay) to absolute minutes from day 0."""
    return day * MINUTES_PER_DAY + minute


def from_abs(abs_min: int) -> tuple[int, int]:
    """Convert absolute minutes back to (dayIdx, minuteInDay)."""
    return abs_min // MINUTES_PER_DAY, abs_min % MINUTES_PER_DAY


def get_shift(minute: int, third_shift: bool = False) -> ShiftId:
    """Get shift for a given minute within a day."""
    if S0 <= minute < T1:
        return "X"
    if T1 <= minute < S1:
        return "Y"
    if third_shift:
        return "Z"
    return "X"


def get_shift_end(shift: ShiftId) -> int:
    """Get shift end minute for a given shift."""
    if shift == "X":
        return T1
    if shift == "Y":
        return S1
    return S2


def get_shift_start(shift: ShiftId) -> int:
    """Get shift start minute for a given shift."""
    if shift == "X":
        return S0
    if shift == "Y":
        return T1
    return S1


_WEEKEND_LABELS = frozenset({"Sáb", "Dom", "Sab", "SAB", "DOM"})


def infer_workdays_from_labels(dnames: list[str], n_days: int) -> list[bool]:
    """Infer workday flags from day-of-week labels."""
    if len(dnames) >= n_days:
        return [label not in _WEEKEND_LABELS for label in dnames[:n_days]]
    return [True] * n_days


def pad_mo_array(
    arr: list[int],
    target_len: int,
    strategy: str,
    nominal_val: int,
) -> list[int]:
    """Pad MO (operator capacity) array to target length."""
    if not arr:
        return [DEFAULT_MO_CAPACITY] * target_len
    if len(arr) >= target_len:
        return arr[:target_len]
    result = list(arr)
    src_len = len(arr)
    while len(result) < target_len:
        if strategy == "cyclic":
            result.append(arr[len(result) % src_len])
        else:
            result.append(nominal_val)
    return result
