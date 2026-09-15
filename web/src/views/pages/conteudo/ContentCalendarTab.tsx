import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatTime } from "../../../lib/formatters";
import type { CalendarTopic, ReelListEntry } from "../../../types/api";
import { getMonthGridDays, getWeekDays, isSameDay } from "./calendarGrid";
import { buildContentCalendarEvents, type ContentCalendarEvent, type ContentEventType } from "./contentCalendarEvents";

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

function formatMonthLabel(date: Date): string {
  const label = MONTH_LABEL.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const EVENT_STYLE: Record<ContentEventType, { dot: string; chip: string; label: string }> = {
  blog: { dot: "bg-status-ok", chip: "bg-status-ok/15 text-status-ok", label: "Blog" },
  reel: { dot: "bg-reel", chip: "bg-reel/15 text-reel", label: "Reel" },
};

const MAX_VISIBLE_PER_DAY = 3;

function EventChip({ event }: { event: ContentCalendarEvent }) {
  const style = EVENT_STYLE[event.type];
  const inner = (
    <div className={`rounded-md px-1.5 py-1 text-left text-[10px] leading-snug ${style.chip}`}>
      <div className="flex items-center gap-1 font-semibold">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        {style.label}
      </div>
      <div className="mt-0.5 truncate text-primary" title={event.title}>{event.title}</div>
      <div className="text-secondary">{formatTime(event.date)}</div>
    </div>
  );
  return event.href ? (
    <Link to={event.href} className="block hover:opacity-80">{inner}</Link>
  ) : (
    <div>{inner}</div>
  );
}

export function ContentCalendarTab({ topics, reels, loading }: { topics: CalendarTopic[]; reels: ReelListEntry[]; loading: boolean }) {
  const [mode, setMode] = useState<"semana" | "mes">("mes");
  const [reference, setReference] = useState(() => new Date());

  const events = useMemo(() => buildContentCalendarEvents(topics, reels), [topics, reels]);

  const days = mode === "mes" ? getMonthGridDays(reference) : getWeekDays(reference);
  const today = new Date();

  function shift(amount: number) {
    setReference((prev) => {
      const next = new Date(prev);
      if (mode === "mes") next.setMonth(next.getMonth() + amount);
      else next.setDate(next.getDate() + amount * 7);
      return next;
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shift(-1)} aria-label="Período anterior" className="rounded-md border border-border px-2 py-1 text-sm text-secondary hover:bg-surface">←</button>
          <h2 className="min-w-[160px] text-sm font-semibold text-primary">{formatMonthLabel(reference)}</h2>
          <button type="button" onClick={() => shift(1)} aria-label="Próximo período" className="rounded-md border border-border px-2 py-1 text-sm text-secondary hover:bg-surface">→</button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={() => setMode("semana")} className={`rounded-md px-3 py-1.5 ${mode === "semana" ? "bg-accent text-white" : "border border-border text-secondary hover:bg-surface"}`}>Semana</button>
          <button type="button" onClick={() => setMode("mes")} className={`rounded-md px-3 py-1.5 ${mode === "mes" ? "bg-accent text-white" : "border border-border text-secondary hover:bg-surface"}`}>Mês</button>
          <button type="button" onClick={() => setReference(new Date())} className="rounded-md border border-border px-3 py-1.5 text-secondary hover:bg-surface">Hoje</button>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-secondary">Aguardando dados</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-lg border border-border bg-border text-center text-xs font-semibold text-secondary">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="bg-surface py-2">{label}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-lg border border-t-0 border-border bg-border">
                {days.map((day) => {
                  const dayEvents = events.filter((e) => isSameDay(e.date, day));
                  const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY);
                  const overflow = dayEvents.length - visible.length;
                  const inMonth = mode === "semana" || day.getMonth() === reference.getMonth();
                  return (
                    <div
                      key={day.toISOString()}
                      className={`flex min-h-[104px] flex-col gap-1 p-1.5 ${inMonth ? "bg-surface" : "bg-app"}`}
                    >
                      <span className={`text-xs ${isSameDay(day, today) ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent font-semibold text-white" : inMonth ? "text-secondary" : "text-secondary/40"}`}>
                        {day.getDate()}
                      </span>
                      {visible.map((event) => <EventChip key={event.id} event={event} />)}
                      {overflow > 0 ? <span className="text-[10px] text-secondary">+{overflow} mais</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4 text-xs text-secondary">
            {(Object.keys(EVENT_STYLE) as ContentEventType[]).map((type) => (
              <span key={type} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${EVENT_STYLE[type].dot}`} aria-hidden="true" />
                {EVENT_STYLE[type].label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
