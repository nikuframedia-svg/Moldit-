# Configuration
# Conforme SP-BE-01

from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    app_name: str = "PP1 Backend"
    app_version: str = "0.1.0"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False

    # API
    api_version: str = "v1"
    api_prefix: str = "/v1"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Database (placeholder - será configurado em SP-BE-02)
    database_url: str = "postgresql://user:password@localhost:5432/pp1"

    # Logging
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "json"

    # Nikufra data directory (ISOP XLSX + PP PDFs)
    nikufra_data_dir: str = "data/nikufra"

    # Security
    expose_stack_traces: bool = False  # Nunca expor em produção

    model_config = {
        "env_file": ".env",
        "case_sensitive": False,
    }


settings = Settings()
