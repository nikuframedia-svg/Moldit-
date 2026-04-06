"""Workforce management API — Moldit Planner.

Endpoints for managing operators, detecting conflicts,
auto-allocating shifts, and forecasting needs.
"""

from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.copilot.state import state
from backend.workforce.store import WorkforceStore
from backend.workforce.types import Operador

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workforce", tags=["workforce"])

# ── Singleton store ────────────────────────────────────────────────────

_store: WorkforceStore | None = None


def _get_store() -> WorkforceStore:
    global _store
    if _store is None:
        _store = WorkforceStore()
    return _store


def _require_data():
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")


def _require_config():
    if state.config is None:
        raise HTTPException(503, "Configuracao nao carregada.")


def _get_competencias(store: WorkforceStore) -> dict:
    """Load competency map, auto-generating from config if needed."""
    factory_machines = None
    if state.config and state.config.machines:
        factory_machines = state.config.machines
    return store.load_competencias(factory_machines=factory_machines)


# ═══════════════════════════════════════════════════════════════════════
# Pydantic models for request bodies
# ═══════════════════════════════════════════════════════════════════════


class OperadorInput(BaseModel):
    nome: str
    competencias: list[str] = []
    nivel: dict[str, int] = {}
    turno: str = "A"
    zona: str = ""
    disponivel: bool = True
    horas_semanais: float = 40.0


class OperadorUpdate(BaseModel):
    nome: str | None = None
    competencias: list[str] | None = None
    nivel: dict[str, int] | None = None
    turno: str | None = None
    zona: str | None = None
    disponivel: bool | None = None
    horas_semanais: float | None = None


class AutoAllocateRequest(BaseModel):
    dia: int
    turno: str = "A"


# ═══════════════════════════════════════════════════════════════════════
# OPERADORES CRUD
# ═══════════════════════════════════════════════════════════════════════


@router.get("/operadores")
async def list_operadores():
    """List all operators."""
    store = _get_store()
    ops = store.load_operadores()
    return [
        {
            "id": op.id,
            "nome": op.nome,
            "competencias": op.competencias,
            "nivel": op.nivel,
            "turno": op.turno,
            "zona": op.zona,
            "disponivel": op.disponivel,
            "horas_semanais": op.horas_semanais,
        }
        for op in ops
    ]


@router.post("/operadores")
async def add_operador(body: OperadorInput):
    """Add a new operator. ID is auto-generated (OP-001, OP-002, ...)."""
    store = _get_store()
    new_id = store._next_id()
    op = Operador(
        id=new_id,
        nome=body.nome,
        competencias=list(body.competencias),
        nivel=dict(body.nivel),
        turno=body.turno,
        zona=body.zona,
        disponivel=body.disponivel,
        horas_semanais=body.horas_semanais,
    )
    store.add_operador(op)
    return {
        "status": "ok",
        "operador": {
            "id": op.id,
            "nome": op.nome,
            "competencias": op.competencias,
            "nivel": op.nivel,
            "turno": op.turno,
            "zona": op.zona,
            "disponivel": op.disponivel,
            "horas_semanais": op.horas_semanais,
        },
    }


@router.put("/operadores/{op_id}")
async def update_operador(op_id: str, body: OperadorUpdate):
    """Update an existing operator's fields."""
    store = _get_store()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nenhum campo para atualizar.")

    result = store.update_operador(op_id, updates)
    if result is None:
        raise HTTPException(404, f"Operador {op_id} nao encontrado.")

    return {
        "status": "ok",
        "operador": {
            "id": result.id,
            "nome": result.nome,
            "competencias": result.competencias,
            "nivel": result.nivel,
            "turno": result.turno,
            "zona": result.zona,
            "disponivel": result.disponivel,
            "horas_semanais": result.horas_semanais,
        },
    }


@router.delete("/operadores/{op_id}")
async def remove_operador(op_id: str):
    """Remove an operator by ID."""
    store = _get_store()
    removed = store.remove_operador(op_id)
    if not removed:
        raise HTTPException(404, f"Operador {op_id} nao encontrado.")
    return {"status": "ok", "removed": op_id}


# ═══════════════════════════════════════════════════════════════════════
# CONFLICTS
# ═══════════════════════════════════════════════════════════════════════


@router.get("/conflicts")
async def get_conflicts(dia: int | None = None):
    """Detect workforce conflicts. Optionally filter by day."""
    _require_data()
    from backend.workforce.conflict_detector import detectar_conflitos

    store = _get_store()
    operadores = store.load_operadores()
    competencias = _get_competencias(store)

    segmentos = state.segments
    if dia is not None:
        segmentos = [s for s in segmentos if s.dia == dia]

    conflicts = detectar_conflitos(
        segmentos=segmentos,
        operadores=operadores,
        competencias=competencias,
        config=state.config,
    )

    return {
        "total": len(conflicts),
        "conflicts": [asdict(c) for c in conflicts],
    }


# ═══════════════════════════════════════════════════════════════════════
# AUTO-ALLOCATE
# ═══════════════════════════════════════════════════════════════════════


@router.post("/auto-allocate")
async def auto_allocate_endpoint(body: AutoAllocateRequest):
    """Auto-assign operators to machines for a day/shift."""
    _require_data()
    from backend.workforce.auto_allocate import auto_allocate

    store = _get_store()
    operadores = store.load_operadores()
    competencias = _get_competencias(store)

    allocations = auto_allocate(
        dia=body.dia,
        turno=body.turno,
        segmentos=state.segments,
        operadores=operadores,
        competencias=competencias,
    )

    return {
        "dia": body.dia,
        "turno": body.turno,
        "total": len(allocations),
        "allocations": [asdict(a) for a in allocations],
    }


# ═══════════════════════════════════════════════════════════════════════
# FORECAST
# ═══════════════════════════════════════════════════════════════════════


@router.get("/forecast")
async def get_forecast(semanas: int = 4):
    """Forecast workforce needs for the next N weeks."""
    _require_data()
    from backend.workforce.forecast import forecast_necessidades

    store = _get_store()
    operadores = store.load_operadores()
    competencias = _get_competencias(store)

    forecast = forecast_necessidades(
        segmentos=state.segments,
        operadores=operadores,
        competencias=competencias,
        config=state.config,
        semanas=semanas,
    )

    return {
        "semanas": semanas,
        "total_registos": len(forecast),
        "forecast": forecast,
    }


# ═══════════════════════════════════════════════════════════════════════
# COMPETENCY GAP ANALYSIS
# ═══════════════════════════════════════════════════════════════════════


@router.get("/gaps")
async def get_competency_gaps():
    """Analyse competency gaps: which skills are missing or insufficient.

    Returns per-competency and per-zone summaries showing where the
    workforce is under-qualified relative to machine requirements.
    """
    store = _get_store()
    operadores = store.load_operadores()
    competencias = _get_competencias(store)

    # Collect all required competencies across machines
    required_comps: dict[str, dict] = {}  # comp -> {count, max_nivel, zones}
    for mid, cr in competencias.items():
        for comp in cr.competencias_necessarias:
            if comp not in required_comps:
                required_comps[comp] = {
                    "competencia": comp,
                    "maquinas_que_exigem": 0,
                    "nivel_minimo_max": 0,
                    "zonas": set(),
                    "operadores_qualificados_A": 0,
                    "operadores_qualificados_B": 0,
                }
            entry = required_comps[comp]
            entry["maquinas_que_exigem"] += 1
            entry["nivel_minimo_max"] = max(entry["nivel_minimo_max"], cr.nivel_minimo)
            entry["zonas"].add(cr.grupo)

    # Count qualified operators per competency per shift
    for comp, entry in required_comps.items():
        nivel_req = entry["nivel_minimo_max"]
        for op in operadores:
            if not op.disponivel:
                continue
            if comp in op.competencias and op.nivel.get(comp, 0) >= nivel_req:
                if op.turno == "A":
                    entry["operadores_qualificados_A"] += 1
                elif op.turno == "B":
                    entry["operadores_qualificados_B"] += 1

    # Build response
    gaps: list[dict] = []
    for comp, entry in sorted(required_comps.items()):
        total_qualified = entry["operadores_qualificados_A"] + entry["operadores_qualificados_B"]
        n_machines = entry["maquinas_que_exigem"]
        gaps.append({
            "competencia": comp,
            "maquinas_que_exigem": n_machines,
            "nivel_minimo_max": entry["nivel_minimo_max"],
            "zonas": sorted(entry["zonas"]),
            "operadores_qualificados_A": entry["operadores_qualificados_A"],
            "operadores_qualificados_B": entry["operadores_qualificados_B"],
            "total_qualificados": total_qualified,
            "deficit": max(0, n_machines - total_qualified),
            "cobertura_pct": (
                round(total_qualified / n_machines * 100, 1) if n_machines > 0 else 100.0
            ),
        })

    # Sort by deficit descending (worst gaps first)
    gaps.sort(key=lambda g: (-g["deficit"], -g["maquinas_que_exigem"]))

    return {
        "total_competencias": len(gaps),
        "gaps_criticos": sum(1 for g in gaps if g["deficit"] > 0),
        "gaps": gaps,
    }
