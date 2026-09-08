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
  TRACK_HEIGHT,
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
  onCreateEvent: (day: string, time: string) => void;
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
  const [preview, setPreview] = useState<(Interval & { id: string }) | null>(
    null,
  );
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
      if (e.key === 'Escape' && drag.current) {
        e.preventDefault();
        finish(true);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      const current = drag.current;
      drag.current = null;
      if (current?.element.hasPointerCapture(current.pointer))
        current.element.releasePointerCapture(current.pointer);
    };
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
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget || pending) return;
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
