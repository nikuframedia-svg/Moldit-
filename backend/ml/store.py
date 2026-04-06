"""ML History Store — Moldit Planner.

SQLite persistence for historical projects, operations, trained models,
and prediction tracking. Extends the existing learning.db pattern.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from .data_model import (
    OperacaoHistorica,
    ProjetoHistorico,
)

_DEFAULT_DB = str(Path(__file__).resolve().parent.parent.parent / "data" / "ml_history.db")


class MLStore:
    """SQLite-backed ML history storage."""

    def __init__(self, db_path: str | None = None) -> None:
        self._path = db_path or _DEFAULT_DB
        if self._path != ":memory:":
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS projetos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id TEXT UNIQUE NOT NULL,
                molde_id TEXT NOT NULL,
                cliente TEXT DEFAULT '',
                data_inicio TEXT NOT NULL,
                data_conclusao TEXT NOT NULL,
                data_deadline TEXT NOT NULL,
                n_operacoes INTEGER DEFAULT 0,
                n_maquinas_usadas INTEGER DEFAULT 0,
                work_total_h REAL DEFAULT 0,
                n_dependencias INTEGER DEFAULT 0,
                profundidade_dag INTEGER DEFAULT 0,
                n_tipos_operacao INTEGER DEFAULT 0,
                complexidade TEXT DEFAULT 'media',
                tipo_molde TEXT DEFAULT 'injecao_plastico',
                peso_estimado_kg REAL DEFAULT 0,
                n_cavidades INTEGER DEFAULT 1,
                makespan_planeado_dias INTEGER DEFAULT 0,
                makespan_real_dias INTEGER DEFAULT 0,
                compliance INTEGER DEFAULT 1,
                score_final REAL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS operacoes_historicas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id TEXT NOT NULL,
                op_id INTEGER NOT NULL,
                tipo_operacao TEXT NOT NULL,
                molde_id TEXT NOT NULL,
                maquina_planeada TEXT DEFAULT '',
                maquina_real TEXT DEFAULT '',
                work_h_estimado REAL DEFAULT 0,
                work_h_real REAL DEFAULT 0,
                setup_h_estimado REAL DEFAULT 0,
                setup_h_real REAL DEFAULT 0,
                ratio_work REAL DEFAULT 1.0,
                ratio_setup REAL DEFAULT 1.0,
                dia_planeado INTEGER DEFAULT 0,
                dia_real INTEGER DEFAULT 0,
                inicio_planeado_h REAL DEFAULT 0,
                inicio_real_h REAL DEFAULT 0,
                atraso_h REAL DEFAULT 0,
                n_predecessores INTEGER DEFAULT 0,
                posicao_no_dag INTEGER DEFAULT 0,
                stress_maquina_no_dia REAL DEFAULT 0,
                operador TEXT DEFAULT '',
                turno TEXT DEFAULT '',
                motivo_desvio TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (projeto_id) REFERENCES projetos(projeto_id)
            );

            CREATE TABLE IF NOT EXISTS ml_models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name TEXT NOT NULL,
                version TEXT NOT NULL,
                hyperparams_json TEXT DEFAULT '{}',
                metrics_json TEXT DEFAULT '{}',
                feature_importance_json TEXT DEFAULT '{}',
                model_path TEXT DEFAULT '',
                n_samples INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS ml_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                op_id INTEGER NOT NULL,
                model_name TEXT NOT NULL,
                model_version TEXT NOT NULL,
                predicted_h REAL,
                p10 REAL,
                p90 REAL,
                confidence REAL,
                actual_h REAL,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS analogy_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                molde_id TEXT NOT NULL,
                analogo_id TEXT NOT NULL,
                util INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_ops_hist_projeto
                ON operacoes_historicas(projeto_id);
            CREATE INDEX IF NOT EXISTS idx_ops_hist_tipo
                ON operacoes_historicas(tipo_operacao);
            CREATE INDEX IF NOT EXISTS idx_ops_hist_maquina
                ON operacoes_historicas(maquina_real);
            CREATE INDEX IF NOT EXISTS idx_preds_op
                ON ml_predictions(op_id);
            CREATE INDEX IF NOT EXISTS idx_models_name
                ON ml_models(model_name);
        """)
        self._conn.commit()

    # ── Projects ─────────────────────────────────────────────────────

    def save_projeto(self, proj: ProjetoHistorico) -> int:
        """Save a completed project. Returns row id."""
        cur = self._conn.execute(
            """INSERT OR REPLACE INTO projetos
               (projeto_id, molde_id, cliente, data_inicio, data_conclusao,
                data_deadline, n_operacoes, n_maquinas_usadas, work_total_h,
                n_dependencias, profundidade_dag, n_tipos_operacao,
                complexidade, tipo_molde, peso_estimado_kg, n_cavidades,
                makespan_planeado_dias, makespan_real_dias, compliance, score_final)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                proj.projeto_id, proj.molde_id, proj.cliente,
                str(proj.data_inicio), str(proj.data_conclusao), str(proj.data_deadline),
                proj.n_operacoes, proj.n_maquinas_usadas, proj.work_total_h,
                proj.n_dependencias, proj.profundidade_dag, proj.n_tipos_operacao,
                proj.complexidade, proj.tipo_molde, proj.peso_estimado_kg, proj.n_cavidades,
                proj.makespan_planeado_dias, proj.makespan_real_dias,
                int(proj.compliance), proj.score_final,
            ),
        )
        # Save operations
        for op in proj.operacoes:
            self._save_operacao(op)
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def _save_operacao(self, op: OperacaoHistorica) -> None:
        self._conn.execute(
            """INSERT INTO operacoes_historicas
               (projeto_id, op_id, tipo_operacao, molde_id,
                maquina_planeada, maquina_real,
                work_h_estimado, work_h_real, setup_h_estimado, setup_h_real,
                ratio_work, ratio_setup,
                dia_planeado, dia_real, inicio_planeado_h, inicio_real_h, atraso_h,
                n_predecessores, posicao_no_dag, stress_maquina_no_dia,
                operador, turno, motivo_desvio)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                op.projeto_id, op.op_id, op.tipo_operacao, op.molde_id,
                op.maquina_planeada, op.maquina_real,
                op.work_h_estimado, op.work_h_real, op.setup_h_estimado, op.setup_h_real,
                op.ratio_work, op.ratio_setup,
                op.dia_planeado, op.dia_real, op.inicio_planeado_h, op.inicio_real_h,
                op.atraso_h,
                op.n_predecessores, op.posicao_no_dag, op.stress_maquina_no_dia,
                op.operador, op.turno, op.motivo_desvio,
            ),
        )

    def get_projetos(self, limit: int = 200) -> list[dict]:
        """Load project summaries (without operations)."""
        rows = self._conn.execute(
            "SELECT * FROM projetos ORDER BY data_conclusao DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_projeto(self, projeto_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM projetos WHERE projeto_id = ?", (projeto_id,),
        ).fetchone()
        return dict(row) if row else None

    def count_projetos(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM projetos").fetchone()
        return row[0] if row else 0

    # ── Historical operations ────────────────────────────────────────

    def get_operacoes_projeto(self, projeto_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM operacoes_historicas WHERE projeto_id = ? ORDER BY op_id",
            (projeto_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_all_operacoes(self, limit: int = 10000) -> list[dict]:
        """All historical operations for ML training."""
        rows = self._conn.execute(
            "SELECT * FROM operacoes_historicas ORDER BY created_at LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_operacoes_by_tipo(self, tipo: str, limit: int = 1000) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM operacoes_historicas WHERE tipo_operacao = ? LIMIT ?",
            (tipo, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_operacoes_by_maquina(self, maquina_id: str, limit: int = 1000) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM operacoes_historicas WHERE maquina_real = ? LIMIT ?",
            (maquina_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def count_operacoes(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM operacoes_historicas").fetchone()
        return row[0] if row else 0

    # ── ML Models ────────────────────────────────────────────────────

    def save_model_info(
        self,
        model_name: str,
        version: str,
        hyperparams: dict,
        metrics: dict,
        feature_importance: dict,
        model_path: str,
        n_samples: int,
    ) -> int:
        cur = self._conn.execute(
            """INSERT INTO ml_models
               (model_name, version, hyperparams_json, metrics_json,
                feature_importance_json, model_path, n_samples)
               VALUES (?,?,?,?,?,?,?)""",
            (
                model_name, version,
                json.dumps(hyperparams), json.dumps(metrics),
                json.dumps(feature_importance), model_path, n_samples,
            ),
        )
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def get_latest_model(self, model_name: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM ml_models WHERE model_name = ? ORDER BY created_at DESC LIMIT 1",
            (model_name,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["hyperparams"] = json.loads(d.pop("hyperparams_json", "{}"))
        d["metrics"] = json.loads(d.pop("metrics_json", "{}"))
        d["feature_importance"] = json.loads(d.pop("feature_importance_json", "{}"))
        return d

    def get_model_history(self, model_name: str, limit: int = 50) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM ml_models WHERE model_name = ? ORDER BY created_at DESC LIMIT ?",
            (model_name, limit),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["metrics"] = json.loads(d.pop("metrics_json", "{}"))
            result.append(d)
        return result

    # ── Predictions ──────────────────────────────────────────────────

    def save_prediction(
        self,
        op_id: int,
        model_name: str,
        model_version: str,
        predicted_h: float,
        p10: float,
        p90: float,
        confidence: float,
    ) -> int:
        cur = self._conn.execute(
            """INSERT INTO ml_predictions
               (op_id, model_name, model_version, predicted_h, p10, p90, confidence)
               VALUES (?,?,?,?,?,?,?)""",
            (op_id, model_name, model_version, predicted_h, p10, p90, confidence),
        )
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def update_prediction_actual(self, op_id: int, actual_h: float) -> None:
        """Fill in actual_h once operation completes (for monitoring)."""
        self._conn.execute(
            "UPDATE ml_predictions SET actual_h = ? WHERE op_id = ? AND actual_h IS NULL",
            (actual_h, op_id),
        )
        self._conn.commit()

    def get_predictions_with_actuals(self, limit: int = 500) -> list[dict]:
        """Predictions where actual_h is known — for evaluating model quality."""
        rows = self._conn.execute(
            """SELECT * FROM ml_predictions
               WHERE actual_h IS NOT NULL
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Analogy feedback ─────────────────────────────────────────────

    def save_analogy_feedback(self, molde_id: str, analogo_id: str, util: bool) -> None:
        self._conn.execute(
            "INSERT INTO analogy_feedback (molde_id, analogo_id, util) VALUES (?,?,?)",
            (molde_id, analogo_id, int(util)),
        )
        self._conn.commit()

    def get_analogy_feedback(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM analogy_feedback ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Aggregate queries ────────────────────────────────────────────

    def get_tipos_operacao(self) -> list[str]:
        """Distinct operation types in history."""
        rows = self._conn.execute(
            "SELECT DISTINCT tipo_operacao FROM operacoes_historicas ORDER BY tipo_operacao"
        ).fetchall()
        return [r[0] for r in rows]

    def get_maquinas_usadas(self) -> list[str]:
        """Distinct machines in history."""
        rows = self._conn.execute(
            "SELECT DISTINCT maquina_real FROM operacoes_historicas ORDER BY maquina_real"
        ).fetchall()
        return [r[0] for r in rows]

    def get_stats(self) -> dict:
        """Quick stats for status endpoint."""
        return {
            "n_projetos": self.count_projetos(),
            "n_operacoes": self.count_operacoes(),
            "tipos_operacao": len(self.get_tipos_operacao()),
            "maquinas": len(self.get_maquinas_usadas()),
        }

    # ── Lifecycle ────────────────────────────────────────────────────

    def close(self) -> None:
        self._conn.close()
