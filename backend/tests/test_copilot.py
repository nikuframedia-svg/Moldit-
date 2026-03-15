"""Tests for copilot tools — Contract C-06.

Tests tool execution directly (no OpenAI API needed).
"""

from __future__ import annotations

import json
from datetime import date

from src.api.state import app_state
from src.copilot.engine import execute_tool
from src.copilot.prompts import build_system_prompt
from src.copilot.tools import TOOLS
from src.engine.models import SKU, ISOPData, Order

# ─── Helpers ─────────────────────────────────────────────────────────────────


def _setup_state():
    """Load minimal synthetic state for copilot tests."""
    orders = [
        Order(
            sku="262", client_code="C1", client_name="Client1",
            qty=1000, deadline=date(2026, 3, 5), tool="T1", machine="PRM019",
            pieces_per_hour=500, operators=1, economic_lot=0, twin_ref=None,
        ),
        Order(
            sku="170", client_code="C1", client_name="Client1",
            qty=2000, deadline=date(2026, 3, 8), tool="T1", machine="PRM031",
            pieces_per_hour=400, operators=1, economic_lot=0, twin_ref=None,
        ),
    ]
    isop = ISOPData(
        skus={
            "262": SKU(
                sku="262", designation="Ref 262", machine="PRM019", tool="T1",
                pieces_per_hour=500, operators=1, economic_lot=0, twin_ref=None,
                stock=500, atraso=0, orders=[orders[0]], clients=["C1"],
            ),
            "170": SKU(
                sku="170", designation="Ref 170", machine="PRM031", tool="T1",
                pieces_per_hour=400, operators=1, economic_lot=0, twin_ref=None,
                stock=0, atraso=-100, orders=[orders[1]], clients=["C1"],
            ),
        },
        orders=orders,
        machines=["PRM019", "PRM031"],
        tools=["T1"],
        twin_pairs=[],
        date_range=(date(2026, 3, 1), date(2026, 3, 15)),
        workdays=[date(2026, 3, d) for d in range(2, 14) if date(2026, 3, d).weekday() < 5],
    )

    from src.engine.alerts import compute_alerts
    from src.engine.transform import run_pipeline

    gantt = run_pipeline(isop, today=date(2026, 3, 1))
    alerts = compute_alerts(isop, date(2026, 3, 1))

    app_state.isop_data = isop
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]
    # Reset rules
    config = app_state.get_config()
    config["rules"] = []
    app_state.set_config(config)


# ─── Tests ───────────────────────────────────────────────────────────────────


def test_tools_schema():
    """All 10 tools have valid OpenAI function schema."""
    assert len(TOOLS) == 10
    for tool in TOOLS:
        assert tool["type"] == "function"
        assert "name" in tool["function"]
        assert "description" in tool["function"]
        assert "parameters" in tool["function"]


def test_explicar_referencia():
    _setup_state()
    result = json.loads(execute_tool("explicar_referencia", '{"sku": "262"}'))
    assert result["sku"] == "262"
    assert result["stock"] == 500
    assert result["encomendas"] == 1


def test_explicar_referencia_not_found():
    _setup_state()
    result = json.loads(execute_tool("explicar_referencia", '{"sku": "NONEXISTENT"}'))
    assert "error" in result


def test_ver_alertas():
    _setup_state()
    result = json.loads(execute_tool("ver_alertas", '{"severity": "all"}'))
    assert "alertas" in result
    assert "total" in result


def test_ver_carga_maquinas():
    _setup_state()
    result = json.loads(execute_tool("ver_carga_maquinas", "{}"))
    assert "máquinas" in result


def test_adicionar_regra():
    _setup_state()
    args = json.dumps({
        "id": "test_copilot_rule",
        "name": "Regra de teste",
        "condition_type": "sku_in_list",
        "condition_params": {"skus": ["262", "170"]},
        "action_type": "move_to_machine",
        "action_params": {"machine": "PRM019"},
    })
    result = json.loads(execute_tool("adicionar_regra", args))
    assert result["status"] == "ok"

    # Verify rule was added
    rules = app_state.get_rules()
    assert any(r["id"] == "test_copilot_rule" for r in rules)


def test_adicionar_regra_duplicate():
    _setup_state()
    args = json.dumps({
        "id": "dup_rule", "name": "Dup", "condition_type": "sku_equals", "action_type": "alert",
    })
    execute_tool("adicionar_regra", args)
    result = json.loads(execute_tool("adicionar_regra", args))
    assert "error" in result


def test_remover_regra():
    _setup_state()
    # Add then remove
    args = json.dumps({
        "id": "to_remove", "name": "Remove me", "condition_type": "sku_equals", "action_type": "alert",
    })
    execute_tool("adicionar_regra", args)
    result = json.loads(execute_tool("remover_regra", '{"id": "to_remove"}'))
    assert result["status"] == "ok"


def test_agrupar_material():
    """Francisco F3: 'agrupa 262 e 170 na PRM019' -> rule created."""
    _setup_state()
    args = json.dumps({
        "sku_list": ["262", "170"],
        "machine_id": "PRM019",
        "reason": "matéria-prima comum",
    })
    result = json.loads(execute_tool("agrupar_material", args))
    assert result["status"] == "ok"
    assert "rule_id" in result


def test_recalcular_plano():
    _setup_state()
    result = json.loads(execute_tool("recalcular_plano", "{}"))
    assert result["status"] == "ok"
    assert "jobs" in result


def test_sugerir_melhorias():
    _setup_state()
    result = json.loads(execute_tool("sugerir_melhorias", '{"focus": "all"}'))
    assert "sugestões" in result
    assert len(result["sugestões"]) > 0


def test_system_prompt_dynamic():
    _setup_state()
    prompt = build_system_prompt()
    assert "Incompol" in prompt
    assert "ESTADO ACTUAL" in prompt
    assert "DADOS ISOP" in prompt


def test_unknown_tool():
    result = json.loads(execute_tool("nonexistent_tool", "{}"))
    assert "error" in result


def test_copilot_tools_endpoint(client):
    """GET /api/copilot/tools returns tool list."""
    r = client.get("/api/copilot/tools")
    assert r.status_code == 200
    data = r.json()
    assert len(data["tools"]) == 10
    names = [t["name"] for t in data["tools"]]
    assert "adicionar_regra" in names
    assert "recalcular_plano" in names


def test_copilot_chat_no_api_key(client):
    """POST /api/copilot/chat returns 503 without API key."""
    r = client.post("/api/copilot/chat", json={
        "messages": [{"role": "user", "content": "olá"}],
    })
    assert r.status_code == 503
