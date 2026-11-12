import React, { useState, useEffect, useCallback } from 'react'
import {
  Lock, KeyRound, Bot, Package, Eye, Gauge, Shield, Brain, Timer,
  TimerOff, Network, ArrowRight, Terminal, FlaskConical, Cpu, Server,
  MonitorPlay, Database, GitBranch,
} from 'lucide-react'

/* ───────────────────────── SVG DIAGRAM 1 — ISOLATION SPECTRUM ───────────────────────── */

function IsolationSpectrumSVG() {
  const box = { fill: '#fff', stroke: '#dbd6e1', strokeWidth: 1.5, rx: 8 }
  const label = { fontSize: 14.5, fontWeight: 600, fill: '#1c1028' }
  const sub = { fontSize: 12, fill: '#80708f' }
  const ann = { fontSize: 12.5 }
  return (
    <svg viewBox="0 0 980 408" role="img" aria-label="Phổ cô lập 3 cấp">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#80708f" strokeWidth="1.6" />
        </marker>
      </defs>

      {/* Host Kernel — one tall shared box on the right */}
      <rect x="812" y="24" width="132" height="360" fill="#ede8f5" stroke="#6c5fc7" strokeWidth="1.8" rx="10" />
      <text x="878" y="190" textAnchor="middle" fontSize="15" fontWeight="700" fill="#4a3f8f">Linux Kernel</text>
      <text x="878" y="212" textAnchor="middle" fontSize="13" fill="#6c5fc7">(Host)</text>

      {/* Tier rows separators */}
      <line x1="12" y1="132" x2="796" y2="132" stroke="#f0edf3" strokeWidth="1.5" strokeDasharray="4 5" />
      <line x1="12" y1="264" x2="796" y2="264" stroke="#f0edf3" strokeWidth="1.5" strokeDasharray="4 5" />

      {/* ── Tier 1 — Docker ── */}
      <text x="16" y="52" style={label}>Cấp 1</text>
      <text x="16" y="74" style={sub}>Docker (runc)</text>
      <text x="16" y="92" style={sub}>+ seccomp, cap-drop</text>
      <rect x="200" y="42" width="170" height="48" {...box} />
      <text x="285" y="71" textAnchor="middle" fontSize="13.5" fill="#1c1028">Tiến trình Agent</text>
      <line x1="370" y1="66" x2="804" y2="66" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr)" />
      <text x="585" y="58" textAnchor="middle" fontSize="12" fill="#f55459">Agent gọi thẳng vào nhân hệ điều hành — ranh giới mỏng nhất</text>
      <text x="200" y="118" style={ann} fill="#2ba185" fontWeight="600">✓ Nhẹ nhất · khởi động &lt;100ms</text>
      <text x="520" y="118" style={ann} fill="#f55459" fontWeight="600">✗ Zero-day Kernel (Dirty Pipe) → chiếm quyền Host</text>

      {/* ── Tier 2 — gVisor ── */}
      <text x="16" y="184" style={label}>Cấp 2</text>
      <text x="16" y="206" style={sub}>gVisor (runsc)</text>
      <rect x="200" y="174" width="150" height="48" {...box} />
      <text x="275" y="203" textAnchor="middle" fontSize="13.5" fill="#1c1028">Tiến trình Agent</text>
      <line x1="350" y1="198" x2="424" y2="198" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr)" />
      <rect x="430" y="174" width="220" height="48" fill="#6c5fc7" rx="8" />
      <text x="540" y="194" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">Sentry — nhân ảo</text>
      <text x="540" y="211" textAnchor="middle" fontSize="11.5" fill="#ede8f5">lớp nhân ảo trung gian</text>
      <line x1="650" y1="198" x2="804" y2="198" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr)" />
      <text x="726" y="190" textAnchor="middle" fontSize="11.5" fill="#4a3f8f">~20-30 lệnh an toàn</text>
      <text x="200" y="250" style={ann} fill="#2ba185" fontWeight="600">✓ Chặn mọi lệnh hệ thống trực tiếp · đổi từ Docker cực dễ</text>
      <text x="620" y="250" style={ann} fill="#d4953a" fontWeight="600">✗ I/O chậm hơn</text>

      {/* ── Tier 3 — Kata / Firecracker ── */}
      <text x="16" y="316" style={label}>Cấp 3</text>
      <text x="16" y="338" style={sub}>Kata Containers</text>
      <text x="16" y="356" style={sub}>Firecracker (KVM)</text>
      <rect x="200" y="306" width="150" height="48" {...box} />
      <text x="275" y="335" textAnchor="middle" fontSize="13.5" fill="#1c1028">Tiến trình Agent</text>
      <line x1="350" y1="330" x2="404" y2="330" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr)" />
      <rect x="410" y="306" width="150" height="48" {...box} />
      <text x="485" y="330" textAnchor="middle" fontSize="13" fill="#1c1028">Guest Kernel</text>
      <text x="485" y="346" textAnchor="middle" fontSize="10.5" fill="#80708f">độc lập hoàn toàn</text>
      <line x1="560" y1="330" x2="614" y2="330" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr)" />
      <rect x="620" y="306" width="160" height="48" fill="#3e3450" rx="8" />
      <text x="700" y="330" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">KVM Hypervisor</text>
      <text x="700" y="346" textAnchor="middle" fontSize="10.5" fill="#d9d2e4">biên giới cuối cùng</text>
      <line x1="780" y1="330" x2="804" y2="330" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr)" />
      <text x="200" y="384" style={ann} fill="#2ba185" fontWeight="600">✓ An toàn tuyệt đối — chuẩn AWS Lambda, E2B</text>
      <text x="620" y="384" style={ann} fill="#d4953a" fontWeight="600">✗ +30-128MB · cần /dev/kvm</text>
    </svg>
  )
}

/* ───────────────────────── SVG DIAGRAM 2 — IN-CONTAINER DAEMON ───────────────────────── */

function DaemonArchSVG() {
  const box = { fill: '#fff', stroke: '#dbd6e1', strokeWidth: 1.5, rx: 8 }
  const chip = { fill: '#f1eef4', rx: 14 }
  const chipText = { fontSize: 11.5, fill: '#5a4d68', fontWeight: 500 }
  return (
    <svg viewBox="0 0 980 470" role="img" aria-label="Kiến trúc In-Container Daemon">
      <defs>
        <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#6c5fc7" strokeWidth="1.7" />
        </marker>
        <marker id="arr2g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#2ba185" strokeWidth="1.7" />
        </marker>
      </defs>

      {/* HOST */}
      <rect x="150" y="10" width="680" height="88" fill="#faf9fb" stroke="#dbd6e1" strokeWidth="1.5" rx="10" />
      <text x="490" y="34" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#80708f" letterSpacing="2">HOST — ORCHESTRATOR</text>
      <rect x="370" y="44" width="240" height="40" {...box} />
      <text x="490" y="69" textAnchor="middle" fontSize="14" fontWeight="600" fill="#1c1028">Agent Tool Executor</text>

      {/* Control plane arrows */}
      <line x1="330" y1="98" x2="330" y2="178" stroke="#6c5fc7" strokeWidth="1.8" markerEnd="url(#arr2)" />
      <text x="316" y="140" textAnchor="end" fontSize="12.5" fill="#6c5fc7" fontWeight="600">Lệnh (Unary)</text>
      <line x1="650" y1="178" x2="650" y2="98" stroke="#2ba185" strokeWidth="1.8" markerEnd="url(#arr2g)" />
      <text x="664" y="140" textAnchor="start" fontSize="12.5" fill="#2ba185" fontWeight="600">Log stream (2 chiều)</text>
      <text x="490" y="124" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#80708f">
        Giao thức: gRPC / WebSocket
      </text>
      <text x="490" y="146" textAnchor="middle" fontSize="12" fill="#80708f">
        Kênh nội bộ riêng — không đi qua Internet
      </text>
      <text x="490" y="164" textAnchor="middle" fontSize="12" fill="#80708f">
        — tự hủy lệnh khi mất kết nối —
      </text>

      {/* SANDBOX */}
      <rect x="90" y="184" width="800" height="204" fill="none" stroke="#6c5fc7" strokeWidth="1.6" strokeDasharray="6 5" rx="12" />
      <text x="490" y="208" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#6c5fc7" letterSpacing="2">
        MÔI TRƯỜNG ĐÃ CÔ LẬP (tiến trình riêng · giới hạn tài nguyên · lọc lệnh hệ thống)
      </text>

      {/* Daemon */}
      <rect x="230" y="222" width="520" height="52" fill="#6c5fc7" rx="9" />
      <text x="490" y="245" textAnchor="middle" fontSize="14.5" fontWeight="700" fill="#fff">Daemon bên trong — nhận lệnh từ Host</text>
      <text x="490" y="263" textAnchor="middle" fontSize="11" fill="#ede8f5">đưa vào dưới dạng file chỉ-đọc (viết bằng Go/Rust) — Agent không thể sửa / xóa</text>

      {/* Children */}
      <line x1="380" y1="274" x2="290" y2="316" stroke="#6c5fc7" strokeWidth="1.5" markerEnd="url(#arr2)" />
      <line x1="490" y1="274" x2="490" y2="316" stroke="#6c5fc7" strokeWidth="1.5" markerEnd="url(#arr2)" />
      <line x1="600" y1="274" x2="690" y2="316" stroke="#6c5fc7" strokeWidth="1.5" markerEnd="url(#arr2)" />

      <rect x="180" y="320" width="220" height="52" {...box} />
      <text x="290" y="342" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">Subprocess</text>
      <text x="290" y="359" textAnchor="middle" fontSize="11" fill="#80708f">lệnh đơn — chạy xong tự hủy</text>

      <rect x="380" y="320" width="220" height="52" {...box} />
      <text x="490" y="342" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">Persistent PTY</text>
      <text x="490" y="359" textAnchor="middle" fontSize="11" fill="#80708f">giữ trạng thái Bash giữa các lệnh</text>

      <rect x="580" y="320" width="220" height="52" {...box} />
      <text x="690" y="342" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">Jupyter Kernel</text>
      <text x="690" y="359" textAnchor="middle" fontSize="11" fill="#80708f">giữ biến &amp; dữ liệu trong RAM</text>

      {/* Engine chips */}
      <rect x="80" y="408" width="272" height="42" {...chip} />
      <text x="216" y="434" textAnchor="middle" style={chipText}>Tiến trình gác — chống "xác chết" (Zombie)</text>
      <rect x="366" y="408" width="272" height="42" {...chip} />
      <text x="502" y="434" textAnchor="middle" style={chipText}>Diệt cả nhóm tiến trình con cháu khi hết giờ</text>
      <rect x="652" y="408" width="260" height="42" {...chip} />
      <text x="782" y="434" textAnchor="middle" style={chipText}>Làm sạch ký tự rác + cắt đầu ra quá dài</text>
    </svg>
  )
}

/* ───────────────────────── SVG DIAGRAM 3 — 3 EXECUTION FLOWS ───────────────────────── */

function ExecFlowsSVG() {
  const box = { fill: '#fff', stroke: '#dbd6e1', strokeWidth: 1.5, rx: 8 }
  const deadBox = { fill: '#fde8e9', stroke: '#f55459', strokeWidth: 1.5, rx: 8 }
  return (
    <svg viewBox="0 0 980 560" role="img" aria-label="Ba luồng hoạt động của ba cách thực thi">
      <defs>
        <marker id="farr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#80708f" strokeWidth="1.6" />
        </marker>
        <marker id="farrp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#6c5fc7" strokeWidth="1.8" />
        </marker>
        <marker id="farrg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#2ba185" strokeWidth="1.8" />
        </marker>
      </defs>

      {/* ── LANE M1 — docker exec: tiến trình chết, trạng thái mất ── */}
      <text x="20" y="36" fontSize="15" fontWeight="700" fill="#1c1028">M1 · docker exec</text>
      <text x="20" y="56" fontSize="11.5" fill="#80708f">không nhớ trạng thái</text>
      <rect x="770" y="14" width="196" height="34" fill="#fde8e9" stroke="#f55459" strokeWidth="1.4" rx="17" />
      <text x="868" y="36" textAnchor="middle" fontSize="12" fontWeight="700" fill="#c93a3f">✗ LOẠI — mất sạch trạng thái</text>
      <rect x="20" y="96" width="150" height="48" {...box} />
      <text x="95" y="125" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">Docker Engine</text>
      <line x1="170" y1="120" x2="244" y2="106" stroke="#80708f" strokeWidth="1.5" markerEnd="url(#farr)" />
      <line x1="170" y1="120" x2="374" y2="120" stroke="#80708f" strokeWidth="1.5" markerEnd="url(#farr)" />
      <line x1="170" y1="120" x2="504" y2="134" stroke="#80708f" strokeWidth="1.5" markerEnd="url(#farr)" />
      <rect x="255" y="68" width="110" height="20" fill="#e0f5ef" stroke="#2ba185" strokeWidth="1" rx="10" />
      <text x="310" y="82" textAnchor="middle" fontSize="10.5" fill="#1d7a63">tạo trạng thái</text>
      <rect x="385" y="68" width="110" height="20" fill="#fff" stroke="#f55459" strokeWidth="1" strokeDasharray="3 3" rx="10" />
      <text x="440" y="82" textAnchor="middle" fontSize="10.5" fill="#c93a3f">✗ không kế thừa</text>
      <rect x="515" y="68" width="110" height="20" fill="#fff" stroke="#f55459" strokeWidth="1" strokeDasharray="3 3" rx="10" />
      <text x="570" y="82" textAnchor="middle" fontSize="10.5" fill="#c93a3f">✗ không kế thừa</text>
      <rect x="250" y="96" width="120" height="48" {...deadBox} />
      <text x="310" y="125" textAnchor="middle" fontSize="12.5" fill="#1c1028">sh lệnh 1</text>
      <text x="310" y="162" textAnchor="middle" fontSize="10.5" fill="#f55459">chết ngay ✗</text>
      <rect x="380" y="96" width="120" height="48" {...deadBox} />
      <text x="440" y="125" textAnchor="middle" fontSize="12.5" fill="#1c1028">sh lệnh 2</text>
      <text x="440" y="162" textAnchor="middle" fontSize="10.5" fill="#f55459">chết ngay ✗</text>
      <rect x="510" y="96" width="120" height="48" {...deadBox} />
      <text x="570" y="125" textAnchor="middle" fontSize="12.5" fill="#1c1028">sh lệnh 3</text>
      <text x="570" y="162" textAnchor="middle" fontSize="10.5" fill="#f55459">chết ngay ✗</text>
      <text x="660" y="118" fontSize="12.5" fill="#f55459" fontWeight="600">Mỗi lệnh = tiến trình MỚI,</text>
      <text x="660" y="138" fontSize="12.5" fill="#f55459" fontWeight="600">chạy xong tự hủy ngay</text>
      <line x1="12" y1="196" x2="968" y2="196" stroke="#f0edf3" strokeWidth="1.5" strokeDasharray="4 5" />

      {/* ── LANE M2 — ống PTY: phải đoán, dễ treo ── */}
      <text x="20" y="226" fontSize="15" fontWeight="700" fill="#1c1028">M2 · giữ phiên terminal từ ngoài</text>
      <text x="20" y="246" fontSize="11.5" fill="#80708f">trạng thái có — nhưng mù thông tin</text>
      <rect x="770" y="204" width="196" height="34" fill="#fdf3e4" stroke="#d4953a" strokeWidth="1.4" rx="17" />
      <text x="868" y="226" textAnchor="middle" fontSize="12" fontWeight="700" fill="#a86c1e">✗ RỦI RO — phải đoán, dễ treo</text>
      <rect x="20" y="266" width="150" height="48" {...box} />
      <text x="95" y="295" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">Host — bơm lệnh</text>
      <rect x="180" y="278" width="370" height="24" fill="#fdf3e4" stroke="#d4953a" strokeWidth="1.2" rx="12" />
      <text x="365" y="295" textAnchor="middle" fontSize="11.5" fill="#a86c1e">bơm chuỗi lệnh →   ← đọc đầu ra mù mờ</text>
      <line x1="556" y1="290" x2="596" y2="290" stroke="#d4953a" strokeWidth="1.5" markerEnd="url(#farr)" />
      <rect x="600" y="266" width="150" height="48" fill="#fdf3e4" stroke="#d4953a" strokeWidth="1.5" rx="8" />
      <text x="675" y="295" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">1 phiên /bin/bash</text>
      <line x1="750" y1="290" x2="790" y2="290" stroke="#d4953a" strokeWidth="1.5" markerEnd="url(#farr)" />
      <rect x="796" y="266" width="80" height="48" fill="#fff" stroke="#d4953a" strokeWidth="1.5" strokeDasharray="4 3" rx="8" />
      <text x="836" y="290" textAnchor="middle" fontSize="13" fontWeight="700" fill="#d4953a">kết thúc</text>
      <text x="836" y="306" textAnchor="middle" fontSize="12" fontWeight="700" fill="#d4953a">= ???</text>
      <text x="20" y="352" fontSize="12.5" fill="#d4953a" fontWeight="600">Đoán kết thúc qua mồi: echo "---DONE:$?---" — lệnh khác cùng in chuỗi này là nhận nhầm</text>
      <text x="20" y="374" fontSize="12.5" fill="#d4953a" fontWeight="600">Lệnh con chiếm quyền terminal (server ngầm) → không ngắt sạch được</text>
      <line x1="12" y1="392" x2="968" y2="392" stroke="#f0edf3" strokeWidth="1.5" strokeDasharray="4 5" />

      {/* ── LANE M3 — Daemon bên trong: 1 kênh, 1 chủ quản ── */}
      <rect x="6" y="402" width="968" height="152" fill="#f4f1fa" stroke="#6c5fc7" strokeWidth="1.4" rx="10" />
      <text x="20" y="432" fontSize="15" fontWeight="700" fill="#4a3f8f">M3 · Daemon bên trong ★</text>
      <text x="20" y="452" fontSize="11.5" fill="#6c5fc7">1 kênh duy nhất — Daemon quản toàn bộ</text>
      <rect x="770" y="420" width="196" height="34" fill="#e0f5ef" stroke="#2ba185" strokeWidth="1.4" rx="17" />
      <text x="868" y="442" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1d7a63">✓ CHỌN — đủ cả 4 yêu cầu</text>
      <rect x="20" y="472" width="150" height="48" {...box} />
      <text x="95" y="501" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1c1028">Host — gọi API</text>
      <line x1="170" y1="496" x2="294" y2="496" stroke="#6c5fc7" strokeWidth="1.8" markerEnd="url(#farrp)" />
      <text x="232" y="484" textAnchor="middle" fontSize="11" fill="#6c5fc7" fontWeight="600">gRPC / WebSocket</text>
      <rect x="300" y="472" width="210" height="48" fill="#6c5fc7" rx="8" />
      <text x="405" y="501" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">Daemon bên trong Sandbox</text>
      <line x1="510" y1="496" x2="576" y2="496" stroke="#2ba185" strokeWidth="1.6" markerEnd="url(#farrg)" />
      <text x="543" y="532" textAnchor="middle" fontSize="11" fill="#2ba185" fontWeight="600">quản trực tiếp</text>
      <rect x="582" y="472" width="120" height="48" {...box} />
      <text x="642" y="501" textAnchor="middle" fontSize="12" fill="#1c1028">Lệnh đơn</text>
      <rect x="712" y="472" width="120" height="48" {...box} />
      <text x="772" y="501" textAnchor="middle" fontSize="12" fill="#1c1028">Phiên Bash</text>
      <rect x="842" y="472" width="120" height="48" {...box} />
      <text x="902" y="501" textAnchor="middle" fontSize="12" fill="#1c1028">Jupyter</text>
      <text x="300" y="546" fontSize="12.5" fill="#2ba185" fontWeight="600">Trạng thái giữ nguyên ✓   Kết thúc chuẩn xác ✓   Diệt cả cây tiến trình ✓</text>
    </svg>
  )
}

/* ───────────────────────── SLIDES ───────────────────────── */

const SLIDES = [
  /* 0 — Title */
  () => (
    <div className="title-center">
      <div className="title-icons">
        <div className="icon-badge"><Lock /></div>
        <div className="icon-badge icon-badge-green"><KeyRound /></div>
      </div>
      <h1>Cơ chế <span style={{ color: 'var(--purple)' }}>Cô lập</span> &amp;<br /><span style={{ color: 'var(--purple)' }}>Thực thi</span> trong AI Agent Sandbox</h1>
      <p className="subtitle">
        Đóng lồng môi trường chạy code của Agent — và mở lối giao tiếp chính xác
        từ bên ngoài vào trong.
      </p>
      <p className="title-meta">Sandbox Kit · Báo cáo kỹ thuật · 2026</p>
    </div>
  ),

  /* 1 — Two faces */
  () => (
    <>
      <h2>Hai mặt đối lập nhưng bổ trợ nhau của cùng một bài toán</h2>
      <p className="subtitle">Môi trường AI Agent đặt ra hai yêu cầu mâu thuẫn — nhốt thật chặt, nhưng vẫn điều khiển được.</p>
      <div className="cols" style={{ marginTop: 22 }}>
        <div className="col card card-top">
          <div className="icon-badge"><Lock /></div>
          <p style={{ fontSize: '0.86rem', fontWeight: 600, letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 4 }}>PHẦN 1 · ISOLATION</p>
          <h3>Cô lập là "Đóng lồng"</h3>
          <p>Khóa chặt tiến trình của Agent, <b>không cho nó phá hoại hay chiếm quyền điều khiển</b> máy chủ thật — kể cả khi code bị thao túng.</p>
        </div>
        <div className="col card card-top-green">
          <div className="icon-badge icon-badge-green"><KeyRound /></div>
          <p style={{ fontSize: '0.86rem', fontWeight: 600, letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 4 }}>PHẦN 2 · EXECUTION</p>
          <h3>Thực thi là "Mở lối giao tiếp"</h3>
          <p>Khi cái lồng đã khóa kín (thậm chí <b>cắt mạng</b>), bộ não của Agent ở ngoài vẫn điều khiển, truyền lệnh, giữ trạng thái và lấy kết quả <b>mượt mà, chính xác nhất</b>.</p>
        </div>
      </div>
      <p className="note"><b>Lồng càng kín → giao tiếp càng khó.</b> Toàn bộ thiết kế bên dưới là lời giải của sự đánh đổi này.</p>
    </>
  ),

  /* 2 — Divider: Part 1 */
  () => (
    <div className="divider-center">
      <div className="divider-num">01</div>
      <h1>Cơ chế Cô lập</h1>
      <div className="divider-line" />
      <p className="subtitle">Ba lớp khóa ở cấp độ hệ điều hành, và phổ công nghệ để chọn mức cô lập.</p>
    </div>
  ),

  /* 3 — Problem: trusted vs untrusted */
  () => (
    <>
      <h2>Chạy code của AI Agent khác gì chạy Web App truyền thống?</h2>
      <div className="cols" style={{ marginTop: 20 }}>
        <div className="col card card-top-red">
          <div className="icon-badge icon-badge-red"><Bot /></div>
          <h3>AI Agent Sandbox</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.98rem', fontWeight: 500 }}>Untrusted &amp; Unpredictable — mã không đáng tin, khó lường</p>
          <ul>
            <li>Code và câu lệnh <b>do AI tự sinh ra</b> hoặc bị kẻ xấu điều khiển qua <b>Prompt Injection</b> (lừa bằng chính câu lệnh)</li>
            <li>Có thể vô tình chạy lệnh hủy diệt: <code>rm -rf /</code>, vòng lặp vô tận, <b>Fork Bomb</b> (lệnh tự nhân bản làm sập máy)</li>
            <li>Có thể cố tình khai thác lỗ hổng hệ điều hành để <b>thoát ra ngoài chiếm máy chủ thật</b> (Container Escape)</li>
          </ul>
        </div>
        <div className="col card card-top-green">
          <div className="icon-badge icon-badge-green"><Package /></div>
          <h3>Ứng dụng truyền thống</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.98rem', fontWeight: 500 }}>Trusted — mã đáng tin cậy</p>
          <ul>
            <li>Code do lập trình viên nội bộ viết, <b>đã qua kiểm duyệt</b> trước khi đóng gói</li>
            <li>Docker ở đây phục vụ mục tiêu <b>đóng gói môi trường</b> (Packaging)</li>
            <li><b>Không</b> phải bài toán chống mã độc</li>
          </ul>
        </div>
      </div>
    </>
  ),

  /* 4 — Three pillars */
  () => (
    <>
      <h2>Ba trụ cột cô lập — mỗi Sandbox phải qua 3 lớp khóa</h2>
      <div className="cards-3" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="icon-badge"><Eye /></div>
          <h3>1 · Không gian nhìn</h3>
          <p style={{ color: 'var(--muted)' }}><b>Namespaces</b> — "bịt mắt" tiến trình bên trong bằng các không gian riêng biệt.</p>
          <div className="chips">
            <span className="pill pill-mono">PID</span><span className="pill pill-mono">NET</span>
            <span className="pill pill-mono">MNT</span><span className="pill pill-mono">IPC</span>
            <span className="pill pill-mono">UTS</span><span className="pill pill-mono">USER</span>
          </div>
        </div>
        <div className="card">
          <div className="icon-badge"><Gauge /></div>
          <h3>2 · Tài nguyên</h3>
          <p style={{ color: 'var(--muted)' }}><b>cgroups v2</b> — "đóng khung" hạn mức phần cứng, không cho Agent chiếm dụng quá nhiều tài nguyên (DoS).</p>
          <div className="chips">
            <span className="pill pill-mono">memory.max</span>
            <span className="pill pill-mono">cpu.max</span>
            <span className="pill pill-mono">pids.max</span>
            <span className="pill pill-mono">io.max</span>
          </div>
        </div>
        <div className="card">
          <div className="icon-badge"><Shield /></div>
          <h3>3 · Quyền hạn &amp; lệnh hệ thống</h3>
          <p style={{ color: 'var(--muted)' }}>Giới hạn những gì Agent được phép đụng tới ở tầng sâu nhất của hệ điều hành.</p>
          <ul style={{ fontSize: '1rem', paddingLeft: 18, color: 'var(--muted)' }}>
            <li>Tước quyền cao nhất của hệ thống (root)</li>
            <li>Khóa vùng hệ thống ở chế độ chỉ đọc</li>
            <li>Bộ lọc chặn các lệnh hệ thống nguy hiểm (Seccomp / AppArmor)</li>
          </ul>
        </div>
      </div>
    </>
  ),

  /* 5 — Isolation spectrum SVG */
  () => (
    <>
      <h2>Ba cấp độ công nghệ cô lập — ranh giới Kernel quyết định độ an toàn</h2>
      <div className="diagram-wrap d1">
        <IsolationSpectrumSVG />
        <div className="legend">
          <span><span className="sw" style={{ background: '#fff', border: '1.5px solid #dbd6e1' }} />Thành phần tiến trình</span>
          <span><span className="sw" style={{ background: '#6c5fc7' }} />Lớp đánh chặn trung gian</span>
          <span><span className="sw" style={{ background: '#3e3450' }} />Lớp ảo hóa phần cứng</span>
          <span><span className="sw" style={{ background: '#ede8f5', border: '1.5px solid #6c5fc7' }} />Host Kernel — dùng chung</span>
        </div>
      </div>
      <p className="note"><b>Câu hỏi kiến trúc:</b> đặt Sandbox Kit ở đâu trên phổ này — và quan trọng hơn, <i>có di chuyển được không?</i> (trả lời ở Phần 2)</p>
    </>
  ),

  /* 6 — Real-world platforms: how they organize isolation */
  () => (
    <>
      <h2>Các nền tảng thực tế chọn cấp độ cô lập thế nào?</h2>
      <p className="subtitle">Không có mức "đúng nhất" — mỗi nền tảng chọn theo độ tin cậy của code, chi phí và độ khắc nghiệt của đa người dùng.</p>
      <div style={{ marginTop: 14 }}>
        <table className="compare">
          <thead>
            <tr>
              <th style={{ width: '20%' }}>Nền tảng</th>
              <th style={{ width: '26%' }}>Cấp độ tổ chức</th>
              <th>Lý do &amp; đặc điểm</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>AWS Lambda</b></td>
              <td><span className="pill pill-amber">Cấp 3 · Firecracker</span></td>
              <td>Đa người dùng khắc nghiệt nhất — <b>mỗi chức năng chạy trong một máy ảo riêng</b>, khởi động ~125ms, biên giới Hypervisor</td>
            </tr>
            <tr>
              <td><b>E2B</b> <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(sandbox cho AI Agent)</span></td>
              <td><span className="pill pill-amber">Cấp 3 · Firecracker</span></td>
              <td>Code do AI sinh ra hoàn toàn không đáng tin — <b>mỗi phiên chạy trong một máy ảo riêng</b>, chấp nhận tốn RAM nền để đổi an toàn tuyệt đối</td>
            </tr>
            <tr>
              <td><b>Modal</b> / <b>Google Cloud Run</b></td>
              <td><span className="pill">Cấp 2 · gVisor</span></td>
              <td>Chặn lệnh hệ thống bằng <b>lớp nhân ảo trung gian</b> — an toàn hơn container thuần, nhẹ và nhanh hơn máy ảo riêng</td>
            </tr>
            <tr>
              <td><b>OpenSandbox</b></td>
              <td><span className="pill">Cấp 1+ · Container gia cố</span></td>
              <td>Container + hardening, <b>daemon bên trong</b> điều khiển thực thi — cân bằng cho workload AI Agent</td>
            </tr>
            <tr>
              <td><b>Cloudflare Workers</b></td>
              <td><span className="pill pill-plain">Ngoài phổ · V8 Isolate</span></td>
              <td>Cô lập ngay <b>bên trong bộ thực thi ngôn ngữ</b> — nhẹ nhất (chung tiến trình), nhưng bị giới hạn quyền với hệ thống</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note d3"><b>Nhận xét:</b> cấp độ cô lập càng cao (→ máy ảo riêng) càng được các nền tảng lớn tin dùng cho code <i>hoàn toàn không tin cậy</i>; cấp thấp hơn tồn tại khi cần đánh đổi hiệu năng / chi phí.</p>
    </>
  ),

  /* 7 — SandboxRuntime interface */
  () => (
    <>
      <h2>Trừu tượng hóa tầng Cô lập — <span style={{ color: 'var(--purple)' }}>SandboxRuntime</span> Interface</h2>
      <p className="subtitle">Phần điều khiển bên ngoài không cần biết môi trường được tạo bằng công nghệ nào — muốn nâng cấp chỉ cần đổi cấu hình.</p>
      <div className="cols" style={{ marginTop: 16, alignItems: 'flex-start' }}>
        <div className="col d1" style={{ flex: 1.05 }}>
          <div className="diagram-wrap" style={{ padding: '14px 12px 6px' }}>
            <svg viewBox="0 0 470 320" role="img" aria-label="SandboxRuntime Interface">
              <defs>
                <marker id="arr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#80708f" strokeWidth="1.6" />
                </marker>
              </defs>
              <rect x="105" y="12" width="260" height="46" fill="#faf9fb" stroke="#dbd6e1" strokeWidth="1.5" rx="8" />
              <text x="235" y="40" textAnchor="middle" fontSize="13.5" fontWeight="600" fill="#1c1028">Host Orchestrator</text>
              <line x1="235" y1="58" x2="235" y2="88" stroke="#80708f" strokeWidth="1.6" markerEnd="url(#arr3)" />
              <rect x="85" y="94" width="300" height="56" fill="#ede8f5" stroke="#6c5fc7" strokeWidth="1.8" rx="9" strokeDasharray="6 4" />
              <text x="235" y="118" textAnchor="middle" fontSize="11" fontStyle="italic" fill="#6c5fc7">«interface»</text>
              <text x="235" y="137" textAnchor="middle" fontSize="14.5" fontWeight="700" fill="#4a3f8f">SandboxRuntime</text>
              <line x1="115" y1="150" x2="80" y2="212" stroke="#80708f" strokeWidth="1.5" markerEnd="url(#arr3)" />
              <line x1="235" y1="150" x2="235" y2="212" stroke="#80708f" strokeWidth="1.5" markerEnd="url(#arr3)" />
              <line x1="355" y1="150" x2="390" y2="212" stroke="#80708f" strokeWidth="1.5" markerEnd="url(#arr3)" />
              <rect x="18" y="218" width="128" height="64" fill="#fff" stroke="#dbd6e1" strokeWidth="1.5" rx="8" />
              <text x="82" y="243" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#1c1028">DockerProvider</text>
              <text x="82" y="264" textAnchor="middle" fontSize="11" fill="#80708f">OCI · runc</text>
              <rect x="171" y="218" width="128" height="64" fill="#fff" stroke="#dbd6e1" strokeWidth="1.5" rx="8" />
              <text x="235" y="243" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#1c1028">GVisorProvider</text>
              <text x="235" y="264" textAnchor="middle" fontSize="11" fill="#80708f">OCI · runsc</text>
              <rect x="324" y="218" width="128" height="64" fill="#fff" stroke="#dbd6e1" strokeWidth="1.5" rx="8" />
              <text x="388" y="243" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#1c1028">KataProvider</text>
              <text x="388" y="264" textAnchor="middle" fontSize="11" fill="#80708f">OCI · kata-runtime</text>
              <text x="235" y="306" textAnchor="middle" fontSize="11.5" fill="#80708f">Cùng một chuẩn chung — đổi công nghệ bằng một dòng cấu hình, không đổi code</text>
            </svg>
          </div>
        </div>
        <div className="col d2">
          <pre className="code-block">{`«interface» SandboxRuntime
  Create(ctx, spec)     → Sandbox
  Destroy(ctx, id)
  Attach(ctx, id)       → ControlChannel
  Capabilities()        → RuntimeCaps

«interface» ControlChannel
  // kênh giao tiếp nội bộ ⇆ kênh máy ảo
  Call(ctx, req)      → ExecResult
  Stream(ctx)         → log chunks

// Tự khai báo năng lực thay cho if-else:
caps.Snapshot      // chỉ Firecracker
caps.NestedVirtReq // chỉ Kata cần /dev/kvm`}</pre>
        </div>
      </div>
      <p className="note d3"><b>Bằng chứng mô hình đã kiểm chứng:</b> hệ thống của Google và Kubernetes thiết kế đúng theo cách này — một lớp giao tiếp thống nhất cho nhiều bộ máy chạy nền, đã kiểm chứng ở quy mô rất lớn.</p>
    </>
  ),

  /* 8 — Divider: Part 2 */
  () => (
    <div className="divider-center">
      <div className="divider-num">02</div>
      <h1>Cơ chế Thực thi</h1>
      <div className="divider-line" />
      <p className="subtitle">Điều khiển môi trường đã khóa kín một cách chính xác đến từng mili-giây.</p>
    </div>
  ),

  /* 9 — 4 requirements */
  () => (
    <>
      <h2>Nghịch lý điều khiển từ xa — 4 yêu cầu khắt khe của AI Agent</h2>
      <p className="subtitle">Host Orchestrator phải gửi lệnh vào lồng kín — khác hẳn con người gõ lệnh, vì Agent không tự biết xử lý tình huống.</p>
      <div className="cards" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="icon-badge"><Brain /></div>
          <h3>1 · Tính lưu trạng thái</h3>
          <p style={{ color: 'var(--muted)', fontSize: '1.04rem' }}>
            Bước 1: <code>cd app &amp;&amp; export ENV=dev</code> → bước 2: <code>pytest</code> phải <b>kế thừa thư mục, biến môi trường</b> — hoặc giữ biến dữ liệu trong RAM (Jupyter).
          </p>
        </div>
        <div className="card">
          <div className="icon-badge"><Timer /></div>
          <h3>2 · Kiểm soát vòng đời lệnh</h3>
          <p style={{ color: 'var(--muted)', fontSize: '1.04rem' }}>
            Biết chính xác đến từng mili-giây: lệnh bắt đầu khi nào, dòng nào là <code>stdout</code> / <code>stderr</code>, khi nào kết thúc, <b>exit_code</b> là bao nhiêu.
          </p>
        </div>
        <div className="card">
          <div className="icon-badge"><TimerOff /></div>
          <h3>3 · Xử lý treo</h3>
          <p style={{ color: 'var(--muted)', fontSize: '1.04rem' }}>
            Agent <b>không biết bấm Ctrl+C</b> khi lệnh hỏi <code>[y/N]</code> hay chạy server ngầm (<code>npm run dev</code>). Tầng thực thi phải tự xử lý — không treo chết luồng suy nghĩ.
          </p>
        </div>
        <div className="card">
          <div className="icon-badge"><Network /></div>
          <h3>4 · Tách kênh điều khiển khỏi Internet</h3>
          <p style={{ color: 'var(--muted)', fontSize: '1.04rem' }}>
            Kênh truyền lệnh Host → Sandbox phải <b>vẫn hoạt động ngay cả khi</b> Sandbox bị cắt Internet hoàn toàn (<code>--network none</code>).
          </p>
        </div>
      </div>
    </>
  ),

  /* 10 — 3 execution models table */
  () => (
    <>
      <h2>Ba mô hình thực thi — vì sao docker exec là ngõ cụt</h2>
      <div style={{ marginTop: 14 }}>
        <table className="compare">
          <thead>
            <tr>
              <th style={{ width: '16%' }}>Tiêu chí</th>
              <th style={{ width: '26%' }}>M1 · docker exec (không nhớ trạng thái)</th>
              <th style={{ width: '27%' }}>M2 · giữ phiên terminal từ ngoài</th>
              <th>M3 · Daemon bên trong ★</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Bản chất</td>
              <td>Docker Engine đẻ tiến trình <code>/bin/sh -c</code> mới cho <b>mỗi</b> lệnh, xong tự hủy</td>
              <td>Giữ 1 phiên <code>/bin/bash</code>, bơm chuỗi lệnh vào <b>stdin/stdout liên tục</b></td>
              <td className="hl"><b>Server nhỏ (Go/Python) chạy sẵn</b> trong Sandbox — Host gọi API gRPC / WebSocket</td>
            </tr>
            <tr>
              <td>Giữ trạng thái</td>
              <td className="bad">Không — lệnh sau <b>mất sạch</b> trạng thái lệnh trước</td>
              <td className="bad">Có cho Bash, nhưng rất khó quản lý trạng thái RAM của Python/Node</td>
              <td className="hl good">Hoàn hảo — Daemon tự quản cả phiên Bash (PTY) lẫn nhân Jupyter</td>
            </tr>
            <tr>
              <td>Phát hiện kết thúc &amp; exit_code</td>
              <td className="good">Dễ — tiến trình tự chết khi xong</td>
              <td className="bad">Rất khó &amp; dễ lỗi — phải <b>đoán</b> kết thúc qua đánh dấu <code>echo "---DONE:$?---"</code></td>
              <td className="hl good">Chuẩn xác 100% — quản tiến trình con trực tiếp, trả kết quả có cấu trúc rõ ràng</td>
            </tr>
            <tr>
              <td>Timeout &amp; giết tiến trình</td>
              <td className="bad">Gọi <code>kill</code> qua Docker API — dễ <b>bỏ sót tiến trình con</b></td>
              <td className="bad">Rất khó ngắt sạch nếu lệnh con chiếm quyền terminal</td>
              <td className="hl good">Tự động &amp; triệt để — gắn vào <b>Process Group (pgid)</b>, diệt cả cây tiến trình</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  ),

  /* 11 — 3 execution flows SVG */
  () => (
    <>
      <h2>Ba luồng hoạt động của ba cách thực thi</h2>
      <div className="diagram-wrap d1">
        <ExecFlowsSVG />
      </div>
      <p className="note d2"><b>Tóm tắt:</b> M1 mỗi lệnh một tiến trình mới — mất sạch trạng thái; M2 giữ phiên nhưng phải <i>đoán</i> kết thúc; chỉ <b>M3</b> đáp ứng đủ cả 4 yêu cầu — vì Daemon quản tiến trình con trực tiếp từ bên trong.</p>
    </>
  ),

  /* 12 — Daemon architecture SVG */
  () => (
    <>
      <h2>Giải phẫu Mô hình 3 — Daemon bên trong Sandbox</h2>
      <div className="diagram-wrap d1">
        <DaemonArchSVG />
      </div>
      <p className="note d2" style={{ textAlign: 'center', marginTop: 14 }}>
        <b>Đây là mô hình chuẩn ngành:</b> các nền tảng sandbox hiện đại khác như <b>OpenSandbox</b>, <b>E2B</b> cũng
        đặt một daemon bên trong môi trường để thực thi lệnh — không dùng <code>docker exec</code> từ ngoài.
      </p>
    </>
  ),

  /* 13 — Conclusion */
  () => (
    <>
      <h2>Điểm chốt kiến trúc</h2>
      <p className="subtitle">Tách tầng Thực thi → tầng Cô lập trở thành thứ có thể thay thế.</p>
      <blockquote className="quote">
        Nếu chỉ dùng <code>docker exec</code> (Mô hình 1 &amp; 2), hệ thống bị <b>khóa chặt vào Docker</b>.
        Khi đặt một <b>trình điều khiển nhỏ chạy bên trong sandbox</b>, giao tiếp qua kênh riêng (Mô hình 3),
        logic thực thi lệnh của Agent <b>hoàn toàn độc lập với Tầng Cô lập</b> — có thể nâng cấp lớp vỏ
        bất cứ lúc nào mà <b>không sửa một dòng code thực thi nào</b>.
      </blockquote>
      <div className="migrate">
        <div className="stage">
          <div className="t1">Container</div>
          <div className="t2">Docker (runc)</div>
        </div>
        <ArrowRight size={20} />
        <div className="stage">
          <div className="t1">Sandboxed Container</div>
          <div className="t2">gVisor (runsc)</div>
        </div>
        <ArrowRight size={20} />
        <div className="stage stage-final">
          <div className="t1">MicroVM</div>
          <div className="t2">Kata / Firecracker</div>
        </div>
      </div>
      <p className="note" style={{ textAlign: 'center' }}>Đổi lớp vỏ cô lập — giữ nguyên mọi code thực thi của Agent.</p>
    </>
  ),

  /* 14 — Thanks */
  () => (
    <div className="title-center">
      <h1 style={{ fontSize: '3.6rem' }}>Trân trọng <span style={{ color: 'var(--purple)' }}>cảm ơn</span></h1>
      <p className="subtitle">Sandbox Kit — Cô lập &amp; Thực thi trong môi trường AI Agent</p>
      <p className="title-meta">← → để duyệt lại · Chấm tròn bên dưới để nhảy đến slide bất kỳ</p>
    </div>
  ),
]

/* ───────────────────────── APP ───────────────────────── */

function Nav({ cur, total, go, setCur }) {
  return (
    <nav>
      <button onClick={() => go(-1)} disabled={cur === 0} aria-label="Slide trước">←</button>
      <div className="dots">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className={`dot${i === cur ? ' on' : ''}`} onClick={() => setCur(i)} />
        ))}
      </div>
      <button onClick={() => go(1)} disabled={cur === total - 1} aria-label="Slide sau">→</button>
      <span className="slide-number">{cur + 1} / {total}</span>
    </nav>
  )
}

export default function App() {
  const initial = (() => {
    const n = parseInt(new URLSearchParams(window.location.search).get('slide'), 10)
    return Number.isInteger(n) && n >= 1 && n <= SLIDES.length ? n - 1 : 0
  })()
  const [cur, setCur] = useState(initial)
  const go = useCallback((d) => setCur((c) => Math.max(0, Math.min(SLIDES.length - 1, c + d))), [])

  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [go])

  return (
    <>
      {cur > 0 && (
        <div className="glyph-watermark">
          <span className="watermark-title">Sandbox Kit · Isolation &amp; Execution</span>
        </div>
      )}
      <div className="progress" style={{ width: `${((cur + 1) / SLIDES.length) * 100}%` }} />
      {SLIDES.map((S, i) => (
        <div key={i} className={`slide ${i === cur ? 'active' : ''}`}>
          <div className={`slide-content${i === cur ? ' anim' : ''}`}>
            <S />
          </div>
        </div>
      ))}
      <Nav cur={cur} total={SLIDES.length} go={go} setCur={setCur} />
    </>
  )
}
