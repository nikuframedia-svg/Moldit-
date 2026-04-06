"""Execution tracking store — Moldit Planner.

SQLite persistence for actual vs planned execution data.
Feeds calibration engine and Monte Carlo risk with real factory data.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

_DEFAULT_DB = str(Path(__file__).resolve().parent.parent.parent / "data" / "execution.db")


class ExecutionStore:
    """SQLite store for execution logs and machine events."""

    def __init__(self, db_path: str | None = None) -> None:
        self._path = db_path or _DEFAULT_DB
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        cur = self._conn.cursor()
        cur.executescript("""
            CREATE TABLE IF NOT EXISTS execution_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                op_id INTEGER NOT NULL,
                molde TEXT NOT NULL,
                maquina_id TEXT NOT NULL,
                codigo TEXT NOT NULL,
                work_h_planeado REAL NOT NULL,
                work_h_real REAL,
                setup_h_planeado REAL,
                setup_h_real REAL,
                dia_planeado INTEGER,
                dia_real INTEGER,
                motivo_desvio TEXT DEFAULT '',
                reportado_por TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS machine_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                maquina_id TEXT NOT NULL,
                tipo TEXT NOT NULL,
                inicio TEXT NOT NULL,
                fim TEXT,
                duracao_h REAL,
                planeado INTEGER DEFAULT 0,
                notas TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_exec_codigo
                ON execution_log(codigo);
            CREATE INDEX IF NOT EXISTS idx_exec_maquina
                ON execution_log(maquina_id);
            CREATE INDEX IF NOT EXISTS idx_events_maquina
                ON machine_events(maquina_id);
        """)
        self._conn.commit()

    # ── Execution log ────────────────────────────────────────────────

    def log_completion(
        self,
        op_id: int,
        molde: str,
        maquina_id: str,
        codigo: str,
        work_h_planeado: float,
        work_h_real: float,
        setup_h_planeado: float = 0.0,
        setup_h_real: float = 0.0,
        dia_planeado: int = 0,
        dia_real: int = 0,
        motivo_desvio: str = "",
        reportado_por: str = "",
    ) -> int:
        """Record an operation completion. Returns row id."""
        cur = self._conn.execute(
            """INSERT INTO execution_log
               (op_id, molde, maquina_id, codigo,
                work_h_planeado, work_h_real,
                setup_h_planeado, setup_h_real,
                dia_planeado, dia_real,
                motivo_desvio, reportado_por)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (op_id, molde, maquina_id, codigo,
             work_h_planeado, work_h_real,
             setup_h_planeado, setup_h_real,
             dia_planeado, dia_real,
             motivo_desvio, reportado_por),
        )
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def get_logs_by_codigo(self, codigo: str, limit: int = 200) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM execution_log WHERE codigo = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (codigo, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_logs_by_maquina(self, maquina_id: str, limit: int = 200) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM execution_log WHERE maquina_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (maquina_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_all_logs(self, limit: int = 500) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM execution_log ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Machine events ───────────────────────────────────────────────

    def log_machine_event(
        self,
        maquina_id: str,
        tipo: str,
        inicio: str,
        fim: str | None = None,
        duracao_h: float = 0.0,
        planeado: bool = False,
        notas: str = "",
    ) -> int:
        """Record a machine event (downtime, maintenance, etc). Returns row id."""
        cur = self._conn.execute(
            """INSERT INTO machine_events
               (maquina_id, tipo, inicio, fim, duracao_h, planeado, notas)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (maquina_id, tipo, inicio, fim, duracao_h, int(planeado), notas),
        )
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def get_machine_events(
        self, maquina_id: str, limit: int = 100,
    ) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM machine_events WHERE maquina_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (maquina_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_all_events(self, limit: int = 200) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM machine_events ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Lifecycle ────────────────────────────────────────────────────

    def close(self) -> None:
        self._conn.close()
