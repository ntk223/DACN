"""Chọn provider theo cấu hình (mcp-integration §3.5) — giá trị lạ đã bị chặn ở ``Settings``."""

from __future__ import annotations

from pathlib import Path

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.providers.base import SandboxProvider


def get_provider(settings: Settings) -> SandboxProvider:
    """``fake`` → bộ giả lập trong ``data/fake-sandboxes``; ``docker`` → Docker daemon.

    Docker không kết nối được → ``AppError(provider_unavailable)`` ngay lúc khởi động
    (fail-fast, không lặng lẽ lùi về fake).
    """
    if settings.provider == "docker":
        from sandbox_kit_clone.providers.docker import DockerProvider

        return DockerProvider(image=settings.sandbox_image, network=settings.sandbox_network)
    from sandbox_kit_clone.providers.fake import FakeProvider

    return FakeProvider(
        base_dir=Path(settings.data_dir) / "fake-sandboxes", exec_host=settings.fake_exec_host
    )
