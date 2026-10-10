"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { type HistoryFilters } from "@/lib/history-data";

import { HistoryFilterPanel } from "./HistoryFilterPanel";

interface ToolbarProps {
  filters: HistoryFilters;
  setFilters: (f: HistoryFilters) => void;
  resultCount: number;
}

export function HistoryToolbar({ filters, setFilters, resultCount }: ToolbarProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const toolRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!popoverOpen) return;
    const panel = popoverRef.current;
    const trigger = toolRef.current;
    if (!panel || !trigger) return;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const contentWidth = trigger.closest(".history-toolbar")?.getBoundingClientRect().width ?? 300;
      const width = Math.min(300, contentWidth, window.innerWidth - 32);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`;
      panel.style.maxHeight = `${window.innerHeight - 32}px`;
      panel.style.top = `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - panel.getBoundingClientRect().height - 16))}px`;
    };
    position();
    panel.showPopover();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [popoverOpen]);

  const typeTabs: [string, string][] = [
    ["all", l("Всички", "All")],
    ["call", l("Входящи", "In")],
    ["callback", l("Изходящи", "Out")],
    ["task", l("Задача", "Task")],
    ["sms", l("СМС", "SMS")],
  ];

  // Sliding highlight for the active type tab.
  const filtersRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const tabs = filtersRef.current;
    if (!tabs) return;
    const moveHighlight = () => {
      const active = tabs.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!active) return;
      const next = { left: active.offsetLeft, width: active.offsetWidth };
      setHighlight((current) =>
        current.left === next.left && current.width === next.width ? current : next,
      );
    };
    moveHighlight();
    const observer = new ResizeObserver(moveHighlight);
    observer.observe(tabs);
    tabs.querySelectorAll("button").forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [filters.filter, lang]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!toolRef.current?.contains(e.target as Node)) setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setPopoverOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const set = (patch: Partial<HistoryFilters>) => setFilters({ ...filters, ...patch });

  const activeCount = [
    filters.statusFilter !== "all",
    filters.period !== "all",
    filters.durationFilter !== "all",
    filters.sortOrder !== "newest",
  ].filter(Boolean).length;

  return (
    <div className="history-toolbar">
      <div ref={filtersRef} className={`history-filters${highlight.width ? " tabs-ready" : ""}`} role="group" aria-label={l("Тип записи", "Record type")}>
        <span className="history-tab-highlight" aria-hidden="true" style={{ transform: `translateX(${highlight.left}px)`, width: highlight.width }} />
        {typeTabs.map(([id, label]) => (
          <button key={id} aria-pressed={filters.filter === id} onClick={() => set({ filter: id })}>
            {label}
          </button>
        ))}
      </div>

      <input
        type="search"
        id="history-search"
        placeholder={l("Търси", "Search")}
        aria-label={l("Търси в историята", "Search history")}
        value={filters.query}
        onChange={(e) => set({ query: e.target.value })}
      />

      <div ref={toolRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          className={`history-tool${activeCount ? " is-active" : ""}`}
          aria-expanded={popoverOpen}
          title={l("Подреждане и филтри", "Sort & Filter")}
          onClick={() => setPopoverOpen((o) => !o)}
        >
          <Icon name="sliders" />
          <span>{l("Подреждане и филтри", "Sort & Filter")}</span>
          {activeCount > 0 && <span id="filter-count">{activeCount}</span>}
        </button>

        {popoverOpen && (
          <div
            ref={popoverRef}
            popover="manual"
            className="history-popover history-sort-panel"
          >
            <HistoryFilterPanel filters={filters} setFilters={setFilters} resultCount={resultCount} />
          </div>
        )}
      </div>
    </div>
  );
}
