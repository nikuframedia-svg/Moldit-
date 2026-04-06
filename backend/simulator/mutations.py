"""Mutation application -- Moldit Planner (Phase 4).

8 handlers for mold production what-if scenarios.
Each handler modifies MolditEngineData in-place (on a deepcopy) and returns
a Portuguese summary string.

Handlers:
  machine_down     -- block machine on date range
  overtime         -- extend regime for a machine
  deadline_change  -- change molde deadline
  priority_boost   -- boost molde priority (work_restante_h multiplier)
  add_holiday      -- add holiday date
  remove_holiday   -- remove holiday date
  force_machine    -- force op to specific machine
  op_done          -- mark operation as complete
"""

from __future__ import annotations

import logging

from backend.config.types import FactoryConfig
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)

# Mutation type -> handler
_HANDLERS: dict[str, callable] = {}


def _register(name: str):
    def decorator(fn):
        _HANDLERS[name] = fn
        return fn
    return decorator


def apply_mutation(
    data: MolditEngineData,
    mutation_type: str,
    params: dict,
    config: FactoryConfig | None = None,
) -> str:
    """Apply a single mutation to MolditEngineData (in-place). Returns summary string."""
    handler = _HANDLERS.get(mutation_type)
    if handler is None:
        raise ValueError(f"Unknown mutation type: {mutation_type}")
    # Pass config to handlers that accept it
    import inspect
    sig = inspect.signature(handler)
    if "config" in sig.parameters:
        return handler(data, params, config=config)
    return handler(data, params)


def mutation_summary(mutation_type: str, params: dict) -> str:
    """Generate a Portuguese description of a mutation without applying it."""
    summaries = {
        "machine_down": lambda p: (
            f"Maquina {p.get('machine_id', '?')} parada "
            f"{p.get('start_date', '?')} a {p.get('end_date', '?')}"
        ),
        "overtime": lambda p: (
            f"Horas extra: regime {p.get('machine_id', '?')} "
            f"para {p.get('new_regime_h', '?')}h"
        ),
        "deadline_change": lambda p: (
            f"Deadline do molde {p.get('molde_id', '?')} "
            f"alterado para {p.get('new_deadline', '?')}"
        ),
        "priority_boost": lambda p: (
            f"Prioridade do molde {p.get('molde_id', '?')} aumentada"
        ),
        "add_holiday": lambda p: f"Feriado adicionado: {p.get('date', '?')}",
        "remove_holiday": lambda p: f"Feriado removido: {p.get('date', '?')}",
        "force_machine": lambda p: (
            f"Op {p.get('op_id', '?')} forcada para maquina {p.get('machine_id', '?')}"
        ),
        "op_done": lambda p: (
            f"Op {p.get('op_id', '?')} marcada como concluida"
        ),
    }
    fn = summaries.get(mutation_type)
    return fn(params) if fn else f"Mutacao desconhecida: {mutation_type}"


# ── Handlers ──


@_register("machine_down")
def _machine_down(data: MolditEngineData, params: dict) -> str:
    """Block specific machine on given date range.

    Removes machine from compatibilidade lists. Ops already assigned
    to this machine get their recurso cleared so the scheduler
    will reassign.
    """
    machine_id = params["machine_id"]
    if not any(m.id == machine_id for m in data.maquinas):
        return f"Maquina {machine_id} nao encontrada"

    # Mark machine as unavailable by setting regime to 0
    for m in data.maquinas:
        if m.id == machine_id:
            m.regime_h = 0
            break

    # Clear ops assigned to this machine
    count = 0
    for op in data.operacoes:
        if op.recurso == machine_id:
            op.recurso = None
            count += 1

    return f"Maquina {machine_id} parada ({count} ops reatribuidas)"


@_register("overtime")
def _overtime(data: MolditEngineData, params: dict, config: FactoryConfig | None = None) -> str:
    """Extend regime hours for a machine (e.g. 16 -> 24)."""
    machine_id = params["machine_id"]
    new_regime = int(params["new_regime_h"])

    for m in data.maquinas:
        if m.id == machine_id:
            old = m.regime_h
            m.regime_h = new_regime
            return f"Regime {machine_id}: {old}h -> {new_regime}h"

    return f"Maquina {machine_id} nao encontrada"


@_register("deadline_change")
def _deadline_change(data: MolditEngineData, params: dict) -> str:
    """Change deadline for a molde."""
    molde_id = params["molde_id"]
    new_deadline = params["new_deadline"]

    for molde in data.moldes:
        if molde.id == molde_id:
            old = molde.deadline
            molde.deadline = new_deadline
            return f"Deadline {molde_id}: {old} -> {new_deadline}"

    return f"Molde {molde_id} nao encontrado"


@_register("priority_boost")
def _priority_boost(data: MolditEngineData, params: dict) -> str:
    """Boost priority of a molde by reducing work_restante_h weight.

    This makes the molde's ops appear more urgent in priority queue.
    Implemented by increasing the DAG priority (moving to front of caminho_critico).
    """
    molde_id = params["molde_id"]
    factor = float(params.get("factor", 1.5))

    found = False
    for molde in data.moldes:
        if molde.id == molde_id:
            found = True
            break

    if not found:
        return f"Molde {molde_id} nao encontrado"

    # Move all ops of this molde to front of caminho_critico
    molde_ops = [op.id for op in data.operacoes if op.molde == molde_id]
    molde_op_set = set(molde_ops)
    new_critical = molde_ops + [x for x in data.caminho_critico if x not in molde_op_set]
    data.caminho_critico = new_critical

    return f"Prioridade {molde_id} aumentada (factor {factor}x, {len(molde_ops)} ops)"


@_register("add_holiday")
def _add_holiday(data: MolditEngineData, params: dict) -> str:
    """Add a holiday date."""
    date = params["date"]
    if date not in data.feriados:
        data.feriados.append(date)
    return f"Feriado adicionado: {date}"


@_register("remove_holiday")
def _remove_holiday(data: MolditEngineData, params: dict) -> str:
    """Remove a holiday date."""
    date = params["date"]
    if date in data.feriados:
        data.feriados.remove(date)
        return f"Feriado removido: {date}"
    return f"Data {date} nao era feriado"


@_register("force_machine")
def _force_machine(data: MolditEngineData, params: dict) -> str:
    """Force an operation to a specific machine."""
    op_id = int(params["op_id"])
    machine_id = params["machine_id"]

    if not any(m.id == machine_id for m in data.maquinas):
        raise ValueError(f"Maquina {machine_id} nao existe")

    # Check compatibility
    for op in data.operacoes:
        if op.id == op_id:
            compativeis = data.compatibilidade.get(op.codigo, [])
            if compativeis and machine_id not in compativeis:
                raise ValueError(
                    f"Maquina {machine_id} nao e compativel com {op.codigo}. "
                    f"Compativeis: {', '.join(compativeis)}"
                )
            break

    for op in data.operacoes:
        if op.id == op_id:
            old = op.recurso
            op.recurso = machine_id
            return f"Op {op_id}: {old} -> {machine_id}"

    return f"Op {op_id} nao encontrada"


@_register("op_done")
def _op_done(data: MolditEngineData, params: dict) -> str:
    """Mark an operation as 100% complete."""
    op_id = int(params["op_id"])
    progress = float(params.get("progress", 100.0))

    for op in data.operacoes:
        if op.id == op_id:
            old_progress = op.progresso
            op.progresso = min(progress, 100.0)
            op.work_restante_h = op.work_h * (1.0 - op.progresso / 100.0)
            return f"Op {op_id}: progresso {old_progress:.0f}% -> {op.progresso:.0f}%"

    return f"Op {op_id} nao encontrada"
