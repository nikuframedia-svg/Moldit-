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


# ── Portuguese public holidays ──

_PT_HOLIDAYS_FIXED = frozenset(
    {(1, 1), (4, 25), (5, 1), (6, 10), (8, 15), (10, 5), (11, 1), (12, 1), (12, 8), (12, 25)}
)


def _compute_easter(year: int) -> tuple[int, int]:
    """Anonymous Gregorian Easter algorithm → (month, day)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    month = (h + ll - 7 * m + 114) // 31
    day = ((h + ll - 7 * m + 114) % 31) + 1
    return month, day


def mark_holidays(workdays: list[bool], dates: list[str]) -> list[bool]:
    """Mark Portuguese public holidays as non-working days.

    dates are in "DD/MM" format. Year is inferred from the range.
    """
    if not dates:
        return workdays

    # Infer year: parse first date, assume current/next year
    # Dates span ~80 days, so at most 2 years
    first_parts = dates[0].split("/")
    last_parts = dates[-1].split("/")
    if len(first_parts) != 2 or len(last_parts) != 2:
        return workdays

    try:
        first_month = int(first_parts[1])
        last_month = int(last_parts[1])
    except ValueError:
        return workdays

    # Guess year: if months go from high to low, it spans year boundary
    import datetime

    now = datetime.date.today()
    year = now.year
    # If first month > 6 and dates seem future, use current year
    # Otherwise use next year if dates seem to be in the future
    if first_month >= now.month:
        year = now.year
    else:
        year = now.year + 1

    # Build set of holiday (month, day) for this year range
    holidays: set[tuple[int, int]] = set(_PT_HOLIDAYS_FIXED)

    # Easter-dependent holidays for relevant years
    for y in (year, year + 1):
        em, ed = _compute_easter(y)
        # Good Friday = Easter - 2 days
        import datetime as dt

        easter = dt.date(y, em, ed)
        good_friday = easter - dt.timedelta(days=2)
        holidays.add((good_friday.month, good_friday.day))
        # Corpus Christi = Easter + 60 days
        corpus = easter + dt.timedelta(days=60)
        holidays.add((corpus.month, corpus.day))

    result = list(workdays)
    for i, date_str in enumerate(dates):
        if i >= len(result):
            break
        parts = date_str.split("/")
        if len(parts) != 2:
            continue
        try:
            day = int(parts[0])
            month = int(parts[1])
        except ValueError:
            continue
        if (month, day) in holidays:
            result[i] = False

    return result


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
