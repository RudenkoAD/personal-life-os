export type CardType = 'task' | 'sequence' | 'project';
export type Placement = 'inbox' | 'board' | 'calendar';
export interface Step {
  id: string;
  title: string;
  done: boolean;
}
// boardId/columnId remain the return destination when placement is inbox/calendar.
// Consumers must select visible location by placement, never by boardId alone.
export interface Card {
  id: string;
  title: string;
  notes: string;
  type: CardType;
  placement: Placement;
  boardId: string;
  columnId: string;
  childBoardId?: string;
  tags: string[];
  steps: Step[];
  done: boolean;
  start?: string;
  end?: string;
  createdAt: string;
}
export interface Board {
  id: string;
  title: string;
  parentCardId?: string;
  columns: { id: string; title: string }[];
}
export interface Scope {
  id: string;
  title: string;
  color: string;
}
export interface Review {
  id: string;
  title: string;
  prompts: Step[];
  intervalDays: number;
  nextDue: string;
  notes: string;
  history: { date: string; notes: string }[];
}
export interface Source {
  id: string;
  title: string;
  color: string;
  enabled: boolean;
  kind: 'file' | 'feed' | 'caldav';
  tags: string[];
  lastSynced: string;
  error?: string;
}
export interface CalendarEvent {
  id: string;
  sourceId: string;
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  tags: string[];
  location: string;
}
export interface LifeState {
  revision: number;
  cards: Card[];
  boards: Board[];
  tags: Scope[];
  reviews: Review[];
  sources: Source[];
  events: CalendarEvent[];
  history: { at: string; text: string; actor: string }[];
}
export type Action = { type: string; [key: string]: unknown };
export class DomainError extends Error {
  status = 400;
}
const id = () => crypto.randomUUID();
function fail(message: string): never {
  throw new DomainError(message);
}
export function textValue(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(`${label}: от 1 до ${max} символов`);
  return value.trim();
}
function optionalText(value: unknown, max = 8000) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max)
    fail('Слишком длинный текст');
  return value.trim();
}
function strictInstant(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return NaN;
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min, sec] = time.slice(0, 8).split(':').map(Number);
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    h > 23 ||
    min > 59 ||
    sec > 59
  )
    return NaN;
  return Date.parse(value);
}
function columns() {
  return [
    { id: id(), title: 'Следующие действия' },
    { id: id(), title: 'В работе' },
    { id: id(), title: 'Ожидание' },
    { id: id(), title: 'Готово' },
  ];
}
export function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function initialState(now = new Date()): LifeState {
  return {
    revision: 0,
    cards: [],
    boards: [{ id: 'main', title: 'Моя доска', columns: columns() }],
    tags: [
      { id: 'life', title: 'Жизнь', color: '#cf8841' },
      { id: 'work', title: 'Работа', color: '#6677dd' },
      { id: 'study', title: 'Образование', color: '#9b6fca' },
      { id: 'health', title: 'Здоровье', color: '#3e9a82' },
      { id: 'people', title: 'Близкие', color: '#c46c92' },
    ],
    reviews: [
      {
        id: id(),
        title: 'Что для меня сейчас важно',
        prompts: [
          'Работа и развитие',
          'Друзья и семья',
          'Образование',
          'Здоровье и энергия',
          'Дом и повседневная жизнь',
        ].map((title) => ({ id: id(), title, done: false })),
        intervalDays: 30,
        nextDue: dateKey(now),
        notes: '',
        history: [],
      },
    ],
    sources: [],
    events: [],
    history: [],
  };
}
function boardOf(s: LifeState, v: unknown) {
  return s.boards.find((b) => b.id === v) ?? fail('Доска не найдена');
}
function cardOf(s: LifeState, v: unknown) {
  return s.cards.find((c) => c.id === v) ?? fail('Карточка не найдена');
}
function tagIds(s: LifeState, v: unknown): string[] {
  if (
    !Array.isArray(v) ||
    v.length > 20 ||
    v.some((t) => !s.tags.some((x) => x.id === t))
  )
    fail('Неизвестный тег');
  return [...new Set(v)] as string[];
}
function checkTarget(s: LifeState, c: Card, b: Board) {
  let at: Board | undefined = b;
  const visited = new Set<string>();
  while (at) {
    if (visited.has(at.id)) fail('Цикл в проектах');
    visited.add(at.id);
    if (at.id === c.childBoardId)
      fail('Нельзя переместить проект внутрь самого себя');
    at = at.parentCardId
      ? s.boards.find(
          (x) =>
            x.id === s.cards.find((y) => y.id === at!.parentCardId)?.boardId,
        )
      : undefined;
  }
}
function addCard(s: LifeState, a: Action, now: string): Card {
  const type = (a.cardType ?? 'task') as CardType;
  if (!['task', 'project', 'sequence'].includes(type)) fail('Неизвестный тип');
  const b = boardOf(s, a.boardId ?? 'main');
  const columnId = a.columnId ?? b.columns[0].id;
  if (!b.columns.some((c) => c.id === columnId)) fail('Колонка не найдена');
  const c: Card = {
    id: id(),
    title: textValue(a.title, 'Название'),
    notes: optionalText(a.notes),
    type,
    placement: a.type === 'capture' ? 'inbox' : 'board',
    boardId: b.id,
    columnId: columnId as string,
    tags: a.tags ? tagIds(s, a.tags) : [],
    steps: [],
    done: false,
    createdAt: now,
  };
  if (type === 'project') {
    c.childBoardId = id();
    s.boards.push({
      id: c.childBoardId,
      title: c.title,
      parentCardId: c.id,
      columns: columns(),
    });
  }
  s.cards.unshift(c);
  return c;
}
export function applyAction(
  input: LifeState,
  a: Action,
  actor = 'Вы',
  nowDate = new Date(),
): LifeState {
  const s = structuredClone(input),
    now = nowDate.toISOString();
  let message = 'Обновлено';
  if (!a || typeof a.type !== 'string') fail('Неизвестное действие');
  switch (a.type) {
    case 'capture':
    case 'create': {
      const c = addCard(s, a, now);
      message = `Добавлено: ${c.title}`;
      break;
    }
    case 'update': {
      const c = cardOf(s, a.id);
      if (a.title !== undefined) {
        c.title = textValue(a.title, 'Название');
        if (c.childBoardId) boardOf(s, c.childBoardId).title = c.title;
      }
      if (a.notes !== undefined) c.notes = optionalText(a.notes);
      if (a.tags !== undefined) c.tags = tagIds(s, a.tags);
      if (a.cardType !== undefined && a.cardType !== c.type) {
        if (c.type === 'project') fail('Тип проекта нельзя изменить');
        if (
          a.cardType !== 'task' &&
          a.cardType !== 'sequence' &&
          a.cardType !== 'project'
        )
          fail('Неизвестный тип');
        if (c.steps.length && a.cardType !== 'sequence')
          fail('Сначала удалите шаги');
        c.type = a.cardType;
        if (c.type === 'project') {
          if (c.placement === 'calendar') c.placement = 'board';
          delete c.start;
          delete c.end;
          c.childBoardId = id();
          s.boards.push({
            id: c.childBoardId,
            title: c.title,
            parentCardId: c.id,
            columns: columns(),
          });
        }
      }
      message = `Изменено: ${c.title}`;
      break;
    }
    case 'move': {
      const c = cardOf(s, a.id);
      const b = boardOf(s, a.boardId ?? c.boardId);
      checkTarget(s, c, b);
      const col = a.columnId ?? b.columns[0].id;
      if (!b.columns.some((x) => x.id === col)) fail('Колонка не найдена');
      c.boardId = b.id;
      c.columnId = col as string;
      c.placement = 'board';
      delete c.start;
      delete c.end;
      message = `На доску: ${c.title}`;
      break;
    }
    case 'inbox': {
      const c = cardOf(s, a.id);
      c.placement = 'inbox';
      delete c.start;
      delete c.end;
      message = `Во входящие: ${c.title}`;
      break;
    }
    case 'schedule': {
      const c = cardOf(s, a.id);
      if (c.type === 'project')
        fail('Планируйте задачи внутри проекта, а не сам проект');
      const start = strictInstant(a.start);
      const end = strictInstant(a.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end - start > 7 * 86400000
      )
        fail('Укажите корректное время начала и окончания (до 7 дней)');
      c.start = new Date(start).toISOString();
      c.end = new Date(end).toISOString();
      c.placement = 'calendar';
      message = `Запланировано: ${c.title}`;
      break;
    }
    case 'complete': {
      const c = cardOf(s, a.id);
      if (typeof a.done !== 'boolean') fail('Не указан статус');
      c.done = a.done;
      message = `${c.done ? 'Завершено' : 'Возвращено'}: ${c.title}`;
      break;
    }
    case 'step.add': {
      const c = cardOf(s, a.id);
      if (c.type !== 'sequence') fail('Шаги доступны в последовательности');
      if (c.steps.length >= 100) fail('Максимум 100 шагов');
      c.steps.push({ id: id(), title: textValue(a.title, 'Шаг'), done: false });
      message = `Добавлен шаг: ${c.title}`;
      break;
    }
    case 'step.toggle':
    case 'step.delete': {
      const c = cardOf(s, a.id);
      const step =
        c.steps.find((x) => x.id === a.stepId) ?? fail('Шаг не найден');
      if (a.type === 'step.delete')
        c.steps = c.steps.filter((x) => x.id !== step.id);
      else step.done = !step.done;
      message = `Изменены шаги: ${c.title}`;
      break;
    }
    case 'delete': {
      const c = cardOf(s, a.id);
      if (c.childBoardId && s.cards.some((x) => x.boardId === c.childBoardId))
        fail('Сначала переместите или удалите карточки внутри проекта');
      s.cards = s.cards.filter((x) => x.id !== c.id);
      s.boards = s.boards.filter((x) => x.id !== c.childBoardId);
      message = `Удалено: ${c.title}`;
      break;
    }
    case 'board.create': {
      s.boards.push({
        id: id(),
        title: textValue(a.title, 'Название доски'),
        columns: columns(),
      });
      message = 'Создана доска';
      break;
    }
    case 'board.rename': {
      boardOf(s, a.id).title = textValue(a.title, 'Название доски');
      const b = boardOf(s, a.id);
      if (b.parentCardId) cardOf(s, b.parentCardId).title = b.title;
      message = 'Доска переименована';
      break;
    }
    case 'column.add': {
      const b = boardOf(s, a.boardId);
      if (b.columns.length >= 20) fail('Максимум 20 колонок');
      b.columns.push({
        id: id(),
        title: textValue(a.title, 'Название колонки', 80),
      });
      message = 'Добавлена колонка';
      break;
    }
    case 'column.rename': {
      const b = boardOf(s, a.boardId);
      const col =
        b.columns.find((c) => c.id === a.id) ?? fail('Колонка не найдена');
      col.title = textValue(a.title, 'Название колонки', 80);
      message = 'Колонка переименована';
      break;
    }
    case 'tag.create': {
      const title = textValue(a.title, 'Название тега', 40);
      if (s.tags.some((t) => t.title.toLowerCase() === title.toLowerCase()))
        fail('Такой тег уже есть');
      const color =
        typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color)
          ? a.color
          : '#6677dd';
      s.tags.push({ id: id(), title, color });
      message = `Создан тег: ${title}`;
      break;
    }
    case 'review.create': {
      s.reviews.push({
        id: id(),
        title: textValue(a.title, 'Название обзора'),
        prompts: [],
        intervalDays: 30,
        nextDue: dateKey(nowDate),
        notes: '',
        history: [],
      });
      message = 'Создан список обзора';
      break;
    }
    case 'review.update': {
      const r = s.reviews.find((x) => x.id === a.id) ?? fail('Обзор не найден');
      if (a.notes !== undefined) r.notes = optionalText(a.notes);
      if (a.intervalDays !== undefined) {
        if (
          !Number.isInteger(a.intervalDays) ||
          Number(a.intervalDays) < 1 ||
          Number(a.intervalDays) > 365
        )
          fail('Интервал: от 1 до 365 дней');
        r.intervalDays = Number(a.intervalDays);
      }
      if (a.title !== undefined)
        r.title = textValue(a.title, 'Название обзора');
      message = 'Обзор сохранён';
      break;
    }
    case 'review.prompt': {
      const r = s.reviews.find((x) => x.id === a.id) ?? fail('Обзор не найден');
      if (a.promptId) {
        const p =
          r.prompts.find((x) => x.id === a.promptId) ?? fail('Пункт не найден');
        p.done = !p.done;
      } else
        r.prompts.push({
          id: id(),
          title: textValue(a.title, 'Пункт'),
          done: false,
        });
      message = 'Обновлён пункт обзора';
      break;
    }
    case 'review.finish': {
      const r = s.reviews.find((x) => x.id === a.id) ?? fail('Обзор не найден');
      if (!r.prompts.length || r.prompts.some((x) => !x.done))
        fail('Сначала пройдите все пункты обзора');
      r.history.unshift({ date: now, notes: r.notes });
      r.history = r.history.slice(0, 50);
      r.nextDue = dateKey(
        new Date(nowDate.getTime() + r.intervalDays * 86400000),
      );
      r.prompts.forEach((p) => (p.done = false));
      r.notes = '';
      message = `Завершён обзор: ${r.title}`;
      break;
    }
    case 'source.toggle': {
      const source =
        s.sources.find((x) => x.id === a.id) ?? fail('Календарь не найден');
      source.enabled = !source.enabled;
      message = 'Видимость календаря изменена';
      break;
    }
    case 'source.remove': {
      s.sources = s.sources.filter((x) => x.id !== a.id);
      s.events = s.events.filter((x) => x.sourceId !== a.id);
      message = 'Календарь отключён';
      break;
    }
    case 'demo': {
      if (s.cards.length)
        fail('Пример можно загрузить только в пустое пространство');
      const b = boardOf(s, 'main');
      const examples = [
        ['Разобрать идеи на неделю', 'task', 'life'],
        ['Обновить рабочее портфолио', 'project', 'work'],
        ['Договориться с электриком', 'sequence', 'life'],
        ['Выбрать курс на осень', 'task', 'study'],
        ['Запланировать встречу с друзьями', 'task', 'people'],
      ] as const;
      for (const [title, cardType, tag] of examples) {
        const c = addCard(
          s,
          { type: 'create', title, cardType, tags: [tag] },
          now,
        );
        c.notes = 'Пример карточки. Измените или удалите её.';
        if (cardType === 'sequence')
          c.steps = [
            'Позвонить электрику',
            'Договориться о времени',
            'Запланировать визит',
          ].map((title) => ({ id: id(), title, done: false }));
        if (cardType === 'project') {
          addCard(
            s,
            {
              type: 'create',
              title: 'Собрать последние работы',
              boardId: c.childBoardId,
              tags: ['work'],
            },
            now,
          );
          c.columnId = b.columns[1].id;
        }
      }
      addCard(
        s,
        { type: 'capture', title: 'Идея для следующего отпуска' },
        now,
      );
      message = 'Добавлены примеры карточек';
      break;
    }
    default:
      fail('Неизвестное действие');
  }
  if (
    s.cards.length > 2000 ||
    s.boards.length > 200 ||
    s.tags.length > 100 ||
    s.reviews.length > 100
  )
    fail('Достигнут лимит пространства');
  s.revision = input.revision + 1;
  s.history.unshift({ at: now, text: message, actor });
  s.history = s.history.slice(0, 100);
  return s;
}
