"""Kiểm thử W1.2: ABC SandboxProvider + FakeProvider (chạy test không cần Docker)."""

from __future__ import annotations

import pathlib
from datetime import UTC, datetime, timedelta

import pytest

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.providers.base import SandboxProvider
from sandbox_kit_clone.providers.fake import FakeProvider


class _MinimalProvider(SandboxProvider):
    """Hiện thực tối giản chỉ để kiểm tra default của các method tùy chọn trên ABC."""

    def create_sandbox(self, session_id, image, ttl_seconds, cpu=None, memory=None):
        return "fake-minimal"

    def start_sandbox(self, sandbox_id):
        pass

    def terminate_sandbox(self, sandbox_id):
        pass

    def pause_sandbox(self, sandbox_id):
        pass

    def resume_sandbox(self, sandbox_id):
        pass

    def renew_sandbox(self, sandbox_id, ttl_seconds):
        pass

    def prepare_workspace(self, session_id, host_project_path):
        return ""

    def get_dial_target(self, sandbox_id):
        return "127.0.0.1:50000"

    def list_sandboxes(self):
        return []


def _make_provider(tmp_path) -> FakeProvider:
    return FakeProvider(base_dir=tmp_path / "fake-sandboxes")


def _create(provider: FakeProvider, session_id: str = "s-1", ttl_seconds: int = 0) -> str:
    return provider.create_sandbox(session_id, "python:3.14-slim", ttl_seconds)


def test_create_then_list_and_state(tmp_path):
    provider = _make_provider(tmp_path)
    sandbox_id = _create(provider, session_id="s-1")

    assert sandbox_id.startswith("fake-")
    assert sandbox_id in provider.list_sandboxes()
    assert provider.get_sandbox_state(sandbox_id) == "running"


def test_expiry_ttl_positive(tmp_path):
    provider = _make_provider(tmp_path)
    before = datetime.now(UTC)
    sandbox_id = _create(provider, ttl_seconds=100)

    # Vừa tạo: chưa hết hạn tại mọi mốc từ trước đến trước hạn.
    assert not provider.is_expired(sandbox_id, now=before)
    # Quá hạn (hạn ≈ created_at + 100s; cho dung sai vài giây).
    assert provider.is_expired(sandbox_id, now=before + timedelta(seconds=101))


def test_ttl_non_positive_means_never_expires(tmp_path):
    provider = _make_provider(tmp_path)
    sandbox_id = _create(provider, ttl_seconds=0)

    # ttl <= 0 → "không hết hạn" (fail-safe): is_expired luôn False kể cả xa tương lai.
    assert not provider.is_expired(sandbox_id, now=datetime.now(UTC))
    assert not provider.is_expired(sandbox_id, now=datetime.now(UTC) + timedelta(days=3650))

    sandbox_id_neg = _create(provider, ttl_seconds=-5)
    assert not provider.is_expired(sandbox_id_neg, now=datetime.now(UTC) + timedelta(days=3650))


def test_pause_resume_renew_without_expiry(tmp_path):
    provider = _make_provider(tmp_path)
    sandbox_id = _create(provider, ttl_seconds=0)

    provider.pause_sandbox(sandbox_id)
    assert provider.get_sandbox_state(sandbox_id) == "paused"

    # Gia hạn khi đang "không hết hạn": giữ nguyên None, không crash.
    provider.renew_sandbox(sandbox_id, 120)
    assert not provider.is_expired(sandbox_id, now=datetime.now(UTC) + timedelta(days=3650))

    provider.resume_sandbox(sandbox_id)
    assert provider.get_sandbox_state(sandbox_id) == "running"


def test_renew_extends_expiry(tmp_path):
    provider = _make_provider(tmp_path)
    before = datetime.now(UTC)
    sandbox_id = _create(provider, ttl_seconds=100)

    # Hạn ≈ now + 100 (dung sai vài giây).
    assert not provider.is_expired(sandbox_id, now=before + timedelta(seconds=98))
    assert provider.is_expired(sandbox_id, now=before + timedelta(seconds=105))

    provider.renew_sandbox(sandbox_id, 50)

    # Hạn mới ≈ now + 150.
    assert not provider.is_expired(sandbox_id, now=before + timedelta(seconds=148))
    assert provider.is_expired(sandbox_id, now=before + timedelta(seconds=155))


def test_prepare_workspace_copies_tree_idempotent(tmp_path):
    provider = _make_provider(tmp_path)
    source = tmp_path / "project"
    (source / "pkg" / "sub").mkdir(parents=True)
    (source / "pkg" / "sub" / "deep.txt").write_text("deep")
    (source / "pkg" / "mod.py").write_text("x = 1")
    (source / "README.md").write_text("hello")

    volume = provider.prepare_workspace("s-9", str(source))

    assert volume.endswith("s-9")
    path_in_volume = pathlib.Path(volume)
    assert (path_in_volume / "README.md").read_text() == "hello"
    assert (path_in_volume / "pkg" / "mod.py").read_text() == "x = 1"
    assert (path_in_volume / "pkg" / "sub" / "deep.txt").read_text() == "deep"

    # Gọi lại lần nữa (mã nguồn có thêm file) → không lỗi, copy đè đủ.
    (source / "extra.txt").write_text("extra")
    volume2 = provider.prepare_workspace("s-9", str(source))
    assert volume2 == volume
    assert (path_in_volume / "extra.txt").read_text() == "extra"
    assert (path_in_volume / "README.md").exists()  # file cũ vẫn còn


def test_prepare_workspace_missing_source(tmp_path):
    provider = _make_provider(tmp_path)
    with pytest.raises(AppError) as exc_info:
        provider.prepare_workspace("s-1", str(tmp_path / "khong-ton-tai"))
    assert exc_info.value.code is ErrorCode.invalid_request


def test_get_dial_target(tmp_path):
    provider = _make_provider(tmp_path)
    first = _create(provider, session_id="s-1")
    second = _create(provider, session_id="s-2")

    target = provider.get_dial_target(first)
    assert target.startswith("127.0.0.1:")
    assert int(target.split(":")[1]) >= 50_000

    # Hai sandbox khác nhau → port khác nhau.
    assert provider.get_dial_target(second) != target

    # Sandbox lạ → AppError.
    with pytest.raises(AppError) as exc_info:
        provider.get_dial_target("fake-missing")
    assert exc_info.value.code is ErrorCode.invalid_request


def test_terminate_removes_and_is_idempotent(tmp_path):
    provider = _make_provider(tmp_path)
    source = tmp_path / "project"
    source.mkdir()
    (source / "a.txt").write_text("a")
    provider.prepare_workspace("s-1", str(source))

    sandbox_id = _create(provider, session_id="s-1")  # gắn volume đã seed
    volume_path = pathlib.Path(provider.prepare_workspace("s-1", str(source)))
    assert sandbox_id in provider.list_sandboxes()

    provider.terminate_sandbox(sandbox_id)
    assert sandbox_id not in provider.list_sandboxes()

    # Gọi terminate lần 2 → an toàn, KHÔNG raise.
    provider.terminate_sandbox(sandbox_id)

    # Volume gắn sandbox được dọn sạch.
    assert not volume_path.exists()


def test_base_optional_methods_not_implemented(tmp_path):
    # ABC không thể khởi tạo trực tiếp.
    with pytest.raises(TypeError):
        SandboxProvider()  # type: ignore[abstract]

    # Method tùy chọn: base default raise NotImplementedError với message rõ ràng.
    provider = _MinimalProvider()
    with pytest.raises(NotImplementedError, match="get_sandbox_metrics"):
        provider.get_sandbox_metrics("fake-1")
    with pytest.raises(NotImplementedError, match="get_sandbox_diagnostics"):
        provider.get_sandbox_diagnostics("fake-1")
    with pytest.raises(NotImplementedError, match="get_sandbox_endpoint"):
        provider.get_sandbox_endpoint("fake-1")


def test_unknown_sandbox_raises_invalid_request(tmp_path):
    provider = _make_provider(tmp_path)
    for call in (
        lambda: provider.start_sandbox("fake-missing"),
        lambda: provider.pause_sandbox("fake-missing"),
        lambda: provider.resume_sandbox("fake-missing"),
        lambda: provider.renew_sandbox("fake-missing", 30),
    ):
        with pytest.raises(AppError) as exc_info:
            call()
        assert exc_info.value.code is ErrorCode.invalid_request

    with pytest.raises(AppError):
        provider.get_sandbox_state("fake-missing")
    with pytest.raises(AppError):
        provider.is_expired("fake-missing")
