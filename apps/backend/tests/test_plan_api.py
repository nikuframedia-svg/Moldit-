# Testes para Plan API
# Conforme SP-BE-06

from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.errors import ErrorCodes
from src.domain.models.snapshot import Snapshot
from src.domain.plan.service import calculate_plan_hash, canonical_plan_json
from src.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_db_session():
    """Fixture para sessão de DB (mock)"""
    session = MagicMock(spec=Session)
    yield session
    session.close()


@pytest.fixture
def sample_snapshot():
    """Snapshot de teste"""
    return Snapshot(
        snapshot_id=uuid4(),
        tenant_id=uuid4(),
        created_at=datetime.utcnow(),
        snapshot_hash="test_snapshot_hash_1234567890123456789012345678901234567890123456789012345678901234",
        series_semantics="DEMAND_QTY_BY_DATE",
        trust_index_overall=0.9,  # AUTO_ELIGIBLE
        snapshot_json={},
    )


def test_canonical_plan_json():
    """Testa que canonical_plan_json produz sempre o mesmo resultado"""
    plan1 = {
        "plan_id": "id1",
        "created_at": "2026-01-01T00:00:00Z",
        "status": "CANDIDATE",
        "snapshot_hash": "hash1",
        "plan_params": {"timebox_s": 30, "seed": 42},
    }

    plan2 = {
        "plan_id": "id2",  # ID diferente
        "created_at": "2026-01-02T00:00:00Z",  # Data diferente
        "status": "OFFICIAL",  # Status diferente
        "snapshot_hash": "hash1",
        "plan_params": {"timebox_s": 30, "seed": 42},
    }

    json1 = canonical_plan_json(plan1)
    json2 = canonical_plan_json(plan2)

    assert json1 == json2  # Deve ser igual (campos não determinísticos excluídos)


def test_calculate_plan_hash_deterministic():
    """Testa que plan_hash é determinístico"""
    plan1 = {
        "plan_id": "id1",
        "created_at": "2026-01-01T00:00:00Z",
        "snapshot_hash": "hash1",
        "plan_params": {"timebox_s": 30, "seed": 42},
    }

    plan2 = {
        "plan_id": "id2",  # ID diferente
        "created_at": "2026-01-02T00:00:00Z",  # Data diferente
        "snapshot_hash": "hash1",
        "plan_params": {"timebox_s": 30, "seed": 42},
    }

    hash1 = calculate_plan_hash(plan1)
    hash2 = calculate_plan_hash(plan2)

    assert hash1 == hash2  # Deve ser igual
    assert len(hash1) == 64  # SHA-256 hex


def test_run_plan_endpoint_missing_params(client, mock_db_session, sample_snapshot):
    """Testa que endpoint rejeita request sem plan_params obrigatórios"""
    from src.db.base import get_db

    app.dependency_overrides[get_db] = lambda: mock_db_session

    mock_db_session.query.return_value.filter.return_value.first.return_value = sample_snapshot

    response = client.post(
        "/v1/plans/run",
        json={
            "snapshot_id": str(sample_snapshot.snapshot_id),
            "plan_params": {},  # Faltam timebox_s e seed
        },
        headers={"Idempotency-Key": str(uuid4())},
    )

    assert response.status_code == 400
    assert response.json()["code"] == ErrorCodes.ERR_PLAN_PARAMS_INVALID

    app.dependency_overrides.clear()


def test_run_plan_endpoint_invalid_snapshot_id(client):
    """Testa que endpoint rejeita snapshot_id inválido"""
    response = client.post(
        "/v1/plans/run",
        json={
            "snapshot_id": "invalid-uuid",
            "plan_params": {"timebox_s": 30, "seed": 42},
        },
        headers={"Idempotency-Key": str(uuid4())},
    )

    assert response.status_code == 400
    assert response.json()["code"] == ErrorCodes.ERR_INVALID_UUID


def test_get_plan_endpoint_not_found(client, mock_db_session):
    """Testa que endpoint retorna 404 para plan não encontrado"""
    from src.db.base import get_db

    app.dependency_overrides[get_db] = lambda: mock_db_session

    mock_db_session.query.return_value.filter.return_value.first.return_value = None

    response = client.get(f"/v1/plans/{uuid4()}")

    assert response.status_code == 404
    assert response.json()["code"] == ErrorCodes.ERR_INVALID_UUID

    app.dependency_overrides.clear()
