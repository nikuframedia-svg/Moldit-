"""Data API — Moldit Planner. Split into 4 sub-modules."""
from backend.api.data_core import router as core_router
from backend.api.data_sim import router as sim_router
from backend.api.data_exec import router as exec_router
from backend.api.data_config import router as config_router

# Re-export for backward compatibility with copilot.py imports
router = core_router
# The other routers need to be included in the app separately
