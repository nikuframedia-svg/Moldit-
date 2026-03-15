# AddCircuit-based setup sequencing
# Implements sequence-dependent setup times using CP-SAT's AddCircuit constraint.
# Same tool consecutive → zero setup. Different tool → setup from matrix or default.

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model


def add_machine_circuit(
    model: cp_model.CpModel,
    machine_id: str,
    jobs: list[dict],
    start_vars: dict[str, cp_model.IntVar],
    end_vars: dict[str, cp_model.IntVar],
    prod_durations: dict[str, int],
    setup_matrix: dict[str, dict[str, int]] | None,
    default_setup: int = 45,
    tool_default_setups: dict[str, int] | None = None,
    horizon: int = 10000,
) -> tuple[list[tuple], list[cp_model.IntervalVar]]:
    """Build a Hamiltonian circuit for one machine, encoding setup sequencing.

    Node 0 = depot (dummy start/end).
    Nodes 1..N = jobs on this machine.

    For arc (i → j):
      - Same tool: start[j] >= end[i] (zero setup)
      - Different tool: start[j] >= end[i] + setup_time(tool_j)

    Returns:
        (setup_arcs, setup_intervals)
        - setup_arcs: list of (arc_lit, setup_dur, machine_id) for active changeovers
        - setup_intervals: list of optional IntervalVar for SetupCrew NoOverlap
    """
    n = len(jobs)
    if n == 0:
        return [], []

    # Build per-tool default setups from job data
    _tool_defaults: dict[str, int] = {}
    for j in jobs:
        if j["tool"] not in _tool_defaults:
            _tool_defaults[j["tool"]] = j.get("setup_default", default_setup)

    if n == 1:
        # Single job: self-loop, no circuit needed.
        # Still needs its own setup (first job on machine always pays setup).
        job = jobs[0]
        jid = job["job_id"]
        setup_dur = _get_setup(None, job["tool"], setup_matrix, default_setup, _tool_defaults)
        setup_arcs: list[tuple] = []
        setup_intervals: list[cp_model.IntervalVar] = []
        if setup_dur > 0:
            model.Add(end_vars[jid] == start_vars[jid] + prod_durations[jid] + setup_dur)
            # Create setup interval for SetupCrew constraint
            ss = model.new_int_var(0, horizon, f"ss_{machine_id}_single")
            model.Add(ss == start_vars[jid])
            siv = model.new_interval_var(ss, setup_dur, ss + setup_dur, f"siv_{machine_id}_single")
            setup_intervals.append(siv)
            setup_arcs.append((None, setup_dur, machine_id))
        else:
            model.Add(end_vars[jid] == start_vars[jid] + prod_durations[jid])
        return setup_arcs, setup_intervals

    # Build circuit arcs
    arcs: list[tuple[int, int, cp_model.IntVar]] = []
    setup_arcs: list[tuple] = []
    setup_intervals: list[cp_model.IntervalVar] = []

    for i in range(n + 1):  # 0 = depot
        for j in range(n + 1):
            if i == j:
                continue

            lit = model.new_bool_var(f"arc_{machine_id}_{i}_{j}")
            arcs.append((i, j, lit))

            if i == 0:
                # Depot → first job: first job always pays its own setup
                job_j = jobs[j - 1]
                jid_j = job_j["job_id"]
                setup_dur = _get_setup(
                    None, job_j["tool"], setup_matrix, default_setup, _tool_defaults
                )
                if setup_dur > 0:
                    # start[j] is free, but end[j] = start[j] + setup + prod
                    model.Add(
                        end_vars[jid_j] >= start_vars[jid_j] + prod_durations[jid_j] + setup_dur
                    ).only_enforce_if(lit)
                    # Create setup interval for crew constraint
                    ss = model.new_int_var(0, horizon, f"ss_{machine_id}_depot_{j}")
                    model.Add(ss == start_vars[jid_j]).only_enforce_if(lit)
                    siv = model.new_optional_interval_var(
                        ss, setup_dur, ss + setup_dur, lit, f"siv_{machine_id}_depot_{j}"
                    )
                    setup_intervals.append(siv)
                    setup_arcs.append((lit, setup_dur, machine_id))
                else:
                    model.Add(
                        end_vars[jid_j] >= start_vars[jid_j] + prod_durations[jid_j]
                    ).only_enforce_if(lit)
                continue

            if j == 0:
                # Last job → depot: no constraint needed
                continue

            job_i = jobs[i - 1]
            job_j = jobs[j - 1]
            jid_i = job_i["job_id"]
            jid_j = job_j["job_id"]

            if job_i["tool"] == job_j["tool"]:
                # SAME tool → zero setup, just sequence
                model.Add(start_vars[jid_j] >= end_vars[jid_i]).only_enforce_if(lit)
                model.Add(
                    end_vars[jid_j] >= start_vars[jid_j] + prod_durations[jid_j]
                ).only_enforce_if(lit)
            else:
                # DIFFERENT tool → setup required
                setup_dur = _get_setup(
                    job_i["tool"], job_j["tool"], setup_matrix, default_setup, _tool_defaults
                )
                model.Add(start_vars[jid_j] >= end_vars[jid_i] + setup_dur).only_enforce_if(lit)
                model.Add(
                    end_vars[jid_j] >= start_vars[jid_j] + prod_durations[jid_j]
                ).only_enforce_if(lit)

                # Create optional setup interval for SetupCrew
                ss = model.new_int_var(0, horizon, f"ss_{machine_id}_{i}_{j}")
                model.Add(ss == end_vars[jid_i]).only_enforce_if(lit)
                siv = model.new_optional_interval_var(
                    ss, setup_dur, ss + setup_dur, lit, f"siv_{machine_id}_{i}_{j}"
                )
                setup_intervals.append(siv)
                setup_arcs.append((lit, setup_dur, machine_id))

    model.add_circuit(arcs)
    return setup_arcs, setup_intervals


def group_jobs_by_machine(
    all_ops: list[tuple],
) -> dict[str, list[dict]]:
    """Group operations by machine for circuit construction.

    Args:
        all_ops: list of (job, op) tuples from SolverRequest

    Returns:
        dict of machine_id → list of job dicts with job_id, tool, op fields
    """
    by_machine: dict[str, list[dict]] = defaultdict(list)
    for job, op in all_ops:
        by_machine[op.machine_id].append(
            {
                "job_id": op.id,
                "tool": op.tool_id,
                "duration": op.duration_min,
                "setup_default": op.setup_min,
            }
        )
    return dict(by_machine)


def _get_setup(
    from_tool: str | None,
    to_tool: str,
    setup_matrix: dict[str, dict[str, int]] | None,
    default: int,
    tool_default_setups: dict[str, int] | None = None,
) -> int:
    """Get setup time from matrix, per-tool default, or global default.

    from_tool=None means first job (depot), uses setup for the target tool.
    Same tool → 0. Different tool → matrix lookup or default.
    """
    if from_tool is not None and from_tool == to_tool:
        return 0

    if setup_matrix and from_tool and from_tool in setup_matrix:
        return setup_matrix[from_tool].get(to_tool, default)

    # Use per-tool default if available (from op.setup_min)
    if tool_default_setups and to_tool in tool_default_setups:
        return tool_default_setups[to_tool]

    return default
