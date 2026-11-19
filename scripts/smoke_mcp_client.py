#!/usr/bin/env python3
"""Smoke test MCP client thật (SDK ``mcp``) — chứng minh vòng đời W1 chạy được qua giao thức.

Cách chạy (server phải đang chạy, ví dụ ``make run``):
    python3 scripts/smoke_mcp_client.py [url_mcp]     # mặc định http://127.0.0.1:8000/mcp

Script chỉ dùng SDK ``mcp`` + stdlib, không cần PYTHONPATH của repo.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

DEFAULT_URL = "http://127.0.0.1:8000/mcp"

REQUIRED_TOOLS = [
    "workspace_create",
    "file_write",
    "file_read",
    "file_edit",
    "file_delete",
    "file_list",
    "sandbox_start",
    "sandbox_stop",
    "sync_status",
]

_results: list[tuple[bool, str]] = []


def _step(ok: bool, label: str) -> None:
    _results.append((ok, label))
    print(f"{'✓' if ok else '✗'} {label}")


def _payload(result: Any) -> dict:
    """CallToolResult → dict: ưu tiên structuredContent, fallback JSON trong text."""
    if getattr(result, "structuredContent", None) is not None:
        return result.structuredContent
    for item in result.content:
        text = getattr(item, "text", None)
        if text is not None:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                continue
    return {}


async def main(url: str) -> int:
    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 1. list_tools — đủ bộ tool tối thiểu
            tools = await session.list_tools()
            names = sorted(t.name for t in tools.tools)
            print(f"Tools ({len(names)}): {', '.join(names)}")
            missing = [t for t in REQUIRED_TOOLS if t not in names]
            _step(not missing, f"list_tools đủ {len(REQUIRED_TOOLS)} tool bắt buộc"
                   + (f" — thiếu: {missing}" if missing else ""))

            # 2. workspace_create → session_id
            created = _payload(await session.call_tool("workspace_create", {"name": "smoke"}))
            session_id = created.get("session_id")
            _step(bool(session_id), f"workspace_create → workspace={created.get('workspace_id')}")

            # 3. file_write src/hello.py
            content_1 = "# xin chào\n"
            written = _payload(await session.call_tool("file_write", {
                "session_id": session_id, "path": "src/hello.py", "content": content_1,
            }))
            _step(isinstance(written.get("rev"), int) and written["rev"] >= 1,
                  f"file_write src/hello.py → rev={written.get('rev')} sha={str(written.get('sha256'))[:12]}…")

            # 4. file_read khớp nội dung
            read_1 = _payload(await session.call_tool("file_read", {
                "session_id": session_id, "path": "src/hello.py",
            }))
            _step(read_1.get("content") == content_1,
                  f"file_read → content khớp ({read_1.get('size')} bytes)")

            # 5. file_edit chính xác (used_fuzzy=False)
            content_2 = "# đã sửa\n"
            edited = _payload(await session.call_tool("file_edit", {
                "session_id": session_id, "path": "src/hello.py",
                "old_text": "# xin chào", "new_text": "# đã sửa",
            }))
            _step(edited.get("used_fuzzy") is False and edited.get("rev", 0) > written.get("rev", 0),
                  f"file_edit chính xác → used_fuzzy={edited.get('used_fuzzy')} rev={edited.get('rev')}")

            # 6. file_read lại
            read_2 = _payload(await session.call_tool("file_read", {
                "session_id": session_id, "path": "src/hello.py",
            }))
            _step(read_2.get("content") == content_2, "file_read sau edit → '# đã sửa'")

            # 7. file_write vào node_modules → bị chặn (không lưu thư viện phụ thuộc)
            blocked = _payload(await session.call_tool("file_write", {
                "session_id": session_id, "path": "node_modules/x.js", "content": "console.log(1)\n",
            }))
            err = blocked.get("error") or {}
            _step(err.get("code") == "ignored_path",
                  f"file_write node_modules → không lưu: {err.get('code')}")

            # 8. sandbox lifecycle: start → status → stop
            started = _payload(await session.call_tool("sandbox_start", {
                "session_id": session_id, "ttl_seconds": 1800,
            }))
            ok_start = bool(started.get("sandbox_id")) and bool(started.get("dial_target"))
            _step(ok_start, f"sandbox_start → {started.get('sandbox_id')} dial={started.get('dial_target')}")

            status = _payload(await session.call_tool("sandbox_status", {"session_id": session_id}))
            _step(status.get("state") == "RUNNING" and status.get("provider_state") == "running",
                  f"sandbox_status → state={status.get('state')} provider={status.get('provider_state')}")

            stopped = _payload(await session.call_tool("sandbox_stop", {"session_id": session_id}))
            _step(stopped.get("state") == "STANDBY", f"sandbox_stop → {stopped.get('state')}")

            # 9. file_delete + file_list rỗng
            deleted = _payload(await session.call_tool("file_delete", {
                "session_id": session_id, "path": "src/hello.py",
            }))
            listing = _payload(await session.call_tool("file_list", {"session_id": session_id}))
            _step(deleted.get("origin") == "vfs" and listing.get("files") == [],
                  f"file_delete + file_list → {len(listing.get('files', []))} file còn lại")

            # 10. sync_status
            synced = _payload(await session.call_tool("sync_status", {"session_id": session_id}))
            _step(isinstance(synced.get("workspace_revision"), int)
                  and synced.get("workspace_revision", 0) >= 1,
                  f"sync_status → revision={synced.get('workspace_revision')} status={synced.get('status')}")

    passed = sum(1 for ok, _ in _results if ok)
    total = len(_results)
    print(f"\nKết quả: {passed}/{total} bước pass")
    return 0 if passed == total else 1


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    sys.exit(asyncio.run(main(url)))
