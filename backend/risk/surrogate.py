"""Tier 2 — Surrogate Risk Model: Spec 06 S3.

Feature extraction + lightweight prediction from pre-trained model.
No scipy/numpy dependency (uses statistics stdlib).
Uses Moldit types (no Incompol references).
"""

from __future__ import annotations

import json
import logging
import statistics
from pathlib import Path

from backend.types import MolditEngineData as EngineData

from .types import MachineRisk, OpRisk

logger = logging.getLogger(__name__)

_SURROGATE_PATH = Path("data/risk_surrogate.json")


def extract_features(
    op_risks: list[OpRisk],
    machine_risks: list[MachineRisk],
    engine_data: EngineData,
) -> list[float]:
    """Extract 10 features for surrogate model.

    Features:
      0. min_slack_days      -- minimum slack across all lots
      1. slack_std            -- std dev of slack days
      2. critical_pct         -- fraction of lots that are critical
      3. high_pct             -- fraction of lots that are high risk
      4. max_utilization      -- peak machine utilization
      5. util_std             -- std dev of avg utilizations
      6. n_machines           -- number of machines
      7. n_ops               -- number of lots
      8. avg_work_h           -- average work_h across ops
      9. dependency_density   -- fraction of ops with dependencies
    """
    n_ops = len(op_risks) or 1
    n_machines = len(machine_risks) or 1

    slacks = [lr.slack_days for lr in op_risks] or [0]
    min_slack = min(slacks)
    slack_sd = statistics.stdev(slacks) if len(slacks) > 1 else 0.0

    critical_pct = sum(1 for lr in op_risks if lr.risk_level == "critical") / n_ops
    high_pct = sum(1 for lr in op_risks if lr.risk_level == "high") / n_ops

    max_util = max((mr.peak_utilization for mr in machine_risks), default=0.0)
    utils = [mr.avg_utilization for mr in machine_risks] or [0.0]
    util_sd = statistics.stdev(utils) if len(utils) > 1 else 0.0

    # Average work_h across ops
    work_hours = [op.work_h for op in engine_data.operacoes] or [0.0]
    avg_work_h = sum(work_hours) / len(work_hours)

    # Dependency density
    ops_with_deps = set()
    for dep in engine_data.dependencias:
        ops_with_deps.add(dep.predecessor_id)
        ops_with_deps.add(dep.sucessor_id)
    dep_density = len(ops_with_deps) / max(len(engine_data.operacoes), 1)

    return [
        float(min_slack),
        round(slack_sd, 3),
        round(critical_pct, 4),
        round(high_pct, 4),
        round(max_util, 3),
        round(util_sd, 3),
        float(n_machines),
        float(n_ops),
        round(avg_work_h, 3),
        round(dep_density, 4),
    ]


def predict_risk(features: list[float]) -> tuple[float, str] | None:
    """Predict OTD probability from features using saved surrogate.

    Returns (otd_probability, confidence_level) or None if no model.
    confidence_level: "low" | "medium" | "high"
    """
    if not _SURROGATE_PATH.exists():
        return None

    try:
        model = json.loads(_SURROGATE_PATH.read_text())
        weights = model["weights"]
        bias = model["bias"]
        thresholds = model.get("thresholds", [0.3, 0.7])
    except (json.JSONDecodeError, KeyError) as exc:
        logger.warning("Surrogate model invalid: %s", exc)
        return None

    if len(weights) != len(features):
        logger.warning(
            "Feature mismatch: model expects %d, got %d",
            len(weights), len(features),
        )
        return None

    # Linear model: sigmoid(w.x + b)
    z = sum(w * x for w, x in zip(weights, features)) + bias
    prob = 1.0 / (1.0 + _safe_exp(-z))

    if prob > thresholds[1]:
        confidence = "high"
    elif prob > thresholds[0]:
        confidence = "medium"
    else:
        confidence = "low"

    return (round(prob, 3), confidence)


def train_surrogate(
    training_data: list[tuple[list[float], float]],
    path: Path | None = None,
) -> None:
    """Train surrogate model from (features, otd_result) pairs.

    Uses simple logistic regression via gradient descent.
    Requires numpy (optional dependency).
    """
    try:
        import numpy as np
    except ImportError as exc:
        raise ImportError(
            "Training requires numpy: pip install numpy"
        ) from exc

    save_path = path or _SURROGATE_PATH
    save_path.parent.mkdir(parents=True, exist_ok=True)

    X = np.array([f for f, _ in training_data])
    y = np.array([t for _, t in training_data])

    # Normalise features
    mu = X.mean(axis=0)
    sigma = X.std(axis=0) + 1e-8
    X_norm = (X - mu) / sigma

    # Logistic regression via gradient descent
    n_features = X_norm.shape[1]
    w = np.zeros(n_features)
    b = 0.0
    lr = 0.01

    for _ in range(1000):
        z = X_norm @ w + b
        pred = 1.0 / (1.0 + np.exp(-np.clip(z, -500, 500)))
        error = pred - y
        w -= lr * (X_norm.T @ error) / len(y)
        b -= lr * error.mean()

    # Convert back to original scale
    w_orig = w / sigma
    b_orig = float(b - (w * mu / sigma).sum())

    model = {
        "weights": w_orig.tolist(),
        "bias": b_orig,
        "thresholds": [0.3, 0.7],
        "n_features": n_features,
        "n_samples": len(training_data),
    }

    save_path.write_text(json.dumps(model, indent=2))
    logger.info("Surrogate trained with %d samples -> %s", len(training_data), save_path)


def _safe_exp(x: float) -> float:
    """Exp with overflow protection."""
    if x > 500:
        return float("inf")
    if x < -500:
        return 0.0
    import math
    return math.exp(x)
