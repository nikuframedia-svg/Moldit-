"""Integration tests — exercises all 4 new modules with the scheduler.

Tests the full pipeline: schedule → alerts → calibration → workforce → reports.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from backend.config.loader import load_config
from backend.scheduler.scheduler import schedule_all
from backend.scheduler.types import ScheduleResult, SegmentoMoldit
from backend.types import (
    Dependencia,
    Maquina,
    Molde,
    MolditEngineData,
    Operacao,
)


# ── Helpers ──────────────────────────────────────────────────────────


def _make_config():
    return load_config()


def _make_data(n_ops: int = 10) -> MolditEngineData:
    """Build synthetic MolditEngineData with N ops across 2 molds."""
    ops = []
    deps = []
    dag = {}
    dag_rev = {}

    for i in range(n_ops):
        molde = "M001" if i < n_ops // 2 else "M002"
        codigo = "FE010" if i % 3 == 0 else ("EE005" if i % 3 == 1 else "BA020")
        ops.append(Operacao(
            id=100 + i,
            molde=molde,
            componente="Comp",
            nome=f"Op {i}",
            codigo=codigo,
            nome_completo=f"{molde} > Op {i}",
            duracao_h=float(4 + i % 5),
            work_h=float(4 + i % 5),
            progresso=0.0,
            work_restante_h=float(4 + i % 5),
            recurso=None,
        ))
        # Chain dependency within same mold
        if i > 0 and ops[i].molde == ops[i - 1].molde:
            deps.append(Dependencia(
                predecessor_id=100 + i - 1,
                sucessor_id=100 + i,
            ))
            dag.setdefault(100 + i - 1, []).append(100 + i)
            dag_rev.setdefault(100 + i, []).append(100 + i - 1)

    machines = [
        Maquina(id="CNC-01", grupo="Desbaste", regime_h=16, setup_h=1.0),
        Maquina(id="CNC-02", grupo="Desbaste", regime_h=16, setup_h=1.0),
        Maquina(id="ERO-01", grupo="EROSAO", regime_h=16, setup_h=1.5),
        Maquina(id="BAN-01", grupo="Bancada", regime_h=8, setup_h=0.0),
    ]

    moldes = [
        Molde(id="M001", cliente="ClienteA", deadline="S15",
              total_ops=n_ops // 2, total_work_h=sum(o.work_h for o in ops if o.molde == "M001")),
        Molde(id="M002", cliente="ClienteB", deadline="S20",
              total_ops=n_ops - n_ops // 2, total_work_h=sum(o.work_h for o in ops if o.molde == "M002")),
    ]

    compat = {
        "FE010": ["CNC-01", "CNC-02"],
        "EE005": ["ERO-01"],
        "BA020": ["BAN-01"],
    }

    return MolditEngineData(
        operacoes=ops,
        maquinas=machines,
        moldes=moldes,
        dependencias=deps,
        compatibilidade=compat,
        dag=dag,
        dag_reverso=dag_rev,
        caminho_critico=[],
        feriados=[],
    )


# ── Tests: Scheduler Core ───────────────────────────────────────────


class TestSchedulerSynthetic:
    """Extended scheduler tests with synthetic data."""

    def test_basic_schedule(self):
        data = _make_data(10)
        config = _make_config()
        result = schedule_all(data, config=config)

        assert isinstance(result, ScheduleResult)
        assert len(result.segmentos) > 0
        assert result.score["ops_agendadas"] > 0

    def test_all_ops_scheduled(self):
        data = _make_data(6)
        config = _make_config()
        result = schedule_all(data, config=config)

        scheduled_ops = {s.op_id for s in result.segmentos}
        expected_ops = {o.id for o in data.operacoes if o.work_restante_h > 0}
        assert scheduled_ops == expected_ops

    def test_dependencies_respected(self):
        data = _make_data(8)
        config = _make_config()
        result = schedule_all(data, config=config)

        op_end = {}
        op_start = {}
        for s in result.segmentos:
            key_end = (s.dia, s.fim_h)
            key_start = (s.dia, s.inicio_h)
            if s.op_id not in op_end or key_end > op_end[s.op_id]:
                op_end[s.op_id] = key_end
            if s.op_id not in op_start or key_start < op_start[s.op_id]:
                op_start[s.op_id] = key_start

        for dep in data.dependencias:
            pred = op_end.get(dep.predecessor_id)
            succ = op_start.get(dep.sucessor_id)
            if pred and succ:
                assert succ >= pred, (
                    f"Op {dep.sucessor_id} starts before predecessor "
                    f"{dep.predecessor_id} finishes"
                )

    def test_no_machine_overlap(self):
        data = _make_data(10)
        config = _make_config()
        result = schedule_all(data, config=config)

        from collections import defaultdict
        by_machine_day: dict[tuple, list] = defaultdict(list)
        for s in result.segmentos:
            if not s.e_2a_placa:
                by_machine_day[(s.maquina_id, s.dia)].append(s)

        for (mid, day), segs in by_machine_day.items():
            sorted_segs = sorted(segs, key=lambda s: s.inicio_h)
            for i in range(len(sorted_segs) - 1):
                a = sorted_segs[i]
                b = sorted_segs[i + 1]
                assert a.fim_h <= b.inicio_h + 0.01, (
                    f"Overlap on {mid} day {day}: "
                    f"op {a.op_id} ends {a.fim_h}, op {b.op_id} starts {b.inicio_h}"
                )

    def test_score_structure(self):
        data = _make_data(10)
        config = _make_config()
        result = schedule_all(data, config=config)

        score = result.score
        assert "makespan_total_dias" in score
        assert "deadline_compliance" in score
        assert "total_setups" in score
        assert "weighted_score" in score
        assert 0 <= score["deadline_compliance"] <= 100
        assert score["makespan_total_dias"] >= 1

    def test_empty_data(self):
        data = MolditEngineData()
        config = _make_config()
        result = schedule_all(data, config=config)
        assert len(result.segmentos) == 0
        assert "Sem operacoes" in result.warnings[0]

    def test_completed_ops_skipped(self):
        data = _make_data(4)
        # Mark first op as complete
        data.operacoes[0].progresso = 100.0
        data.operacoes[0].work_restante_h = 0.0
        config = _make_config()
        result = schedule_all(data, config=config)

        scheduled_ids = {s.op_id for s in result.segmentos}
        assert data.operacoes[0].id not in scheduled_ids

    def test_operator_alerts_generated(self):
        # Create heavy load on one group
        data = _make_data(20)
        config = _make_config()
        result = schedule_all(data, config=config)

        # OperatorAlerts are per (group, day) overloads
        assert isinstance(result.alerts, list)


# ── Tests: Alert Engine ──────────────────────────────────────────────


class TestAlertEngine:
    """Test the alert engine with synthetic schedule data."""

    def test_engine_evaluates(self):
        from backend.alerts.engine import AlertEngine

        data = _make_data(10)
        config = _make_config()
        result = schedule_all(data, config=config)

        engine = AlertEngine()
        alerts = engine.evaluate(
            segmentos=result.segmentos,
            data=data,
            config=config,
        )
        assert isinstance(alerts, list)

    def test_r1_deadline_risk(self):
        from backend.alerts.rules import r1_deadline_em_risco

        data = _make_data(10)
        config = _make_config()
        result = schedule_all(data, config=config)

        alerts = r1_deadline_em_risco(result.segmentos, data.moldes, config)
        assert isinstance(alerts, list)
        # All alerts should have correct structure
        for a in alerts:
            assert a.regra == "R1"
            assert a.severidade in ("critico", "aviso")

    def test_r3_overloaded_machines(self):
        from backend.alerts.rules import r3_maquina_sobrecarregada

        data = _make_data(10)
        config = _make_config()
        result = schedule_all(data, config=config)

        alerts = r3_maquina_sobrecarregada(
            result.segmentos, data.maquinas, config,
        )
        assert isinstance(alerts, list)

    def test_alert_store_crud(self):
        from backend.alerts.store import AlertStore
        from backend.alerts.types import Alert

        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            store = AlertStore(db_path=path)
            alert = Alert(
                id="test-001", regra="R1", severidade="critico",
                titulo="Test Alert", mensagem="Test message",
                timestamp="2026-04-03T12:00:00",
                moldes_afetados=["M001"], maquinas_afetadas=["CNC-01"],
                operacoes=[100], impacto_dias=3.0,
                sugestoes=[], estado="ativo",
            )
            store.save(alert)

            retrieved = store.get("test-001")
            assert retrieved is not None
            assert retrieved.titulo == "Test Alert"

            active = store.list_active()
            assert len(active) == 1

            store.acknowledge("test-001")
            ack = store.get("test-001")
            assert ack.estado == "reconhecido"

            store.resolve("test-001", "Fixed it")
            resolved = store.get("test-001")
            assert resolved.estado == "resolvido"

            stats = store.stats()
            assert stats["total"] >= 1

            store.close()
        finally:
            os.unlink(path)


# ── Tests: Calibration Pipeline ──────────────────────────────────────


class TestCalibrationPipeline:
    """Test execution logging → calibration → Monte Carlo integration."""

    def test_execution_to_calibration(self):
        from backend.learning.calibration import calcular_fatores_calibracao
        from backend.learning.execution_store import ExecutionStore

        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            store = ExecutionStore(db_path=path)

            # Log 10 completions for FE010 with ~15% overrun
            for i in range(10):
                store.log_completion(
                    op_id=i, molde="M001", maquina_id="CNC-01",
                    codigo="FE010", work_h_planeado=10.0,
                    work_h_real=10.0 * (1.15 + (i % 3) * 0.02),
                    dia_planeado=i, dia_real=i,
                )

            # Log 8 completions for EE005 with ~22% overrun
            for i in range(8):
                store.log_completion(
                    op_id=100 + i, molde="M001", maquina_id="ERO-01",
                    codigo="EE005", work_h_planeado=8.0,
                    work_h_real=8.0 * (1.22 + (i % 3) * 0.03),
                    dia_planeado=i, dia_real=i,
                )

            logs = store.get_all_logs()
            fatores = calcular_fatores_calibracao(logs)

            assert "FE010" in fatores
            assert "EE005" in fatores
            assert 1.10 < fatores["FE010"].ratio_media < 1.25
            assert 1.15 < fatores["EE005"].ratio_media < 1.35
            assert fatores["FE010"].confianca == 0.5  # 10/20
            assert fatores["EE005"].confianca == 0.4  # 8/20

            store.close()
        finally:
            os.unlink(path)

    def test_machine_reliability(self):
        from backend.learning.calibration import calcular_fiabilidade_maquina

        events = [
            {"maquina_id": "CNC-01", "duracao_h": 3.0, "planeado": False},
            {"maquina_id": "CNC-01", "duracao_h": 5.0, "planeado": False},
            {"maquina_id": "CNC-01", "duracao_h": 2.0, "planeado": True},  # maintenance
        ]
        rel = calcular_fiabilidade_maquina(events, regime_h=16, periodo_dias=90)

        assert rel.n_eventos == 2  # only unplanned
        assert rel.mttr_h == 4.0  # (3+5)/2
        total = 90 * 16
        expected_uptime = (total - 8) / total
        assert abs(rel.uptime_pct - expected_uptime) < 0.001

    def test_monte_carlo_with_calibration(self):
        """Test that Monte Carlo accepts calibration data."""
        from backend.learning.calibration import CalibrationFactor

        try:
            from backend.risk.monte_carlo import monte_carlo_risk
        except ImportError:
            pytest.skip("scipy not installed")

        data = _make_data(6)
        config = _make_config()

        calib = {
            "FE010": CalibrationFactor("FE010", 1.15, 0.08, 20, 1.0),
            "EE005": CalibrationFactor("EE005", 1.22, 0.12, 15, 0.75),
        }

        result = monte_carlo_risk(
            data, schedule_all, n_samples=10, seed=42,
            calibration=calib,
        )

        assert "makespan_p50" in result
        assert "compliance_p50" in result
        assert result["calibrated"] is True
        assert result["n_samples"] == 10

    def test_monte_carlo_without_calibration(self):
        """Test Monte Carlo still works without calibration (backwards compat)."""
        try:
            from backend.risk.monte_carlo import monte_carlo_risk
        except ImportError:
            pytest.skip("scipy not installed")

        data = _make_data(6)
        result = monte_carlo_risk(data, schedule_all, n_samples=10, seed=42)

        assert result["calibrated"] is False
        assert result["n_samples"] == 10


# ── Tests: Workforce ─────────────────────────────────────────────────


class TestWorkforce:
    """Test workforce conflict detection and allocation."""

    def test_conflict_detector_no_operators(self):
        from backend.workforce.conflict_detector import detectar_conflitos
        from backend.workforce.types import CompetenciasMaquina

        data = _make_data(6)
        config = _make_config()
        result = schedule_all(data, config=config)

        # No operators → should detect conflicts
        competencias = {
            "CNC-01": CompetenciasMaquina("CNC-01", "Desbaste", ["cnc"], 1, 1),
            "ERO-01": CompetenciasMaquina("ERO-01", "EROSAO", ["erosao"], 1, 1),
            "BAN-01": CompetenciasMaquina("BAN-01", "Bancada", ["montagem"], 1, 1),
        }

        conflicts = detectar_conflitos(
            result.segmentos, [], competencias, config,
        )
        # With 0 operators and active machines, expect conflicts
        assert isinstance(conflicts, list)
        if result.segmentos:
            assert len(conflicts) > 0

    def test_conflict_detector_sufficient_operators(self):
        from backend.workforce.conflict_detector import detectar_conflitos
        from backend.workforce.types import CompetenciasMaquina, Operador

        data = _make_data(4)
        config = _make_config()
        result = schedule_all(data, config=config)

        competencias = {
            "CNC-01": CompetenciasMaquina("CNC-01", "Desbaste", ["cnc"], 1, 1),
            "CNC-02": CompetenciasMaquina("CNC-02", "Desbaste", ["cnc"], 1, 1),
            "ERO-01": CompetenciasMaquina("ERO-01", "EROSAO", ["erosao"], 1, 1),
            "BAN-01": CompetenciasMaquina("BAN-01", "Bancada", ["montagem"], 1, 1),
        }

        # 10 operators covering everything
        operators = [
            Operador(f"OP-{i:03d}", f"Op {i}", ["cnc", "erosao", "montagem"],
                     {"cnc": 3, "erosao": 2, "montagem": 2}, "A", "CNC")
            for i in range(10)
        ]

        conflicts = detectar_conflitos(
            result.segmentos, operators, competencias, config,
        )
        # With 10 skilled operators, fewer conflicts expected
        assert isinstance(conflicts, list)

    def test_auto_allocate_basic(self):
        from backend.workforce.auto_allocate import auto_allocate
        from backend.workforce.types import CompetenciasMaquina, Operador

        data = _make_data(4)
        config = _make_config()
        result = schedule_all(data, config=config)

        competencias = {
            "CNC-01": CompetenciasMaquina("CNC-01", "Desbaste", ["cnc"], 1, 1),
            "ERO-01": CompetenciasMaquina("ERO-01", "EROSAO", ["erosao"], 1, 1),
        }

        operators = [
            Operador("OP-001", "João", ["cnc"], {"cnc": 3}, "A", "CNC"),
            Operador("OP-002", "Maria", ["erosao"], {"erosao": 2}, "A", "EROSAO"),
        ]

        allocations = auto_allocate(
            dia=0, turno="A",
            segmentos=result.segmentos,
            operadores=operators,
            competencias=competencias,
        )
        assert isinstance(allocations, list)
        for alloc in allocations:
            assert alloc.auto is True

    def test_forecast(self):
        from backend.workforce.forecast import forecast_necessidades
        from backend.workforce.types import CompetenciasMaquina, Operador

        data = _make_data(8)
        config = _make_config()
        result = schedule_all(data, config=config)

        competencias = {
            "CNC-01": CompetenciasMaquina("CNC-01", "Desbaste", ["cnc"], 1, 1),
        }
        operators = [
            Operador("OP-001", "João", ["cnc"], {"cnc": 3}, "A", "Desbaste"),
        ]

        forecast = forecast_necessidades(
            result.segmentos, operators, competencias, config, semanas=2,
        )
        assert isinstance(forecast, list)


# ── Tests: Report Generation ─────────────────────────────────────────


class TestReportGeneration:
    """Test HTML report generation."""

    def test_daily_report(self):
        from backend.reports.generator import ReportGenerator

        data = _make_data(6)
        config = _make_config()
        result = schedule_all(data, config=config)

        gen = ReportGenerator()
        html = gen.generate_daily(
            score=result.score,
            segmentos=result.segmentos,
            moldes=data.moldes,
            config=config,
            date="2026-04-03",
        )

        assert "<!DOCTYPE html>" in html
        assert "Compliance" in html
        assert "Makespan" in html
        assert "2026-04-03" in html

    def test_weekly_report(self):
        from backend.reports.generator import ReportGenerator

        data = _make_data(6)
        config = _make_config()
        result = schedule_all(data, config=config)

        gen = ReportGenerator()
        html = gen.generate_weekly(
            score=result.score,
            segmentos=result.segmentos,
            moldes=data.moldes,
            config=config,
            week="2026-W14",
        )

        assert "<!DOCTYPE html>" in html

    def test_client_report(self):
        from backend.reports.generator import ReportGenerator

        data = _make_data(6)
        config = _make_config()
        result = schedule_all(data, config=config)

        gen = ReportGenerator()
        html = gen.generate_client(
            molde_id="M001",
            score=result.score,
            segmentos=result.segmentos,
            moldes=data.moldes,
        )

        assert "<!DOCTYPE html>" in html
        assert "M001" in html

    def test_empty_schedule_report(self):
        from backend.reports.generator import ReportGenerator

        gen = ReportGenerator()
        html = gen.generate_daily(
            score={}, segmentos=[], moldes=[], config=None, date="2026-04-03",
        )
        assert "<!DOCTYPE html>" in html


# ── Tests: Real MPP Full Pipeline ────────────────────────────────────


_MPP_PATH = "/Users/martimnicolau/Downloads/Template_para_teste_Moldit.mpp"


@pytest.mark.skipif(
    not os.path.exists(_MPP_PATH),
    reason="Real MPP file not found",
)
class TestRealMPPFullPipeline:
    """Full pipeline test with real MPP data."""

    def test_schedule_and_alerts(self):
        from backend.alerts.engine import AlertEngine
        from backend.transform.transform import transform

        data = transform(_MPP_PATH)
        config = _make_config()
        result = schedule_all(data, config=config)

        assert len(result.segmentos) > 100
        assert result.score["deadline_compliance"] > 0

        # Run alert engine
        engine = AlertEngine()
        alerts = engine.evaluate(result.segmentos, data, config)
        assert isinstance(alerts, list)

        # Expect some alerts for a realistic schedule
        print(f"\n  Real MPP: {len(result.segmentos)} segments, "
              f"{result.score['ops_agendadas']} ops scheduled")
        print(f"  Compliance: {result.score['deadline_compliance']:.1f}%")
        print(f"  Alerts generated: {len(alerts)}")
        for a in alerts[:5]:
            print(f"    [{a.severidade}] {a.titulo}")

    def test_schedule_and_report(self):
        from backend.reports.generator import ReportGenerator
        from backend.transform.transform import transform

        data = transform(_MPP_PATH)
        config = _make_config()
        result = schedule_all(data, config=config)

        gen = ReportGenerator()
        html = gen.generate_daily(
            result.score, result.segmentos, data.moldes, config, "2026-04-03",
        )

        assert len(html) > 500
        # Check all real molds appear
        for m in data.moldes:
            assert m.id in html
