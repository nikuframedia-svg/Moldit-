"""Moldit Chromosome -- 4 genes for mold production scheduling.

Gene groups:
  G1: machine_choice  (dict[int, int])    -- op_id -> index into compat list
  G2: sequence_keys   (dict[str, list])   -- machine_id -> float sort keys
  G3: mold_priority   (dict[str, float])  -- molde_id -> priority (0.5-2.0)
  G4: setup_aversion  (float)             -- setup weight (0.0-1.0)
"""

from __future__ import annotations

import copy
import hashlib
import pickle
import random
from dataclasses import dataclass, field

from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData


@dataclass
class MolditChromosome:
    """Chromosome encoding for the Moldit CPO."""

    # G1: op_id -> index into compat list (which machine)
    machine_choice: dict[int, int] = field(default_factory=dict)
    # G2: machine_id -> list of float sort keys (sequence order)
    sequence_keys: dict[str, list[float]] = field(default_factory=dict)
    # G3: molde_id -> priority multiplier (0.5-2.0, higher = more urgent)
    mold_priority: dict[str, float] = field(default_factory=dict)
    # G4: setup aversion weight (0.0-1.0)
    setup_aversion: float = 0.5
    _hash: str | None = field(default=None, repr=False)

    def compute_hash(self) -> str:
        if self._hash is not None:
            return self._hash
        data = (
            tuple(sorted(self.machine_choice.items())),
            tuple(
                (k, tuple(round(v, 4) for v in vals))
                for k, vals in sorted(self.sequence_keys.items())
            ),
            tuple(sorted((k, round(v, 4)) for k, v in self.mold_priority.items())),
            round(self.setup_aversion, 4),
        )
        self._hash = hashlib.md5(pickle.dumps(data)).hexdigest()
        return self._hash

    def clone(self) -> MolditChromosome:
        return MolditChromosome(
            machine_choice=dict(self.machine_choice),
            sequence_keys={k: list(v) for k, v in self.sequence_keys.items()},
            mold_priority=dict(self.mold_priority),
            setup_aversion=self.setup_aversion,
        )

    @staticmethod
    def from_baseline(
        segmentos: list[SegmentoMoldit],
        data: MolditEngineData,
    ) -> MolditChromosome:
        """Extract chromosome from greedy baseline schedule."""
        chrom = MolditChromosome()

        # G1: machine_choice -- for each op, find index in compat list
        op_machine: dict[int, str] = {}
        for seg in segmentos:
            if seg.op_id not in op_machine:
                op_machine[seg.op_id] = seg.maquina_id

        ops_by_id = {op.id: op for op in data.operacoes}
        for op_id, machine_id in op_machine.items():
            op = ops_by_id.get(op_id)
            if op and op.codigo in data.compatibilidade:
                machines = data.compatibilidade[op.codigo]
                if machine_id in machines:
                    chrom.machine_choice[op_id] = machines.index(machine_id)
                else:
                    chrom.machine_choice[op_id] = 0

        # G2: sequence_keys -- by machine, order ops by their segment time
        machine_ops: dict[str, list[tuple[float, int]]] = {}
        for seg in segmentos:
            if not seg.e_continuacao:
                machine_ops.setdefault(seg.maquina_id, []).append(
                    (seg.dia * 24 + seg.inicio_h, seg.op_id)
                )
        for mid, ops_list in machine_ops.items():
            ops_list.sort()
            chrom.sequence_keys[mid] = [float(i) for i in range(len(ops_list))]

        # G3: mold_priority -- all 1.0 (neutral)
        for molde in data.moldes:
            chrom.mold_priority[molde.id] = 1.0

        # G4: setup_aversion -- neutral
        chrom.setup_aversion = 0.5

        return chrom

    def apply_to_data(self, data: MolditEngineData, config: object) -> MolditEngineData:
        """Apply chromosome decisions to create modified data for scheduling."""
        modified = copy.deepcopy(data)
        ops_by_id = {op.id: op for op in modified.operacoes}

        # Apply G1: machine_choice -- override op.recurso
        for op_id, choice_idx in self.machine_choice.items():
            op = ops_by_id.get(op_id)
            if op and op.codigo in modified.compatibilidade:
                machines = modified.compatibilidade[op.codigo]
                if 0 <= choice_idx < len(machines):
                    op.recurso = machines[choice_idx]

        # Store G3/G2/G4 as private attrs for dispatch to use
        modified._mold_priority = dict(self.mold_priority)  # type: ignore[attr-defined]
        modified._sequence_keys = dict(self.sequence_keys)  # type: ignore[attr-defined]
        modified._setup_aversion = self.setup_aversion  # type: ignore[attr-defined]
        return modified


# Keep backward compat alias
Chromosome = MolditChromosome


# ─── Mutation operators ───────────────────────────────────────────────


def mutate_machine(
    chrom: MolditChromosome, rng: random.Random, data: MolditEngineData,
) -> MolditChromosome:
    """Pick random op, change to different compatible machine."""
    c = chrom.clone()
    if not c.machine_choice:
        return c
    op_id = rng.choice(list(c.machine_choice.keys()))
    op = next((o for o in data.operacoes if o.id == op_id), None)
    if op and op.codigo in data.compatibilidade:
        machines = data.compatibilidade[op.codigo]
        if len(machines) > 1:
            c.machine_choice[op_id] = rng.randint(0, len(machines) - 1)
    c._hash = None
    return c


def mutate_sequence_swap(
    chrom: MolditChromosome, rng: random.Random, data: MolditEngineData,
) -> MolditChromosome:
    """Swap 2 adjacent sequence keys in one machine."""
    c = chrom.clone()
    if not c.sequence_keys:
        return c
    candidates = [m for m, keys in c.sequence_keys.items() if len(keys) >= 2]
    if not candidates:
        return c
    mid = rng.choice(candidates)
    keys = c.sequence_keys[mid]
    i = rng.randint(0, len(keys) - 2)
    keys[i], keys[i + 1] = keys[i + 1], keys[i]
    c._hash = None
    return c


def mutate_sequence_insert(
    chrom: MolditChromosome, rng: random.Random, data: MolditEngineData,
) -> MolditChromosome:
    """Relocate one op's sort key to a different position."""
    c = chrom.clone()
    if not c.sequence_keys:
        return c
    candidates = [m for m, keys in c.sequence_keys.items() if len(keys) >= 2]
    if not candidates:
        return c
    mid = rng.choice(candidates)
    keys = c.sequence_keys[mid]
    i = rng.randint(0, len(keys) - 1)
    j = rng.randint(0, len(keys) - 1)
    val = keys.pop(i)
    keys.insert(j, val)
    c._hash = None
    return c


def mutate_mold_priority(
    chrom: MolditChromosome, rng: random.Random, data: MolditEngineData,
) -> MolditChromosome:
    """Perturb one mold's priority."""
    c = chrom.clone()
    if not c.mold_priority:
        return c
    mid = rng.choice(list(c.mold_priority.keys()))
    c.mold_priority[mid] = max(0.5, min(2.0, c.mold_priority[mid] + rng.uniform(-0.1, 0.1)))
    c._hash = None
    return c


def mutate_setup_aversion(
    chrom: MolditChromosome, rng: random.Random, data: MolditEngineData,
) -> MolditChromosome:
    """Perturb setup aversion weight."""
    c = chrom.clone()
    c.setup_aversion = max(0.0, min(1.0, c.setup_aversion + rng.uniform(-0.05, 0.05)))
    c._hash = None
    return c


def mutate_strong(
    chrom: MolditChromosome, rng: random.Random, data: MolditEngineData,
) -> MolditChromosome:
    """Strong shake: randomize 2-4 genes."""
    c = chrom.clone()
    ops = [mutate_machine, mutate_sequence_swap, mutate_mold_priority, mutate_setup_aversion]
    for _ in range(rng.randint(2, 4)):
        op = rng.choice(ops)
        c = op(c, rng, data)
    return c


def crossover_uniform(
    a: MolditChromosome,
    b: MolditChromosome,
    rng: random.Random,
    data: MolditEngineData,
) -> MolditChromosome:
    """Uniform crossover: 50/50 per gene group."""
    child = MolditChromosome()

    # G1: per op, pick from a or b
    all_ops = set(a.machine_choice) | set(b.machine_choice)
    for op_id in all_ops:
        if rng.random() < 0.5 and op_id in a.machine_choice:
            child.machine_choice[op_id] = a.machine_choice[op_id]
        elif op_id in b.machine_choice:
            child.machine_choice[op_id] = b.machine_choice[op_id]
        elif op_id in a.machine_choice:
            child.machine_choice[op_id] = a.machine_choice[op_id]

    # G2: per machine, pick from a or b
    all_machines = set(a.sequence_keys) | set(b.sequence_keys)
    for mid in all_machines:
        src = a if (rng.random() < 0.5 and mid in a.sequence_keys) else b
        if mid in src.sequence_keys:
            child.sequence_keys[mid] = list(src.sequence_keys[mid])
        elif mid in a.sequence_keys:
            child.sequence_keys[mid] = list(a.sequence_keys[mid])

    # G3: per mold, pick from a or b
    all_molds = set(a.mold_priority) | set(b.mold_priority)
    for mid in all_molds:
        src = a if (rng.random() < 0.5 and mid in a.mold_priority) else b
        if mid in src.mold_priority:
            child.mold_priority[mid] = src.mold_priority[mid]
        elif mid in a.mold_priority:
            child.mold_priority[mid] = a.mold_priority[mid]

    # G4: pick from a or b
    child.setup_aversion = a.setup_aversion if rng.random() < 0.5 else b.setup_aversion

    return child


# All operators (name -> callable)
OPERATORS: dict[str, callable] = {
    "mutate_machine": mutate_machine,
    "mutate_sequence_swap": mutate_sequence_swap,
    "mutate_sequence_insert": mutate_sequence_insert,
    "mutate_mold_priority": mutate_mold_priority,
    "mutate_setup_aversion": mutate_setup_aversion,
    "mutate_strong": mutate_strong,
}
