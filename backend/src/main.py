"""PP1 LEAN — FastAPI application."""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.alerts import router as alerts_router
from src.api.config_routes import router as config_router
from src.api.copilot import router as copilot_router
from src.api.references import router as references_router
from src.api.schedule import router as schedule_router
from src.api.solver_compat import router as solver_compat_router
from src.config import settings

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schedule_router)
app.include_router(alerts_router)
app.include_router(references_router)
app.include_router(config_router)
app.include_router(copilot_router)
app.include_router(solver_compat_router)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
