"""Factory config loader — Moldit Planner."""

from __future__ import annotations

from pathlib import Path

import yaml

from .types import FactoryConfig, MachineConfig, ShiftConfig

DEFAULT_CONFIG_PATH = "config/factory.yaml"


def _parse_time(t: str) -> int:
    """Parse HH:MM to minutes from midnight. '00:00' -> 1440 (end of day)."""
    h, m = t.split(":")
    mins = int(h) * 60 + int(m)
    return mins if mins > 0 else 1440


def load_config(path: str = DEFAULT_CONFIG_PATH) -> FactoryConfig:
    """Load factory YAML. Missing file or sections -> defaults."""
    raw: dict = {}
    p = Path(path)
    if p.exists():
        with open(p) as f:
            raw = yaml.safe_load(f) or {}

    config = FactoryConfig()

    # Factory identity
    factory = raw.get("factory", {})
    if factory:
        config.name = factory.get("name", config.name)
        config.site = factory.get("site", config.site)
        config.timezone = factory.get("timezone", config.timezone)

    # Shifts
    shifts_raw = raw.get("shifts", [])
    if shifts_raw:
        config.shifts = [
            ShiftConfig(
                id=s["id"],
                start_min=_parse_time(s["start"]),
                end_min=_parse_time(s["end"]),
                label=s.get("label", ""),
            )
            for s in shifts_raw
        ]

    # Machines (new format: regime_h, setup_h)
    for mid, mdata in raw.get("machines", {}).items():
        if isinstance(mdata, dict):
            regime_h = mdata.get("regime_h", 16)
            config.machines[mid] = MachineConfig(
                id=mid,
                group=mdata.get("group", "Outros"),
                active=mdata.get("active", True),
                regime_h=regime_h,
                setup_h=mdata.get("setup_h", 1.0),
                e_externo=(regime_h == 0),
            )

    # Bancada dedicacao
    bancada_raw = raw.get("bancada_dedicacao", {})
    if bancada_raw:
        config.bancada_dedicacao = bancada_raw
        # Also inject into per-machine dedicacao
        for maq_id, ded_map in bancada_raw.items():
            if maq_id in config.machines:
                config.machines[maq_id].dedicacao = ded_map

    # Electrodos default
    config.electrodos_default_h = raw.get(
        "electrodos_default_h", config.electrodos_default_h,
    )

    # Tools (merge alt_machines + setup_hours format)
    tools_raw = raw.get("tools", {})
    default_tool = tools_raw.get("_default", {})
    if isinstance(default_tool, dict):
        config.default_setup_hours = default_tool.get(
            "setup_hours", config.default_setup_hours,
        )
    for tid, tdata in tools_raw.items():
        if tid == "_default" or not isinstance(tdata, dict):
            continue
        config.tools[tid] = tdata

    # Operators
    operators_raw = raw.get("operators", {})
    if operators_raw:
        ops: dict[tuple[str, str], int] = {}
        for group, shifts in operators_raw.items():
            if isinstance(shifts, dict):
                for shift_id, count in shifts.items():
                    ops[(group, shift_id)] = count
        if ops:
            config.operators = ops

    # Holidays
    holidays_raw = raw.get("holidays", [])
    if holidays_raw:
        config.holidays = holidays_raw
    # Warn if holidays year doesn't match current year
    holidays_year = raw.get("holidays_year")
    if holidays_year:
        import datetime
        current_year = datetime.date.today().year
        if int(holidays_year) != current_year:
            import logging
            logging.getLogger(__name__).warning(
                "factory.yaml holidays_year=%s mas ano actual=%s. "
                "Feriados moveis (Carnaval, Pascoa, Corpo de Deus) podem estar errados.",
                holidays_year, current_year,
            )

    # Scoring
    scoring = raw.get("scoring", {})
    if scoring:
        config.weight_makespan = scoring.get(
            "weight_makespan", config.weight_makespan,
        )
        config.weight_deadline_compliance = scoring.get(
            "weight_deadline_compliance", config.weight_deadline_compliance,
        )
        config.weight_setups = scoring.get(
            "weight_setups", config.weight_setups,
        )
        config.weight_balance = scoring.get(
            "weight_utilization_balance", config.weight_balance,
        )

    # Risk
    risk = raw.get("risk", {})
    if risk:
        oee_dist = risk.get("oee_distribution", {})
        if oee_dist:
            config.risk_oee_alpha = oee_dist.get("alpha", config.risk_oee_alpha)
            config.risk_oee_beta = oee_dist.get("beta", config.risk_oee_beta)
        config.risk_setup_cv = risk.get("setup_cv", config.risk_setup_cv)
        config.risk_processing_cv = risk.get("processing_cv", config.risk_processing_cv)

    # Compatibilidade (if provided in YAML)
    compat_raw = raw.get("compatibilidade", {})
    if compat_raw:
        config.compatibilidade = compat_raw

    return config


def _min_to_time(mins: int) -> str:
    """Convert minutes from midnight to HH:MM string. 420 -> '07:00', 1440 -> '00:00'."""
    if mins >= 1440:
        mins = 0
    return f"{mins // 60:02d}:{mins % 60:02d}"


def save_config(config: FactoryConfig, path: str = DEFAULT_CONFIG_PATH) -> None:
    """Serialize FactoryConfig back to YAML."""
    machines_data = {}
    for mid, m in config.machines.items():
        machines_data[mid] = {
            "group": m.group,
            "regime_h": m.regime_h,
            "setup_h": m.setup_h,
        }

    data = {
        "factory": {"name": config.name, "site": config.site, "timezone": config.timezone},
        "machines": machines_data,
        "bancada_dedicacao": config.bancada_dedicacao,
        "electrodos_default_h": config.electrodos_default_h,
        "holidays": config.holidays,
        "scoring": {
            "weight_makespan": config.weight_makespan,
            "weight_deadline_compliance": config.weight_deadline_compliance,
            "weight_setups": config.weight_setups,
            "weight_utilization_balance": config.weight_balance,
        },
        "risk": {
            "oee_distribution": {
                "type": "beta",
                "alpha": config.risk_oee_alpha,
                "beta": config.risk_oee_beta,
            },
            "setup_cv": config.risk_setup_cv,
            "processing_cv": config.risk_processing_cv,
        },
    }
    with open(path, "w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def validate_config(config: FactoryConfig) -> list[str]:
    """Validate config. Returns list of errors (empty = valid)."""
    errors: list[str] = []

    # Shifts
    if not config.shifts:
        errors.append("Nenhum turno definido")
    if config.day_capacity_min <= 0:
        errors.append(f"DAY_CAP = {config.day_capacity_min} (deve ser > 0)")

    # Machines
    if config.machines:
        active = [m for m in config.machines.values() if m.active]
        if not active:
            errors.append("Nenhuma maquina activa")

    # Scoring weights should sum to ~1.0
    w_sum = (config.weight_makespan + config.weight_deadline_compliance
             + config.weight_setups + config.weight_balance)
    if abs(w_sum - 1.0) > 0.01:
        errors.append(f"Scoring weights somam {w_sum:.2f}, deviam somar 1.0")

    # OEE range
    if not 0.1 <= config.oee_default <= 1.0:
        errors.append(f"OEE default {config.oee_default} fora do range 0.1-1.0")

    return errors
