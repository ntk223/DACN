"""Provider Docker (§5.3, mcp-integration §3.7): container + named volume gắn ``/workspace``.

Ranh giới giữ đúng ``providers/base.py``: provider chỉ dựng/xóa/tạm dừng container, chép
mã nguồn từ host vào volume và cho biết địa chỉ nối vào trình thực thi. Không biết VFS,
không biết revision.

Quy ước:
- Mọi tài nguyên do provider tạo mang label ``sandbox-kit=1`` (+ ``sandbox-kit.session``)
  → ``list_sandboxes`` và quét dọn mồ côi chỉ đụng đồ của mình.
- Volume theo session: ``skc-vol-{session}``. Docker KHÔNG tự xóa volume khi xóa container
  → ``terminate_sandbox`` xóa tường minh (§8 "Dọn bộ nhớ ngoài").
- Cổng trình thực thi (gRPC, W2 bước sau) chỉ ánh xạ ra ``127.0.0.1``.
- Provider không giữ state riêng ngoài Docker: khởi động lại server vẫn thấy container cũ.
"""

from __future__ import annotations

import io
import tarfile
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.providers.base import SandboxProvider

LABEL = "sandbox-kit"
LABEL_SESSION = "sandbox-kit.session"
LABEL_EXPIRES = "sandbox-kit.expires-at"
CONTAINER_PREFIX = "skc-"
VOLUME_PREFIX = "skc-vol-"
WORKSPACE_MOUNT = "/workspace"
AGENT_PORT = "50051/tcp"  # cổng trình thực thi bên trong container

# Docker status → state chung của provider (khớp FakeProvider).
_STATE_MAP = {
    "created": "created",
    "running": "running",
    "paused": "paused",
    "restarting": "running",
    "exited": "stopped",
    "dead": "stopped",
    "removing": "stopped",
}


def _docker_errors():
    """Import lazy: máy không có docker-py vẫn import được module (chỉ lỗi khi dùng)."""
    import docker.errors

    return docker.errors


class DockerProvider(SandboxProvider):
    """Sandbox = container Docker; mã nguồn nằm trong named volume riêng mỗi session."""

    name = "docker"

    def __init__(
        self,
        image: str,
        network: bool = True,
        client=None,
    ) -> None:
        self.image = image
        self.network = network
        if client is None:
            import docker

            try:
                client = docker.from_env()
                client.ping()
            except Exception as exc:
                raise AppError(
                    ErrorCode.provider_unavailable,
                    f"Không kết nối được Docker daemon: {exc}",
                ) from exc
        self.client = client
        # Hạn sống sau khi renew (label không sửa được sau khi tạo container).
        self._expiry_override: dict[str, datetime | None] = {}

    # ------------------------------------------------------------ năng lực

    @property
    def capabilities(self) -> dict:
        return {
            "pause_resume": True,
            "metrics": True,
            "diagnostics": True,
            "isolation_tiers": ["runc"],
        }

    # ------------------------------------------------------------ vòng đời

    def create_sandbox(
        self,
        session_id: str,
        image: str,
        ttl_seconds: int,
        cpu: int | None = None,
        memory: int | None = None,
    ) -> str:
        """Chạy container từ ``image`` (rỗng → image mặc định), gắn volume của session nếu có."""
        image = image or self.image
        self._ensure_image(image)
        sandbox_id = f"{CONTAINER_PREFIX}{uuid.uuid4().hex[:10]}"
        expires_at = (
            (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat() if ttl_seconds > 0 else ""
        )
        volumes = {}
        volume_name = self._volume_name(session_id)
        if self._volume_exists(volume_name):
            volumes[volume_name] = {"bind": WORKSPACE_MOUNT, "mode": "rw"}
        kwargs: dict = {
            "name": sandbox_id,
            "detach": True,
            "init": True,  # tini làm PID 1: dọn zombie, chuyển tín hiệu
            "working_dir": WORKSPACE_MOUNT,
            "labels": {LABEL: "1", LABEL_SESSION: session_id, LABEL_EXPIRES: expires_at},
            "volumes": volumes,
            "ports": {AGENT_PORT: ("127.0.0.1", None)},
            "tmpfs": {"/scratch": "rw,size=256m"},  # §5.1: bộ nhớ tạm chỉ trong RAM
        }
        if not self.network:
            kwargs["network_mode"] = "none"
            kwargs.pop("ports")
        if cpu:
            kwargs["nano_cpus"] = int(cpu * 1_000_000_000)
        if memory:
            kwargs["mem_limit"] = f"{int(memory)}m"
        self.client.containers.run(image, **kwargs)
        return sandbox_id

    def start_sandbox(self, sandbox_id: str) -> None:
        container = self._container(sandbox_id)
        container.reload()
        if container.status == "paused":
            container.unpause()
        elif container.status != "running":
            container.start()

    def terminate_sandbox(self, sandbox_id: str) -> None:
        """Xóa container + volume của session. Idempotent: sandbox không còn → không lỗi."""
        errors = _docker_errors()
        try:
            container = self.client.containers.get(sandbox_id)
        except errors.NotFound:
            self._expiry_override.pop(sandbox_id, None)
            return
        session_id = container.labels.get(LABEL_SESSION)
        container.remove(force=True)
        self._expiry_override.pop(sandbox_id, None)
        if session_id:
            self._remove_volume(self._volume_name(session_id))

    def pause_sandbox(self, sandbox_id: str) -> None:
        container = self._container(sandbox_id)
        container.reload()
        if container.status != "paused":
            container.pause()

    def resume_sandbox(self, sandbox_id: str) -> None:
        self.start_sandbox(sandbox_id)

    def renew_sandbox(self, sandbox_id: str, ttl_seconds: int) -> None:
        current = self.get_expiry(sandbox_id)
        if current is None:
            return  # "không hết hạn" giữ nguyên (khớp FakeProvider)
        self._expiry_override[sandbox_id] = current + timedelta(seconds=ttl_seconds)

    # ------------------------------------------------------- mã nguồn + mạng

    def prepare_workspace(self, session_id: str, host_project_path: str) -> str:
        """Tạo volume ``skc-vol-{session}`` rồi chép cây thư mục host vào (qua container tạm).

        Chép đè, không xóa file cũ trong volume (idempotent như FakeProvider).
        """
        source = Path(host_project_path)
        if not source.is_dir():
            raise AppError(
                ErrorCode.invalid_request,
                f"Đường dẫn mã nguồn không tồn tại hoặc không phải thư mục: {host_project_path}",
            )
        volume_name = self._volume_name(session_id)
        if not self._volume_exists(volume_name):
            self.client.volumes.create(
                name=volume_name, labels={LABEL: "1", LABEL_SESSION: session_id}
            )
        self._ensure_image(self.image)
        helper = self.client.containers.create(
            self.image,
            command=["true"],
            volumes={volume_name: {"bind": WORKSPACE_MOUNT, "mode": "rw"}},
            labels={LABEL: "helper"},
        )
        try:
            helper.put_archive(WORKSPACE_MOUNT, _tar_directory(source))
        finally:
            helper.remove(force=True)
        return volume_name

    def cleanup_workspace(self, session_id: str) -> None:
        """Dọn volume của session khi tạo sandbox thất bại (idempotent)."""
        self._remove_volume(self._volume_name(session_id))

    def get_dial_target(self, sandbox_id: str) -> str:
        """``127.0.0.1:{port}`` ánh xạ tới cổng trình thực thi; chưa có cổng → chuỗi rỗng."""
        container = self._container(sandbox_id)
        container.reload()
        bindings = (container.attrs.get("NetworkSettings", {}).get("Ports") or {}).get(AGENT_PORT)
        if not bindings:
            return ""
        return f"{bindings[0].get('HostIp') or '127.0.0.1'}:{bindings[0]['HostPort']}"

    def has_exec_agent(self, sandbox_id: str) -> bool:
        """Có đường nối vào trình thực thi (container không mạng → không có cổng)."""
        return bool(self.get_dial_target(sandbox_id))

    def list_sandboxes(self) -> list[str]:
        """Mọi container sandbox (kể cả đang dừng) do provider này tạo."""
        containers = self.client.containers.list(all=True, filters={"label": f"{LABEL}=1"})
        return sorted(c.name for c in containers)

    # ------------------------------------------------------------ xem / chẩn đoán

    def get_sandbox_state(self, sandbox_id: str) -> str:
        container = self._container(sandbox_id)
        container.reload()
        return _STATE_MAP.get(container.status, container.status)

    def get_expiry(self, sandbox_id: str) -> datetime | None:
        if sandbox_id in self._expiry_override:
            return self._expiry_override[sandbox_id]
        raw = self._container(sandbox_id).labels.get(LABEL_EXPIRES) or ""
        try:
            return datetime.fromisoformat(raw) if raw else None
        except ValueError:
            return None  # thông tin hạn lỗi → coi như chưa hết hạn (§5.4)

    def describe_sandbox(self, sandbox_id: str) -> dict:
        """Thông tin gọn cho trang quản trị (không gọi stats — chậm)."""
        container = self._container(sandbox_id)
        container.reload()
        attrs = container.attrs
        host_cfg = attrs.get("HostConfig", {})
        expiry = self.get_expiry(sandbox_id)
        return {
            "sandbox_id": sandbox_id,
            "session_id": container.labels.get(LABEL_SESSION),
            "state": _STATE_MAP.get(container.status, container.status),
            "docker_status": container.status,
            "image": (attrs.get("Config") or {}).get("Image"),
            "created_at": attrs.get("Created"),
            "started_at": (attrs.get("State") or {}).get("StartedAt"),
            "exit_code": (attrs.get("State") or {}).get("ExitCode"),
            "oom_killed": (attrs.get("State") or {}).get("OOMKilled"),
            "expires_at": expiry.isoformat() if expiry else None,
            "dial_target": self.get_dial_target(sandbox_id),
            "volume": next(
                (m.get("Name") for m in attrs.get("Mounts", []) if m.get("Destination") == WORKSPACE_MOUNT),
                None,
            ),
            "cpu": (host_cfg.get("NanoCpus") or 0) / 1e9 or None,
            "memory_mb": (host_cfg.get("Memory") or 0) // (1024 * 1024) or None,
            "network": host_cfg.get("NetworkMode"),
        }

    def get_sandbox_metrics(self, sandbox_id: str) -> dict:
        container = self._container(sandbox_id)
        container.reload()
        if container.status != "running":
            return {"available": False, "reason": f"container đang {container.status}"}
        stats = container.stats(stream=False)
        cpu = stats.get("cpu_stats", {})
        pre = stats.get("precpu_stats", {})
        cpu_delta = cpu.get("cpu_usage", {}).get("total_usage", 0) - pre.get("cpu_usage", {}).get(
            "total_usage", 0
        )
        sys_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus") or 1
        mem = stats.get("memory_stats", {})
        return {
            "available": True,
            "cpu_percent": round(cpu_delta / sys_delta * online * 100, 2) if sys_delta > 0 else 0.0,
            "memory_bytes": mem.get("usage", 0),
            "memory_limit_bytes": mem.get("limit", 0),
            "pids": (stats.get("pids_stats") or {}).get("current"),
        }

    def get_sandbox_diagnostics(self, sandbox_id: str, tail: int = 200) -> dict:
        container = self._container(sandbox_id)
        logs = container.logs(tail=tail, timestamps=True).decode("utf-8", "replace")
        return {"logs": logs}

    def list_workspace_files(self, sandbox_id: str, limit: int = 500) -> dict:
        """Liệt kê file trong ``/workspace`` (debug: kiểm việc nạp mã nguồn).

        Container đang chạy → ``find`` qua docker exec; đang dừng/tạm dừng → đọc archive.
        """
        container = self._container(sandbox_id)
        container.reload()
        if container.status == "running":
            result = container.exec_run(
                ["find", WORKSPACE_MOUNT, "-type", "f", "-printf", "%s\t%P\n"], demux=False
            )
            lines = (result.output or b"").decode("utf-8", "replace").splitlines()
            files = []
            for line in lines:
                size, _, path = line.partition("\t")
                if path:
                    files.append({"path": path, "size": int(size) if size.isdigit() else None})
        else:
            files = self._files_from_archive(container)
        files.sort(key=lambda f: f["path"])
        return {"files": files[:limit], "total": len(files), "truncated": len(files) > limit}

    def read_workspace_file(self, sandbox_id: str, path: str, max_bytes: int = 256 * 1024) -> dict:
        """Đọc một file trong ``/workspace`` qua archive (chạy được cả khi container dừng)."""
        errors = _docker_errors()
        container = self._container(sandbox_id)
        try:
            stream, stat = container.get_archive(f"{WORKSPACE_MOUNT}/{path}")
        except errors.NotFound as exc:
            raise AppError(ErrorCode.file_not_found, f"Không có '{path}' trong sandbox") from exc
        buf = io.BytesIO(b"".join(stream))
        with tarfile.open(fileobj=buf) as tar:
            member = next((m for m in tar.getmembers() if m.isfile()), None)
            if member is None:
                raise AppError(ErrorCode.invalid_request, f"'{path}' không phải file")
            data = tar.extractfile(member).read(max_bytes + 1)
        return {
            "path": path,
            "size": stat.get("size"),
            "content": data[:max_bytes],
            "truncated": len(data) > max_bytes,
        }

    # ---------------------------------------------------------------- nội bộ

    def _container(self, sandbox_id: str):
        errors = _docker_errors()
        try:
            container = self.client.containers.get(sandbox_id)
        except errors.NotFound as exc:
            raise AppError(
                ErrorCode.invalid_request, f"Sandbox không tồn tại hoặc đã bị hủy: {sandbox_id}"
            ) from exc
        if container.labels.get(LABEL) != "1":
            raise AppError(ErrorCode.invalid_request, f"Container {sandbox_id} không do sandbox-kit quản lý")
        return container

    def _ensure_image(self, image: str) -> None:
        errors = _docker_errors()
        try:
            self.client.images.get(image)
        except errors.ImageNotFound as exc:
            raise AppError(
                ErrorCode.provider_unavailable,
                f"Chưa có image '{image}' — chạy `make image` để build image sandbox",
            ) from exc

    @staticmethod
    def _volume_name(session_id: str) -> str:
        return f"{VOLUME_PREFIX}{session_id}"

    def _volume_exists(self, name: str) -> bool:
        errors = _docker_errors()
        try:
            self.client.volumes.get(name)
        except errors.NotFound:
            return False
        return True

    def _remove_volume(self, name: str) -> None:
        errors = _docker_errors()
        for attempt in range(5):  # volume có thể còn "in use" vài trăm ms sau khi xóa container
            try:
                self.client.volumes.get(name).remove(force=True)
                return
            except errors.NotFound:
                return
            except errors.APIError:
                if attempt == 4:
                    raise
                time.sleep(0.2)

    @staticmethod
    def _files_from_archive(container) -> list[dict]:
        stream, _ = container.get_archive(WORKSPACE_MOUNT)
        buf = io.BytesIO(b"".join(stream))
        files = []
        with tarfile.open(fileobj=buf) as tar:
            for m in tar.getmembers():
                if m.isfile():
                    files.append({"path": m.name.split("/", 1)[1] if "/" in m.name else m.name, "size": m.size})
        return files


def _tar_directory(source: Path) -> bytes:
    """Đóng gói nội dung thư mục (không gồm chính thư mục) thành tar trong bộ nhớ."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for child in sorted(source.iterdir()):
            tar.add(child, arcname=child.name)
    return buf.getvalue()
