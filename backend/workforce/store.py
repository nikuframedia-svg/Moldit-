"""YAML-based workforce store — Moldit Planner.

Persists operators and competency mappings to config/operadores.yaml.
Auto-generates competency requirements from factory.yaml machine groups
when no explicit mapping is defined.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from backend.workforce.types import CompetenciasMaquina, Operador

logger = logging.getLogger(__name__)

_DEFAULT_PATH = "config/operadores.yaml"

# ── Machine-group → default competency mapping ─────────────────────────
# Each group maps to a list of required competency tags and a minimum level.
_GROUP_COMPETENCY_DEFAULTS: dict[str, tuple[list[str], int]] = {
    "Desbaste":        (["cnc", "desbaste"], 2),
    "Desbaste_PD":     (["cnc", "desbaste"], 2),
    "Maq_3D_GD":       (["cnc", "maquinacao_3d"], 3),
    "Maq_3D_2D_GD":    (["cnc", "maquinacao_3d", "maquinacao_2d"], 3),
    "Maq_3D_MD":       (["cnc", "maquinacao_3d"], 2),
    "Maq_3D_PD":       (["cnc", "maquinacao_3d"], 2),
    "Acab_5ax":        (["cnc", "5_eixos", "acabamento"], 3),
    "Maq_estruturas":  (["cnc", "estruturas"], 2),
    "FACESS":          (["cnc", "faces"], 2),
    "Maq_Eletrodos":   (["cnc", "eletrodos"], 2),
    "EROSAO":          (["erosao"], 2),
    "Erosao_Fio":      (["erosao", "erosao_fio"], 2),
    "FURACAO":         (["furacao"], 2),
    "TORNO":           (["torno"], 2),
    "Maq_Acessorios":  (["convencional"], 1),
    "Bancada":         (["bancada"], 1),
    "Polimento":       (["polimento"], 2),
    "Tapagem":         (["tapagem"], 1),
    "Qualidade":       (["metrologia", "qualidade"], 2),
    "Retificacao":     (["retificacao"], 2),
    "Externo":         ([], 0),  # no operator needed
}


class WorkforceStore:
    """Reads and writes operator data from a YAML file."""

    def __init__(self, path: str = _DEFAULT_PATH) -> None:
        self.path = Path(path)
        self._ensure_file()

    # ── Private helpers ─────────────────────────────────────────────────

    def _ensure_file(self) -> None:
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                yaml.safe_dump({"operadores": [], "competencias": {}}, allow_unicode=True),
                encoding="utf-8",
            )

    def _read_yaml(self) -> dict:
        text = self.path.read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}

    def _write_yaml(self, data: dict) -> None:
        self.path.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )

    # ── Operadores ──────────────────────────────────────────────────────

    def load_operadores(self) -> list[Operador]:
        """Load all operators from YAML."""
        data = self._read_yaml()
        raw_list = data.get("operadores", [])
        result: list[Operador] = []
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            result.append(Operador(
                id=item.get("id", ""),
                nome=item.get("nome", ""),
                competencias=item.get("competencias", []),
                nivel=item.get("nivel", {}),
                turno=item.get("turno", "A"),
                zona=item.get("zona", ""),
                disponivel=item.get("disponivel", True),
                horas_semanais=item.get("horas_semanais", 40.0),
            ))
        return result

    def save_operadores(self, ops: list[Operador]) -> None:
        """Persist a full operator list, preserving other YAML sections."""
        data = self._read_yaml()
        data["operadores"] = [
            {
                "id": op.id,
                "nome": op.nome,
                "competencias": list(op.competencias),
                "nivel": dict(op.nivel),
                "turno": op.turno,
                "zona": op.zona,
                "disponivel": op.disponivel,
                "horas_semanais": op.horas_semanais,
            }
            for op in ops
        ]
        self._write_yaml(data)

    def add_operador(self, op: Operador) -> None:
        """Append a single operator and persist."""
        ops = self.load_operadores()
        ops.append(op)
        self.save_operadores(ops)

    def update_operador(self, op_id: str, updates: dict) -> Operador | None:
        """Update fields of an existing operator. Returns updated or None."""
        ops = self.load_operadores()
        target: Operador | None = None
        for op in ops:
            if op.id == op_id:
                target = op
                break
        if target is None:
            return None

        allowed = {"nome", "competencias", "nivel", "turno", "zona", "disponivel", "horas_semanais"}
        for key, val in updates.items():
            if key in allowed:
                setattr(target, key, val)

        self.save_operadores(ops)
        return target

    def remove_operador(self, op_id: str) -> bool:
        """Remove an operator by ID. Returns True if found and removed."""
        ops = self.load_operadores()
        before = len(ops)
        ops = [op for op in ops if op.id != op_id]
        if len(ops) == before:
            return False
        self.save_operadores(ops)
        return True

    # ── Competencias por maquina ────────────────────────────────────────

    def load_competencias(
        self,
        factory_machines: dict[str, object] | None = None,
    ) -> dict[str, CompetenciasMaquina]:
        """Load competency requirements per machine.

        If the YAML has explicit mappings, use those.
        Otherwise, auto-generate from factory machine groups.
        """
        data = self._read_yaml()
        raw = data.get("competencias", {})
        result: dict[str, CompetenciasMaquina] = {}

        # Explicit from YAML
        if isinstance(raw, dict):
            for mid, item in raw.items():
                if not isinstance(item, dict):
                    continue
                result[mid] = CompetenciasMaquina(
                    maquina_id=mid,
                    grupo=item.get("grupo", ""),
                    competencias_necessarias=item.get("competencias_necessarias", []),
                    nivel_minimo=item.get("nivel_minimo", 1),
                    n_operadores=item.get("n_operadores", 1),
                )

        # Auto-generate for machines not already in result
        if factory_machines:
            for mid, mach in factory_machines.items():
                if mid in result:
                    continue
                grupo = getattr(mach, "group", "") or getattr(mach, "grupo", "")
                defaults = _GROUP_COMPETENCY_DEFAULTS.get(grupo, ([], 1))
                comps, nivel = defaults
                # External machines need no operator
                if grupo == "Externo" or mid.startswith("//"):
                    continue
                result[mid] = CompetenciasMaquina(
                    maquina_id=mid,
                    grupo=grupo,
                    competencias_necessarias=list(comps),
                    nivel_minimo=nivel,
                    n_operadores=1,
                )

        return result

    def _next_id(self) -> str:
        """Generate the next operator ID (OP-001, OP-002, ...)."""
        ops = self.load_operadores()
        max_num = 0
        for op in ops:
            if op.id.startswith("OP-"):
                try:
                    num = int(op.id[3:])
                    max_num = max(max_num, num)
                except ValueError:
                    pass
        return f"OP-{max_num + 1:03d}"
