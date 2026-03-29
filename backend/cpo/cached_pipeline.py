"""CachedPipeline for CPO v3.0 — Delta evaluation wrapper.

Wraps the existing scheduler pipeline phases with caching:
  - Lots (Phase 1): gene-independent, cached once
  - ToolRuns (Phase 2): cached by (edd_gap, max_edd_span)
  - Machine assignment + Sequencing + Dispatch: per chromosome
  - JIT + VNS + Post-processing: per chromosome

Reuses ALL existing functions from backend.scheduler.*.
"""

from __future__ import annotations

import copy
import logging
from collections import defaultdict
from backend.config.types import FactoryConfig
from backend.scheduler.dispatch import (
    assign_machines,
    sequence_per_machine,
)
from backend.scheduler.types import Lot, ScheduleResult, ToolRun
from backend.types import EngineData

from backend.cpo.chromosome import Chromosome

logger = logging.getLogger(__name__)


class CachedPipeline:
    """Delta-evaluation wrapper over the existing scheduler pipeline."""

    def __init__(self, engine_data: EngineData, config: FactoryConfig):
        self.data = engine_data
        self.config = config
        self._lots: list[Lot] | None = None
        self._runs_cache: dict[tuple[int, int], list[ToolRun]] = {}
        self._fitness_cache: dict[str, tuple[dict, ScheduleResult]] = {}
        self.eval_count = 0
        self.cache_hits = 0

    def _get_lots(self) -> list[Lot]:
        """Lots are gene-independent (cached once)."""
        raise NotImplementedError("Moldit CachedPipeline — Phase 2")

    def _get_runs(self, edd_gap: int, max_edd_span: int) -> list[ToolRun]:
        """Tool runs cached by (edd_gap, max_edd_span)."""
        raise NotImplementedError("Moldit CachedPipeline — Phase 2")

    def evaluate(self, chrom: Chromosome) -> ScheduleResult:
        """Full pipeline evaluation for a chromosome."""
        raise NotImplementedError("Moldit CachedPipeline — Phase 2")

    def _assign_with_choices(
        self, runs: list[ToolRun], choices: dict[int, int]
    ) -> dict[str, list[ToolRun]]:
        """Machine assignment using chromosome's G3 gene.

        For runs with alt_machine_id, use choices[run_idx] to decide.
        For runs without alt, go to primary.
        """
        if not choices:
            return assign_machines(runs, self.data, config=self.config)

        machine_runs: dict[str, list[ToolRun]] = defaultdict(list)

        for idx, run in enumerate(runs):
            if run.alt_machine_id is None:
                machine_runs[run.machine_id].append(run)
            else:
                choice = choices.get(idx, 0)
                if choice == 1:
                    machine_runs[run.alt_machine_id].append(run)
                else:
                    machine_runs[run.machine_id].append(run)

        return dict(machine_runs)

    def _sequence_with_chromosome(
        self, machine_runs: dict[str, list[ToolRun]], chrom: Chromosome
    ) -> dict[str, list[ToolRun]]:
        """Apply chromosome's G4 sequence keys, then use campaign sequencing with G6."""
        # First apply G4 sort keys to reorder runs per machine
        for m_id, m_runs in machine_runs.items():
            keys = chrom.sequence_keys.get(m_id)
            if keys and len(keys) == len(m_runs):
                # Sort runs by their chromosome keys
                paired = sorted(zip(keys, m_runs), key=lambda x: x[0])
                machine_runs[m_id] = [run for _, run in paired]

        # Then apply campaign sequencing with G6 window
        seq_cfg = copy.copy(self.config)
        seq_cfg.campaign_window = chrom.campaign_window
        machine_runs = sequence_per_machine(machine_runs, config=seq_cfg)
        return machine_runs
