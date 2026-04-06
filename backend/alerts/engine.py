"""Alert Engine — Moldit Planner.

Evaluates all rules, deduplicates, prioritises, and persists alerts.
"""

from __future__ import annotations

import logging

from backend.alerts.rules import (
    r1_deadline_em_risco,
    r2_cascata_perigosa,
    r3_maquina_sobrecarregada,
    r7_slot_livre,
    r8_setup_evitavel,
    r9_caminho_critico_alterou,
)
from backend.alerts.store import AlertStore
from backend.alerts.types import Alert
from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)

# Severity ordering for prioritisation (lower = more severe)
_SEVERITY_ORDER = {"critico": 0, "aviso": 1, "info": 2}


class AlertEngine:
    """Evaluate alert rules, deduplicate, persist."""

    def __init__(self, db_path: str | None = None) -> None:
        self.store = AlertStore(db_path)

    def evaluate(
        self,
        segmentos: list[SegmentoMoldit],
        data: MolditEngineData,
        config: FactoryConfig | None = None,
        caminho_critico_anterior: list[int] | None = None,
    ) -> list[Alert]:
        """Run all applicable rules and return deduplicated, prioritised alerts.

        The alerts are also persisted to the store.
        """
        raw_alerts: list[Alert] = []

        # ── R1: Deadline em risco ─────────────────────────────────────
        try:
            raw_alerts.extend(
                r1_deadline_em_risco(segmentos, data.moldes, config)
            )
        except Exception:
            logger.exception("R1 failed")

        # ── R2: Cascata perigosa ──────────────────────────────────────
        try:
            raw_alerts.extend(
                r2_cascata_perigosa(
                    segmentos, data.dag, data.dag_reverso, data.moldes, config
                )
            )
        except Exception:
            logger.exception("R2 failed")

        # ── R3: Maquina sobrecarregada ────────────────────────────────
        try:
            raw_alerts.extend(
                r3_maquina_sobrecarregada(segmentos, data.maquinas, config)
            )
        except Exception:
            logger.exception("R3 failed")

        # ── R7: Slot livre ────────────────────────────────────────────
        try:
            raw_alerts.extend(
                r7_slot_livre(segmentos, data.maquinas, config)
            )
        except Exception:
            logger.exception("R7 failed")

        # ── R8: Setup evitavel ────────────────────────────────────────
        try:
            raw_alerts.extend(
                r8_setup_evitavel(segmentos, config)
            )
        except Exception:
            logger.exception("R8 failed")

        # ── R9: Caminho critico alterou ───────────────────────────────
        try:
            raw_alerts.extend(
                r9_caminho_critico_alterou(
                    caminho_critico_anterior or [],
                    data.caminho_critico,
                )
            )
        except Exception:
            logger.exception("R9 failed")

        # ── Deduplicate ──────────────────────────────────────────────
        deduped = self._deduplicate(raw_alerts)

        # ── Prioritise ───────────────────────────────────────────────
        deduped.sort(
            key=lambda a: (
                _SEVERITY_ORDER.get(a.severidade, 9),
                -a.impacto_dias,
            )
        )

        # ── Auto-resolve stale alerts ────────────────────────────────
        new_keys = {_dedup_key(a) for a in deduped}
        try:
            active = self.store.list_active(estado="ativo")
            for old_alert in active:
                key = _dedup_key(old_alert)
                if key not in new_keys:
                    self.store.resolve(
                        old_alert.id,
                        note="Auto-resolvido: condicao ja nao se verifica",
                    )
                    logger.info("Auto-resolved alert %s (%s)", old_alert.id, old_alert.regra)
        except Exception:
            logger.exception("Auto-resolve failed")

        # ── Persist ──────────────────────────────────────────────────
        for alert in deduped:
            try:
                self.store.save(alert)
            except Exception:
                logger.exception("Failed to persist alert %s", alert.id)

        logger.info(
            "Alert engine: %d raw -> %d deduped (%d critico, %d aviso, %d info)",
            len(raw_alerts),
            len(deduped),
            sum(1 for a in deduped if a.severidade == "critico"),
            sum(1 for a in deduped if a.severidade == "aviso"),
            sum(1 for a in deduped if a.severidade == "info"),
        )

        return deduped

    @staticmethod
    def _deduplicate(alerts: list[Alert]) -> list[Alert]:
        """Deduplicate by (regra, primary entity).

        Primary entity is:
        - For R1/R2: first molde
        - For R3/R7: first machine
        - For R8: (machine, first two moldes)
        - For R9: always unique (single alert)

        When duplicates exist, keep the one with higher severity / larger impact.
        """
        seen: dict[str, Alert] = {}

        for a in alerts:
            key = _dedup_key(a)
            existing = seen.get(key)
            if existing is None:
                seen[key] = a
            else:
                # Keep the more severe / higher impact alert
                existing_rank = (
                    _SEVERITY_ORDER.get(existing.severidade, 9),
                    -existing.impacto_dias,
                )
                new_rank = (
                    _SEVERITY_ORDER.get(a.severidade, 9),
                    -a.impacto_dias,
                )
                if new_rank < existing_rank:
                    seen[key] = a

        return list(seen.values())


def _dedup_key(alert: Alert) -> str:
    """Build a deduplication key for an alert."""
    regra = alert.regra

    if regra in ("R1", "R2"):
        entity = alert.moldes_afetados[0] if alert.moldes_afetados else ""
        return f"{regra}:{entity}"

    if regra in ("R3", "R7"):
        entity = alert.maquinas_afetadas[0] if alert.maquinas_afetadas else ""
        return f"{regra}:{entity}"

    if regra == "R8":
        machine = alert.maquinas_afetadas[0] if alert.maquinas_afetadas else ""
        moldes = ":".join(sorted(alert.moldes_afetados[:2]))
        return f"R8:{machine}:{moldes}"

    if regra == "R9":
        return "R9"

    return f"{regra}:{alert.id}"
