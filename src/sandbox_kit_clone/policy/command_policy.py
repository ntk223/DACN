"""Bộ chặn lệnh 2 lớp (system-design §9.1, C7) — kiểm TRƯỚC khi lệnh vào sandbox.

- **Lớp 1 — phá hoại rõ ràng:** xóa toàn bộ đĩa / thư mục gốc, format, ghi thẳng vào thiết bị,
  fork bomb, tải script lạ rồi chạy ngay, tắt máy...
- **Lớp 2 — shell tự ghi / xóa file:** ``rm``, ``mv``, ``sed -i``, chuyển hướng ``>`` vào file,
  ``git clean`` / ``reset --hard``... Lệnh vẫn chạy được, nhưng đi vòng qua kho lưu: thay đổi kiểu
  này chỉ vào kho khi có bước nhận về (W3), và xóa trong sandbox lúc đó sẽ thành xóa thật ở kho.

Mỗi lớp có 2 chế độ: ``audit`` (chỉ cảnh báo + ghi log — mặc định PoC) và ``enforce`` (chặn hẳn,
lỗi ``command_blocked``). Đây là bộ lọc theo mẫu (regex) trên chuỗi lệnh — chặn được thao tác
lỡ tay / phổ biến, KHÔNG thay được cô lập của container (lệnh cố tình né mẫu vẫn lọt).
"""

from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass

log = logging.getLogger("sandbox_kit_clone.policy")

VALID_MODES = ("audit", "enforce")

# Ranh giới đầu một lệnh con: đầu chuỗi hoặc sau ; & | ( ` $( ' " và tiền tố sudo/env/time/nohup.
_CMD = r"(?:^|[;&|(`'\"]|\$\()\s*(?:(?:sudo|nohup|time|env(?:\s+\w+=\S*)*)\s+)*"
_ROOTISH = r"(?:/|/\*|~|~/|\$HOME|/root|/home|/etc|/usr|/var|/bin|/boot|/lib)/?(?:\s|$|;|&|\||'|\")"


@dataclass(frozen=True)
class Rule:
    id: str
    layer: int
    pattern: re.Pattern
    message: str


def _r(rule_id: str, layer: int, pattern: str, message: str) -> Rule:
    return Rule(rule_id, layer, re.compile(pattern, re.IGNORECASE), message)


RULES: tuple[Rule, ...] = (
    # ------------------------------------------------------------ lớp 1
    _r("rm-root", 1, _CMD + r"rm\s+(?:-[a-z]*\s+)*-[a-z]*[rR][a-z]*\s+(?:-[a-z-]+\s+)*(?:--no-preserve-root\s+)?" + _ROOTISH,
       "xóa đệ quy thư mục gốc / hệ thống / thư mục nhà"),
    _r("no-preserve-root", 1, r"--no-preserve-root", "rm với --no-preserve-root"),
    _r("mkfs", 1, _CMD + r"(?:mkfs(?:\.\w+)?|mkswap|wipefs)\b", "định dạng / xóa phân vùng"),
    _r("dd-device", 1, r"\bdd\b[^;&|]*\bof=/dev/(?!null\b)", "dd ghi thẳng vào thiết bị"),
    _r("write-device", 1, r">\s*/dev/(?:sd|nvme|hd|vd|xvd|mmcblk|disk)\w*", "chuyển hướng ghi vào ổ đĩa"),
    _r("fork-bomb", 1, r":\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:", "fork bomb"),
    _r("pipe-to-shell", 1,
       r"\b(?:curl|wget|fetch)\b[^;&]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\b(?:ba)?sh\s+-c\s+[\"']?\$\((?:curl|wget)",
       "tải script từ mạng rồi chạy ngay"),
    _r("chmod-root", 1, _CMD + r"(?:chmod|chown)\s+(?:-[a-z]*\s+)*-[a-z]*R[a-z]*\s+\S+\s+" + _ROOTISH,
       "đổi quyền / chủ sở hữu đệ quy toàn hệ thống"),
    _r("shutdown", 1, _CMD + r"(?:shutdown|reboot|halt|poweroff|init\s+[06])\b", "tắt / khởi động lại máy"),
    _r("kill-all", 1, _CMD + r"kill\s+(?:-\w+\s+)*-1\b", "kill mọi tiến trình"),
    # ------------------------------------------------------------ lớp 2
    _r("shell-rm", 2, _CMD + r"(?:rm|rmdir|unlink|shred)\s", "xóa file bằng shell"),
    _r("shell-mv", 2, _CMD + r"mv\s", "đổi tên / di chuyển file bằng shell"),
    _r("shell-sed-i", 2, r"\b(?:sed|perl)\s+(?:-\w+\s+)*-i", "sửa file tại chỗ (sed -i / perl -i)"),
    _r("shell-redirect", 2, r"(?<![0-9&<>])>{1,2}\s*(?!&|/dev/(?:null|stdout|stderr)\b)[\w./~\"'$-][^\s;&|]*",
       "ghi file bằng chuyển hướng > / >>"),
    _r("shell-tee", 2, _CMD + r"tee\s+(?:-a\s+)?(?!/dev/)\S", "ghi file bằng tee"),
    _r("shell-truncate", 2, _CMD + r"(?:truncate|fallocate)\s", "cắt / cấp phát file"),
    _r("git-destructive", 2, r"\bgit\s+(?:clean\s+-\w*f|reset\s+--hard|checkout\s+--\s|restore\s)",
       "git ghi đè / xóa thay đổi trong cây làm việc"),
    _r("find-delete", 2, r"\bfind\b[^;&|]*\s-delete\b|\bfind\b[^;&|]*-exec\s+rm\b", "find xóa file"),
)


_QUOTED = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")


def _strip_quotes(command: str) -> str:
    """Thay nội dung trong nháy bằng chuỗi trung tính — lớp 2 không bắt ``>`` / ``rm`` nằm trong chuỗi."""
    return _QUOTED.sub("''", command)


@dataclass(frozen=True)
class Hit:
    rule: str
    layer: int
    message: str
    match: str


def check(command: str, layer1_mode: str = "audit", layer2_mode: str = "audit") -> dict:
    """Phân tích một lệnh; KHÔNG raise. Trả ``{blocked, mode, hits, warnings}``.

    ``blocked`` = có hit ở lớp đang ``enforce``.
    """
    hits: list[Hit] = []
    seen: set[str] = set()
    unquoted = _strip_quotes(command)
    for rule in RULES:
        # Lớp 1 quét cả chuỗi gốc (bắt cả `bash -c 'rm -rf /'`); lớp 2 bỏ phần trong nháy.
        m = rule.pattern.search(command if rule.layer == 1 else unquoted)
        if m and rule.id not in seen:
            seen.add(rule.id)
            hits.append(Hit(rule.id, rule.layer, rule.message, m.group(0).strip()[:80]))
    # Đã trúng lớp 1 thì bỏ cảnh báo lớp 2 trùng nghĩa (rm -rf / đã đủ nói).
    if any(h.layer == 1 for h in hits):
        hits = [h for h in hits if h.layer == 1 or h.rule not in ("shell-rm", "shell-redirect")]
    modes = {1: layer1_mode, 2: layer2_mode}
    blocked = any(modes[h.layer] == "enforce" for h in hits)
    warnings = [
        f"[lớp {h.layer}{' · CHẶN' if modes[h.layer] == 'enforce' else ' · cảnh báo'}] {h.message}: `{h.match}`"
        for h in hits
    ]
    if any(h.layer == 2 for h in hits):
        warnings.append(
            "Lưu ý: thay đổi file bằng shell chưa được nhận về kho (W3) — nên dùng file_write / file_edit / file_delete."
        )
    return {
        "blocked": blocked,
        "modes": {"layer1": layer1_mode, "layer2": layer2_mode},
        "hits": [asdict(h) for h in hits],
        "warnings": warnings,
    }


def log_decision(session_id: str, command: str, result: dict) -> None:
    """Lớp ghi vết thứ 3 (§9.5): log của bộ chặn lệnh."""
    if not result["hits"]:
        return
    level = logging.WARNING if result["blocked"] else logging.INFO
    log.log(level, "policy %s session=%s rules=%s cmd=%r",
            "BLOCK" if result["blocked"] else "audit", session_id,
            ",".join(h["rule"] for h in result["hits"]), command[:300])
