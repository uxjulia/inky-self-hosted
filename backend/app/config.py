from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Inky"
    database_url: str = "sqlite:////data/inky.db"
    data_dir: Path = Path("/data")
    mounted_library_dir: Path = Path("/library")
    http_timeout_seconds: float = 30.0
    auth_username: str = ""
    auth_password: str = ""
    auth_realm: str = "Inky"

    model_config = SettingsConfigDict(env_prefix="INKY_", env_file=(".env", "../.env"), extra="ignore")

    @field_validator("data_dir", "mounted_library_dir")
    @classmethod
    def expand_user_path(cls, value: Path) -> Path:
        return value.expanduser()

    @property
    def originals_dir(self) -> Path:
        return self.data_dir / "originals"

    @property
    def optimized_dir(self) -> Path:
        return self.data_dir / "optimized"

    @property
    def imports_dir(self) -> Path:
        return self.data_dir / "imports"

    @property
    def auth_enabled(self) -> bool:
        return bool(self.auth_username and self.auth_password)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_data_dirs() -> None:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.originals_dir.mkdir(parents=True, exist_ok=True)
    settings.optimized_dir.mkdir(parents=True, exist_ok=True)
    settings.imports_dir.mkdir(parents=True, exist_ok=True)
