"""Bootstrap — Moldit ML.

Import retroactive data from completed molds to warm-start the ML system.
Supports importing from .mpp files and manual entry.
"""
from __future__ import annotations

import logging
from datetime import date

from backend.ml.data_model import OperacaoHistorica, ProjetoHistorico
from backend.ml.feature_engineering import (
    inferir_complexidade,
)
from backend.ml.store import MLStore

logger = logging.getLogger(__name__)


class Bootstrapper:
    """Imports historical data into the ML store."""

    def __init__(self, store: MLStore) -> None:
        self.store = store

    def ingest_completed_project(
        self,
        molde_id: str,
        cliente: str,
        data_inicio: date,
        data_conclusao: date,
        data_deadline: date,
        n_operacoes: int,
        work_total_h: float,
        makespan_planeado_dias: int,
        makespan_real_dias: int,
        *,
        n_maquinas_usadas: int = 10,
        n_dependencias: int = 0,
        profundidade_dag: int = 0,
        n_tipos_operacao: int = 6,
        tipo_molde: str = "injecao_plastico",
        peso_estimado_kg: float = 0.0,
        n_cavidades: int = 1,
        operacoes: list[dict] | None = None,
    ) -> str:
        """Ingest a completed project into the ML store.

        Args:
            operacoes: Optional list of operation dicts with:
                op_id, tipo_operacao, maquina_planeada, maquina_real,
                work_h_estimado, work_h_real, setup_h_estimado, setup_h_real.

        Returns:
            projeto_id generated.
        """
        compliance = (data_conclusao <= data_deadline)
        complexidade = inferir_complexidade(n_operacoes, work_total_h)

        projeto_id = f"PRJ-{data_conclusao.year}-{molde_id}"

        proj = ProjetoHistorico(
            projeto_id=projeto_id,
            molde_id=molde_id,
            cliente=cliente,
            data_inicio=data_inicio,
            data_conclusao=data_conclusao,
            data_deadline=data_deadline,
            n_operacoes=n_operacoes,
            n_maquinas_usadas=n_maquinas_usadas,
            work_total_h=work_total_h,
            n_dependencias=n_dependencias,
            profundidade_dag=profundidade_dag,
            n_tipos_operacao=n_tipos_operacao,
            complexidade=complexidade,
            tipo_molde=tipo_molde,
            peso_estimado_kg=peso_estimado_kg,
            n_cavidades=n_cavidades,
            makespan_planeado_dias=makespan_planeado_dias,
            makespan_real_dias=makespan_real_dias,
            compliance=compliance,
        )

        # Convert operation dicts to OperacaoHistorica
        if operacoes:
            for op_dict in operacoes:
                work_est = op_dict.get("work_h_estimado", 0)
                work_real = op_dict.get("work_h_real", work_est)
                setup_est = op_dict.get("setup_h_estimado", 0)
                setup_real = op_dict.get("setup_h_real", setup_est)

                proj.operacoes.append(OperacaoHistorica(
                    op_id=op_dict.get("op_id", 0),
                    tipo_operacao=op_dict.get("tipo_operacao", op_dict.get("codigo", "")),
                    molde_id=molde_id,
                    projeto_id=projeto_id,
                    maquina_planeada=op_dict.get("maquina_planeada", ""),
                    maquina_real=op_dict.get("maquina_real", op_dict.get("maquina_planeada", "")),
                    work_h_estimado=work_est,
                    work_h_real=work_real,
                    setup_h_estimado=setup_est,
                    setup_h_real=setup_real,
                    ratio_work=work_real / work_est if work_est > 0 else 1.0,
                    ratio_setup=setup_real / setup_est if setup_est > 0 else 1.0,
                    dia_planeado=op_dict.get("dia_planeado", 0),
                    dia_real=op_dict.get("dia_real", op_dict.get("dia_planeado", 0)),
                    n_predecessores=op_dict.get("n_predecessores", 0),
                    posicao_no_dag=op_dict.get("posicao_no_dag", 0),
                    operador=op_dict.get("operador", ""),
                    turno=op_dict.get("turno", ""),
                    motivo_desvio=op_dict.get("motivo_desvio", ""),
                ))

        self.store.save_projeto(proj)
        logger.info("Ingested project %s (%s, %d ops)", projeto_id, molde_id, len(proj.operacoes))
        return projeto_id

    def batch_ingest(self, projetos: list[dict]) -> dict:
        """Ingest multiple projects at once.

        Each dict should have keys matching ingest_completed_project params.
        Returns: {ingested: int, errors: list[str]}.
        """
        ingested = 0
        errors: list[str] = []

        for p in projetos:
            try:
                self.ingest_completed_project(
                    molde_id=p["molde_id"],
                    cliente=p.get("cliente", ""),
                    data_inicio=_parse_date(p["data_inicio"]),
                    data_conclusao=_parse_date(p["data_conclusao"]),
                    data_deadline=_parse_date(p["data_deadline"]),
                    n_operacoes=p.get("n_operacoes", 0),
                    work_total_h=p.get("work_total_h", 0),
                    makespan_planeado_dias=p.get("makespan_planeado_dias", 0),
                    makespan_real_dias=p.get("makespan_real_dias", 0),
                    operacoes=p.get("operacoes"),
                    **{k: p[k] for k in (
                        "n_maquinas_usadas", "n_dependencias", "profundidade_dag",
                        "n_tipos_operacao", "tipo_molde", "peso_estimado_kg", "n_cavidades",
                    ) if k in p},
                )
                ingested += 1
            except Exception as e:
                errors.append(f"{p.get('molde_id', '?')}: {e}")

        return {"ingested": ingested, "errors": errors}


def _parse_date(value) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))
