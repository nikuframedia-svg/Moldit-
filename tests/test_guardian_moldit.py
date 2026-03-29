"""Tests for Moldit Guardian rules."""
from backend.config.types import FactoryConfig
from backend.guardian.guardian import validate_input
from backend.types import Dependencia, Maquina, MolditEngineData, Operacao


def _make_op(id: int, **kwargs) -> Operacao:
    """Helper to create a test operation with defaults."""
    defaults = dict(
        molde="2947", componente="Cavidade",
        nome="TestOp", codigo="FE010",
        nome_completo="Test", duracao_h=8.0,
        work_h=8.0, progresso=0.0,
        work_restante_h=8.0,
    )
    defaults.update(kwargs)
    return Operacao(id=id, **defaults)


def _make_config() -> FactoryConfig:
    """Create a minimal config for testing."""
    from backend.config.types import MachineConfig
    cfg = FactoryConfig()
    cfg.machines = {
        "FE16-Zayer": MachineConfig(id="FE16-Zayer", group="Desbaste"),
        "FE31-MasterMill": MachineConfig(id="FE31-MasterMill", group="Maq_3D_2D_GD"),
    }
    cfg.electrodos_default_h = 4.0
    return cfg


class TestValidateInput:
    def test_cyclic_dag_detected(self):
        ops = [_make_op(1), _make_op(2), _make_op(3)]
        data = MolditEngineData(
            operacoes=ops,
            maquinas=[Maquina(id="FE16-Zayer", grupo="Desbaste")],
            dependencias=[
                Dependencia(predecessor_id=1, sucessor_id=2),
                Dependencia(predecessor_id=2, sucessor_id=3),
                Dependencia(predecessor_id=3, sucessor_id=1),  # cycle!
            ],
            dag={1: [2], 2: [3], 3: [1]},
            dag_reverso={2: [1], 3: [2], 1: [3]},
            compatibilidade={"FE010": ["FE16-Zayer"]},
        )
        config = _make_config()
        result = validate_input(data, config)
        cycle_issues = [i for i in result.issues if i.field == "dag"]
        assert len(cycle_issues) >= 1, "Should detect cycle in DAG"

    def test_electrode_fixed_with_default(self):
        op = _make_op(10, codigo="EL001", work_h=0.0, duracao_h=0.0,
                      work_restante_h=0.0, recurso="FE29-GT")
        data = MolditEngineData(
            operacoes=[op],
            maquinas=[Maquina(id="FE29-GT", grupo="Maq_Eletrodos")],
            compatibilidade={"EL001": ["FE29-GT"]},
        )
        config = _make_config()
        result = validate_input(data, config)
        fix_issues = [i for i in result.issues if i.severity == "fix" and "Electrodo" in i.message]
        assert len(fix_issues) >= 1
        # Cleaned op should have default hours
        cleaned_op = result.cleaned.operacoes[0]
        assert cleaned_op.work_h == 4.0

    def test_op_no_compatible_machine_dropped(self):
        op = _make_op(20, codigo="UNKNOWN_CODE", recurso=None)
        data = MolditEngineData(
            operacoes=[op],
            maquinas=[],
            compatibilidade={},  # no compat for UNKNOWN_CODE
        )
        config = _make_config()
        result = validate_input(data, config)
        assert 20 in result.dropped_ops

    def test_progress_clamped(self):
        op = _make_op(30, progresso=150.0)
        data = MolditEngineData(
            operacoes=[op],
            maquinas=[Maquina(id="FE16-Zayer", grupo="Desbaste")],
            compatibilidade={"FE010": ["FE16-Zayer"]},
        )
        config = _make_config()
        result = validate_input(data, config)
        cleaned_op = result.cleaned.operacoes[0]
        assert cleaned_op.progresso == 100.0
        assert cleaned_op.work_restante_h == 0.0

    def test_clean_data_passes(self):
        op = _make_op(40, recurso="FE16-Zayer")
        data = MolditEngineData(
            operacoes=[op],
            maquinas=[Maquina(id="FE16-Zayer", grupo="Desbaste")],
            compatibilidade={"FE010": ["FE16-Zayer"]},
        )
        config = _make_config()
        result = validate_input(data, config)
        assert result.is_clean
        assert len(result.issues) == 0
        assert len(result.dropped_ops) == 0
