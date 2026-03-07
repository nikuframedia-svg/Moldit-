# API v1

from fastapi import APIRouter

from .audit import audit_router
from .events import router as events_router
from .health import router as health_router
from .metrics import metrics_router
from .nikufra import nikufra_router
from .plan import router as plan_router
from .snapshots import router as snapshots_router
from .version import router as version_router

# Router principal para v1
router = APIRouter(prefix="/v1")

# Incluir sub-routers
router.include_router(health_router)
router.include_router(version_router)
router.include_router(snapshots_router)
router.include_router(plan_router)
router.include_router(events_router)
router.include_router(metrics_router)
router.include_router(audit_router)
router.include_router(nikufra_router)
