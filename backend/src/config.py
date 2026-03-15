from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "PP1 LEAN"
    app_version: str = "0.1.0"
    debug: bool = False

    # Paths
    isop_path: Path = Path("data/ISOP_Nikufra_27_2.xlsx")
    definitions_path: Path = Path("src/definitions/incompol.yaml")

    # OpenAI (for copilot)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # Solver
    max_solve_seconds: int = 60
    solver_seed: int = 42

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    model_config = {"env_prefix": "PP1_", "env_file": ".env"}


settings = Settings()
