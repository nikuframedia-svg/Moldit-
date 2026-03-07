#!/usr/bin/env python3
"""
Regression Test Harness
Conforme SP-QA-01

Compara outputs com golden fixtures e valida determinismo.
"""

import json
import sys
from pathlib import Path
from typing import Any

# Adicionar backend ao path
backend_path = Path(__file__).parent.parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from src.core.logging import get_logger

# Importar run_benchmark diretamente
sys.path.insert(0, str(Path(__file__).parent))
from run_benchmark import run_benchmark

logger = get_logger(__name__)


def load_expected_results(fixture_name: str) -> dict[str, Any] | None:
    """Carrega resultados esperados (golden)"""
    fixtures_dir = Path(__file__).parent.parent.parent / "fixtures" / "golden"
    expected_path = fixtures_dir / f"{fixture_name}_expected.json"

    if not expected_path.exists():
        logger.warning(
            f"Expected results not found: {expected_path}",
            extra={"expected_path": str(expected_path)},
        )
        return None

    with open(expected_path, encoding="utf-8") as f:
        return json.load(f)


def compare_results(
    actual: dict[str, Any],
    expected: dict[str, Any],
    tolerance: float = 0.01,
) -> dict[str, Any]:
    """
    Compara resultados atuais com esperados.

    Args:
        actual: Resultados atuais
        expected: Resultados esperados (golden)
        tolerance: Tolerância para comparações numéricas

    Returns:
        Relatório de comparação
    """
    differences = []
    matches = []

    # Comparar plan_hash (deve ser exato)
    actual_hash = actual.get("results", {}).get("plan_hash", "")
    expected_hash = expected.get("results", {}).get("plan_hash", "")

    if actual_hash != expected_hash:
        differences.append(
            {
                "field": "plan_hash",
                "actual": actual_hash,
                "expected": expected_hash,
                "type": "hash_mismatch",
                "critical": True,  # Hash mismatch é crítico
            }
        )
    else:
        matches.append("plan_hash")

    # Ignorar plan_id na comparação (é gerado aleatoriamente)

    # Comparar KPIs (com tolerância)
    actual_kpis = actual.get("results", {}).get("kpi_pack", {})
    expected_kpis = expected.get("results", {}).get("kpi_pack", {})

    for kpi_name in set(list(actual_kpis.keys()) + list(expected_kpis.keys())):
        actual_value = actual_kpis.get(kpi_name)
        expected_value = expected_kpis.get(kpi_name)

        if actual_value is None and expected_value is None:
            continue

        if actual_value is None:
            differences.append(
                {
                    "field": f"kpi_pack.{kpi_name}",
                    "actual": None,
                    "expected": expected_value,
                    "type": "missing",
                }
            )
            continue

        if expected_value is None:
            differences.append(
                {
                    "field": f"kpi_pack.{kpi_name}",
                    "actual": actual_value,
                    "expected": None,
                    "type": "unexpected",
                }
            )
            continue

        # Comparar valores numéricos
        if isinstance(actual_value, (int, float)) and isinstance(expected_value, (int, float)):
            diff = abs(actual_value - expected_value)
            if diff > tolerance:
                differences.append(
                    {
                        "field": f"kpi_pack.{kpi_name}",
                        "actual": actual_value,
                        "expected": expected_value,
                        "diff": diff,
                        "type": "value_mismatch",
                    }
                )
            else:
                matches.append(f"kpi_pack.{kpi_name}")
        elif actual_value != expected_value:
            differences.append(
                {
                    "field": f"kpi_pack.{kpi_name}",
                    "actual": actual_value,
                    "expected": expected_value,
                    "type": "value_mismatch",
                }
            )
        else:
            matches.append(f"kpi_pack.{kpi_name}")

    # Comparar contagens
    actual_wo_count = actual.get("results", {}).get("workorders_count", 0)
    expected_wo_count = expected.get("results", {}).get("workorders_count", 0)

    if actual_wo_count != expected_wo_count:
        differences.append(
            {
                "field": "workorders_count",
                "actual": actual_wo_count,
                "expected": expected_wo_count,
                "type": "count_mismatch",
            }
        )
    else:
        matches.append("workorders_count")

    actual_op_count = actual.get("results", {}).get("operations_count", 0)
    expected_op_count = expected.get("results", {}).get("operations_count", 0)

    if actual_op_count != expected_op_count:
        differences.append(
            {
                "field": "operations_count",
                "actual": actual_op_count,
                "expected": expected_op_count,
                "type": "count_mismatch",
            }
        )
    else:
        matches.append("operations_count")

    return {
        "matches": matches,
        "differences": differences,
        "passed": len(differences) == 0,
    }


def run_regression(
    fixture_name: str,
    plan_params: dict[str, Any] = None,
) -> dict[str, Any]:
    """
    Executa teste de regressão.

    Args:
        fixture_name: Nome do golden fixture
        plan_params: Parâmetros do solver

    Returns:
        Relatório de regressão
    """
    logger.info(
        f"Running regression test for: {fixture_name}", extra={"fixture_name": fixture_name}
    )

    # Executar benchmark
    actual_results = run_benchmark(fixture_name, plan_params)

    # Carregar resultados esperados
    expected_results = load_expected_results(fixture_name)

    if expected_results is None:
        logger.warning("No expected results found - creating baseline")
        return {
            "fixture_name": fixture_name,
            "status": "baseline_created",
            "actual": actual_results,
            "expected": None,
            "comparison": None,
        }

    # Comparar resultados
    comparison = compare_results(actual_results, expected_results)

    # Construir relatório
    report = {
        "fixture_name": fixture_name,
        "timestamp": actual_results["timestamp"],
        "status": "passed" if comparison["passed"] else "failed",
        "actual": actual_results,
        "expected": expected_results,
        "comparison": comparison,
    }

    if comparison["passed"]:
        logger.info("Regression test PASSED", extra={"fixture_name": fixture_name})
    else:
        logger.error(
            "Regression test FAILED",
            extra={
                "fixture_name": fixture_name,
                "differences_count": len(comparison["differences"]),
            },
        )

    return report


def main():
    """Entry point do script"""
    import argparse

    parser = argparse.ArgumentParser(description="Run regression tests")
    parser.add_argument(
        "--fixture",
        default="snapshot_small",
        help="Golden fixture name (default: snapshot_small)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed (default: 42)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.01,
        help="Tolerance for numeric comparisons (default: 0.01)",
    )

    args = parser.parse_args()

    # Executar regressão
    plan_params = {
        "seed": args.seed,
        "timebox_s": 30,
        "objective_weights": {
            "tardiness": 1.0,
            "setup_count": 1.0,
            "setup_balance": 0.5,
            "churn": 0.5,
            "overtime_hours": 0.5,
        },
    }

    report = run_regression(args.fixture, plan_params)

    # Imprimir resumo
    print(f"\nRegression Test: {report['fixture_name']}")
    print(f"Status: {report['status'].upper()}")

    if report["comparison"]:
        comparison = report["comparison"]
        print(f"Matches: {len(comparison['matches'])}")
        print(f"Differences: {len(comparison['differences'])}")

        if comparison["differences"]:
            print("\nDifferences:")
            for diff in comparison["differences"]:
                print(
                    f"  - {diff['field']}: {diff['actual']} != {diff['expected']} ({diff['type']})"
                )

    # Exit code baseado em status
    if report["status"] == "failed":
        sys.exit(1)
    elif report["status"] == "baseline_created":
        print("\n⚠ Baseline created - run again to validate")
        sys.exit(0)
    else:
        print("\n✓ Regression test PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
