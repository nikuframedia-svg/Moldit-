"""Number formatting — plain Portuguese, no technical notation.

Rules from Simplicidade Radical §5.3:
- Hours: "8h" or "9.5h" (never "9.47h")
- Days: "23 dias" (never "23d")
- Percentage: "85%" or "85.7%" (never "85.714%")
- Date: "15 de Abril" (never "2026-04-15")
- Probability: phrase, not number
- Interval: "Entre 8 e 11 horas" (never "[7.8, 11.1]")
"""
from __future__ import annotations

from datetime import date

_MESES = [
    "", "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

_DIAS_SEMANA = [
    "Segunda-feira", "Terca-feira", "Quarta-feira",
    "Quinta-feira", "Sexta-feira", "Sabado", "Domingo",
]


def fmt_horas(h: float) -> str:
    if h == 0:
        return "0h"
    if h == int(h):
        return f"{int(h)}h"
    return f"{h:.1f}h"


def fmt_dias(d: int | float) -> str:
    d = int(round(d))
    if d == 1:
        return "1 dia"
    return f"{d} dias"


def fmt_pct(p: float) -> str:
    if p == int(p):
        return f"{int(p)}%"
    return f"{p:.1f}%"


def fmt_data(d: date | str) -> str:
    if isinstance(d, str):
        try:
            d = date.fromisoformat(d)
        except ValueError:
            return str(d)
    return f"{d.day} de {_MESES[d.month]}"


def fmt_data_semana(d: date | str) -> str:
    if isinstance(d, str):
        try:
            d = date.fromisoformat(d)
        except ValueError:
            return str(d)
    dia_semana = _DIAS_SEMANA[d.weekday()]
    return f"{dia_semana}, {d.day} de {_MESES[d.month]}"


def fmt_probabilidade(p: float) -> str:
    """Convert probability 0-1 to plain Portuguese phrase."""
    if p >= 0.95:
        return "Quase certo"
    if p >= 0.85:
        return "Muito provavel"
    if p >= 0.70:
        return "Provavel"
    if p >= 0.50:
        return "Possivel"
    if p >= 0.30:
        return "Pouco provavel"
    if p >= 0.10:
        return "Improvavel"
    return "Muito improvavel"


def fmt_intervalo(lo: float, hi: float) -> str:
    return f"Entre {fmt_horas(lo)} e {fmt_horas(hi)}"
