"""Generate a small .mpp test fixture via MPXJ (Java bridge).

Produces data/test_fixture.mpp with 2 moldes, ~10 operations, basic FS deps.
Requires: jpype1, mpxj.
"""

from __future__ import annotations

import datetime
import sys
from pathlib import Path

# Ensure project root on sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def create_test_fixture(out_path: str | None = None) -> Path:
    """Create a minimal .mpp file for testing the upload flow."""
    import jpype
    import mpxj

    if not jpype.isJVMStarted():
        jpype.startJVM()

    from net.sf.mpxj import (  # type: ignore[import-untyped]
        ProjectFile,
        TaskField,
        Duration,
        TimeUnit,
        RelationType,
    )
    from net.sf.mpxj.writer import UniversalProjectWriter  # type: ignore[import-untyped]

    project = ProjectFile()
    props = project.getProjectProperties()
    props.setProjectTitle("Moldit Test Fixture")

    # Create two summary tasks (moldes)
    molde1 = project.addTask()
    molde1.setName("M9901 - Test Mold A")
    molde1.setStart(datetime.datetime(2026, 4, 1, 8, 0))

    molde2 = project.addTask()
    molde2.setName("M9902 - Test Mold B")
    molde2.setStart(datetime.datetime(2026, 4, 1, 8, 0))

    # Ops for molde 1
    ops_m1 = []
    for i, (name, code, hours, resource) in enumerate([
        ("Desbaste Cavidade", "CN001", 16.0, "CNC_G01"),
        ("Acabamento Cavidade", "CN002", 12.0, "CNC_G01"),
        ("Erosao Cavidade", "ED001", 8.0, "EDM_G01"),
        ("Furacao Cavidade", "FU001", 4.0, "FUR_G01"),
        ("Bancada Cavidade", "BA001", 6.0, "BAN_G01"),
    ]):
        task = molde1.addTask()
        task.setName(name)
        task.setDuration(Duration.getInstance(hours, TimeUnit.HOURS))
        task.setText(1, code)       # operation code in Text1
        task.setText(2, resource)   # resource assignment in Text2
        task.setPercentageComplete(java.lang.Double(0.0))  # noqa: F821
        ops_m1.append(task)

    # FS deps within molde 1
    for j in range(1, len(ops_m1)):
        ops_m1[j].addPredecessor(
            ops_m1[j - 1], RelationType.FINISH_START, Duration.getInstance(0, TimeUnit.HOURS)
        )

    # Ops for molde 2
    ops_m2 = []
    for i, (name, code, hours, resource) in enumerate([
        ("Desbaste Bucha", "CN001", 10.0, "CNC_G02"),
        ("Acabamento Bucha", "CN002", 8.0, "CNC_G02"),
        ("Polimento Bucha", "PO001", 3.0, "POL_G01"),
        ("Tapagem Bucha", "TA001", 2.0, "TAP_G01"),
        ("Montagem Final", "BA002", 5.0, "BAN_G01"),
    ]):
        task = molde2.addTask()
        task.setName(name)
        task.setDuration(Duration.getInstance(hours, TimeUnit.HOURS))
        task.setText(1, code)
        task.setText(2, resource)
        task.setPercentageComplete(java.lang.Double(0.0))  # noqa: F821
        ops_m2.append(task)

    for j in range(1, len(ops_m2)):
        ops_m2[j].addPredecessor(
            ops_m2[j - 1], RelationType.FINISH_START, Duration.getInstance(0, TimeUnit.HOURS)
        )

    # Write the file
    dest = Path(out_path) if out_path else ROOT / "data" / "test_fixture.mpp"
    dest.parent.mkdir(parents=True, exist_ok=True)

    writer = UniversalProjectWriter()
    writer.write(project, str(dest))

    print(f"Created test fixture: {dest}  ({dest.stat().st_size} bytes)")
    return dest


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else None
    create_test_fixture(out)
