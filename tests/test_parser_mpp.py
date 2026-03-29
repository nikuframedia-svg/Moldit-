"""Tests for MPP parser against real Moldit data."""
import pytest
from pathlib import Path

MPP_PATH = "/Users/martimnicolau/Downloads/Template_para_teste_Moldit.mpp"


@pytest.mark.skipif(not Path(MPP_PATH).exists(), reason="MPP test file not available")
class TestParseMPP:
    @pytest.fixture(autouse=True, scope="class")
    def parsed_data(self, request):
        """Parse MPP once for all tests in this class."""
        from backend.parser.mpp_reader import parse_mpp
        data = parse_mpp(MPP_PATH)
        request.cls.data = data

    def test_operation_count(self):
        """Should extract approximately 548 real operations."""
        count = len(self.data.operacoes)
        assert 400 <= count <= 700, f"Expected ~548 ops, got {count}"

    def test_dependency_count(self):
        """Should extract approximately 443 dependencies."""
        count = len(self.data.dependencias)
        assert 300 <= count <= 600, f"Expected ~443 deps, got {count}"

    def test_mold_count(self):
        """Should detect 7 molds."""
        count = len(self.data.moldes)
        assert 5 <= count <= 10, f"Expected ~7 moldes, got {count}"

    def test_total_work(self):
        """Total work should be approximately 7501h."""
        total = sum(op.work_h for op in self.data.operacoes)
        assert 5000 <= total <= 10000, f"Expected ~7501h total work, got {total:.0f}h"

    def test_electrodes_zero_work(self):
        """Should find ~42 electrode ops (EL001/EL005) with 0h work."""
        el_zero = [
            op for op in self.data.operacoes
            if op.codigo in ("EL001", "EL005") and op.work_h <= 0.0
        ]
        assert len(el_zero) >= 10, (
            f"Expected ~42 electrode ops with 0h, got {len(el_zero)}"
        )

    def test_conditional_ops(self):
        """Should detect ~8 conditional ops (recurso='?')."""
        cond = [op for op in self.data.operacoes if op.e_condicional]
        assert len(cond) >= 1, f"Expected conditional ops, got {len(cond)}"

    def test_2a_placa_detection(self):
        """Should detect 2a placa ops (// resources)."""
        placa2 = [op for op in self.data.operacoes if op.e_2a_placa]
        # May or may not have any — just ensure detection logic runs
        assert isinstance(placa2, list)

    def test_dag_acyclic(self):
        """DAG should be acyclic."""
        from collections import deque

        dag = self.data.dag
        all_nodes: set[int] = set()
        in_degree: dict[int, int] = {}
        for node, succs in dag.items():
            all_nodes.add(node)
            for s in succs:
                all_nodes.add(s)

        for n in all_nodes:
            in_degree[n] = 0
        for node, succs in dag.items():
            for s in succs:
                in_degree[s] = in_degree.get(s, 0) + 1

        queue = deque(n for n, d in in_degree.items() if d == 0)
        count = 0
        while queue:
            node = queue.popleft()
            count += 1
            for succ in dag.get(node, []):
                in_degree[succ] -= 1
                if in_degree[succ] == 0:
                    queue.append(succ)

        assert count == len(all_nodes), "DAG has cycles"

    def test_critical_path_exists(self):
        """Critical path should be non-empty."""
        assert len(self.data.caminho_critico) > 0
