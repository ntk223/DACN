/**
 * OverviewPage.tsx — trang chủ của trang quản trị: 3 tab con.
 * 1. Tổng quan  — dashboard từ GET /admin/api/overview (+ /admin/api/sandboxes).
 * 2. Console MCP — gọi 14 tool MCP qua POST /mcp/ (port từ trang admin cũ).
 * 3. Tải lên / Tải xuống — luồng REST /upload theo phần và /download.
 */

import { useState } from "react";

import { Tabs } from "@/components/Tabs";

import { ConsoleTab } from "./ConsoleTab";
import { OverviewTab } from "./OverviewTab";
import { TransferTab } from "./TransferTab";
import "./overview.css";

type TabKey = "dashboard" | "console" | "transfer";

const TAB_ITEMS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "dashboard", label: "Tổng quan" },
  { key: "console", label: "Console MCP" },
  { key: "transfer", label: "Tải lên / Tải xuống" },
];

export function OverviewPage() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  return (
    <div className="ov-page">
      <Tabs items={TAB_ITEMS} active={tab} onChange={setTab} />
      {tab === "dashboard" ? <OverviewTab /> : tab === "console" ? <ConsoleTab /> : <TransferTab />}
    </div>
  );
}
