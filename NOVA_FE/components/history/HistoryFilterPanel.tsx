"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n-context";
import { defaultFilters, type HistoryFilters } from "@/lib/history-data";

type Choice = [string, string];
const Chevron = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;

function FilterSelect({ label, value, choices, onChange }: { label: string; value: string; choices: Choice[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const panel = menu.current;
    const position = () => {
      const r = trigger.current!.getBoundingClientRect();
      panel.style.width = `${r.width}px`;
      panel.style.left = `${r.left}px`;
      panel.style.maxHeight = `${Math.min(300, window.innerHeight - 24)}px`;
      panel.style.top = `${Math.max(12, Math.min(r.bottom + 6, window.innerHeight - panel.getBoundingClientRect().height - 12))}px`;
    };
    panel.showPopover(); position();
    panel.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!wrapper.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (!open) { setOpen(true); return; }
    const options = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>("button"));
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    options[e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
  };
  return <div className="history-select">
    <span>{label}</span>
    <div ref={wrapper} className={`crafted-select${open ? " is-open" : ""}`} onKeyDown={keys}>
      <button ref={trigger} type="button" className="crafted-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span>{choices.find(([id]) => id === value)?.[1]}</span><Chevron /></button>
      {open && <div ref={menu} className="crafted-menu history-choice-menu" popover="manual" role="listbox" aria-label={label}>
        {choices.map(([id, title]) => <button key={id} type="button" role="option" tabIndex={-1} aria-selected={value === id} onClick={() => { onChange(id); close(); }}>{title}</button>)}
      </div>}
    </div>
  </div>;
}

const stamp = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function HistoryFilterPanel({ filters, setFilters, resultCount }: { filters: HistoryFilters; setFilters: (filters: HistoryFilters) => void; resultCount: number }) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => lang === "bg" ? bg : en;
  const [rangeOpen, setRangeOpen] = useState(false);
  const [start, setStart] = useState(filters.fromDate);
  const [end, setEnd] = useState(filters.toDate);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [month, setMonth] = useState(() => new Date(filters.fromDate ? `${filters.fromDate}T12:00:00` : Date.now()));
  const rangeTrigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  const pretty = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  const set = (patch: Partial<HistoryFilters>) => setFilters({ ...filters, ...patch });
  const toggleRange = () => {
    if (!rangeOpen) {
      setStart(filters.fromDate); setEnd(filters.toDate); setPickingEnd(false);
      setMonth(new Date(filters.fromDate ? `${filters.fromDate}T12:00:00` : Date.now()));
    }
    setRangeOpen(!rangeOpen);
  };
  const selectDate = (date: string) => {
    if (!pickingEnd) { setStart(date); setEnd(""); setPickingEnd(true); }
    else {
      const [fromDate, toDate] = [start, date].sort();
      setStart(fromDate); setEnd(toDate); setPickingEnd(false);
      set({ period: "custom", fromDate, toDate });
      setRangeOpen(false); rangeTrigger.current?.focus();
    }
  };
  const calendarKey = (e: KeyboardEvent<HTMLButtonElement>, value: string) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + step);
    setMonth(date);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-date="${stamp(date)}"]`)?.focus());
  };
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(1 - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, i) => { const date = new Date(first); date.setDate(first.getDate() + i); return date; });
  const rangeLabel = filters.fromDate && filters.toDate ? `${pretty(filters.fromDate)} – ${pretty(filters.toDate)}` : l("Всички дати", "All dates");
  return <div ref={root} className={`history-filter-content${rangeOpen ? " range-focused" : ""}`} onKeyDown={e => {
    if (e.key === "Escape" && rangeOpen) { e.preventDefault(); e.stopPropagation(); setRangeOpen(false); rangeTrigger.current?.focus(); }
  }}>
    <div className="history-popover-title">{l("Подреждане и филтри", "Sort & Filter")}</div>
    <div className="filter-upper-collapse" inert={rangeOpen} aria-hidden={rangeOpen}>
      <div className="range-upper-fields">
        <FilterSelect label={l("Подреди", "Sort")} value={filters.sortOrder} onChange={sortOrder => set({ sortOrder })} choices={[
          ["newest", l("Най-нови", "Newest first")], ["oldest", l("Най-стари", "Oldest first")], ["az", l("Заглавие: А–Я", "Title: A–Z")], ["za", l("Заглавие: Я–А", "Title: Z–A")], ["shortest", l("Най-кратки", "Shortest first")], ["longest", l("Най-дълги", "Longest first")], ["status", l("Първо в процес", "In Progress first")],
        ]} />
        <FilterSelect label={l("Статус", "Status")} value={filters.statusFilter} onChange={statusFilter => set({ statusFilter })} choices={[["all", l("Всички", "All")], ["complete", l("Завършено", "Complete")], ["progress", l("В процес", "In Progress")]]} />
        <FilterSelect label={l("Продължителност", "Duration")} value={filters.durationFilter} onChange={durationFilter => set({ durationFilter })} choices={[["all", l("Всички", "Any duration")], ["short", l("Под 1 мин", "Under 1 min")], ["medium", l("1–5 мин", "1–5 min")], ["long", l("5+ мин", "5+ min")], ["none", l("Без продължителност", "No duration")]]} />
      </div>
    </div>
    <div className="history-select">
      <span>{l("Период", "Date Range")}</span>
      <div className={`crafted-select with-calendar${rangeOpen ? " is-open" : ""}`}>
        <button ref={rangeTrigger} type="button" className="crafted-trigger" aria-label={l("Период", "Date Range")} aria-expanded={rangeOpen} title={rangeLabel} onClick={toggleRange}><span>{rangeLabel}</span><Chevron /></button>
        <button type="button" className="calendar-shortcut" aria-label={l("Избери период от календара", "Choose dates from calendar")} aria-expanded={rangeOpen} onClick={toggleRange}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16M8 14h3m2 3h3" /></svg></button>
      </div>
    </div>
    <div className="filter-calendar-collapse" inert={!rangeOpen} aria-hidden={!rangeOpen}>
      <div className="filter-calendar-clip">
        <div className="crafted-calendar filter-range-calendar" role="region" aria-label={l("Избери период", "Choose date range")}>
          <div className="calendar-month"><button type="button" aria-label={l("Предишен месец", "Previous month")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month)}</strong><button type="button" aria-label={l("Следващ месец", "Next month")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
          <p className="range-instruction" role="status">{pickingEnd ? l("Избери крайна дата", "Choose an end date") : start && end ? `${pretty(start)} – ${pretty(end)}` : l("Избери начална дата", "Choose a start date")}</p>
          <div className="calendar-weekdays">{(lang === "bg" ? ["П", "В", "С", "Ч", "П", "С", "Н"] : ["M", "T", "W", "T", "F", "S", "S"]).map((day, i) => <span key={i}>{day}</span>)}</div>
          <div className="calendar-days">{days.map(date => {
            const value = stamp(date), selected = value === start || value === end;
            return <button key={value} type="button" data-date={value} aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date)} aria-pressed={selected} className={`${date.getMonth() !== month.getMonth() ? "outside " : ""}${selected ? "selected" : start && end && value > start && value < end ? "in-range" : ""}`} onClick={() => selectDate(value)} onKeyDown={e => calendarKey(e, value)}>{date.getDate()}</button>;
          })}</div>
        </div>
      </div>
    </div>
    <button id="reset-history" type="button" className="primary full options-button" aria-label={rangeOpen ? l("Изчисти периода", "Clear Range") : l("Изчисти", "Reset")} onClick={() => {
      if (rangeOpen) { setStart(""); setEnd(""); setPickingEnd(false); set({ period: "all", fromDate: "", toDate: "" }); }
      else setFilters(defaultFilters());
    }}><span className="reset-label-window" aria-hidden="true"><span className="reset-label-track"><span>{l("Изчисти", "Reset")}</span><span>{l("Изчисти периода", "Clear Range")}</span></span></span></button>
    <p className="history-filter-feedback" role="status">{resultCount} {l("записа", "results")}</p>
  </div>;
}
