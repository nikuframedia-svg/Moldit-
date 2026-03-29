"""Tests for Moldit core types."""
from backend.types import Dependencia, Molde, MolditEngineData, Operacao


class TestOperacao:
    def test_basic_creation(self):
        op = Operacao(
            id=1, molde="2947", componente="Cavidade",
            nome="Desbaste 3D", codigo="FE010",
            nome_completo="2947 > Cavidade > Desbaste 3D",
            duracao_h=12.0, work_h=12.0,
            progresso=0.0, work_restante_h=12.0,
        )
        assert op.id == 1
        assert op.molde == "2947"
        assert op.duracao_h == 12.0

    def test_work_restante(self):
        op = Operacao(
            id=2, molde="2947", componente="Bucha",
            nome="Acabamento", codigo="FE020",
            nome_completo="2947 > Bucha > Acabamento",
            duracao_h=8.0, work_h=8.0,
            progresso=50.0, work_restante_h=4.0,
        )
        assert op.work_restante_h == 4.0
        assert op.progresso == 50.0

    def test_condicional_flag(self):
        op = Operacao(
            id=3, molde="2947", componente="Cavidade",
            nome="Textura", codigo="TX001",
            nome_completo="2947 > Cavidade > Textura",
            duracao_h=6.0, work_h=6.0,
            progresso=0.0, work_restante_h=6.0,
            e_condicional=True, recurso="?",
        )
        assert op.e_condicional is True
        assert op.recurso == "?"


class TestMolde:
    def test_basic_creation(self):
        m = Molde(id="2947", cliente="AutoCo", deadline="2026-06-15")
        assert m.id == "2947"
        assert m.componentes == []

    def test_progresso(self):
        m = Molde(
            id="2950", cliente="PartsCo", deadline="2026-07-01",
            total_ops=10, ops_concluidas=3, progresso=30.0,
        )
        assert m.progresso == 30.0
        assert m.total_ops == 10


class TestMolditEngineData:
    def test_empty_creation(self):
        data = MolditEngineData()
        assert data.operacoes == []
        assert data.maquinas == []
        assert data.moldes == []
        assert data.dependencias == []
        assert data.dag == {}
        assert data.caminho_critico == []

    def test_dag_structure(self):
        ops = [
            Operacao(
                id=i, molde="2947", componente="C",
                nome=f"Op{i}", codigo="FE010",
                nome_completo=f"Op{i}",
                duracao_h=4.0, work_h=4.0,
                progresso=0.0, work_restante_h=4.0,
            )
            for i in range(1, 4)
        ]
        deps = [
            Dependencia(predecessor_id=1, sucessor_id=2),
            Dependencia(predecessor_id=2, sucessor_id=3),
        ]
        data = MolditEngineData(
            operacoes=ops,
            dependencias=deps,
            dag={1: [2], 2: [3]},
            dag_reverso={2: [1], 3: [2]},
        )
        assert data.dag[1] == [2]
        assert data.dag_reverso[3] == [2]
        assert len(data.dependencias) == 2
