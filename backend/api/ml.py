"""ML API Endpoints — Moldit Planner.

/api/ml/* — Machine Learning status, predictions, analogies, ranking,
anomalies, training, bootstrap, and configuration.
"""
from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.ml.cold_start import ColdStartManager
from backend.ml.store import MLStore
from backend.ml.training.monitor import ModelMonitor
from backend.ml.training.trainer import MLTrainer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ml", tags=["ml"])

# ── Singleton state ──────────────────────────────────────────────────

_store: MLStore | None = None
_trainer: MLTrainer | None = None
_cold_start = ColdStartManager()


def _get_store() -> MLStore:
    global _store
    if _store is None:
        _store = MLStore()
    return _store


def _get_trainer() -> MLTrainer:
    global _trainer
    store = _get_store()
    if _trainer is None:
        _trainer = MLTrainer(store)
        # Try to load persisted models
        loaded = _trainer.load_models()
        if loaded:
            logger.info("Loaded ML models from disk: %s", loaded)
        # If data exists but models aren't trained, train now
        n_ops = store.count_operacoes()
        if n_ops >= 10 and not _trainer.m1.is_trained:
            logger.info("Training ML models on startup (%d ops available)", n_ops)
            _trainer.train_all()
    return _trainer


# ── Status & Metrics ─────────────────────────────────────────────────

@router.get("/status")
async def get_ml_status() -> dict:
    """Overall ML system status: phase, models, metrics."""
    store = _get_store()
    trainer = _get_trainer()
    n_proj = store.count_projetos()

    phase_info = _cold_start.get_phase_info(n_proj)

    models = []
    for name, model, health_fn in [
        ("M1_duration", trainer.m1, lambda m: "saudavel" if m.is_trained else "inativo"),
        ("M2_risk", trainer.m2, lambda m: "saudavel" if m.is_trained else "inativo"),
        ("M3_analogy", trainer.m3, lambda m: "saudavel" if m.is_trained else "inativo"),
        ("M4_machine", trainer.m4, lambda m: "saudavel" if m.is_trained else "inativo"),
        ("M5_anomaly", trainer.m5, lambda m: "saudavel" if m.is_trained else "inativo"),
    ]:
        latest = store.get_latest_model(name)
        models.append({
            "name": name,
            "version": getattr(model, "version", "0"),
            "health": health_fn(model),
            "last_train": latest["created_at"] if latest else "",
            "metrics": latest.get("metrics", {}) if latest else {},
            "n_samples": getattr(model, "n_samples", 0),
        })

    return {
        **phase_info,
        "models": models,
        "last_retrain": models[0]["last_train"] if models else "",
    }


@router.get("/evolution")
async def get_ml_evolution() -> list[dict]:
    """Model evolution over time (MAE, coverage per month)."""
    store = _get_store()
    monitor = ModelMonitor(store)
    points = monitor.get_evolution()
    return [asdict(p) for p in points]


# ── Predictions ──────────────────────────────────────────────────────

@router.get("/predict/duration/{op_id}")
async def predict_duration(op_id: int) -> dict:
    """M1: Predict actual duration for one operation."""
    trainer = _get_trainer()

    if not trainer.m1.is_trained:
        raise HTTPException(404, "M1 not trained yet. Need more historical data.")

    # Get operation from current schedule (via copilot state)
    from backend.copilot.state import state
    if not state.engine_data:
        raise HTTPException(400, "No schedule loaded.")

    op = None
    for o in state.engine_data.operacoes:
        if o.id == op_id:
            op = o
            break
    if not op:
        raise HTTPException(404, f"Operation {op_id} not found.")

    op_dict = {
        "op_id": op.id, "codigo": op.codigo, "work_h_estimado": op.work_h,
        "setup_h_estimado": getattr(op, "setup_h", 1.0),
        "maquina_id": op.recurso or "",
    }

    # Get SHAP explanations
    from backend.ml.explainability.shap_explainer import ShapExplainer
    pred = trainer.m1.predict(op_dict)
    explainer = ShapExplainer()
    if trainer.m1.model_median:
        explainer.initialize(trainer.m1.model_median)
        pred.explicacao = explainer.explain_duration(trainer.m1.model_median, op_dict)

    return asdict(pred)


@router.get("/predict/risk/{molde_id}")
async def predict_risk(molde_id: str) -> dict:
    """M2: Predict delay risk for a mold."""
    trainer = _get_trainer()

    if not trainer.m2.is_trained:
        raise HTTPException(404, "M2 not trained yet.")

    from backend.copilot.state import state
    if not state.engine_data:
        raise HTTPException(400, "No schedule loaded.")

    # Build project dict from current engine data
    molde = None
    for m in state.engine_data.moldes:
        if m.id == molde_id:
            molde = m
            break
    if not molde:
        raise HTTPException(404, f"Mold {molde_id} not found.")

    ops = [o for o in state.engine_data.operacoes if o.molde == molde_id]
    projeto = {
        "molde_id": molde_id,
        "n_operacoes": len(ops),
        "work_total_h": sum(o.work_h for o in ops),
        "profundidade_dag": 0,
        "n_dependencias": 0,
        "n_maquinas_usadas": len(set(o.recurso for o in ops if o.recurso)),
        "n_tipos_operacao": len(set(o.codigo for o in ops)),
        "complexidade": "media",
        "n_cavidades": 1,
        "peso_estimado_kg": 0,
        "folga_deadline_dias": 0,
    }

    pred = trainer.m2.predict(projeto)
    return asdict(pred)


@router.get("/predict/bulk")
async def predict_bulk() -> list[dict]:
    """M1: Predict duration for all operations in current schedule."""
    trainer = _get_trainer()

    if not trainer.m1.is_trained:
        return []

    from backend.copilot.state import state
    if not state.engine_data:
        raise HTTPException(400, "No schedule loaded.")

    results = []
    for op in state.engine_data.operacoes:
        op_dict = {
            "op_id": op.id, "codigo": op.codigo, "work_h_estimado": op.work_h,
            "setup_h_estimado": 1.0, "maquina_id": op.recurso or "",
        }
        pred = trainer.m1.predict(op_dict)
        results.append(asdict(pred))

    return results


# ── Analogies ────────────────────────────────────────────────────────

@router.get("/analogues/{molde_id}")
async def get_analogues(molde_id: str) -> list[dict]:
    """M3: Find similar past projects."""
    trainer = _get_trainer()

    if not trainer.m3.is_trained:
        return []

    from backend.copilot.state import state
    if not state.engine_data:
        raise HTTPException(400, "No schedule loaded.")

    molde = None
    for m in state.engine_data.moldes:
        if m.id == molde_id:
            molde = m
            break
    if not molde:
        raise HTTPException(404, f"Mold {molde_id} not found.")

    ops = [o for o in state.engine_data.operacoes if o.molde == molde_id]
    projeto = {
        "n_operacoes": len(ops),
        "work_total_h": sum(o.work_h for o in ops),
        "profundidade_dag": 0,
        "n_dependencias": 0,
        "n_tipos_operacao": len(set(o.codigo for o in ops)),
        "complexidade": "media",
        "n_cavidades": 1,
        "peso_estimado_kg": 0,
    }
    ops_dicts = [{"codigo": o.codigo} for o in ops]

    analogos = trainer.m3.encontrar_analogos(projeto, ops_dicts)
    return [asdict(a) for a in analogos]


class FeedbackBody(BaseModel):
    molde_id: str
    analogo_id: str
    util: bool


@router.post("/feedback/analogy")
async def feedback_analogy(body: FeedbackBody) -> dict:
    """Record user feedback on analogy quality."""
    trainer = _get_trainer()
    store = _get_store()

    trainer.m3.feedback(body.molde_id, body.analogo_id, body.util)
    store.save_analogy_feedback(body.molde_id, body.analogo_id, body.util)

    return {"status": "ok"}


# ── Ranking ──────────────────────────────────────────────────────────

@router.get("/ranking/{tipo_operacao}")
async def get_machine_ranking(tipo_operacao: str) -> list[dict]:
    """M4: Rank machines for an operation type."""
    trainer = _get_trainer()

    if not trainer.m4.is_trained:
        return []

    ranked = trainer.m4.ranking(tipo_operacao)
    return [asdict(s) for s in ranked]


@router.get("/ranking/matrix")
async def get_ranking_matrix() -> dict:
    """M4: Full ranking matrix (all types × all machines)."""
    trainer = _get_trainer()

    if not trainer.m4.is_trained:
        return {"tipos": [], "maquinas": [], "data": {}}

    matrix = trainer.m4.get_matrix()
    tipos = sorted(matrix.keys())
    all_maquinas = set()
    data = {}
    for tipo, scores in matrix.items():
        data[tipo] = [asdict(s) for s in scores]
        for s in scores:
            all_maquinas.add(s.maquina)

    return {
        "tipos": tipos,
        "maquinas": sorted(all_maquinas),
        "data": data,
    }


# ── Anomalies ────────────────────────────────────────────────────────

@router.get("/anomalies")
async def get_anomalies() -> list[dict]:
    """M5: Check all in-progress operations for anomalies."""
    trainer = _get_trainer()

    if not trainer.m5.is_trained:
        return []

    from backend.copilot.state import state
    if not state.engine_data:
        return []

    anomalies = []
    for op in state.engine_data.operacoes:
        if 0 < op.progresso < 100:
            op_dict = {
                "op_id": op.id, "codigo": op.codigo,
                "work_h_estimado": op.work_h, "maquina_id": op.recurso or "",
            }
            result = trainer.m5.check(op_dict, progresso_pct=op.progresso)
            if result:
                anomalies.append(asdict(result))

    # Also check machine patterns
    maquinas_in_use = set(op.recurso for op in state.engine_data.operacoes if op.recurso)
    for maq in maquinas_in_use:
        patterns = trainer.m5.check_machine_pattern(maq)
        for p in patterns:
            anomalies.append(asdict(p))

    return anomalies


# ── Training & Bootstrap ────────────────────────────────────────────

@router.post("/train")
async def train_models() -> dict:
    """Force full retrain of all models."""
    trainer = _get_trainer()
    report = trainer.train_all()
    return asdict(report)


class BootstrapBody(BaseModel):
    projetos: list[dict]


@router.post("/bootstrap")
async def bootstrap_data(body: BootstrapBody) -> dict:
    """Batch import historical projects."""
    store = _get_store()
    from backend.ml.bootstrap import Bootstrapper
    bootstrapper = Bootstrapper(store)
    result = bootstrapper.batch_ingest(body.projetos)
    return result



class IngestBody(BaseModel):
    molde_id: str
    cliente: str = ""
    data_inicio: str
    data_conclusao: str
    data_deadline: str
    n_operacoes: int = 0
    work_total_h: float = 0
    makespan_planeado_dias: int = 0
    makespan_real_dias: int = 0
    operacoes: list[dict] | None = None


@router.post("/ingest")
async def ingest_project(body: IngestBody) -> dict:
    """Ingest a single completed project."""
    store = _get_store()
    from datetime import date as dt_date

    from backend.ml.bootstrap import Bootstrapper

    bootstrapper = Bootstrapper(store)
    projeto_id = bootstrapper.ingest_completed_project(
        molde_id=body.molde_id,
        cliente=body.cliente,
        data_inicio=dt_date.fromisoformat(body.data_inicio),
        data_conclusao=dt_date.fromisoformat(body.data_conclusao),
        data_deadline=dt_date.fromisoformat(body.data_deadline),
        n_operacoes=body.n_operacoes,
        work_total_h=body.work_total_h,
        makespan_planeado_dias=body.makespan_planeado_dias,
        makespan_real_dias=body.makespan_real_dias,
        operacoes=body.operacoes,
    )
    return {"status": "ok", "projeto_id": projeto_id}


# ── Config ───────────────────────────────────────────────────────────

class MLConfigBody(BaseModel):
    usar_previsoes_ml: bool | None = None
    min_confianca: float | None = None


@router.put("/config")
async def update_ml_config(body: MLConfigBody) -> dict:
    """Update ML configuration."""
    # Store in copilot state for now
    from backend.copilot.state import state
    if body.usar_previsoes_ml is not None:
        if not hasattr(state, "ml_config"):
            state.ml_config = {}  # type: ignore[attr-defined]
        state.ml_config["usar_previsoes_ml"] = body.usar_previsoes_ml  # type: ignore[attr-defined]
    if body.min_confianca is not None:
        if not hasattr(state, "ml_config"):
            state.ml_config = {}  # type: ignore[attr-defined]
        state.ml_config["min_confianca"] = body.min_confianca  # type: ignore[attr-defined]

    return {"status": "ok"}
