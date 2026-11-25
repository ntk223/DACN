"""Provider Docker trên daemon thật — đánh dấu ``docker``; tự bỏ qua khi máy không có Docker/image.

Chạy riêng: ``make test-docker``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError
from sandbox_kit_clone.manager.manager import Manager

pytestmark = pytest.mark.docker

IMAGE = Settings().sandbox_image


def _docker_client():
    try:
        import docker

        client = docker.from_env()
        client.ping()
        client.images.get(IMAGE)
    except Exception as exc:  # noqa: BLE001 — mọi lý do không dùng được Docker đều là skip
        pytest.skip(f"Docker hoặc image {IMAGE} không sẵn sàng: {exc}")
    return client


@pytest.fixture()
def manager(tmp_path: Path):
    client = _docker_client()
    from sandbox_kit_clone.providers.docker import LABEL_SESSION, DockerProvider

    provider = DockerProvider(image=IMAGE, client=client)
    mgr = Manager(Settings(data_dir=str(tmp_path / "data"), provider="docker"), provider)
    sessions: list[str] = []
    mgr._test_sessions = sessions  # type: ignore[attr-defined]
    yield mgr
    # Dọn mọi thứ test đã tạo (kể cả khi test fail giữa chừng).
    for c in client.containers.list(all=True, filters={"label": "sandbox-kit=1"}):
        if c.labels.get(LABEL_SESSION) in sessions:
            provider.terminate_sandbox(c.name)
    for sid in sessions:
        provider.cleanup_workspace(sid)


def _workspace(mgr: Manager) -> str:
    ws = mgr.create_workspace("docker-test")
    mgr._test_sessions.append(ws["session_id"])  # type: ignore[attr-defined]
    _w, vfs = mgr.resolve_session(ws["session_id"])
    vfs.write_file("src/app.py", "print('hi')\n")
    vfs.write_file("data/b.bin", bytes(range(256)))
    vfs.close()
    return ws["session_id"]


def test_lifecycle_with_materialized_files(manager: Manager) -> None:
    sid = _workspace(manager)
    started = manager.sandbox_start(sid, ttl_seconds=600, cpu=1, memory=256)
    sandbox_id = started["sandbox_id"]
    provider = manager.provider
    assert started["materialized_files"] == 2 and started["dial_target"].startswith("127.0.0.1:")

    detail = manager.sandbox_detail(sandbox_id)
    assert detail["info"]["state"] == "running" and detail["info"]["memory_mb"] == 256
    assert [f["path"] for f in detail["workspace"]["files"]] == ["data/b.bin", "src/app.py"]
    assert provider.read_workspace_file(sandbox_id, "data/b.bin")["content"] == bytes(range(256))

    manager.sandbox_pause(sid)
    assert provider.get_sandbox_state(sandbox_id) == "paused"
    # Container đang tạm dừng vẫn liệt kê được file (qua archive).
    assert provider.list_workspace_files(sandbox_id)["total"] == 2
    manager.sandbox_resume(sid)
    assert provider.get_sandbox_state(sandbox_id) == "running"
    before = provider.get_expiry(sandbox_id)
    manager.sandbox_renew(sid, 120)
    assert (provider.get_expiry(sandbox_id) - before).total_seconds() == 120

    volume = detail["info"]["volume"]
    manager.sandbox_stop(sid)
    assert sandbox_id not in provider.list_sandboxes()
    assert not provider._volume_exists(volume)
    provider.terminate_sandbox(sandbox_id)  # idempotent


def test_command_run_inside_container(manager: Manager) -> None:
    sid = _workspace(manager)
    manager.sandbox_start(sid, ttl_seconds=600)
    r = manager.command_run(sid, "cat src/app.py && whoami && pwd && python3 --version")
    assert r["exit_code"] == 0
    assert r["stdout"].startswith("print('hi')\nroot\n/workspace\nPython 3.12")
    seen: list[bytes] = []
    r = manager.command_run(sid, "echo a; sleep 0.5; echo b >&2", on_output=lambda _s, d: seen.append(d))
    assert seen == [b"a\n", b"b\n"] and r["stderr"] == "b\n"
    r = manager.command_run(sid, "sleep 60", timeout_seconds=1)
    assert r["timed_out"] is True
    # Tạm dừng / tiếp tục: kênh gRPC vẫn dùng lại được.
    manager.sandbox_pause(sid)
    manager.sandbox_resume(sid)
    assert manager.command_run(sid, "echo ok")["stdout"] == "ok\n"
    manager.sandbox_stop(sid)


def test_push_before_command_in_container(manager: Manager) -> None:
    """Gate W2 trên Docker: ghi SAU khi bật → lệnh kế tiếp thấy; xóa trong kho → mất trong sandbox."""
    sid = _workspace(manager)
    manager.sandbox_start(sid, ttl_seconds=600)
    _w, vfs = manager.resolve_session(sid)
    vfs.write_file("src/app.py", "print('bản mới')\n")
    vfs.write_file("docs/n.md", "# mới\n")
    vfs.delete_file("data/b.bin")
    vfs.close()
    r = manager.command_run(sid, "python3 src/app.py && find . -type f | sort")
    assert r["stdout"] == "bản mới\n./docs/n.md\n./src/app.py\n"
    assert (r["sync"]["put"], r["sync"]["deleted"]) == (2, 1)
    assert manager.sandbox_compare(sid)["in_sync"] is True
    manager.sandbox_stop(sid)


def test_orphan_is_listed_and_cleaned(manager: Manager) -> None:
    provider = manager.provider
    manager._test_sessions.append("orphan-session")  # type: ignore[attr-defined]
    orphan = provider.create_sandbox("orphan-session", "", 60)
    assert orphan in [o["sandbox_id"] for o in manager.sandbox_overview()["orphans"]]
    manager.terminate_orphan(orphan)
    assert orphan not in provider.list_sandboxes()


def test_prepare_workspace_recreates_stale_volume(manager: Manager, tmp_path: Path) -> None:
    """Volume cũ còn file lạ (orphan từ lần stop dở) → prepare_workspace xóa hẳn rồi tạo mới.

    Nếu chỉ chép đè, file ma trong volume sẽ sống sót qua lần seed và lấn át nội dung mới.
    """
    from sandbox_kit_clone.providers.docker import LABEL, LABEL_SESSION

    provider = manager.provider
    client = provider.client
    session = "stale-volume-session"
    manager._test_sessions.append(session)  # type: ignore[attr-defined]

    # Giả lập volume cũ còn rác: tạo volume + viết file lạ qua container tạm.
    volume_name = provider._volume_name(session)
    client.volumes.create(name=volume_name, labels={LABEL: "1", LABEL_SESSION: session})
    client.containers.run(
        IMAGE,
        command=[
            "sh",
            "-c",
            (
                "echo ma > /workspace/orphan.txt && mkdir -p /workspace/stale-dir"
                " && echo x > /workspace/stale-dir/old.py"
            ),
        ],
        volumes={volume_name: {"bind": "/workspace", "mode": "rw"}},
        labels={LABEL: "helper"},
        remove=True,
    )

    # Seed từ thư mục host chỉ có đúng 1 file.
    source = tmp_path / "seed"
    source.mkdir()
    (source / "seed.txt").write_text("giong")

    provider.prepare_workspace(session, str(source))

    # Đọc lại toàn bộ file trong volume (qua container tạm): chỉ còn nội dung seed.
    out = client.containers.run(
        IMAGE,
        command=["find", "/workspace", "-type", "f"],
        volumes={volume_name: {"bind": "/workspace", "mode": "rw"}},
        labels={LABEL: "helper"},
        remove=True,
    )
    assert sorted(out.decode().splitlines()) == ["/workspace/seed.txt"]
    # Volume được tạo lại với label đầy đủ (vẫn do provider quản lý, quét dọn thấy được).
    labels = client.volumes.get(volume_name).attrs.get("Labels") or {}
    assert labels.get(LABEL) == "1" and labels.get(LABEL_SESSION) == session


def test_missing_image_is_clear_error(manager: Manager) -> None:
    with pytest.raises(AppError) as exc:
        manager.provider.create_sandbox("x", "sandbox-kit/khong-co:0", 60)
    assert exc.value.code.value == "provider_unavailable" and "make image" in exc.value.message
