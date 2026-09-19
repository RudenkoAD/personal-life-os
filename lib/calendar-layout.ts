export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_SLOT = 15;
export const TRACK_HEIGHT = 24 * 72;
const MIN_DURATION = MINUTES_PER_SLOT * 60_000;
const DAY = 24 * 60 * 60_000;
const MAX_GRAB_OFFSET = 31 * DAY;

export function moscowNowPosition(value: Date | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '0';
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    minutes,
    top: (minutes / MINUTES_PER_DAY) * TRACK_HEIGHT,
  };
}

/** Extra drag metadata is advisory; the card id remains the authoritative payload. */
export const CARD_DRAG_META = 'application/x-life-card-meta';

export function encodeGrabOffset(offsetMs: number) {
  const value = Number.isFinite(offsetMs)
    ? Math.max(-MAX_GRAB_OFFSET, Math.min(MAX_GRAB_OFFSET, offsetMs))
    : 0;
  return JSON.stringify({
    version: 1,
    origin: 'calendar',
    grabOffsetMs: value,
  });
}

export function decodeGrabOffset(raw: string | null | undefined) {
  if (!raw || raw.length > 256) return 0;
  try {
    const metadata = JSON.parse(raw);
    if (metadata?.version !== 1 || metadata?.origin !== 'calendar') return 0;
    const value = metadata.grabOffsetMs;
    return Number.isFinite(value)
      ? Math.max(-MAX_GRAB_OFFSET, Math.min(MAX_GRAB_OFFSET, value))
      : 0;
  } catch {
    return 0;
  }
}

export type LayoutInput = {
  id: string;
  start: string;
  end: string;
  title: string;
  card: boolean;
  editable?: boolean;
  seriesId?: string;
  color: string;
  done?: boolean;
};
export type LayoutItem = LayoutInput & {
  top: number;
  height: number;
  lane: number;
  lanes: number;
  first: boolean;
  last: boolean;
};

export const snapMs = (value: number) =>
  Math.round(value / (MINUTES_PER_SLOT * 60_000)) * MINUTES_PER_SLOT * 60_000;
export const snapMinute = (value: number) =>
  Math.round(value / MINUTES_PER_SLOT) * MINUTES_PER_SLOT;

export function dayBounds(day: string) {
  const start = Date.parse(`${day}T00:00:00+03:00`);
  return { start, end: start + DAY };
}

/** The moved edge lands on a quarter-hour; the opposite edge stays exact. */
export function clampResize(
  start: number,
  end: number,
  target: number,
  edge: 'start' | 'end',
  minStart = -Infinity,
  maxEnd = Infinity,
) {
  const low =
    edge === 'start' ? Math.max(minStart, end - 7 * DAY) : start + MIN_DURATION;
  const high =
    edge === 'start' ? end - MIN_DURATION : Math.min(maxEnd, start + 7 * DAY);
  const first = Math.ceil(low / MIN_DURATION) * MIN_DURATION;
  const last = Math.floor(high / MIN_DURATION) * MIN_DURATION;
  if (first > last) return { start, end };
  const value = Math.max(first, Math.min(last, snapMs(target)));
  return edge === 'start' ? { start: value, end } : { start, end: value };
}
export function pointerTimestamp(
  day: string,
  clientY: number,
  trackTop: number,
  trackHeight = TRACK_HEIGHT,
) {
  return dayBounds(day).start + ((clientY - trackTop) / trackHeight) * DAY;
}

/** Convert a mouse drag on an empty day track into a bounded 15-minute range. */
export function selectionInterval(
  day: string,
  startClientY: number,
  endClientY: number,
  trackTop: number,
  trackHeight = TRACK_HEIGHT,
) {
  const bounds = dayBounds(day);
  const point = (clientY: number) =>
    Math.max(
      bounds.start,
      Math.min(bounds.end, pointerTimestamp(day, clientY, trackTop, trackHeight)),
    );
  return selectionIntervalFromTimestamps(
    day,
    point(startClientY),
    point(endClientY),
  );
}

export function selectionIntervalFromTimestamps(
  day: string,
  startTimestamp: number,
  endTimestamp: number,
) {
  const bounds = dayBounds(day);
  const clamp = (value: number) =>
    Math.max(bounds.start, Math.min(bounds.end, value));
  let start = snapMs(Math.min(clamp(startTimestamp), clamp(endTimestamp)));
  let end = snapMs(Math.max(clamp(startTimestamp), clamp(endTimestamp)));
  start = Math.max(bounds.start, Math.min(bounds.end, start));
  end = Math.max(bounds.start, Math.min(bounds.end, end));
  if (end - start < MIN_DURATION) {
    if (start + MIN_DURATION <= bounds.end) end = start + MIN_DURATION;
    else {
      end = bounds.end;
      start = bounds.end - MIN_DURATION;
    }
  }
  return { start, end };
}
export function dropInterval(
  day: string,
  clientY: number,
  trackTop: number,
  trackHeight = TRACK_HEIGHT,
  duration = 3600000,
  grabOffset = 0,
) {
  const bounds = dayBounds(day);
  const offset = Number.isFinite(grabOffset) ? grabOffset : 0;
  // Clamp the pointer to the visible day before subtracting the grab offset.
  // The resulting start may lie on the preceding day for a clipped continuation.
  const pointer = Math.max(
    bounds.start,
    Math.min(bounds.end, pointerTimestamp(day, clientY, trackTop, trackHeight)),
  );
  const start = Math.min(bounds.end - MIN_DURATION, snapMs(pointer - offset));
  return { start, end: start + duration };
}

export function buildDayLayout(
  day: string,
  input: LayoutInput[],
): LayoutItem[] {
  const { start: dayStart, end: dayEnd } = dayBounds(day);
  const visible = input
    .flatMap((event) => {
      const from = Math.max(Date.parse(event.start), dayStart);
      const to = Math.min(Date.parse(event.end), dayEnd);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
        return [];
      return [
        {
          event,
          from,
          to,
          first: Date.parse(event.start) >= dayStart,
          last: Date.parse(event.end) <= dayEnd,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.from - b.from || a.to - b.to || a.event.id.localeCompare(b.event.id),
    );
  const laneEnds: number[] = [];
  const placed = visible.map((x) => {
    let lane = laneEnds.findIndex((end) => end <= x.from);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(x.to);
    } else laneEnds[lane] = x.to;
    return { ...x, lane };
  });
  // Keep lane width local to each connected overlap group.
  const groups: (typeof placed)[] = [];
  for (const item of placed) {
    const group = groups.at(-1);
    if (!group || item.from >= Math.max(...group.map((x) => x.to)))
      groups.push([item]);
    else group.push(item);
  }
  const laneByEvent = new Map<string, number>();
  const laneCount = new Map<string, number>();
  for (const group of groups) {
    const ends: number[] = [];
    for (const item of group) {
      let lane = ends.findIndex((end) => end <= item.from);
      if (lane < 0) {
        lane = ends.length;
        ends.push(item.to);
      } else ends[lane] = item.to;
      laneByEvent.set(item.event.id, lane);
    }
    for (const item of group) laneCount.set(item.event.id, ends.length);
  }
  return placed.map(({ event, from, to, first, last }) => ({
    ...event,
    top: ((from - dayStart) / DAY) * TRACK_HEIGHT,
    height: ((to - from) / DAY) * TRACK_HEIGHT,
    lane: laneByEvent.get(event.id)!,
    lanes: laneCount.get(event.id)!,
    first,
    last,
  }));
}
