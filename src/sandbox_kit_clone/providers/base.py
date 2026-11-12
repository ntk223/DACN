"""ABC hạ tầng chạy sandbox: chỉ lifecycle + reachability, không đụng đồng bộ file.

Lưu ý ranh giới trách nhiệm: provider KHÔNG tính đồng bộ file và KHÔNG biết khái niệm
revision — việc đó thuộc về kho file (VFS) và bộ điều phối. Provider chỉ dựng/xóa/hạt
chống môi trường chạy và cho hệ thống biết địa chỉ nối vào trình thực thi bên trong.
Xem ``docs/system-design.md`` §5.2 (bảng khả năng) và §5.3 (bộ giả lập cho test).
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class SandboxProvider(ABC):
    """Lớp trừu tượng của hạ tầng chạy (Docker / Kubernetes / bộ giả lập)."""

    @abstractmethod
    def create_sandbox(
        self,
        session_id: str,
        image: str,
        ttl_seconds: int,
        cpu: int | None = None,
        memory: int | None = None,
    ) -> str:
        """Dựng sandbox mới từ image cho session; trả về sandbox_id."""

    @abstractmethod
    def start_sandbox(self, sandbox_id: str) -> None:
        """Chạy lại sandbox đang đứng ngoài vòng đời (resume từ PAUSED/STANDBY)."""

    @abstractmethod
    def terminate_sandbox(self, sandbox_id: str) -> None:
        """Hủy sandbox và dọn sạch tài nguyên kèm theo."""

    @abstractmethod
    def pause_sandbox(self, sandbox_id: str) -> None:
        """Tạm dừng sandbox (không tính thời hạn khi đang dừng)."""

    @abstractmethod
    def resume_sandbox(self, sandbox_id: str) -> None:
        """Tiếp tục sandbox từ trạng thái tạm dừng."""

    @abstractmethod
    def renew_sandbox(self, sandbox_id: str, ttl_seconds: int) -> None:
        """Gia hạn thời hạn sống thêm ``ttl_seconds`` giây."""

    @abstractmethod
    def prepare_workspace(self, session_id: str, host_project_path: str) -> str:
        """Seed mã nguồn từ host vào bộ nhớ ngoài gắn sandbox; trả về volume identifier."""

    @abstractmethod
    def get_dial_target(self, sandbox_id: str) -> str:
        """Địa chỉ host:port để hệ thống nối vào exec agent bên trong sandbox."""

    @abstractmethod
    def list_sandboxes(self) -> list[str]:
        """Liệt kê mọi sandbox đang sống (phục vụ quét dọn sandbox mồ côi)."""

    # --- Khả năng tùy chọn: không bắt buộc mỗi hạ tầng đều có (xem §5.2) ---

    def get_sandbox_metrics(self, sandbox_id: str) -> dict:
        """Số liệu tài nguyên của sandbox (CPU/bộ nhớ/disk) — tùy chọn."""
        raise NotImplementedError(
            f"provider {type(self).__name__} không hỗ trợ get_sandbox_metrics"
        )

    def get_sandbox_diagnostics(self, sandbox_id: str) -> dict:
        """Thông tin chẩn đoán sandbox (trạng thái, log gần đây...) — tùy chọn."""
        raise NotImplementedError(
            f"provider {type(self).__name__} không hỗ trợ get_sandbox_diagnostics"
        )

    def get_sandbox_endpoint(self, sandbox_id: str) -> dict:
        """Cổng dịch vụ/mạng của sandbox (ngoài dial target) — tùy chọn."""
        raise NotImplementedError(
            f"provider {type(self).__name__} không hỗ trợ get_sandbox_endpoint"
        )
