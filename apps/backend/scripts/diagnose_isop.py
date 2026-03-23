"""Diagnostic runner — parse ISOP XLSX, run scheduler with tracing, print report.

Usage:
    cd apps/backend
    python -m scripts.diagnose_isop /path/to/ISOP.xlsx
    python -m scripts.diagnose_isop /path/to/ISOP.xlsx --op OP13
    python -m scripts.diagnose_isop /path/to/ISOP.xlsx --machine PRM031
    python -m scripts.diagnose_isop /path/to/ISOP.xlsx --alerts
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from domain.nikufra.isop_parser import parse_isop_file  # noqa: E402
from domain.scheduler.diagnose import diagnose  # noqa: E402
from domain.scheduling.transform import transform_plan_state  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Scheduler diagnostic report")
    parser.add_argument("isop_path", help="Path to ISOP XLSX file")
    parser.add_argument("--op", help="Show single op trace")
    parser.add_argument("--machine", help="Show single machine detail")
    parser.add_argument("--alerts", action="store_true", help="Show only alerts")
    parser.add_argument("--json", action="store_true", dest="full_json", help="Full JSON output")
    args = parser.parse_args()

    isop_path = Path(args.isop_path)
    if not isop_path.exists():
        print(f"File not found: {isop_path}", file=sys.stderr)
        sys.exit(1)

    # Parse ISOP
    print(f"Parsing {isop_path.name}...", file=sys.stderr)
    parse_result = parse_isop_file(str(isop_path))
    plan_state = parse_result.data

    # Transform to EngineData
    print("Transforming to EngineData...", file=sys.stderr)
    engine_data = transform_plan_state(
        plan_state,
        demand_semantics="raw_np",
        order_based=True,
        pre_start_days=5,
    )

    # Run diagnosis
    print(
        f"Running scheduler ({len(engine_data.ops)} ops, {engine_data.n_days} days)...",
        file=sys.stderr,
    )
    report = diagnose(engine_data)

    # Output
    if args.full_json:
        print(json.dumps(report, indent=2, default=str))
        return

    if args.alerts:
        _print_alerts(report)
        return

    if args.op:
        _print_op(report, args.op)
        return

    if args.machine:
        _print_machine(report, args.machine)
        return

    _print_summary(report)


def _print_summary(report: dict) -> None:
    s = report["summary"]
    print(f"\n{'=' * 60}")
    print("  SCHEDULER DIAGNOSTIC REPORT")
    print(f"{'=' * 60}")
    print(
        f"  Ops: {s['n_ops']}  Machines: {s['n_machines']}  Days: {s['n_days']} ({s['workdays']} workdays)"
    )
    print(f"  Demand: {s['total_demand_pcs']:,} pcs  ({s['total_demand_min']:,.0f} min)")
    print(f"  Twins: {s['twin_groups']} groups")
    print(f"  Solve time: {s['solve_time_ms']:.0f} ms")
    print("\n  RESULT:")
    print(f"    Blocks: {s['blocks']}  Overflow: {s['overflow_blocks']} ({s['overflow_min']} min)")
    print(f"    Tardiness: {s['tardiness_min']} min  OTD-D failures: {s['otd_d_failures']}")

    gs = report.get("grid_search", {})
    if gs:
        print("\n  GRID SEARCH (25 combos):")
        b = gs.get("best", {})
        w = gs.get("worst", {})
        print(f"    Best:  k1={b.get('k1')}, k2={b.get('k2')} (metric={b.get('metric')})")
        print(f"    Worst: k1={w.get('k1')}, k2={w.get('k2')} (metric={w.get('metric')})")
        print(f"    Zero overflow: {gs.get('zero_overflow_count')}/25")

    ov = report.get("overflow_routing", {})
    if ov:
        print("\n  OVERFLOW ROUTING:")
        t1 = ov.get("tier1", {})
        if t1:
            print(
                f"    Tier 1: overflow {t1.get('overflow_before')} → {t1.get('overflow_after')} min"
            )
            if t1.get("moves"):
                print(f"      Moves: {t1['moves']}")
            if t1.get("advances"):
                print(f"      Advances: {t1['advances']}")
        t2 = ov.get("tier2", {})
        if t2:
            print(
                f"    Tier 2: tardiness {t2.get('tardiness_before')} → {t2.get('tardiness_after')} min"
            )
        t3 = ov.get("tier3", {})
        if t3:
            print(
                f"    Tier 3: best_rule={t3.get('best_rule')}, failures={t3.get('failures_after')}"
            )

    print("\n  PER MACHINE:")
    for mid, info in sorted(report.get("per_machine", {}).items()):
        print(
            f"    {mid}: {info['blocks']} blocks, {info['util_pct']}% util, "
            f"{info['setups']} setups, {info['idle_min']:.0f} min idle, "
            f"{info['overflow_min']} min overflow"
        )

    alerts = report.get("alerts", [])
    if alerts:
        print(f"\n  ALERTS ({len(alerts)}):")
        for a in alerts[:10]:
            if a["type"] == "overproduction":
                print(
                    f"    ⚠ OVERPROD {a['op_id']} ({a['sku']}): {a['produced']}/{a['demand']} = {a['ratio']}x"
                )
            elif a["type"] == "high_util":
                print(f"    ⚠ HIGH UTIL {a['machine']}: {a['util_pct']}%")
            elif a["type"] == "idle_machine":
                print(f"    ⚠ IDLE {a['machine']}: {a['util_pct']}% ({a['free_min']:.0f} min free)")

    trace = report.get("trace", [])
    if trace:
        print(f"\n  TRACE ({len(trace)} actionable entries):")
        for t in trace[:15]:
            if t["type"] == "overflow":
                print(
                    f"    OVERFLOW {t['op_id']} @ {t['machine']}: {t['overflow_min']} min — {t['reason']}"
                )
            elif t["type"] == "constraint_block":
                print(
                    f"    BLOCKED {t['op_id']} @ {t['machine']}: {t['constraint']} — {t['detail']}"
                )

    print(f"{'=' * 60}\n")


def _print_op(report: dict, op_id: str) -> None:
    op = report.get("per_op", {}).get(op_id)
    if not op:
        # Try partial match
        matches = [k for k in report.get("per_op", {}) if op_id in k]
        if matches:
            print(f"No exact match for '{op_id}'. Did you mean: {matches[:5]}")
        else:
            print(f"Op '{op_id}' not found")
        return
    print(f"\n  OP: {op_id}")
    print(json.dumps(op, indent=2, default=str))

    # Show relevant trace entries
    trace = [t for t in report.get("trace", []) if t.get("op_id") == op_id]
    if trace:
        print(f"\n  TRACE for {op_id}:")
        for t in trace:
            print(f"    {json.dumps(t, default=str)}")


def _print_machine(report: dict, mid: str) -> None:
    info = report.get("per_machine", {}).get(mid)
    if not info:
        print(f"Machine '{mid}' not found. Available: {list(report.get('per_machine', {}).keys())}")
        return
    print(f"\n  MACHINE: {mid}")
    print(json.dumps(info, indent=2, default=str))

    # Show ops on this machine
    ops_here = {k: v for k, v in report.get("per_op", {}).items() if v.get("machine") == mid}
    print(f"\n  OPS on {mid}: {len(ops_here)}")
    for op_id, op in sorted(ops_here.items(), key=lambda x: -x[1].get("demand_pcs", 0))[:10]:
        print(
            f"    {op_id} ({op['sku']}): demand={op['demand_pcs']:,} prod={op['produced_pcs']:,} "
            f"blocks={op['blocks']} tardy={op['tardy']}"
        )


def _print_alerts(report: dict) -> None:
    alerts = report.get("alerts", [])
    if not alerts:
        print("No alerts.")
        return
    print(f"\n  {len(alerts)} ALERTS:")
    for a in alerts:
        print(f"  {json.dumps(a, default=str)}")


if __name__ == "__main__":
    main()
