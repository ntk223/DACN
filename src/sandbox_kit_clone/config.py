"""Cấu hình toàn hệ thống: đọc biến môi trường với tiền tố ``SANDBOX_KIT_``.

Giá trị mặc định khớp ``.env.example``. Parse số nguyên được thực hiện an toàn:
env rỗng hoặc sai định dạng sẽ lùi về giá trị mặc định thay vì raise.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

ENV_PREFIX = "SANDBOX_KIT_"

_VALID_POLICY_MODES = ("audit", "enforce")
_VALID_PROVIDERS = ("fake", "docker")


def _env_bool(name: str, default: bool) -> bool:
    """Đọc bool từ env (1/true/yes/on); thiếu hoặc rỗng → ``default``."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _env_str(name: str, default: str) -> str:
    """Đọc chuỗi từ env; trả về ``default`` khi thiếu hoặc rỗng."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _env_int(name: str, default: int) -> int:
    """Đọc số nguyên từ env; env rỗng hoặc lỗi parse → lùi về ``default`` (không raise)."""
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    try:
        return int(value.strip())
    except ValueError:
        # Env sai định dạng: dùng giá trị mặc định thay vì làm sập tiến trình khởi động.
        return default


@dataclass(frozen=True)
class Settings:
    """Cấu hình ứng dụng. Cho phép override cho test: ``Settings(data_dir="/tmp/x")``."""

    data_dir: str = "./data"                   # gốc chứa system.sqlite, workspaces/, staging/
    inline_max_bytes: int = 3_145_728          # ~3MB: ngưỡng file lớn đi đường upload riêng
    blob_sidecar_min_bytes: int = 33_554_432   # 32MB: ngưỡng lưu thành file rời
    workspace_quota_bytes: int = 2_147_483_648  # 2GB hard quota per workspace
    policy_mode: str = "audit"                 # audit | enforce
    staging_max_age_hours: int = 24            # tự dọn staging/upload quá hạn
    host: str = "127.0.0.1"
    port: int = 8000
    api_key: str = ""                          # "" = no-auth
    provider: str = "fake"                     # fake | docker
    sandbox_image: str = "sandbox-kit/sandbox:w2"  # image sandbox (make image)
    sandbox_network: bool = True               # False → container không ra mạng
    fake_exec_host: bool = False               # fake: chạy lệnh THẬT trên host (dev/test, không cô lập)
    command_timeout_default: int = 120         # giây
    command_timeout_max: int = 600             # giây
    command_output_max_bytes: int = 1_048_576  # mỗi luồng stdout/stderr, giữ phần cuối
    agent_ready_timeout: int = 90              # giây chờ trình thực thi sẵn sàng (§5.5)

    def __post_init__(self) -> None:
        if self.policy_mode not in _VALID_POLICY_MODES:
            raise ValueError(
                f"policy_mode phải là một trong {_VALID_POLICY_MODES}, "
                f"nhận được: {self.policy_mode!r}"
            )
        if self.provider not in _VALID_PROVIDERS:
            raise ValueError(
                f"provider phải là một trong {_VALID_PROVIDERS}, nhận được: {self.provider!r}"
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Đọc cấu hình từ biến môi trường (cache 1 kết quả trong tiến trình)."""
    return Settings(
        data_dir=_env_str(f"{ENV_PREFIX}DATA_DIR", "./data"),
        inline_max_bytes=_env_int(f"{ENV_PREFIX}INLINE_MAX_BYTES", 3_145_728),
        blob_sidecar_min_bytes=_env_int(f"{ENV_PREFIX}BLOB_SIDECAR_MIN_BYTES", 33_554_432),
        workspace_quota_bytes=_env_int(f"{ENV_PREFIX}WORKSPACE_QUOTA_BYTES", 2_147_483_648),
        policy_mode=_env_str(f"{ENV_PREFIX}POLICY_MODE", "audit"),
        staging_max_age_hours=_env_int(f"{ENV_PREFIX}STAGING_MAX_AGE_HOURS", 24),
        host=_env_str(f"{ENV_PREFIX}HOST", "127.0.0.1"),
        port=_env_int(f"{ENV_PREFIX}PORT", 8000),
        api_key=_env_str(f"{ENV_PREFIX}API_KEY", ""),
        provider=_env_str(f"{ENV_PREFIX}PROVIDER", "fake"),
        sandbox_image=_env_str(f"{ENV_PREFIX}SANDBOX_IMAGE", "sandbox-kit/sandbox:w2"),
        sandbox_network=_env_bool(f"{ENV_PREFIX}SANDBOX_NETWORK", True),
        fake_exec_host=_env_bool(f"{ENV_PREFIX}FAKE_EXEC_HOST", False),
        command_timeout_default=_env_int(f"{ENV_PREFIX}COMMAND_TIMEOUT_DEFAULT", 120),
        command_timeout_max=_env_int(f"{ENV_PREFIX}COMMAND_TIMEOUT_MAX", 600),
        command_output_max_bytes=_env_int(f"{ENV_PREFIX}COMMAND_OUTPUT_MAX_BYTES", 1_048_576),
        agent_ready_timeout=_env_int(f"{ENV_PREFIX}AGENT_READY_TIMEOUT", 90),
    )
