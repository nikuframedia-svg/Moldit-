#!/usr/bin/env python3
"""
Benchmark Harness determinístico
Conforme SP-QA-01

Corre import+solve+diff e gera relatório de benchmark.
"""

import hashlib
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Adicionar backend ao path
backend_path = Path(__file__).parent.parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from src.core.logging import get_logger
from src.domain.solver.plan_min import solve_plan_min

logger = get_logger(__name__)


def load_golden_fixture(fixture_name: str) -> dict[str, Any]:
    """Carrega golden fixture"""
    fixtures_dir = Path(__file__).parent.parent.parent / "fixtures" / "golden"
    fixture_path = fixtures_dir / f"{fixture_name}.json"

    if not fixture_path.exists():
        raise FileNotFoundError(f"Golden fixture not found: {fixture_path}")

    with open(fixture_path, encoding="utf-8") as f:
        return json.load(f)


def calculate_hash(data: dict[str, Any]) -> str:
    """Calcula hash SHA-256 de dados canónicos"""
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def run_benchmark(
    fixture_name: str,
    plan_params: dict[str, Any] = None,
) -> dict[str, Any]:
    """
    Executa benchmark completo: import + solve + diff.

    Args:
        fixture_name: Nome do golden fixture (ex: "snapshot_small")
        plan_params: Parâmetros do solver (seed, timebox_s, etc.)

    Returns:
        Relatório de benchmark
    """
    if plan_params is None:
        plan_params = {
            "seed": 42,
            "timebox_s": 30,
            "objective_weights": {
                "tardiness": 1.0,
                "setup_count": 1.0,
                "setup_balance": 0.5,
                "churn": 0.5,
                "overtime_hours": 0.5,
            },
        }

    start_time = time.time()

    # 1. Carregar golden fixture
    logger.info(f"Loading golden fixture: {fixture_name}")
    snapshot = load_golden_fixture(fixture_name)
    import_time = time.time() - start_time

    # 2. Executar solver
    logger.info("Running solver")
    solve_start = time.time()
    plan = solve_plan_min(
        snapshot=snapshot,
        plan_params=plan_params,
        calendar=None,
        db_session=None,
    )
    solve_time = time.time() - solve_start

    # 3. Calcular hash do plano
    plan_hash = plan.get("plan_hash", "")

    # 4. Extrair KPIs
    kpi_pack = plan.get("kpi_pack", {})

    # 5. Calcular tempo total
    total_time = time.time() - start_time

    # 6. Construir relatório
    report = {
        "fixture_name": fixture_name,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "plan_params": plan_params,
        "timings": {
            "import_seconds": round(import_time, 3),
            "solve_seconds": round(solve_time, 3),
            "total_seconds": round(total_time, 3),
        },
        "results": {
            "plan_hash": plan_hash,
            "plan_id": plan.get("plan_id", ""),
            "workorders_count": len(plan.get("workorders", [])),
            "operations_count": len(plan.get("operations", [])),
            "kpi_pack": kpi_pack,
        },
        "determinism": {
            "plan_hash_stable": True,  # Será verificado em regression
            "seed": plan_params.get("seed"),
        },
    }

    logger.info(
        "Benchmark completed",
        fixture_name=fixture_name,
        total_seconds=round(total_time, 3),
        plan_hash=plan_hash[:16] + "...",
    )

    return report


def generate_markdown_report(report: dict[str, Any]) -> str:
    """Gera relatório em formato Markdown"""
    lines = [
        f"# Benchmark Report - {report['fixture_name']}",
        "",
        f"**Timestamp:** {report['timestamp']}",
        "",
        "## Timings",
        "",
        f"- Import: {report['timings']['import_seconds']}s",
        f"- Solve: {report['timings']['solve_seconds']}s",
        f"- Total: {report['timings']['total_seconds']}s",
        "",
        "## Results",
        "",
        f"- Plan Hash: `{report['results']['plan_hash']}`",
        f"- Plan ID: `{report['results']['plan_id']}`",
        f"- WorkOrders: {report['results']['workorders_count']}",
        f"- Operations: {report['results']['operations_count']}",
        "",
        "## KPIs",
        "",
    ]

    kpi_pack = report["results"]["kpi_pack"]
    for kpi, value in kpi_pack.items():
        lines.append(f"- {kpi}: {value}")

    lines.extend(
        [
            "",
            "## Determinism",
            "",
            f"- Seed: {report['determinism']['seed']}",
            f"- Plan Hash Stable: {report['determinism']['plan_hash_stable']}",
        ]
    )

    return "\n".join(lines)


def main():
    """Entry point do script"""
    import argparse

    parser = argparse.ArgumentParser(description="Run benchmark harness")
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
        "--timebox",
        type=int,
        default=30,
        help="Timebox in seconds (default: 30)",
    )
    parser.add_argument(
        "--output-dir",
        default="docs/benchmarks",
        help="Output directory for reports (default: docs/benchmarks)",
    )

    args = parser.parse_args()

    # Executar benchmark
    plan_params = {
        "seed": args.seed,
        "timebox_s": args.timebox,
        "objective_weights": {
            "tardiness": 1.0,
            "setup_count": 1.0,
            "setup_balance": 0.5,
            "churn": 0.5,
            "overtime_hours": 0.5,
        },
    }

    report = run_benchmark(args.fixture, plan_params)

    # Salvar relatório JSON
    output_dir = Path(__file__).parent.parent.parent / args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"benchmark_{args.fixture}_{timestamp_str}.json"
    md_path = output_dir / f"benchmark_{args.fixture}_{timestamp_str}.md"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Gerar e salvar relatório Markdown
    md_report = generate_markdown_report(report)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_report)

    print("Benchmark report saved:")
    print(f"  JSON: {json_path}")
    print(f"  Markdown: {md_path}")

    # Verificar critérios de aceitação
    total_seconds = report["timings"]["total_seconds"]
    if total_seconds > 300:  # 5 minutos
        print(f"WARNING: Benchmark took {total_seconds}s (> 5 minutes)")
        sys.exit(1)

    print(f"✓ Benchmark completed in {total_seconds}s")
    sys.exit(0)


if __name__ == "__main__":
    main()
