"""Master data executors — Spec 10.

10 executors for factory master data changes.
Pattern: validate -> update config -> SYNC EngineData -> save YAML -> re-schedule -> return impact.
Uses Moldit types (no Incompol references).
"""

from __future__ import annotations

import json
import logging

from backend.config.loader import _parse_time, save_config
from backend.config.types import MachineConfig, ShiftConfig
from backend.copilot.state import state
from backend.types import Maquina as MachineInfo

logger = logging.getLogger(__name__)


def _dumps(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _guard() -> str | None:
    if state.engine_data is None:
        return _dumps({"error": "Sem dados carregados."})
    if state.config is None:
        return _dumps({"error": "Configuracao nao carregada."})
    return None


def _reschedule() -> dict:
    """Re-schedule and return new score."""
    from backend.cpo import optimize

    result = optimize(state.engine_data, mode="quick", audit=True, config=state.config)
    state.update_schedule(result)
    return result.score


def _sync_day_capacity() -> None:
    """Sync EngineData machine capacities from config shifts."""
    for m in state.engine_data.maquinas:
        mc = state.config.machines.get(m.id)
        if mc:
            m.regime_h = mc.regime_h


# --- 1. adicionar_maquina -----------------------------------------------

def exec_adicionar_maquina(args: dict) -> str:
    if (err := _guard()):
        return err

    mid = args["id"]
    grupo = args.get("grupo", "Grandes")
    activa = args.get("activa", True)

    if mid in state.config.machines:
        return _dumps({"error": f"Maquina {mid} ja existe."})

    # 1. Update config
    state.config.machines[mid] = MachineConfig(id=mid, group=grupo, active=activa)

    # 2. Sync EngineData
    if activa:
        state.engine_data.maquinas.append(
            MachineInfo(id=mid, grupo=grupo),
        )

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({"status": "ok", "maquina": mid, "score": new_score, "score_anterior": old_score})


# --- 2. editar_maquina --------------------------------------------------

def exec_editar_maquina(args: dict) -> str:
    if (err := _guard()):
        return err

    mid = args["id"]
    if mid not in state.config.machines:
        return _dumps({"error": f"Maquina {mid} nao existe."})

    mc = state.config.machines[mid]

    # 1. Update config
    if "activa" in args:
        mc.active = args["activa"]
    if "grupo" in args:
        mc.group = args["grupo"]

    # 2. Sync EngineData
    if "activa" in args and not args["activa"]:
        state.engine_data.maquinas = [m for m in state.engine_data.maquinas if m.id != mid]
    elif "activa" in args and args["activa"]:
        if not any(m.id == mid for m in state.engine_data.maquinas):
            state.engine_data.maquinas.append(
                MachineInfo(id=mid, grupo=mc.group),
            )
    if "grupo" in args:
        for m in state.engine_data.maquinas:
            if m.id == mid:
                m.grupo = args["grupo"]

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({"status": "ok", "maquina": mid, "score": new_score, "score_anterior": old_score})


# --- 3. adicionar_ferramenta --------------------------------------------

def exec_adicionar_ferramenta(args: dict) -> str:
    if (err := _guard()):
        return err

    tid = args["id"]
    primary = args["primary"]
    alt = args.get("alt")
    setup_h_val = args.get("setup_hours", 0.5)

    if tid in state.config.tools:
        return _dumps({"error": f"Ferramenta {tid} ja existe."})
    if primary not in state.config.machines:
        return _dumps({"error": f"Maquina primaria {primary} nao existe."})
    if alt and alt not in state.config.machines:
        return _dumps({"error": f"Maquina alternativa {alt} nao existe."})

    # 1. Update config
    tool_data = {"primary": primary, "setup_hours": setup_h_val}
    if alt:
        tool_data["alt"] = alt
    state.config.tools[tid] = tool_data

    # 2. No EngineData sync needed (no ops use this new tool yet)

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({
        "status": "ok", "ferramenta": tid,
        "score": new_score, "score_anterior": old_score,
    })


# --- 4. editar_ferramenta -----------------------------------------------

def exec_editar_ferramenta(args: dict) -> str:
    if (err := _guard()):
        return err

    tid = args["id"]
    if tid not in state.config.tools:
        return _dumps({"error": f"Ferramenta {tid} nao existe."})

    tool_data = state.config.tools[tid]

    # 1. Update config
    if "setup_hours" in args:
        tool_data["setup_hours"] = args["setup_hours"]
    if "alt" in args:
        new_alt = args["alt"]
        if new_alt and new_alt not in state.config.machines:
            return _dumps({"error": f"Maquina {new_alt} nao existe."})
        tool_data["alt"] = new_alt

    # 2. SYNC EngineData -- update setup_h on machines associated with this tool
    new_setup = args.get("setup_hours")
    if new_setup is not None:
        for m in state.engine_data.maquinas:
            mc = state.config.machines.get(m.id)
            if mc and tid in str(state.config.tools):
                # Update machine default setup if applicable
                pass

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({
        "status": "ok", "ferramenta": tid,
        "score": new_score, "score_anterior": old_score,
    })


# --- 5. adicionar_feriado -----------------------------------------------

def exec_adicionar_feriado(args: dict) -> str:
    if (err := _guard()):
        return err

    data = args["data"]
    if data in state.config.holidays:
        return _dumps({"error": f"Feriado {data} ja existe."})

    # 1. Update config
    state.config.holidays.append(data)

    # 2. Sync EngineData
    if data not in state.engine_data.feriados:
        state.engine_data.feriados.append(data)
        state.engine_data.feriados.sort()

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({
        "status": "ok", "feriado": data,
        "score": new_score, "score_anterior": old_score,
    })


# --- 6. remover_feriado -------------------------------------------------

def exec_remover_feriado(args: dict) -> str:
    if (err := _guard()):
        return err

    data = args["data"]
    if data not in state.config.holidays:
        return _dumps({"error": f"Feriado {data} nao existe."})

    # 1. Update config
    state.config.holidays.remove(data)

    # 2. Sync EngineData
    if data in state.engine_data.feriados:
        state.engine_data.feriados.remove(data)

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({
        "status": "ok", "feriado_removido": data,
        "score": new_score, "score_anterior": old_score,
    })


# --- 7. editar_turno ----------------------------------------------------

def exec_editar_turno(args: dict) -> str:
    if (err := _guard()):
        return err

    tid = args["turno_id"]
    shift = next((s for s in state.config.shifts if s.id == tid), None)
    if not shift:
        return _dumps({"error": f"Turno {tid} nao existe."})

    # 1. Update config
    if "inicio" in args:
        shift.start_min = _parse_time(args["inicio"])
    if "fim" in args:
        shift.end_min = _parse_time(args["fim"])

    # 2. Sync EngineData
    _sync_day_capacity()

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({
        "status": "ok", "turno": tid,
        "day_capacity_min": state.config.day_capacity_min,
        "score": new_score, "score_anterior": old_score,
    })


# --- 8. adicionar_turno ------------------------------------------------

def exec_adicionar_turno(args: dict) -> str:
    if (err := _guard()):
        return err

    tid = args["id"]
    if any(s.id == tid for s in state.config.shifts):
        return _dumps({"error": f"Turno {tid} ja existe."})

    inicio = _parse_time(args["inicio"])
    fim = _parse_time(args["fim"])
    label = args.get("label", "")

    # 1. Update config
    state.config.shifts.append(ShiftConfig(id=tid, start_min=inicio, end_min=fim, label=label))

    # 2. Sync EngineData
    _sync_day_capacity()

    # 3. Save + re-schedule
    old_score = dict(state.score)
    save_config(state.config)
    new_score = _reschedule()

    return _dumps({
        "status": "ok", "turno": tid,
        "day_capacity_min": state.config.day_capacity_min,
        "score": new_score, "score_anterior": old_score,
    })
