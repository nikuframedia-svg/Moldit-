"""Scheduling constants — port of constants.ts.

All values FROZEN. Do not change without updating frozen-invariants tests.
"""

from __future__ import annotations

# Shift boundaries (minutes from midnight)
S0 = 420  # Shift X start: 07:00
T1 = 930  # Shift change X→Y: 15:30
S1 = 1440  # Shift Y end: 24:00 (midnight)
S2 = 1860  # Shift Z end: 07:00 next day (S1 + S0)
MINUTES_PER_DAY = 1440

# Capacity
DAY_CAP = 1020  # 2 shifts (07:00 to 24:00) = 17h = 1020 min
DEFAULT_OEE = 0.66
TG_END = 960  # Turno geral end: 16:00

# Scheduling parameters
BUCKET_WINDOW = 5
MAX_EDD_GAP = 5
MAX_AUTO_MOVES = 50
MAX_OVERFLOW_ITER = 3
ALT_UTIL_THRESHOLD = 0.95
MAX_ADVANCE_DAYS = float("inf")
ADVANCE_UTIL_THRESHOLD = 0.95
OTD_TOLERANCE = 1.0

# Load leveling parameters
LEVEL_LOW_THRESHOLD = 0.50
LEVEL_HIGH_THRESHOLD = 0.85
LEVEL_LOOKAHEAD = 15

# Risk grid thresholds
RISK_MEDIUM_THRESHOLD = 0.85
RISK_HIGH_THRESHOLD = 0.95
RISK_CRITICAL_THRESHOLD = 1.0

# Machine IDs
KNOWN_FOCUS = frozenset({"PRM019", "PRM020", "PRM031", "PRM039", "PRM042", "PRM043"})

# Shipping cutoff
DEFAULT_SHIPPING_BUFFER_HOURS = 0

# Auto-replan parameters
DEFAULT_OVERTIME_MAX_PER_MACHINE = 450
DEFAULT_OVERTIME_MAX_TOTAL = 2700
SPLIT_MIN_FRACTION = 0.3
SPLIT_MIN_DEFICIT = 60

# Default values for unknown data
DEFAULT_MO_CAPACITY = 99
