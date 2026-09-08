import {
  dateAdd,
  type EventFields,
  type EventRepeat,
} from './calendar-events.ts';
export type EventDraft = EventFields & {
  endDate: string;
  endTime: string;
  repeat: EventRepeat;
  ending: 'never' | 'until' | 'count';
};
const instant = (date: string, time: string) =>
  Date.parse(`${date}T${time}:00+03:00`);
export const eventLocalDate = (value: number) =>
  new Date(value + 10800000).toISOString().slice(0, 10);
export const eventLocalTime = (value: number) =>
  new Date(value + 10800000).toISOString().slice(11, 16);
export function toEventDraft(
  fields: EventFields,
  repeat: EventRepeat,
): EventDraft {
  const end =
    instant(fields.startDate, fields.allDay ? '00:00' : fields.startTime) +
    fields.durationMinutes * 60000;
  return {
    ...fields,
    tags: [...fields.tags],
    endDate: fields.allDay
      ? dateAdd(eventLocalDate(end), -1)
      : eventLocalDate(end),
    endTime: eventLocalTime(end),
    repeat: structuredClone(repeat),
    ending: repeat.until ? 'until' : repeat.count ? 'count' : 'never',
  };
}
export function eventDraftFields(draft: EventDraft): EventFields {
  const from = instant(
    draft.startDate,
    draft.allDay ? '00:00' : draft.startTime,
  );
  const to = instant(
    draft.allDay ? dateAdd(draft.endDate, 1) : draft.endDate,
    draft.allDay ? '00:00' : draft.endTime,
  );
  return {
    title: draft.title,
    notes: draft.notes,
    location: draft.location,
    tags: draft.tags,
    allDay: draft.allDay,
    startDate: draft.startDate,
    startTime: draft.allDay ? '00:00' : draft.startTime,
    durationMinutes: (to - from) / 60000,
  };
}
export function rebaseEventDraft(
  draft: EventDraft,
  original: EventDraft,
  fields: EventFields,
  repeat: EventRepeat,
): EventDraft {
  const values = eventDraftFields(draft),
    before = eventDraftFields(original);
  if (!Number.isFinite(values.durationMinutes))
    throw new Error('Укажите даты и время события');
  const edits = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(before[key as keyof EventFields]),
    ),
  );
  // Rebase duration, not the old occurrence's absolute end date, onto the series anchor.
  const result = toEventDraft(
    { ...fields, ...edits },
    JSON.stringify(draft.repeat) === JSON.stringify(original.repeat)
      ? repeat
      : draft.repeat,
  );
  result.ending =
    draft.ending === original.ending ? result.ending : draft.ending;
  return result;
}
