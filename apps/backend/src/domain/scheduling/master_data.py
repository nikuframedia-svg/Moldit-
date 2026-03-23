"""Incompol factory master data — alt machines and setup times.

Source: ISOP__Nikufra.xlsx (coluna "Máquina alternativa").
Used by the solver bridge when the production ISOP lacks alt/setup columns.
"""

from __future__ import annotations

# Tool → alternative machine (primary is implicit from the ISOP row)
TOOL_ALT_MACHINE: dict[str, str] = {
    "BFP079": "PRM039",  # PRM031 → PRM039
    "BFP080": "PRM039",  # PRM019 → PRM039
    "BFP082": "PRM039",  # PRM019 → PRM039
    "BFP083": "PRM039",  # PRM031 → PRM039
    "BFP091": "PRM043",  # PRM039 → PRM043
    "BFP092": "PRM043",  # PRM039 → PRM043
    "BFP096": "PRM043",  # PRM039 → PRM043
    "BFP100": "PRM043",  # PRM039 → PRM043
    "BFP101": "PRM043",  # PRM039 → PRM043
    "BFP110": "PRM043",  # PRM039 → PRM043
    "BFP112": "PRM031",  # PRM039 → PRM031
    "BFP114": "PRM039",  # PRM031 → PRM039
    "BFP125": "PRM039",  # PRM043 → PRM039
    "BFP162": "PRM039",  # PRM031 → PRM039
    "BFP171": "PRM039",  # PRM031 → PRM039
    "BFP172": "PRM039",  # PRM043 → PRM039
    "BFP178": "PRM043",  # PRM039 → PRM043
    "BFP179": "PRM043",  # PRM019 → PRM043
    "BFP181": "PRM043",  # PRM019 → PRM043
    "BFP183": "PRM039",  # PRM031 → PRM039
    "BFP184": "PRM039",  # PRM031 → PRM039
    "BFP186": "PRM031",  # PRM039 → PRM031
    "BFP187": "PRM039",  # PRM043 → PRM039
    "BFP188": "PRM031",  # PRM043 → PRM031
    "BFP192": "PRM043",  # PRM019 → PRM043
    "BFP197": "PRM043",  # PRM019 → PRM043
    "BFP204": "PRM039",  # PRM043 → PRM039
    "VUL038": "PRM043",  # PRM019 → PRM043
    "VUL068": "PRM039",  # PRM020 → PRM039
    "VUL127": "PRM043",  # PRM039 → PRM043
}

# Tool → setup time in hours (fallback when ISOP has no setup column)
TOOL_SETUP_HOURS: dict[str, float] = {
    "BFP079": 1.0,
    "BFP080": 1.25,
    "BFP082": 1.25,
    "BFP083": 1.0,
    "BFP091": 1.0,
    "BFP092": 1.0,
    "BFP096": 1.0,
    "BFP100": 1.0,
    "BFP101": 1.0,
    "BFP110": 1.0,
    "BFP112": 0.5,
    "BFP114": 1.25,
    "BFP125": 1.0,
    "BFP162": 1.25,
    "BFP171": 0.5,
    "BFP172": 0.5,
    "BFP178": 0.5,
    "BFP179": 0.5,
    "BFP181": 0.5,
    "BFP183": 0.5,
    "BFP184": 0.5,
    "BFP186": 0.5,
    "BFP187": 0.5,
    "BFP188": 0.5,
    "BFP192": 0.5,
    "BFP195": 0.5,
    "BFP197": 0.5,
    "BFP202": 0.5,
    "BFP204": 0.5,
    "DYE025": 1.5,
    "EBR001": 0.5,
    "HAN002": 0.5,
    "HAN004": 0.5,
    "JDE002": 1.0,
    "JTE001": 1.0,
    "JTE003": 1.0,
    "LEC002": 0.5,
    "MIC009": 0.5,
    "VUL031": 1.0,
    "VUL038": 1.25,
    "VUL068": 1.0,
    "VUL111": 1.5,
    "VUL115": 1.0,
    "VUL127": 1.0,
}
