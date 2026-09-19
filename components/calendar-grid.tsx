'use client';
import { useEffect, useRef, useState } from 'react';
import type { Card, CalendarEvent, LifeState } from '@/lib/domain';
import {
  buildDayLayout,
  clampResize,
  dayBounds,
  CARD_DRAG_META,
  decodeGrabOffset,
  dropInterval,
  encodeGrabOffset,
  pointerTimestamp,
  selectionIntervalFromTimestamps,
  TRACK_HEIGHT,
  moscowNowPosition,
} from '@/lib/calendar-layout';
import './calendar-grid.css';
type Props = {
  days: string[];
  scheduled: Card[];
  allCards: Card[];
  events: CalendarEvent[];
  sources: LifeState['sources'];
  pending: boolean;
  onSchedule: (id: string, start: string, end: string) => Promise<boolean>;
  onScheduleEvent: (
    event: CalendarEvent,
    start: string,
    end: string,
  ) => Promise<boolean>;
  onCreateEvent: (day: string, time: string, durationMinutes?: number) => void;
  onSelectCard: (id: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onDragCard: (id: string | null) => void;
};
type Interval = { start: number; end: number };
type Drag = Interval & {
  id: string;
  edge: 'start' | 'end';
  offset: number;
  day: string;
  pointer: number;
  element: HTMLElement;
  preview: Interval;
};
type Selection = {
  day: string;
  pointer: number;
  startY: number;
  startTimestamp: number;
  currentY: number;
  track: HTMLDivElement;
  active: boolean;
};
const iso = (n: number) => new Date(n).toISOString();
const clock = (n: number) =>
  new Intl.DateTimeFormat('ru', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(n));
export function CalendarGrid({
  days,
  scheduled,
  allCards,
  events,
  sources,
  pending,
  onSchedule,
  onScheduleEvent,
  onCreateEvent,
  onSelectCard,
  onSelectEvent,
  onDragCard,
}: Props) {
  const tracks = useRef<Record<string, HTMLDivElement | null>>({});
  const drag = useRef<Drag | null>(null);
  const bodyGrab = useRef<{ id: string; day: string; offset: number } | null>(
    null,
  );
  const selection = useRef<Selection | null>(null);
  const suppressDoubleClick = useRef(0);
  const [preview, setPreview] = useState<(Interval & { id: string }) | null>(
    null,
  );
  const [now, setNow] = useState<Date | null>(null);
  const cancelSelection = () => {
    const current = selection.current;
    if (!current) return;
    selection.current = null;
    setPreview(null);
    if (current.track.hasPointerCapture(current.pointer))
      current.track.releasePointerCapture(current.pointer);
  };
  const updateSelection = (current: Selection) => {
    const rect = current.track.getBoundingClientRect();
    const currentTimestamp = pointerTimestamp(
      current.day,
      current.currentY,
      rect.top,
      rect.height,
    );
    const stableRange = selectionIntervalFromTimestamps(
      current.day,
      current.startTimestamp,
      currentTimestamp,
    );
    setPreview({ id: `selection:${current.day}`, ...stableRange });
  };
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const nowPosition = now ? moscowNowPosition(now) : null;
  const schedule = (id: string, start: string, end: string) => {
    const event = events.find((event) => event.id === id && event.seriesId);
    return event
      ? onScheduleEvent(event, start, end)
      : onSchedule(id, start, end);
  };
  const finish = (cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setPreview(null);
    if (current.element.hasPointerCapture(current.pointer))
      current.element.releasePointerCapture(current.pointer);
    if (
      !cancel &&
      (current.start !== current.preview.start ||
        current.end !== current.preview.end)
    )
      void schedule(
        current.id,
        iso(current.preview.start),
        iso(current.preview.end),
      );
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (drag.current || selection.current)) {
        e.preventDefault();
        if (drag.current) finish(true);
        if (selection.current) cancelSelection();
      }
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      const current = drag.current;
      drag.current = null;
      if (current?.element.hasPointerCapture(current.pointer))
        current.element.releasePointerCapture(current.pointer);
      cancelSelection();
    };
  }, []);
  const dayKey = days.join('|');
  useEffect(() => () => cancelSelection(), [dayKey]);
  useEffect(() => {
    const cancel = () => cancelSelection();
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);
  const begin = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
    day: string,
    edge: 'start' | 'end',
    start: number,
    end: number,
  ) => {
    if (pending || drag.current || e.button !== 0) return;
    const track = tracks.current[day];
    if (!track) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    const offset =
      pointerTimestamp(day, e.clientY, rect.top, rect.height) -
      (edge === 'start' ? start : end);
    drag.current = {
      id,
      day,
      edge,
      start,
      end,
      offset,
      pointer: e.pointerId,
      element: e.currentTarget,
      preview: { start, end },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreview({ id, start, end });
  };
  const move = (e: React.PointerEvent) => {
    const current = drag.current;
    if (!current || e.pointerId !== current.pointer) return;
    const track = tracks.current[current.day];
    if (!track) return;
    const rect = track.getBoundingClientRect(),
      bounds = dayBounds(current.day);
    const target =
      pointerTimestamp(current.day, e.clientY, rect.top, rect.height) -
      current.offset;
    current.preview = clampResize(
      current.start,
      current.end,
      target,
      current.edge,
      bounds.start,
      bounds.end,
    );
    setPreview({ ...current.preview, id: current.id });
  };
  const keyboard = (
    e: React.KeyboardEvent,
    id: string,
    day: string,
    edge: 'start' | 'end',
    start: number,
    end: number,
  ) => {
    if (
      pending ||
      drag.current ||
      (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = dayBounds(day);
    const next = clampResize(
      start,
      end,
      (edge === 'start' ? start : end) +
        (e.key === 'ArrowUp' ? -900000 : 900000),
      edge,
      bounds.start,
      bounds.end,
    );
    if (next.start !== start || next.end !== end)
      void schedule(id, iso(next.start), iso(next.end));
  };
  const clearBodyGrab = () => {
    bodyGrab.current = null;
  };
  const captureBodyGrab = (
    e: React.PointerEvent,
    id: string,
    day: string,
    start: number,
  ) => {
    const track = tracks.current[day];
    if (e.button !== 0 || !track) return;
    const rect = track.getBoundingClientRect();
    bodyGrab.current = {
      id,
      day,
      offset: pointerTimestamp(day, e.clientY, rect.top, rect.height) - start,
    };
  };
  const beginBodyDrag = (
    e: React.DragEvent,
    id: string,
    day: string,
    start: number,
  ) => {
    const track = tracks.current[day];
    const rect = track?.getBoundingClientRect();
    const grab = bodyGrab.current;
    const offset =
      grab?.id === id && grab.day === day
        ? grab.offset
        : rect
          ? pointerTimestamp(day, e.clientY, rect.top, rect.height) - start
          : 0;
    const localEvent = events.some(
      (event) => event.id === id && event.seriesId,
    );
    e.dataTransfer.setData(
      localEvent ? 'text/life-event' : 'text/life-card',
      id,
    );
    e.dataTransfer.setData(CARD_DRAG_META, encodeGrabOffset(offset));
    e.dataTransfer.effectAllowed = 'move';
    if (!localEvent) onDragCard(id);
  };
  const endBodyDrag = () => {
    clearBodyGrab();
    onDragCard(null);
  };
  const drop = (e: React.DragEvent, day: string) => {
    const eventDrag = e.dataTransfer.types.includes('text/life-event');
    if (!eventDrag && !e.dataTransfer.types.includes('text/life-card')) return;
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData(
        eventDrag ? 'text/life-event' : 'text/life-card',
      ),
      grabOffset = decodeGrabOffset(e.dataTransfer.getData(CARD_DRAG_META)),
      card = allCards.find((c) => c.id === id),
      track = tracks.current[day];
    onDragCard(null);
    const event = eventDrag
      ? events.find((event) => event.id === id && event.seriesId)
      : undefined;
    if (
      pending ||
      !track ||
      (eventDrag ? !event : !card || card.type === 'project')
    )
      return;
    const rect = track.getBoundingClientRect(),
      duration = event
        ? Date.parse(event.end) - Date.parse(event.start)
        : card?.start && card.end
          ? Date.parse(card.end) - Date.parse(card.start)
          : 3600000;
    const next = dropInterval(
      day,
      e.clientY,
      rect.top,
      rect.height,
      duration,
      eventDrag || card?.placement === 'calendar' ? grabOffset : 0,
    );
    void schedule(id, iso(next.start), iso(next.end));
  };
  const beginSelection = (e: React.PointerEvent<HTMLDivElement>, day: string) => {
    if (
      e.target !== e.currentTarget ||
      pending ||
      drag.current ||
      selection.current ||
      e.button !== 0 ||
      e.pointerType !== 'mouse'
    )
      return;
    e.preventDefault();
    selection.current = {
      day,
      pointer: e.pointerId,
      startY: e.clientY,
      startTimestamp: pointerTimestamp(
        day,
        e.clientY,
        e.currentTarget.getBoundingClientRect().top,
        e.currentTarget.getBoundingClientRect().height,
      ),
      currentY: e.clientY,
      track: e.currentTarget,
      active: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveSelection = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = selection.current;
    if (!current || current.pointer !== e.pointerId) return;
    current.currentY = e.clientY;
    if (!current.active && Math.abs(current.currentY - current.startY) <= 4) return;
    if (!current.active) {
      current.active = true;
    }
    e.preventDefault();
    updateSelection(current);
  };
  const finishSelection = (e: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = selection.current;
    if (!current || current.pointer !== e.pointerId) return;
    current.currentY = e.clientY;
    selection.current = null;
    const rect = current.track.getBoundingClientRect();
    const range = current.active && !cancel
      ? selectionIntervalFromTimestamps(
          current.day,
          current.startTimestamp,
          pointerTimestamp(current.day, current.currentY, rect.top, rect.height),
        )
      : null;
    setPreview(null);
    if (current.track.hasPointerCapture(current.pointer))
      current.track.releasePointerCapture(current.pointer);
    if (range) {
      suppressDoubleClick.current = Date.now() + 500;
      onCreateEvent(current.day, clock(range.start), (range.end - range.start) / 60000);
    }
  };
  const items = [
    ...scheduled
      .filter((c) => c.start && c.end && c.type !== 'project')
      .map((c) => ({
        id: c.id,
        title: c.title,
        start: c.start!,
        end: c.end!,
        card: true,
        editable: true,
        seriesId: undefined,
        done: c.done,
        color: '#6677dd',
      })),
    ...events
      .filter((e) => !e.allDay)
      .map((e) => ({
        ...e,
        card: false,
        editable: Boolean(e.seriesId),
        done: false,
        color: e.seriesId
          ? '#8d68b5'
          : (sources.find((s) => s.id === e.sourceId)?.color ?? '#3e9a82'),
      })),
  ];
  return (
    <div
      className="calendar-timed-grid"
      style={{
        gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`,
      }}
    >
      <div className="calendar-time-ruler">
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ top: h * 72 }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
      {days.map((day) => (
        <div
          key={day}
          className="calendar-day-track"
          ref={(node) => {
            tracks.current[day] = node;
          }}
          onDragOver={(e) => {
            if (
              !pending &&
              (e.dataTransfer.types.includes('text/life-card') ||
                e.dataTransfer.types.includes('text/life-event'))
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => drop(e, day)}
          onPointerDown={(e) => beginSelection(e, day)}
          onPointerMove={moveSelection}
          onPointerUp={(e) => finishSelection(e)}
          onPointerCancel={(e) => finishSelection(e, true)}
          onLostPointerCapture={(e) => finishSelection(e, true)}
          onDoubleClick={(e) => {
            if (
              e.target !== e.currentTarget ||
              pending ||
              Date.now() < suppressDoubleClick.current
            )
              return;
            const rect = e.currentTarget.getBoundingClientRect();
            const next = dropInterval(
              day,
              e.clientY,
              rect.top,
              rect.height,
              3600000,
              0,
            );
            onCreateEvent(day, clock(next.start));
          }}
        >
          {nowPosition?.day === day && (
            <div
              className="calendar-now-line"
              style={{ top: `${nowPosition.top}px` }}
              aria-hidden="true"
            />
          )}
          {preview?.id === `selection:${day}` && (
            <div
              className="calendar-selection-preview"
              style={{
                top:
                  ((preview.start - dayBounds(day).start) / 86400000) *
                  TRACK_HEIGHT,
                height: ((preview.end - preview.start) / 86400000) * TRACK_HEIGHT,
              }}
              aria-hidden="true"
            >
              <span>
                {clock(preview.start)}–{clock(preview.end)}
              </span>
            </div>
          )}
          {buildDayLayout(day, items).map((item) => {
            const original = {
                start: Date.parse(item.start),
                end: Date.parse(item.end),
              },
              p = preview?.id === item.id ? preview : original,
              bounds = dayBounds(day);
            const top =
                ((Math.max(p.start, bounds.start) - bounds.start) / 86400000) *
                TRACK_HEIGHT,
              height =
                ((Math.min(p.end, bounds.end) -
                  Math.max(p.start, bounds.start)) /
                  86400000) *
                TRACK_HEIGHT;
            return (
              <div
                key={item.id}
                className={`calendar-positioned-event ${item.done ? 'completed' : ''} ${preview?.id === item.id ? 'resizing' : ''}`}
                style={{
                  top,
                  height,
                  left: `${(item.lane * 100) / item.lanes}%`,
                  width: `calc(${100 / item.lanes}% - 2px)`,
                  background: item.color + '15',
                  borderLeftColor: item.color,
                  color: item.color,
                }}
              >
                <button
                  type="button"
                  className="calendar-event-body"
                  draggable={item.editable && !pending && !preview}
                  onPointerDown={(e) =>
                    captureBodyGrab(e, item.id, day, original.start)
                  }
                  onPointerUp={clearBodyGrab}
                  onDragStart={(e) =>
                    beginBodyDrag(e, item.id, day, original.start)
                  }
                  onDragEnd={endBodyDrag}
                  onClick={() => {
                    if (item.card) onSelectCard(item.id);
                    else {
                      const event = events.find((x) => x.id === item.id);
                      if (event) onSelectEvent(event);
                    }
                  }}
                  title={`${item.title} · ${clock(p.start)}–${clock(p.end)}`}
                >
                  <b>{item.title}</b>
                  <small>
                    {clock(p.start)}–{clock(p.end)}
                    {!item.card &&
                      (item.seriesId ? ' · событие' : ' · внешний')}
                  </small>
                </button>
                {item.editable &&
                  (['start', 'end'] as const)
                    .filter((edge) =>
                      edge === 'start' ? item.first : item.last,
                    )
                    .map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        disabled={pending}
                        className={`calendar-resize-handle ${edge}`}
                        aria-label={`${edge === 'start' ? 'Изменить начало' : 'Изменить конец'}: ${item.title}`}
                        title="Перетащите или используйте стрелки ↑ ↓ · шаг 15 минут"
                        onPointerDown={(e) =>
                          begin(
                            e,
                            item.id,
                            day,
                            edge,
                            original.start,
                            original.end,
                          )
                        }
                        onPointerMove={move}
                        onPointerUp={(e) => {
                          if (drag.current?.pointer === e.pointerId) {
                            move(e);
                            finish();
                          }
                        }}
                        onPointerCancel={() => finish(true)}
                        onLostPointerCapture={() => finish(true)}
                        onKeyDown={(e) =>
                          keyboard(
                            e,
                            item.id,
                            day,
                            edge,
                            original.start,
                            original.end,
                          )
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ))}
              </div>
            );
          })}
        </div>
      ))}
      {preview && (
        <div className="calendar-resize-announcement" role="status">
          {clock(preview.start)}–{clock(preview.end)} ·{' '}
          {Math.round((preview.end - preview.start) / 60000)} мин
        </div>
      )}
    </div>
  );
}
