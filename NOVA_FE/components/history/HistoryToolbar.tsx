"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { defaultFilters, type HistoryFilters } from "@/lib/history-data";

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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPopoverOpen(false);
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

  const select = (
    id: keyof HistoryFilters,
    label: string,
    choices: [string, string][],
  ) => (
    <label className="history-select">
      <span>{label}</span>
      <select
        aria-label={label}
        value={filters[id] as string}
        onChange={(e) => set({ [id]: e.target.value } as Partial<HistoryFilters>)}
      >
        {choices.map(([k, title]) => (
          <option key={k} value={k}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );

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
            className="history-popover"
            style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300, maxHeight: "70vh" }}
          >
            <div className="history-popover-title">{l("Подреждане и филтри", "Sort & Filter")}</div>
            <div className="history-refinements">
              {select("sortOrder", l("Подреди", "Sort"), [
                ["newest", l("Най-нови", "Newest first")],
                ["oldest", l("Най-стари", "Oldest first")],
                ["az", l("Заглавие: А–Я", "Title: A–Z")],
                ["za", l("Заглавие: Я–А", "Title: Z–A")],
                ["shortest", l("Най-кратки", "Shortest first")],
                ["longest", l("Най-дълги", "Longest first")],
                ["status", l("Първо в процес", "In Progress first")],
              ])}
              {select("statusFilter", l("Статус", "Status"), [
                ["all", l("Всички", "All")],
                ["complete", l("Завършено", "Complete")],
                ["progress", l("В процес", "In Progress")],
              ])}
              {select("durationFilter", l("Продължителност", "Duration"), [
                ["all", l("Всички", "Any duration")],
                ["short", l("Под 1 мин", "Under 1 min")],
                ["medium", l("1–5 мин", "1–5 min")],
                ["long", l("5+ мин", "5+ min")],
                ["none", l("Без продължителност", "No duration")],
              ])}
              {select("period", l("Период", "Date Range"), [
                ["all", l("Всички дати", "All dates")],
                ["today", l("Днес", "Today")],
                ["week", l("Последните 7 дни", "Last 7 days")],
                ["month", l("Последните 30 дни", "Last 30 days")],
                ["custom", l("Избери дати", "Custom dates")],
              ])}
              <button type="button" className="primary full options-button" onClick={() => setFilters(defaultFilters())}>
                {l("Изчисти", "Reset")}
              </button>
            </div>
            {filters.period === "custom" && (
              <div className="history-date-range" style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  {l("От", "From")}
                  <input type="date" value={filters.fromDate} onChange={(e) => set({ fromDate: e.target.value })} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  {l("До", "To")}
                  <input type="date" value={filters.toDate} onChange={(e) => set({ toDate: e.target.value })} />
                </label>
              </div>
            )}
            <p className="history-filter-feedback" role="status">
              {filters.period === "custom" && filters.fromDate && filters.toDate && filters.fromDate > filters.toDate
                ? l("Началната дата трябва да е преди крайната.", "Start date must be before end date.")
                : `${resultCount} ${l("записа", "results")}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
