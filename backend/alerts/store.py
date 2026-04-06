"""Alert Store — SQLite persistence for alerts.

Stores alerts in data/alerts.db with full lifecycle support
(ativo -> reconhecido -> resolvido | ignorado).
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime

from backend.alerts.types import Alert, AlertSuggestion

DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "alerts.db"
)


class AlertStore:
    """SQLite-backed alert storage."""

    def __init__(self, db_path: str | None = None) -> None:
        self._path = db_path or DEFAULT_DB_PATH
        if self._path != ":memory:":
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                regra TEXT NOT NULL,
                severidade TEXT NOT NULL,
                titulo TEXT NOT NULL,
                mensagem TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                moldes_json TEXT NOT NULL DEFAULT '[]',
                maquinas_json TEXT NOT NULL DEFAULT '[]',
                operacoes_json TEXT NOT NULL DEFAULT '[]',
                impacto_dias REAL NOT NULL DEFAULT 0.0,
                sugestoes_json TEXT NOT NULL DEFAULT '[]',
                estado TEXT NOT NULL DEFAULT 'ativo',
                resolved_at TEXT,
                resolved_note TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_alerts_estado
                ON alerts(estado);
            CREATE INDEX IF NOT EXISTS idx_alerts_severidade
                ON alerts(severidade);
            CREATE INDEX IF NOT EXISTS idx_alerts_regra
                ON alerts(regra);
        """)
        self._conn.commit()

    # ── Serialisation helpers ─────────────────────────────────────────

    def _alert_from_row(self, row: sqlite3.Row) -> Alert:
        """Reconstruct an Alert from a DB row."""
        sugestoes_raw = json.loads(row["sugestoes_json"])
        sugestoes = [
            AlertSuggestion(
                acao=s["acao"],
                impacto=s["impacto"],
                esforco=s["esforco"],
                mutation_type=s.get("mutation_type"),
                mutation_params=s.get("mutation_params", {}),
            )
            for s in sugestoes_raw
        ]
        return Alert(
            id=row["id"],
            regra=row["regra"],
            severidade=row["severidade"],
            titulo=row["titulo"],
            mensagem=row["mensagem"],
            timestamp=row["timestamp"],
            moldes_afetados=json.loads(row["moldes_json"]),
            maquinas_afetadas=json.loads(row["maquinas_json"]),
            operacoes=json.loads(row["operacoes_json"]),
            impacto_dias=row["impacto_dias"],
            sugestoes=sugestoes,
            estado=row["estado"],
        )

    @staticmethod
    def _sugestoes_to_json(sugestoes: list[AlertSuggestion]) -> str:
        return json.dumps(
            [
                {
                    "acao": s.acao,
                    "impacto": s.impacto,
                    "esforco": s.esforco,
                    "mutation_type": s.mutation_type,
                    "mutation_params": s.mutation_params,
                }
                for s in sugestoes
            ],
            ensure_ascii=False,
        )

    # ── CRUD ──────────────────────────────────────────────────────────

    def save(self, alert: Alert) -> None:
        """Insert or replace an alert."""
        self._conn.execute(
            """INSERT OR REPLACE INTO alerts
               (id, regra, severidade, titulo, mensagem, timestamp,
                moldes_json, maquinas_json, operacoes_json,
                impacto_dias, sugestoes_json, estado)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                alert.id,
                alert.regra,
                alert.severidade,
                alert.titulo,
                alert.mensagem,
                alert.timestamp,
                json.dumps(alert.moldes_afetados, ensure_ascii=False),
                json.dumps(alert.maquinas_afetadas, ensure_ascii=False),
                json.dumps(alert.operacoes),
                alert.impacto_dias,
                self._sugestoes_to_json(alert.sugestoes),
                alert.estado,
            ),
        )
        self._conn.commit()

    def get(self, alert_id: str) -> Alert | None:
        """Retrieve a single alert by ID."""
        row = self._conn.execute(
            "SELECT * FROM alerts WHERE id = ?", (alert_id,)
        ).fetchone()
        if row is None:
            return None
        return self._alert_from_row(row)

    def list_active(
        self,
        severidade: str | None = None,
        estado: str | None = None,
    ) -> list[Alert]:
        """List alerts, optionally filtered by severidade and/or estado.

        If neither filter is given, returns all non-ignored alerts.
        """
        clauses: list[str] = []
        params: list[str] = []

        if estado:
            clauses.append("estado = ?")
            params.append(estado)
        else:
            clauses.append("estado NOT IN ('ignorado', 'resolvido')")

        if severidade:
            clauses.append("severidade = ?")
            params.append(severidade)

        where = " AND ".join(clauses) if clauses else "1=1"
        rows = self._conn.execute(
            f"SELECT * FROM alerts WHERE {where} ORDER BY timestamp DESC",  # noqa: S608
            params,
        ).fetchall()
        return [self._alert_from_row(r) for r in rows]

    def acknowledge(self, alert_id: str) -> bool:
        """Mark an alert as acknowledged. Returns True if found."""
        cur = self._conn.execute(
            "UPDATE alerts SET estado = 'reconhecido' WHERE id = ? AND estado = 'ativo'",
            (alert_id,),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def resolve(self, alert_id: str, note: str = "") -> bool:
        """Mark an alert as resolved with an optional note. Returns True if found."""
        now = datetime.now().isoformat()
        cur = self._conn.execute(
            """UPDATE alerts
               SET estado = 'resolvido', resolved_at = ?, resolved_note = ?
               WHERE id = ? AND estado IN ('ativo', 'reconhecido')""",
            (now, note, alert_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def ignore(self, alert_id: str) -> bool:
        """Suppress an alert. Returns True if found."""
        cur = self._conn.execute(
            "UPDATE alerts SET estado = 'ignorado' WHERE id = ? AND estado IN ('ativo', 'reconhecido')",
            (alert_id,),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def stats(self) -> dict[str, dict[str, int]]:
        """Return counts grouped by severidade and estado.

        Returns::

            {
                "por_severidade": {"critico": 2, "aviso": 5, "info": 1},
                "por_estado": {"ativo": 4, "reconhecido": 2, ...},
                "total": 8
            }
        """
        rows_sev = self._conn.execute(
            "SELECT severidade, COUNT(*) FROM alerts GROUP BY severidade"
        ).fetchall()
        rows_est = self._conn.execute(
            "SELECT estado, COUNT(*) FROM alerts GROUP BY estado"
        ).fetchall()
        total_row = self._conn.execute(
            "SELECT COUNT(*) FROM alerts"
        ).fetchone()

        return {
            "por_severidade": {r[0]: r[1] for r in rows_sev},
            "por_estado": {r[0]: r[1] for r in rows_est},
            "total": total_row[0] if total_row else 0,
        }

    def close(self) -> None:
        """Close the underlying database connection."""
        self._conn.close()
