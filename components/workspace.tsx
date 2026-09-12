'use client';
import './compact-workspace.css';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
} from '@/components/ui/sidebar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ScopesSettings } from '@/components/scopes-settings';
import { ICSLinkField, ReplaceICSLink } from '@/components/ics-feed-link';
import { RecurringHub } from '@/components/recurring-hub';
import {
  CalendarEventEditor,
  type EventEditorTarget,
} from '@/components/calendar-event-editor';
import { expandEventSeries } from '@/lib/calendar-events';
import { CalendarGrid } from '@/components/calendar-grid';
import { useSyncedDraft } from '@/hooks/use-synced-draft';
import { SyncQueue, type SyncSnapshot } from '@/lib/sync-queue';
import { apiRequest, ApiError } from '@/lib/api-client';
import DockWorkspace from '@/components/dock-workspace';
import type { DockPanelId } from '@/lib/dock-layout';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Save,
  Archive,
  Menu,
  Inbox,
  PanelsTopLeft,
  CalendarDays,
  Layers,
  ListChecks,
  Plus,
  Orbit,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Check,
  Clock3,
  Circle,
  GripVertical,
  Settings2,
  Repeat2,
  Bot,
  Search,
  X,
  Link2,
  FileUp,
  RefreshCw,
  Trash2,
  CheckCheck,
  ArrowDownToLine,
  Sparkles,
  ShieldCheck,
  Copy,
  LogOut,
  CalendarClock,
  FolderOpen,
} from 'lucide-react';
import {
  dateKey,
  type LifeState,
  type Card,
  type Action,
  type Review,
  type CalendarEvent,
} from '@/lib/domain';

type View =
  | 'board'
  | 'inbox'
  | 'calendar'
  | 'projects'
  | 'reviews'
  | 'recurring'
  | 'archive'
  | 'settings'
  | 'agent';
type NewForm = {
  kind:
    | 'card'
    | 'board'
    | 'column'
    | 'tag'
    | 'review'
    | 'prompt'
    | 'renameBoard'
    | 'renameColumn';
  title: string;
  cardType?: string;
  placement?: 'inbox' | 'board';
  columnId?: string;
  id?: string;
};
const labels = {
  task: 'Задача',
  sequence: 'Последовательность',
  project: 'Проект',
};
const clock = (value: string) =>
  new Intl.DateTimeFormat('ru', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const prettyDate = (value: string) =>
  new Intl.DateTimeFormat('ru', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
  }).format(new Date(value));
function addDays(day: string, n: number) {
  return dateKey(new Date(Date.parse(`${day}T12:00:00+03:00`) + n * 86400000));
}
function localInput(value?: string) {
  return value
    ? `${dateKey(new Date(value))}T${clock(value)}`
    : `${dateKey()}T10:00`;
}
function SelectBox({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
    >
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue>
          {options.find((o) => o.value === value)?.label ?? label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function ScopeDot({ color }: { color: string }) {
  return <span className="scope-dot" style={{ background: color }} />;
}
function EmptyState({
  icon: Icon = Inbox,
  title,
  detail,
  children,
}: {
  icon?: typeof Inbox;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
export default function Workspace({
  ownerId,
  passwordAuth = false,
  migrationDestination,
}: {
  ownerId: string;
  passwordAuth?: boolean;
  migrationDestination?: string;
}) {
  const [state, setState] = useState<LifeState | null>(null),
    stateRef = useRef<LifeState | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [dockToolbarTarget, setDockToolbarTarget] =
    useState<HTMLDivElement | null>(null);
  const [viewToolbarTarget, setViewToolbarTarget] =
    useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>('board'),
    [boardId, setBoardId] = useState('main'),
    [scope, setScope] = useState('all'),
    [query, setQuery] = useState(''),
    [showDone, setShowDone] = useState(true);
  const [dockFocus, setDockFocus] = useState<{
    panel: DockPanelId;
    request: number;
    capture?: boolean;
  }>({ panel: 'board', request: 0 });
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [notice, setNotice] = useState(''),
    [failure, setFailure] = useState(''),
    [needsSignIn, setNeedsSignIn] = useState(false);
  const [inboxCapture, setInboxCapture] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null),
    [eventEditor, setEventEditor] = useState<EventEditorTarget | null>(null),
    [newForm, setNewForm] = useState<NewForm | null>(null),
    [importOpen, setImportOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const attachCalendar = useCallback((node: HTMLDivElement | null) => {
    calendarRef.current = node;
    if (node) node.scrollTop = 8 * 72;
  }, []);
  const lastSyncAttempt = useRef<Record<string, number>>({});
  const [day, setDay] = useState(dateKey()),
    [calendarMode, setCalendarMode] = useState('day'),
    [dragged, setDragged] = useState<string | null>(null),
    [dropTarget, setDropTarget] = useState<string | null>(null);
  const queueRef = useRef<SyncQueue | null>(null);
  const [sync, setSync] = useState<SyncSnapshot>({
    state: null,
    count: 0,
    status: 'loading',
    error: '',
    canDiscard: false,
    needsSignIn: false,
    calendarPending: false,
    storageError: '',
    discardCount: 0,
  });
  const pending = !state;
  const update = useCallback((data: LifeState) => {
    stateRef.current = data;
    setState(data);
  }, []);
  const reload = useCallback(async () => {
    await queueRef.current?.retry();
  }, []);
  useEffect(() => {
    const storageKey = `life-os-outbox-v1:${ownerId}`;
    const queue = new SyncQueue({
      load: (ids) =>
        apiRequest<{ state: LifeState; applied: string[] }>(
          `/api/state?mutations=${encodeURIComponent(ids.join(','))}`,
        ),
      send: (revision, mutation) =>
        apiRequest<LifeState>('/api/actions', { revision, mutation }, 20000),
      remote: (path, payload) => apiRequest<LifeState>(path, payload),
      read: () => {
        let raw: string | null;
        try {
          raw = sessionStorage.getItem(storageKey);
        } catch {
          return [];
        }
        return raw ? JSON.parse(raw) : [];
      },
      write: (mutations) => {
        if (mutations.length)
          sessionStorage.setItem(storageKey, JSON.stringify(mutations));
        else sessionStorage.removeItem(storageKey);
      },
      changed: (snapshot) => {
        setSync(snapshot);
        if (snapshot.state) update(snapshot.state);
        setLoading(snapshot.status === 'loading');
        setLoadError(snapshot.state ? '' : snapshot.error);
        setNeedsSignIn(snapshot.needsSignIn);
      },
      remoteError: (e) => {
        setFailure(
          e instanceof Error ? e.message : 'Не удалось обновить календарь',
        );
        setNeedsSignIn(e instanceof ApiError && e.needsSignIn);
      },
    });
    queueRef.current = queue;
    void queue.start();
    const online = () => {
      if (queue.snapshot().count || queue.snapshot().error) void queue.retry();
      else void queue.refresh();
    };
    const leaving = (e: BeforeUnloadEvent) => {
      if (queue.snapshot().count) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const refresh = () => {
      if (document.visibilityState === 'visible') void queue.refresh();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', leaving);
    return () => {
      queue.stop();
      queueRef.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [ownerId, update]);
  useEffect(() => {
    if (state && scope !== 'all' && !state.tags.some((tag) => tag.id === scope))
      setScope('all');
  }, [state, scope]);
  const focusInboxCapture = useCallback(() => {
    setNavigationOpen(false);
    setView('inbox');
    setDockFocus((f) => ({
      panel: 'inbox',
      request: f.request + 1,
      capture: true,
    }));
  }, []);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('capture') === '1') {
      focusInboxCapture();
    }
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        focusInboxCapture();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [reload, focusInboxCapture]);
  useEffect(() => {
    if (calendarRef.current) calendarRef.current.scrollTop = 8 * 72;
  }, [calendarMode]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const request = useCallback(
    async (
      path: string,
      payload: Record<string, unknown>,
      success = 'Сохранено',
    ) => {
      setFailure('');
      const ok = (await queueRef.current?.remote(path, payload)) ?? false;
      if (ok && success) setNotice(success);
      return ok;
    },
    [],
  );
  const act = useCallback(async (action: Action, _success?: string) => {
    try {
      setFailure('');
      return queueRef.current?.enqueue(action) ?? false;
    } catch (e) {
      setFailure((e as Error).message);
      return false;
    }
  }, []);
  useEffect(() => {
    const t = setInterval(async () => {
      for (const source of stateRef.current?.sources ?? []) {
        if (
          source.kind !== 'file' &&
          Date.now() - Date.parse(source.lastSynced) > 15 * 60000 &&
          Date.now() - (lastSyncAttempt.current[source.id] ?? 0) > 15 * 60000 &&
          queueRef.current?.snapshot().count === 0
        ) {
          lastSyncAttempt.current[source.id] = Date.now();
          const ok = await request(
            '/api/calendars',
            { sourceId: source.id },
            '',
          );
          if (!ok) break;
        }
      }
    }, 60000);
    return () => clearInterval(t);
  }, [request]);
  const navigate = (next: View, id?: string) => {
    setView(next);
    setNavigationOpen(false);
    if (next === 'inbox' || next === 'board' || next === 'calendar')
      setDockFocus((f) => ({ panel: next, request: f.request + 1 }));
    if (id) setBoardId(id);
    setSelected(null);
  };

  const board = state?.boards.find((b) => b.id === boardId) ?? state?.boards[0];
  const matchesSearch = (c: { title: string; tags: string[] }) =>
    (scope === 'all' || c.tags.includes(scope)) &&
    c.title.toLowerCase().includes(query.toLowerCase());
  const matches = (c: { title: string; tags: string[]; done?: boolean }) =>
    matchesSearch(c) && (showDone || !c.done);
  const activeCards = state?.cards.filter((c) => !c.archived) ?? [];
  const archived =
    state?.cards.filter((c) => c.archived && matchesSearch(c)) ?? [];
  const filterActive = scope !== 'all' || (view !== 'archive' && !showDone);
  const visible = activeCards.filter(matches),
    inbox = visible.filter((c) => c.placement === 'inbox'),
    scheduled = visible.filter((c) => c.placement === 'calendar');
  const importedEvents =
    state?.events.filter(
      (e) =>
        state.sources.some((s) => s.id === e.sourceId && s.enabled) &&
        matches(e),
    ) ?? [];
  const currentCard = state?.cards.find((c) => c.id === selected);
  const openNew = (columnId?: string) =>
    setNewForm({
      kind: 'card',
      title: '',
      cardType: 'task',
      columnId,
      placement: 'board',
    });
  const newSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newForm || !board) return;
    let a: Action = { type: 'capture', title: newForm.title };
    switch (newForm.kind) {
      case 'card':
        a =
          newForm.placement === 'inbox'
            ? { type: 'capture', title: newForm.title }
            : {
                type: 'create',
                title: newForm.title,
                cardType: newForm.cardType,
                boardId: board.id,
                columnId: newForm.columnId ?? board.columns[0].id,
                tags: scope === 'all' ? [] : [scope],
              };
        break;
      case 'board':
        a = { type: 'board.create', title: newForm.title };
        break;
      case 'column':
        a = { type: 'column.add', title: newForm.title, boardId: board.id };
        break;
      case 'tag':
        a = { type: 'tag.create', title: newForm.title };
        break;
      case 'review':
        a = { type: 'review.create', title: newForm.title };
        break;
      case 'prompt':
        a = { type: 'review.prompt', id: newForm.id, title: newForm.title };
        break;
      case 'renameBoard':
        a = { type: 'board.rename', id: board.id, title: newForm.title };
        break;
      case 'renameColumn':
        a = {
          type: 'column.rename',
          boardId: board.id,
          id: newForm.id,
          title: newForm.title,
        };
        break;
    }
    if (await act(a)) {
      if (newForm.kind === 'board') {
        const created = stateRef.current?.boards.at(-1);
        if (created) navigate('board', created.id);
      }
      setNewForm(null);
    }
  };
  const endDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const acceptDrop = (e: React.DragEvent, target: string) => {
    if (pending || !e.dataTransfer.types.includes('text/life-card')) return;
    if (
      target.startsWith('calendar:') &&
      state?.cards.some((c) => c.id === dragged && c.type === 'project')
    ) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };
  const leaveDrop = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setDropTarget(null);
  };
  const dropMove = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/life-card');
    endDrag();
    if (id && board)
      void act(
        { type: 'move', id, boardId: board.id, columnId: col },
        'Карточка перемещена',
      );
  };
  const cardTile = (c: Card, compact = false) => (
    <article
      key={c.id}
      className={`task-card ${c.done ? 'completed' : ''} ${dragged === c.id ? 'dragging' : ''} ${compact ? 'compact' : ''}`}
      draggable={!pending && !c.archived}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/life-card', c.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragged(c.id);
      }}
      onDragEnd={endDrag}
    >
      {!compact && (
        <div className="card-kind">
          <span>
            {c.type === 'project' ? (
              <Layers size={13} />
            ) : c.type === 'sequence' ? (
              <ListChecks size={13} />
            ) : (
              <Circle size={12} />
            )}{' '}
            {labels[c.type]}
          </span>
          <GripVertical size={14} />
        </div>
      )}
      <button className="card-title" onClick={() => setSelected(c.id)}>
        {compact && c.type !== 'task' && (
          <span className="compact-card-kind" title={labels[c.type]}>
            {c.type === 'project' ? (
              <Layers size={14} />
            ) : (
              <ListChecks size={14} />
            )}
            <span className="sr-only">{labels[c.type]}: </span>
          </span>
        )}
        {c.title}
      </button>
      {c.type === 'sequence' && c.steps.length > 0 && (
        <div className="card-progress">
          <Progress
            value={
              (c.steps.filter((s) => s.done).length / c.steps.length) * 100
            }
          />
          <span>
            {c.steps.filter((s) => s.done).length}/{c.steps.length}
          </span>
        </div>
      )}
      {c.type === 'project' && (
        <button
          className="project-link"
          onClick={() => navigate('board', c.childBoardId)}
        >
          {
            state?.cards.filter((x) => x.boardId === c.childBoardId && !x.done)
              .length
          }{' '}
          активных дел <ArrowUpRight size={14} />
        </button>
      )}
      <div className="card-bottom">
        <div className="tags">
          {c.tags.map((id) => {
            const tag = state?.tags.find((t) => t.id === id);
            return tag ? (
              <span
                className="tag"
                key={id}
                style={{ color: tag.color, background: tag.color + '13' }}
              >
                {tag.title}
              </span>
            ) : null;
          })}
        </div>
        <button
          className={`done-toggle ${c.done ? 'checked' : ''}`}
          aria-label={c.done ? `Вернуть: ${c.title}` : `Завершить: ${c.title}`}
          title={c.archived ? 'Вернуть в работу' : undefined}
          disabled={pending}
          onClick={() =>
            void act(
              { type: 'complete', id: c.id, done: !c.done },
              c.done ? 'Задача возвращена' : 'Готово!',
            )
          }
        >
          <Check size={13} />
        </button>
      </div>
      {!c.archived && c.placement === 'inbox' && board && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inbox-move-button"
            disabled={pending}
            aria-label={`Переместить «${c.title}» на доску «${board.title}»`}
            title={`На доску «${board.title}»`}
          >
            {compact ? (
              <ArrowRight size={16} />
            ) : (
              <>
                <PanelsTopLeft size={14} /> На доску <ArrowRight size={14} />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="inbox-move-menu" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{board.title}</DropdownMenuLabel>
              {board.columns.map((col) => (
                <DropdownMenuItem
                  key={col.id}
                  onClick={() =>
                    void act(
                      {
                        type: 'move',
                        id: c.id,
                        boardId: board.id,
                        columnId: col.id,
                      },
                      `Перемещено в «${col.title}»`,
                    )
                  }
                >
                  {col.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </article>
  );
  const navItems: [View, string, typeof Inbox][] = [
    ['board', 'Рабочее пространство', PanelsTopLeft],
    ['projects', 'Проекты', Layers],
    ['reviews', 'Обзоры', ListChecks],
    ['recurring', 'Рекуррентные', Repeat2],
    ['archive', 'Архив', Archive],
  ];
  const titles: Record<View, string> = {
    board: board?.title ?? 'Моя доска',
    inbox: 'Входящие',
    calendar: 'Календарь',
    projects: 'Проекты',
    reviews: 'Обзоры',
    recurring: 'Рекуррентные',
    archive: 'Архив',
    settings: 'Настройки',
    agent: 'Ваш агент',
  };
  let monday = day;
  const weekday = new Date(`${day}T12:00:00+03:00`).getUTCDay();
  monday = addDays(day, -((weekday + 6) % 7));
  const days =
    calendarMode === 'day'
      ? [day]
      : Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const windowStart = days[0],
    windowEnd = addDays(days.at(-1)!, 1);
  const localCalendar = useMemo(() => {
    try {
      return {
        events: expandEventSeries(
          state?.calendarSeries ?? [],
          windowStart,
          windowEnd,
        ),
        error: '',
      };
    } catch (error) {
      return { events: [] as CalendarEvent[], error: (error as Error).message };
    }
  }, [state?.calendarSeries, windowStart, windowEnd]);
  const events = [...importedEvents, ...localCalendar.events.filter(matches)];
  const openEvent = (event: CalendarEvent) => {
    if (event.seriesId)
      setEventEditor({
        seriesId: event.seriesId,
        occurrenceDate: event.occurrenceDate,
        date: dateKey(new Date(event.start)),
      });
    else setSelectedEvent(event);
  };
  const scheduleEvent = (event: CalendarEvent, start: string, end: string) => {
    const series = state?.calendarSeries?.find(
      (series) => series.id === event.seriesId,
    );
    if (!series) return Promise.resolve(false);
    const patch = {
      startDate: dateKey(new Date(start)),
      startTime: clock(start),
      durationMinutes: (Date.parse(end) - Date.parse(start)) / 60000,
    };
    return act(
      series.repeat.frequency === 'none'
        ? { type: 'event.update', id: series.id, ...patch }
        : {
            type: 'event.override',
            id: series.id,
            occurrenceDate: event.occurrenceDate,
            patch,
          },
      'Время события изменено',
    );
  };
  const isDockView =
    view === 'board' || view === 'inbox' || view === 'calendar';
  const inboxPanel =
    state && board ? (
      <aside
        className={`board-inbox ${dropTarget === 'inbox' ? 'drop-active' : ''}`}
        aria-label="Неразобранные задачи"
        onDragOver={(e) => acceptDrop(e, 'inbox')}
        onDragLeave={leaveDrop}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/life-card');
          endDrag();
          if (
            id &&
            state.cards.some((c) => c.id === id && c.placement !== 'inbox')
          )
            void act({ type: 'inbox', id }, 'Возвращено во входящие');
        }}
      >
        <form
          className="inbox-capture"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act(
                { type: 'capture', title: inboxCapture },
                'Добавлено во входящие',
              )
            )
              setInboxCapture('');
          }}
        >
          <input
            data-inbox-capture
            aria-label="Новая задача в Inbox"
            disabled={pending}
            placeholder="Добавить задачу…"
            value={inboxCapture}
            onChange={(e) => setInboxCapture(e.target.value)}
            maxLength={200}
            required
          />
          <button
            aria-label="Добавить во входящие"
            type="submit"
            disabled={pending || !inboxCapture.trim()}
          >
            <Plus size={18} />
          </button>
        </form>
        <p className="board-inbox-hint">
          Перетащите задачу в колонку доски или на время в календаре.
        </p>
        {activeCards.filter((c) => c.placement === 'inbox').length >
          inbox.length && (
          <button
            className="inbox-filter-note"
            onClick={() => {
              setScope('all');
              setQuery('');
              setShowDone(true);
            }}
          >
            Часть входящих скрыта фильтрами. Показать все
          </button>
        )}
        <div className="board-inbox-list">
          {inbox.length ? (
            inbox.map((c) => cardTile(c, true))
          ) : (
            <div className="board-inbox-empty">
              <Inbox size={25} />
              <b>
                {scope !== 'all' || query || !showDone
                  ? 'Нет подходящих задач'
                  : 'Всё разобрано'}
              </b>
              <p>
                Новые мысли можно записать здесь и сразу распределить по доске.
              </p>
            </div>
          )}
        </div>
        <div className="inbox-return-hint">
          <ArrowDownToLine size={15} />
          <span>Сюда можно вернуть задачу с доски или календаря</span>
        </div>
      </aside>
    ) : null;
  const boardPanel =
    state && board ? (
      <div className="board-area">
        <div className="dock-board-navigation">
          {' '}
          {board.parentCardId && (
            <button
              className="breadcrumb"
              onClick={() =>
                navigate(
                  'board',
                  state?.cards.find((c) => c.id === board.parentCardId)
                    ?.boardId ?? 'main',
                )
              }
            >
              <ChevronLeft size={14} />К родительской доске
            </button>
          )}
          <SelectBox
            value={board.id}
            onChange={(id) => navigate('board', id)}
            label="Выбрать доску"
            options={state.boards.map((b) => ({ value: b.id, label: b.title }))}
          />
        </div>
        <div className="board-tools">
          <span>
            <PanelsTopLeft size={15} /> Доска{' '}
            <span className="muted">
              ·{' '}
              {
                visible.filter(
                  (c) => c.placement === 'board' && c.boardId === board.id,
                ).length
              }{' '}
              карточек
            </span>
          </span>
          <div>
            <button
              className="text-button"
              onClick={() =>
                setNewForm({
                  kind: 'renameBoard',
                  title: board.title,
                })
              }
            >
              Переименовать
            </button>
            <button
              className="text-button"
              onClick={() => setNewForm({ kind: 'column', title: '' })}
            >
              <Plus size={14} />
              Колонка
            </button>
          </div>
        </div>
        <div className="board-grid">
          {board.columns.map((col, i) => (
            <section
              className={`column ${dropTarget === col.id ? 'drop-active' : ''}`}
              key={col.id}
              aria-label={`Колонка «${col.title}»`}
              onDragOver={(e) => acceptDrop(e, col.id)}
              onDragLeave={leaveDrop}
              onDrop={(e) => dropMove(e, col.id)}
            >
              <h2>
                <span className={`status-dot tone-${i % 4}`} />
                <button
                  onClick={() =>
                    setNewForm({
                      kind: 'renameColumn',
                      id: col.id,
                      title: col.title,
                    })
                  }
                >
                  {col.title}
                </button>
                <span className="count">
                  {
                    visible.filter(
                      (c) =>
                        c.placement === 'board' &&
                        c.boardId === board.id &&
                        c.columnId === col.id,
                    ).length
                  }
                </span>
                <button
                  className="column-plus"
                  aria-label={`Добавить в ${col.title}`}
                  onClick={() => openNew(col.id)}
                >
                  <Plus size={15} />
                </button>
              </h2>
              <div className="column-cards">
                {visible
                  .filter(
                    (c) =>
                      c.placement === 'board' &&
                      c.boardId === board.id &&
                      c.columnId === col.id,
                  )
                  .map((c) => cardTile(c, true))}
                <button className="add-card" onClick={() => openNew(col.id)}>
                  <Plus size={16} />
                  Добавить карточку
                </button>
              </div>
            </section>
          ))}
        </div>
        {state.cards.length === 0 && (
          <div className="welcome-strip">
            <div className="welcome-orbit">
              <Orbit size={28} />
            </div>
            <div>
              <b>Начните с одного дела</b>
              <p>
                Запишите мысль выше или посмотрите, как устроены карточки,
                проекты и последовательности.
              </p>
            </div>
            <button
              className="quiet-button"
              disabled={pending}
              onClick={() =>
                void act(
                  { type: 'demo' },
                  'Добавлены примеры — их можно изменить или удалить',
                )
              }
            >
              <Sparkles size={15} />
              Попробовать на примере
            </button>
          </div>
        )}
      </div>
    ) : null;
  const calendarPanel = state ? (
    <div className="dock-calendar-content">
      <div className="calendar-toolbar">
        <div>
          <button className="quiet-button" onClick={() => setDay(dateKey())}>
            Сегодня
          </button>
          <button
            className="icon-btn"
            aria-label="Предыдущий период"
            onClick={() =>
              setDay(addDays(day, calendarMode === 'day' ? -1 : -7))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Следующий период"
            onClick={() => setDay(addDays(day, calendarMode === 'day' ? 1 : 7))}
          >
            <ChevronRight size={18} />
          </button>
          <b>
            {prettyDate(`${days[0]}T12:00:00+03:00`)}
            {days.length > 1
              ? ' — ' + prettyDate(`${days.at(-1)}T12:00:00+03:00`)
              : ''}
          </b>
        </div>
        <button
          className="quiet-button calendar-event-create"
          onClick={() => setEventEditor({ date: day })}
        >
          <Plus size={15} />
          Событие
        </button>
        <SelectBox
          value={calendarMode}
          onChange={setCalendarMode}
          label="Вид календаря"
          options={[
            { value: 'day', label: 'День' },
            { value: 'week', label: 'Неделя' },
          ]}
        />
      </div>
      <div className="calendar-layout">
        <div className="calendar-scroll" ref={attachCalendar}>
          <div
            className="calendar-grid"
            style={{
              gridTemplateColumns: `50px repeat(${days.length}, minmax(${days.length === 1 ? '220' : '105'}px, 1fr))`,
            }}
          >
            <div className="calendar-corner">МСК</div>
            {days.map((d) => (
              <div
                className={`calendar-day-heading ${d === dateKey() ? 'is-today' : ''}`}
                key={d}
              >
                <small>
                  {new Intl.DateTimeFormat('ru', {
                    weekday: 'short',
                  }).format(new Date(`${d}T12:00:00+03:00`))}
                </small>
                <b>{Number(d.slice(-2))}</b>
              </div>
            ))}
            <div className="all-day-label">
              весь
              <br />
              день
            </div>
            {days.map((d) => (
              <div
                key={'all-' + d}
                className="all-day-cell"
                onDoubleClick={(e) => {
                  if (e.target === e.currentTarget)
                    setEventEditor({ date: d, allDay: true });
                }}
              >
                {events
                  .filter(
                    (e) =>
                      e.allDay &&
                      dateKey(new Date(e.start)) <= d &&
                      dateKey(new Date(e.end)) > d,
                  )
                  .map((e) => (
                    <button key={e.id} onClick={() => openEvent(e)}>
                      {e.title}
                    </button>
                  ))}
              </div>
            ))}
            <CalendarGrid
              days={days}
              scheduled={scheduled}
              allCards={activeCards}
              events={events}
              sources={state.sources}
              pending={pending}
              onSchedule={(id, start, end) =>
                act({ type: 'schedule', id, start, end }, 'Время изменено')
              }
              onSelectCard={setSelected}
              onScheduleEvent={scheduleEvent}
              onCreateEvent={(date, time) => setEventEditor({ date, time })}
              onSelectEvent={openEvent}
              onDragCard={(id) => (id ? setDragged(id) : endDrag())}
            />
          </div>
        </div>
      </div>
      {localCalendar.error && (
        <p role="alert" className="event-error">
          {localCalendar.error}
        </p>
      )}
      <div className="calendar-sources">
        <span>Календари:</span>
        <span>
          <ScopeDot color="#6677dd" />
          Мои задачи
        </span>
        <span>
          <ScopeDot color="#8d68b5" />
          Мои события
        </span>
        {state.sources.map((s) => (
          <label key={s.id} className="checkbox-label">
            <Checkbox
              checked={s.enabled}
              disabled={pending}
              onCheckedChange={() =>
                void act(
                  { type: 'source.toggle', id: s.id },
                  'Видимость изменена',
                )
              }
            />
            <ScopeDot color={s.color} />
            {s.title}
          </label>
        ))}
        <button className="text-button" onClick={() => setImportOpen(true)}>
          <Plus size={14} />
          Добавить
        </button>
      </div>
    </div>
  ) : null;
  const feedback = (
    <>
      {sync.error && state && (
        <div className="error-banner sync-banner" role="alert">
          <span>Синхронизация приостановлена. {sync.error}</span>
          <button onClick={() => void queueRef.current?.retry()}>
            Повторить
          </button>
          {sync.canDiscard && (
            <button onClick={() => queueRef.current?.discardRejected()}>
              {sync.discardCount > 1
                ? `Отменить это и зависимые изменения (${sync.discardCount})`
                : 'Отменить это изменение'}
            </button>
          )}
          {sync.needsSignIn && <a href="/">Войти снова</a>}
        </div>
      )}
      {sync.storageError && (
        <div className="error-banner" role="alert">
          {sync.storageError}
        </div>
      )}
      {failure && (
        <div className="error-banner" role="alert">
          <span>{failure}</span>
          {needsSignIn && <a href="/">Войти снова</a>}
          <button aria-label="Закрыть ошибку" onClick={() => setFailure('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <CheckCheck size={17} />
          {notice}
        </div>
      )}
    </>
  );
  return (
    <SidebarProvider
      open={navigationOpen}
      onOpenChange={setNavigationOpen}
      style={{ '--sidebar-width': '238px' } as React.CSSProperties}
    >
      <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
        <SheetContent
          side="left"
          className="navigation-drawer"
          showCloseButton={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Меню пространства</SheetTitle>
            <SheetDescription>
              Рабочее пространство, проекты, обзоры и настройки.
            </SheetDescription>
          </SheetHeader>
          <SheetClose className="navigation-close" aria-label="Закрыть меню">
            <X size={19} />
          </SheetClose>
          <Sidebar className="life-sidebar" collapsible="none">
            <SidebarHeader>
              <div className="brand">
                <Orbit />
                <b>
                  life<span>os</span>
                </b>
                <span className="brand-badge">ЛИЧНОЕ</span>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <p className="nav-label">ПРОСТРАНСТВО</p>
              <SidebarMenu className="nav-menu">
                {navItems.map(([v, label, Icon]) => (
                  <SidebarMenuItem key={v}>
                    <SidebarMenuButton
                      isActive={v === 'board' ? isDockView : view === v}
                      onClick={() => navigate(v)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              <div className="nav-section-head">
                <p className="nav-label">МОИ ДОСКИ</p>
                <button
                  aria-label="Создать доску"
                  onClick={() => {
                    setNavigationOpen(false);
                    setNewForm({ kind: 'board', title: '' });
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>
              <SidebarMenu className="nav-menu">
                {state?.boards
                  .filter((b) => b.id !== 'main' && !b.parentCardId)
                  .map((b) => (
                    <SidebarMenuItem key={b.id}>
                      <SidebarMenuButton
                        isActive={view === 'board' && boardId === b.id}
                        onClick={() => navigate('board', b.id)}
                      >
                        <PanelsTopLeft />
                        <span>{b.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                {!state?.boards.some(
                  (b) => b.id !== 'main' && !b.parentCardId,
                ) && (
                  <p className="nav-hint">
                    Отдельная доска для любого направления.
                  </p>
                )}
              </SidebarMenu>
              <div className="nav-section-head">
                <p className="nav-label">СФЕРЫ ЖИЗНИ</p>
                <button
                  aria-label="Настроить сферы жизни"
                  onClick={() => navigate('settings')}
                >
                  <Settings2 size={15} />
                </button>
              </div>
              <div className="scope-nav">
                <button
                  className={scope === 'all' ? 'active' : ''}
                  onClick={() => {
                    setScope('all');
                    setNavigationOpen(false);
                  }}
                >
                  <span className="all-scopes" />
                  Все сферы
                </button>
                {state?.tags.map((t) => (
                  <button
                    key={t.id}
                    className={scope === t.id ? 'active' : ''}
                    onClick={() => {
                      setScope(t.id);
                      setNavigationOpen(false);
                    }}
                  >
                    <ScopeDot color={t.color} />
                    {t.title}
                  </button>
                ))}
              </div>
            </SidebarContent>
            <SidebarFooter>
              <button
                className={`footer-nav ${view === 'agent' ? 'active' : ''}`}
                onClick={() => navigate('agent')}
              >
                <Bot size={18} /> Агент и MCP <ArrowUpRight size={14} />
              </button>
              <button
                className={`footer-nav ${view === 'settings' ? 'active' : ''}`}
                onClick={() => navigate('settings')}
              >
                <Settings2 size={18} /> Настройки
              </button>
              <div className="profile">
                <div className="avatar">Я</div>
                <div>
                  <b>Моё пространство</b>
                  <small>
                    <span /> Только для меня
                  </small>
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>
        </SheetContent>
        <SidebarInset
          className={`app-inset ${isDockView ? 'dock-shell' : 'compact-shell'}`}
        >
          <header className="topbar workspace-topbar">
            <SheetTrigger
              className="navigation-trigger"
              aria-label="Открыть меню"
            >
              <Menu size={19} />
              <span>Меню</span>
            </SheetTrigger>
            {isDockView ? (
              <div
                className="topbar-dock-controls"
                ref={setDockToolbarTarget}
              />
            ) : (
              <h1 className="view-title">{titles[view]}</h1>
            )}
            {(isDockView || view === 'projects' || view === 'archive') && (
              <>
                <label className="search-box topbar-search">
                  <Search size={16} />
                  <input
                    aria-label="Поиск карточек и событий"
                    placeholder="Найти…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="Очистить поиск"
                      onClick={() => setQuery('')}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <Popover>
                  <PopoverTrigger
                    className={`topbar-filter ${filterActive ? 'has-filters' : ''}`}
                    aria-label="Фильтры задач"
                    title="Фильтры задач"
                    disabled={!state}
                  >
                    <Settings2 size={17} />
                    <span className="sr-only">Фильтры</span>
                    {filterActive && <span className="filter-active-dot" />}
                  </PopoverTrigger>
                  <PopoverContent
                    className="workspace-filter-popover"
                    align="end"
                  >
                    <PopoverTitle>Фильтры задач</PopoverTitle>
                    {state && (
                      <>
                        <SelectBox
                          value={scope}
                          onChange={setScope}
                          label="Фильтр по сфере"
                          options={[
                            { value: 'all', label: 'Все сферы' },
                            ...state.tags.map((t) => ({
                              value: t.id,
                              label: t.title,
                            })),
                          ]}
                        />
                        {view !== 'archive' && (
                          <label className="checkbox-label">
                            <Checkbox
                              checked={showDone}
                              onCheckedChange={(v) => setShowDone(v === true)}
                            />
                            Показывать готовые
                          </label>
                        )}
                        <button
                          className="text-button"
                          onClick={() => {
                            setScope('all');
                            setShowDone(true);
                            setQuery('');
                          }}
                        >
                          Сбросить фильтры и поиск
                        </button>
                      </>
                    )}
                  </PopoverContent>
                </Popover>
              </>
            )}
            <div className="view-actions">
              {!isDockView && (
                <div
                  className="view-extra-actions"
                  ref={setViewToolbarTarget}
                />
              )}
              {view === 'projects' && (
                <button
                  className="primary"
                  disabled={!state}
                  onClick={() =>
                    setNewForm({
                      kind: 'card',
                      title: '',
                      cardType: 'project',
                    })
                  }
                >
                  <Plus size={17} />
                  Новый проект
                </button>
              )}
              {view === 'reviews' && (
                <button
                  className="primary"
                  disabled={!state}
                  onClick={() => setNewForm({ kind: 'review', title: '' })}
                >
                  <Plus size={17} />
                  Новый список
                </button>
              )}
              {view === 'settings' && (
                <button
                  className="primary"
                  disabled={!state}
                  onClick={() => setImportOpen(true)}
                >
                  <Plus size={17} />
                  Добавить календарь
                </button>
              )}
            </div>
            <div className="topbar-right">
              {migrationDestination && (
                <button
                  className="btn secondary"
                  disabled={sync.count > 0 || !!sync.error}
                  onClick={async () => {
                    await queueRef.current?.retry();
                    const snapshot = queueRef.current?.snapshot();
                    if (!snapshot || snapshot.count || snapshot.error) return;
                    const target = new URL('/migrate', migrationDestination);
                    target.hash = new URLSearchParams({
                      layout:
                        localStorage.getItem('life-os:dock-layout:v1') ?? '',
                    }).toString();
                    location.assign(target.href);
                  }}
                >
                  Открыть в Yandex Cloud
                </button>
              )}
              <span
                className={`save-indicator sync-status ${sync.error ? 'sync-error' : ''}`}
                role="status"
                title={sync.error || undefined}
              >
                {sync.status === 'saved' ? <CheckCheck size={15} /> : <span />}
                {sync.status === 'saved'
                  ? 'Сохранено'
                  : sync.status === 'loading'
                    ? 'Загружаем…'
                    : sync.error
                      ? `Не сохранено: ${sync.count}`
                      : sync.status === 'retrying'
                        ? `Ждём связь · ${sync.count}`
                        : `Синхронизация · ${sync.count}`}
              </span>
              {!isDockView && (
                <button
                  className="icon-btn"
                  aria-label="Быстрый захват"
                  onClick={focusInboxCapture}
                >
                  <Plus size={19} />
                </button>
              )}
            </div>
          </header>
          {isDockView &&
            (failure || notice || sync.error || sync.storageError) && (
              <div className="dock-feedback">{feedback}</div>
            )}
          <main
            className={`workspace ${isDockView ? 'dock-page' : 'compact-page'}`}
          >
            {!isDockView && feedback}
            {loading ? (
              <div className="loading-grid">
                {[1, 2, 3].map((i) => (
                  <Skeleton className="h-56 rounded-xl" key={i} />
                ))}
              </div>
            ) : loadError ? (
              <EmptyState
                title="Не удалось открыть пространство"
                detail={loadError}
              >
                <button className="primary" onClick={() => void reload()}>
                  Повторить
                </button>
                <a
                  className="quiet-button"
                  href={
                    passwordAuth
                      ? '/login'
                      : '/signin-with-chatgpt?return_to=%2F'
                  }
                  target="_top"
                >
                  Войти
                </a>
              </EmptyState>
            ) : (
              state && (
                <>
                  {isDockView && board && (
                    <DockWorkspace
                      panels={{
                        inbox: {
                          title: `Inbox · ${inbox.length}`,
                          content: inboxPanel,
                        },
                        board: { title: board.title, content: boardPanel },
                        calendar: {
                          title: 'Календарь',
                          content: calendarPanel,
                        },
                      }}
                      focus={dockFocus}
                      onFocus={setView}
                      toolbarTarget={dockToolbarTarget}
                    />
                  )}
                  {view === 'projects' &&
                    (visible.some((c) => c.type === 'project') ? (
                      <div className="project-grid">
                        {visible
                          .filter((c) => c.type === 'project')
                          .map((c) => (
                            <section className="project-card" key={c.id}>
                              <FolderOpen
                                size={19}
                                className="project-row-icon"
                              />
                              <div className="project-summary">
                                <button
                                  className="project-name"
                                  onClick={() =>
                                    navigate('board', c.childBoardId)
                                  }
                                >
                                  {c.title}
                                </button>
                                {c.notes && <p>{c.notes}</p>}
                              </div>
                              <div className="project-progress">
                                <Progress
                                  value={
                                    state.cards.filter(
                                      (x) => x.boardId === c.childBoardId,
                                    ).length
                                      ? (state.cards.filter(
                                          (x) =>
                                            x.boardId === c.childBoardId &&
                                            x.done,
                                        ).length /
                                          state.cards.filter(
                                            (x) => x.boardId === c.childBoardId,
                                          ).length) *
                                        100
                                      : 0
                                  }
                                />
                                <span>
                                  {
                                    state.cards.filter(
                                      (x) =>
                                        x.boardId === c.childBoardId && x.done,
                                    ).length
                                  }{' '}
                                  /{' '}
                                  {
                                    state.cards.filter(
                                      (x) => x.boardId === c.childBoardId,
                                    ).length
                                  }{' '}
                                  готово
                                </span>
                              </div>
                              <button
                                className="icon-btn"
                                aria-label={`Детали проекта ${c.title}`}
                                title="Детали"
                                onClick={() => setSelected(c.id)}
                              >
                                <Settings2 size={17} />
                              </button>
                              <button
                                className="quiet-button project-row-open"
                                onClick={() =>
                                  navigate('board', c.childBoardId)
                                }
                              >
                                Открыть <ArrowUpRight size={15} />
                              </button>
                            </section>
                          ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={Layers}
                        title="Нет проектов"
                        detail=""
                      />
                    ))}
                  {view === 'reviews' && (
                    <div className="review-grid">
                      {state.reviews.map((r) => (
                        <ReviewPanel
                          key={r.id}
                          review={r}
                          pending={pending}
                          act={act}
                          addPrompt={() =>
                            setNewForm({ kind: 'prompt', title: '', id: r.id })
                          }
                          capturePrompt={(title) => {
                            navigate('inbox');
                            setNewForm({
                              kind: 'card',
                              title: `Что сделать: ${title}`,
                              placement: 'inbox',
                              cardType: 'task',
                            });
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {view === 'recurring' && (
                    <RecurringHub
                      openEvent={setEventEditor}
                      query={query}
                      scope={scope}
                      state={state}
                      act={act}
                      openCard={setSelected}
                      error={failure}
                      toolbarTarget={viewToolbarTarget}
                    />
                  )}
                  {view === 'settings' && (
                    <div className="settings-stack settings-columns">
                      <section className="settings-card">
                        <div className="section-heading">
                          <Archive size={21} />
                          <h2>Выполненные задачи</h2>
                        </div>
                        <div className="preference-row">
                          <label htmlFor="auto-archive-completed">
                            Автоархивация
                          </label>
                          <Switch
                            id="auto-archive-completed"
                            checked={state.settings.autoArchiveCompleted}
                            disabled={pending}
                            onCheckedChange={(checked) =>
                              void act({
                                type: 'settings.update',
                                autoArchiveCompleted: checked,
                              })
                            }
                          />
                        </div>
                        <details className="compact-help">
                          <summary>Как это работает</summary>
                          <p>
                            Выполненные задачи уходят в архив сразу. При
                            включении туда попадут и уже выполненные. Выключение
                            действует на следующие завершения; из архива задачу
                            можно вернуть в работу.
                          </p>
                        </details>
                        <button
                          className="text-button"
                          onClick={() => navigate('archive')}
                        >
                          Открыть архив
                        </button>
                      </section>
                      <ScopesSettings tags={state.tags} act={act} />
                      <section className="settings-card">
                        <div className="section-heading">
                          <CalendarDays size={21} />
                          <div>
                            <h2>Внешние календари</h2>
                          </div>
                        </div>
                        {state.sources.length ? (
                          state.sources.map((s) => (
                            <div className="source-row" key={s.id}>
                              <ScopeDot color={s.color} />
                              <div>
                                <b>{s.title}</b>
                                <small>
                                  {s.kind === 'caldav'
                                    ? 'CalDAV'
                                    : s.kind === 'feed'
                                      ? 'Подписка ICS'
                                      : 'Импорт файла'}{' '}
                                  ·{' '}
                                  {
                                    state.events.filter(
                                      (e) => e.sourceId === s.id,
                                    ).length
                                  }{' '}
                                  событий · {prettyDate(s.lastSynced)},{' '}
                                  {clock(s.lastSynced)}
                                </small>
                              </div>
                              <Checkbox
                                aria-label={`Показывать ${s.title}`}
                                checked={s.enabled}
                                disabled={pending}
                                onCheckedChange={() =>
                                  void act({ type: 'source.toggle', id: s.id })
                                }
                              />
                              {s.kind !== 'file' && (
                                <button
                                  className="icon-btn"
                                  aria-label={`Обновить ${s.title}`}
                                  disabled={sync.calendarPending}
                                  onClick={() =>
                                    void request(
                                      '/api/calendars',
                                      { sourceId: s.id },
                                      'Календарь обновлён',
                                    )
                                  }
                                >
                                  <RefreshCw size={17} />
                                </button>
                              )}
                              {s.kind === 'feed' && (
                                <ReplaceICSLink
                                  title={s.title}
                                  pending={sync.calendarPending}
                                  serverError={failure}
                                  submit={(url) =>
                                    request(
                                      '/api/calendars',
                                      { sourceId: s.id, url },
                                      'ICS-ссылка обновлена',
                                    )
                                  }
                                />
                              )}
                              <RemoveSource
                                pending={pending}
                                title={s.title}
                                remove={() =>
                                  act(
                                    { type: 'source.remove', id: s.id },
                                    'Календарь отключён',
                                  )
                                }
                              />
                            </div>
                          ))
                        ) : (
                          <p className="inline-empty">
                            Нет подключённых календарей
                          </p>
                        )}
                        <details className="compact-help">
                          <summary>Обновление календарей</summary>
                          <p>
                            Подписки обновляются каждые 15 минут, пока
                            приложение открыто. Файлы ICS импортируются один
                            раз; внешние события доступны только для чтения.
                          </p>
                        </details>
                      </section>
                      <section className="settings-card settings-extra">
                        <div className="account-toolbar">
                          <span>Москва · UTC+3</span>
                          <span>
                            Вход: {passwordAuth ? 'пароль' : 'ChatGPT'}
                          </span>
                          {passwordAuth ? (
                            <form method="post" action="/api/session/logout">
                              <button className="text-button" type="submit">
                                <LogOut size={15} />
                                Выйти
                              </button>
                            </form>
                          ) : (
                            <a
                              className="text-button"
                              href="/signout-with-chatgpt?return_to=%2F"
                              target="_top"
                            >
                              <LogOut size={15} />
                              Выйти
                            </a>
                          )}
                        </div>
                        <details className="compact-help">
                          <summary>Захват с телефона</summary>
                          <p>
                            Откройте Inbox и добавьте страницу на домашний экран
                            через меню браузера. Для работы нужен интернет.
                          </p>
                          <a className="quiet-button" href="/?capture=1">
                            Открыть Inbox <ArrowUpRight size={15} />
                          </a>
                        </details>
                      </section>
                    </div>
                  )}
                  {view === 'archive' && (
                    <div className="archive-list">
                      {archived.length ? (
                        archived.map((c) => cardTile(c, true))
                      ) : (
                        <p className="inline-empty">
                          {query || scope !== 'all'
                            ? 'Нет подходящих задач'
                            : 'Архив пуст'}
                        </p>
                      )}
                    </div>
                  )}
                  {view === 'agent' && <AgentPanel history={state.history} />}
                </>
              )
            )}
          </main>
        </SidebarInset>
      </Sheet>
      <Dialog
        open={!!newForm}
        onOpenChange={(open) => {
          if (!open) setNewForm(null);
        }}
      >
        <DialogContent className="life-dialog">
          <DialogHeader>
            <DialogTitle>
              {newForm?.kind === 'card'
                ? 'Новая карточка'
                : newForm?.kind === 'board'
                  ? 'Новая доска'
                  : newForm?.kind === 'column'
                    ? 'Новая колонка'
                    : newForm?.kind === 'tag'
                      ? 'Новая сфера'
                      : newForm?.kind === 'review'
                        ? 'Новый список обзора'
                        : newForm?.kind === 'prompt'
                          ? 'Новый пункт обзора'
                          : 'Переименовать'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {newForm?.placement === 'inbox' && newForm?.kind === 'card'
                ? 'Просто запишите мысль. Всё остальное можно решить позже.'
                : 'Дайте понятное название, чтобы легко вернуться к этому позже.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={newSubmit} className="form-stack">
            <label>
              Название
              <input
                autoFocus
                value={newForm?.title ?? ''}
                maxLength={200}
                onChange={(e) =>
                  setNewForm((f) => (f ? { ...f, title: e.target.value } : f))
                }
                placeholder="Что вы хотите сделать?"
                required
              />
            </label>
            {newForm?.kind === 'card' && newForm.placement !== 'inbox' && (
              <label>
                Тип карточки
                <SelectBox
                  value={newForm.cardType ?? 'task'}
                  onChange={(v) =>
                    setNewForm((f) => (f ? { ...f, cardType: v } : f))
                  }
                  label="Тип карточки"
                  options={Object.entries(labels).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </label>
            )}
            <button
              className="primary"
              disabled={pending || !newForm?.title.trim()}
            >
              Сохранить
              <ArrowRight size={16} />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!currentCard}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="detail-sheet">
          {currentCard && state && (
            <CardDetails
              key={currentCard.id}
              card={currentCard}
              state={state}
              pending={pending}
              act={act}
              close={() => setSelected(null)}
              openProject={() => {
                navigate('board', currentCard.childBoardId);
                setSelected(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
      >
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>{selectedEvent?.title ?? 'Событие'}</SheetTitle>
            <SheetDescription>
              {
                state?.sources.find((s) => s.id === selectedEvent?.sourceId)
                  ?.title
              }{' '}
              · Внешнее событие, только чтение
            </SheetDescription>
          </SheetHeader>
          {selectedEvent && (
            <div className="detail-body">
              <p>{prettyDate(selectedEvent.start)}</p>
              <b>
                {selectedEvent.allDay
                  ? 'Весь день'
                  : `${clock(selectedEvent.start)} — ${clock(selectedEvent.end)}`}
              </b>
              {selectedEvent.location && <p>{selectedEvent.location}</p>}
              <p className="muted">
                Изменения вносятся в исходном календаре и появятся после
                обновления подписки.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {state && eventEditor && (
        <CalendarEventEditor
          state={state}
          target={eventEditor}
          act={act}
          close={() => setEventEditor(null)}
        />
      )}
      <ImportCalendar
        tags={state?.tags ?? []}
        open={importOpen}
        setOpen={setImportOpen}
        pending={sync.calendarPending}
        submit={(payload) =>
          request('/api/calendars', payload, 'Календарь добавлен')
        }
      />
    </SidebarProvider>
  );
}
function CardDetails({
  card,
  state,
  pending,
  act,
  close,
  openProject,
}: {
  card: Card;
  state: LifeState;
  pending: boolean;
  act: (a: Action, s?: string) => Promise<boolean>;
  close: () => void;
  openProject: () => void;
}) {
  const detailsFormId = useId();
  const [title, setTitle] = useSyncedDraft(card.title),
    [notes, setNotes] = useSyncedDraft(card.notes),
    [tags, setTags] = useSyncedDraft(card.tags),
    [type, setType] = useSyncedDraft(card.type),
    [start, setStart] = useSyncedDraft(localInput(card.start)),
    [duration, setDuration] = useSyncedDraft(
      card.start && card.end
        ? String((Date.parse(card.end) - Date.parse(card.start)) / 60000)
        : '60',
    ),
    [target, setTarget] = useSyncedDraft(card.boardId),
    [column, setColumn] = useSyncedDraft(card.columnId),
    [step, setStep] = useState(''),
    [remove, setRemove] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await act({
      type: 'update',
      id: card.id,
      title,
      notes,
      tags,
      cardType: type,
    });
  };
  const schedule = async (e: FormEvent) => {
    e.preventDefault();
    const value = new Date(start + ':00+03:00');
    if (!Number.isFinite(value.getTime())) return;
    await act(
      {
        type: 'schedule',
        id: card.id,
        start: value.toISOString(),
        end: new Date(value.getTime() + Number(duration) * 60000).toISOString(),
      },
      'Дело перенесено в календарь',
    );
  };
  return (
    <>
      <SheetHeader>
        <div className="detail-eyebrow">
          {labels[card.type]} · {card.archived && 'Архив · '}
          {card.placement === 'inbox'
            ? 'Входящие'
            : card.placement === 'calendar'
              ? 'Календарь'
              : state.boards.find((b) => b.id === card.boardId)?.title}
        </div>
        <SheetTitle>{card.title}</SheetTitle>
        <SheetDescription>Название, заметки и следующие шаги.</SheetDescription>
      </SheetHeader>
      <div className="detail-body">
        <form id={detailsFormId} className="form-stack" onSubmit={save}>
          <label>
            Название
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          {card.type !== 'project' && (
            <label>
              Тип
              <SelectBox
                value={type}
                onChange={(v) => setType(v as Card['type'])}
                label="Тип карточки"
                options={Object.entries(labels).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </label>
          )}
          <label>
            Заметки
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={8000}
              placeholder="Детали, ссылки, мысли…"
            />
          </label>
          <div>
            <span className="field-label">Сферы жизни</span>
            <div className="tag-choices">
              {state.tags.map((t) => (
                <label className="checkbox-label" key={t.id}>
                  <Checkbox
                    checked={tags.includes(t.id)}
                    onCheckedChange={(v) =>
                      setTags(
                        v ? [...tags, t.id] : tags.filter((id) => id !== t.id),
                      )
                    }
                  />
                  <ScopeDot color={t.color} />
                  {t.title}
                </label>
              ))}
            </div>
          </div>
        </form>
        {card.type === 'project' && (
          <button className="project-open" onClick={openProject}>
            <Layers size={20} />
            <span>Открыть доску проекта</span>
            <ArrowRight size={18} />
          </button>
        )}
        {card.type === 'sequence' && (
          <section className="detail-section">
            <h3>
              <ListChecks size={18} />
              Следующие шаги
            </h3>
            <p className="muted">Шаги можно выполнять в любом порядке.</p>
            {card.steps.map((s) => (
              <div className="step-row" key={s.id}>
                <Checkbox
                  checked={s.done}
                  aria-label={s.title}
                  disabled={pending}
                  onCheckedChange={() =>
                    void act({ type: 'step.toggle', id: card.id, stepId: s.id })
                  }
                />
                <span className={`step-title ${s.done ? 'strike' : ''}`}>
                  {s.title}
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Удалить шаг ${s.title}`}
                  disabled={pending}
                  onClick={() =>
                    void act({ type: 'step.delete', id: card.id, stepId: s.id })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act({ type: 'step.add', id: card.id, title: step }))
                  setStep('');
              }}
            >
              <input
                aria-label="Новый шаг"
                placeholder="Добавить шаг…"
                maxLength={200}
                value={step}
                onChange={(e) => setStep(e.target.value)}
              />
              <button
                className="icon-btn"
                disabled={pending || !step.trim()}
                aria-label="Добавить шаг"
              >
                <Plus size={18} />
              </button>
            </form>
          </section>
        )}
        {!card.archived && card.type !== 'project' && type !== 'project' && (
          <section className="detail-section">
            <h3>
              <CalendarDays size={18} />
              Запланировать время
            </h3>
            {card.placement === 'calendar' && (
              <p className="schedule-current">
                {prettyDate(card.start!)} · {clock(card.start!)} —{' '}
                {clock(card.end!)}
              </p>
            )}
            <form className="form-stack" onSubmit={schedule}>
              <label>
                Начало · Москва
                <input
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Длительность, минуты
                <input
                  type="number"
                  min={5}
                  max={10080}
                  required
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              <button className="quiet-button" disabled={pending}>
                <CalendarClock size={16} />
                {card.placement === 'calendar'
                  ? 'Изменить время'
                  : 'Перенести в календарь'}
              </button>
            </form>
          </section>
        )}
        {!card.archived && (
          <section className="detail-section">
            <h3>
              <PanelsTopLeft size={18} />
              {card.placement === 'calendar'
                ? 'Вернуть на доску'
                : 'Место на доске'}
            </h3>
            <div className="form-stack">
              <SelectBox
                value={target}
                onChange={(v) => {
                  setTarget(v);
                  setColumn(
                    state.boards.find((b) => b.id === v)!.columns[0].id,
                  );
                }}
                label="Доска"
                options={state.boards
                  .filter((b) => b.id !== card.childBoardId)
                  .map((b) => ({ value: b.id, label: b.title }))}
              />
              <SelectBox
                value={column}
                onChange={setColumn}
                label="Колонка"
                options={
                  state.boards
                    .find((b) => b.id === target)
                    ?.columns.map((c) => ({ value: c.id, label: c.title })) ??
                  []
                }
              />
              <button
                className="quiet-button"
                disabled={pending}
                onClick={() =>
                  void act(
                    {
                      type: 'move',
                      id: card.id,
                      boardId: target,
                      columnId: column,
                    },
                    'Карточка на доске',
                  )
                }
              >
                <ArrowRight size={15} />
                Переместить
              </button>
            </div>
          </section>
        )}
        <div className="detail-actions">
          {card.archived && (
            <button
              className="quiet-button"
              disabled={pending}
              onClick={() =>
                void act(
                  { type: 'complete', id: card.id, done: false },
                  'Задача возвращена в работу',
                )
              }
            >
              Вернуть в работу
            </button>
          )}
          <button
            className="primary"
            type="submit"
            form={detailsFormId}
            disabled={pending || !title.trim()}
          >
            <Save size={17} />
            Сохранить
          </button>
          <button
            className="danger-button"
            disabled={pending}
            onClick={() => setRemove(true)}
          >
            <Trash2 size={16} />
            Удалить
          </button>
        </div>
      </div>
      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить карточку?</AlertDialogTitle>
            <AlertDialogDescription>
              «{card.title}» будет удалена из пространства. Проект с карточками
              внутри удалить нельзя.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={async () => {
                if (
                  await act({ type: 'delete', id: card.id }, 'Карточка удалена')
                )
                  close();
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function ReviewPanel({
  review: r,
  pending,
  act,
  addPrompt,
  capturePrompt,
}: {
  review: Review;
  pending: boolean;
  act: (a: Action, s?: string) => Promise<boolean>;
  addPrompt: () => void;
  capturePrompt: (title: string) => void;
}) {
  const [notes, setNotes] = useSyncedDraft(r.notes),
    [interval, setIntervalValue] = useSyncedDraft(String(r.intervalDays));
  const done = r.prompts.filter((p) => p.done).length;
  return (
    <section className="review-card">
      <div className="review-card-top">
        <h2>{r.title}</h2>
        <span className={`review-due ${r.nextDue <= dateKey() ? 'due' : ''}`}>
          {r.nextDue <= dateKey()
            ? 'Пора пройти'
            : prettyDate(r.nextDue + 'T12:00:00+03:00')}
        </span>
      </div>
      <div className="review-progress">
        <Progress
          value={r.prompts.length ? (done / r.prompts.length) * 100 : 0}
        />
        <span>
          {done} из {r.prompts.length}
        </span>
      </div>
      <div className="review-prompts">
        {r.prompts.map((p) => (
          <div className="review-prompt" key={p.id}>
            <Checkbox
              checked={p.done}
              aria-label={p.title}
              disabled={pending}
              onCheckedChange={() =>
                void act(
                  { type: 'review.prompt', id: r.id, promptId: p.id },
                  'Пункт отмечен',
                )
              }
            />
            <span className={p.done ? 'strike' : ''}>{p.title}</span>
            <button
              className="icon-btn"
              aria-label={`Создать дело: ${p.title}`}
              onClick={() => capturePrompt(p.title)}
            >
              <Plus size={17} />
            </button>
          </div>
        ))}
      </div>
      <button className="text-button" onClick={addPrompt}>
        <Plus size={15} />
        Добавить пункт
      </button>
      <details className="compact-help review-notes">
        <summary>Заметки{notes.trim() ? ' · есть текст' : ''}</summary>
        <label className="review-notes-field">
          <span className="sr-only">Мысли после обзора</span>
          <textarea
            rows={3}
            value={notes}
            maxLength={8000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Заметки к обзору"
          />
        </label>
      </details>
      <div className="review-footer">
        <label className="review-interval">
          <span>Каждые</span>
          <input
            type="number"
            min={1}
            max={365}
            value={interval}
            onChange={(e) => setIntervalValue(e.target.value)}
            aria-label="Интервал обзора в днях"
          />
          <span>дн.</span>
        </label>
        <div className="review-buttons">
          <button
            className="quiet-button"
            disabled={pending}
            onClick={() =>
              void act({
                type: 'review.update',
                id: r.id,
                notes,
                intervalDays: Number(interval),
              })
            }
          >
            Сохранить
          </button>
          <button
            className="primary"
            disabled={pending || !r.prompts.length || done !== r.prompts.length}
            onClick={async () => {
              if (
                await act({
                  type: 'review.finish',
                  id: r.id,
                  notes,
                  intervalDays: Number(interval),
                })
              )
                setNotes('');
            }}
          >
            <CheckCheck size={17} />
            Завершить обзор
          </button>
        </div>
      </div>
      {r.history.length > 0 && (
        <details className="review-history">
          <summary>Прошлые обзоры · {r.history.length}</summary>
          {r.history.map((h, i) => (
            <div key={i}>
              <b>{prettyDate(h.date)}</b>
              <p>{h.notes || 'Обзор пройден'}</p>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
function RemoveSource({
  title,
  pending,
  remove,
}: {
  title: string;
  pending: boolean;
  remove: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="icon-btn"
        aria-label={`Отключить ${title}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={16} />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отключить «{title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Импортированные события исчезнут из Life OS. Исходный календарь
              сохранится.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={async () => {
                if (await remove()) setOpen(false);
              }}
            >
              Отключить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function ImportCalendar({
  tags,
  open,
  setOpen,
  pending,
  submit,
}: {
  tags: LifeState['tags'];
  open: boolean;
  setOpen: (v: boolean) => void;
  pending: boolean;
  submit: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(''),
    [tag, setTag] = useState('none'),
    [url, setUrl] = useState(''),
    [ics, setIcs] = useState(''),
    [mode, setMode] = useState('feed'),
    [error, setError] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [calendars, setCalendars] = useState<{ url: string; title: string }[]>([]),
    [collection, setCollection] = useState(''),
    [discovering, setDiscovering] = useState(false);
  const discoveryId = useRef(0);
  useEffect(() => {
    discoveryId.current++;
    setCalendars([]);
    setCollection('');
  }, [url, username, password, mode, open]);
  useEffect(() => {
    if (!open) {
      setTitle('');
      setUrl('');
      setIcs('');
      setUsername('');
      setPassword('');
      setError('');
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="life-dialog calendar-dialog">
        <DialogHeader>
          <DialogTitle>Добавить календарь</DialogTitle>
          <DialogDescription>
            События сохранят свой источник и появятся в общем календаре.
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (discovering) return;
            if (mode === 'caldav' && !collection) {
              setError('Сначала найдите и выберите календарь');
              return;
            }
            if (mode === 'file' && !ics) {
              setError('Выберите файл ICS');
              return;
            }
            if (
              await submit(
                mode === 'caldav'
                  ? {
                      mode,
                      title,
                      url: collection,
                      username,
                      password,
                      tags: tag === 'none' ? [] : [tag],
                    }
                  : mode === 'feed'
                    ? { title, url, tags: tag === 'none' ? [] : [tag] }
                    : { title, ics, tags: tag === 'none' ? [] : [tag] },
              )
            )
              setOpen(false);
            else
              setError(
                'Не удалось добавить календарь. Проверьте файл или ссылку; подробности показаны в приложении.',
              );
          }}
        >
          <label>
            Название
            <input
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, университет"
            />
          </label>
          <label>
            Сфера жизни
            <SelectBox
              value={tag}
              onChange={setTag}
              label="Сфера календаря"
              options={[
                { value: 'none', label: 'Без сферы' },
                ...tags.map((t) => ({ value: t.id, label: t.title })),
              ]}
            />
          </label>
          <Tabs value={mode} onValueChange={(v) => setMode(String(v))}>
            <TabsList>
              <TabsTrigger value="feed">
                <Link2 size={15} />
                Подписка ICS
              </TabsTrigger>
              <TabsTrigger value="caldav">CalDAV</TabsTrigger>
              <TabsTrigger value="file">
                <FileUp size={15} />
                Файл
              </TabsTrigger>
            </TabsList>
            <TabsContent value="feed">
              <ICSLinkField value={url} onChange={setUrl} disabled={pending} />
            </TabsContent>
            <TabsContent value="caldav">
              <div className="form-stack">
                <label>
                  Адрес сервера или календаря CalDAV
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoComplete="off"
                    placeholder="https://caldav.yandex.ru"
                    required={mode === 'caldav'}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setUrl('https://caldav-mob.yandex-team.ru')}
                >
                  Рабочий Яндекс
                </button>
                <label>
                  Имя пользователя
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    maxLength={500}
                    required={mode === 'caldav'}
                  />
                </label>
                <label>
                  Пароль приложения или токен
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    maxLength={1000}
                    required={mode === 'caldav'}
                  />
                </label>
                <p className="setting-footnote">
                  Яндекс, рабочий Яндекс, iCloud и Fastmail. Для другого сервера
                  его домен нужно разрешить в настройках сервера приложения.
                  Пароль хранится зашифрованным на сервере. События доступны
                  только для чтения.
                </p>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    pending || discovering || !url || !username || !password
                  }
                  onClick={async () => {
                    const id = ++discoveryId.current;
                    setDiscovering(true);
                    setError('');
                    setCalendars([]);
                    setCollection('');
                    try {
                      const result = await apiRequest<{
                        calendars: { url: string; title: string }[];
                      }>('/api/calendars', {
                        mode: 'caldav',
                        operation: 'discover',
                        url,
                        username,
                        password,
                      });
                      if (id !== discoveryId.current) return;
                      setCalendars(result.calendars);
                      setCollection(result.calendars[0]?.url ?? '');
                      if (!title && result.calendars[0])
                        setTitle(result.calendars[0].title);
                      if (!result.calendars.length)
                        setError('На этом сервере не найдено календарей');
                    } catch (e) {
                      if (id === discoveryId.current)
                        setError(
                          e instanceof Error
                            ? e.message
                            : 'Не удалось найти календари',
                        );
                    } finally {
                      setDiscovering(false);
                    }
                  }}
                >
                  {discovering ? 'Ищем…' : 'Найти календари'}
                </button>
                {!!calendars.length && (
                  <label>
                    Календарь
                    <SelectBox
                      value={collection}
                      onChange={setCollection}
                      label="Календарь CalDAV"
                      options={calendars.map((c) => ({
                        value: c.url,
                        label: c.title,
                      }))}
                    />
                  </label>
                )}
              </div>
            </TabsContent>
            <TabsContent value="file">
              <label className="file-input">
                Файл календаря
                <input
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 1000000) {
                      setError('Максимальный размер — 1 МБ');
                      setIcs('');
                      return;
                    }
                    setIcs(await f.text());
                    setError('');
                  }}
                />
              </label>
              <p className="setting-footnote">
                Файл импортируется один раз. Для автоматического обновления
                используйте подписку.
              </p>
            </TabsContent>
          </Tabs>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            disabled={
              pending || discovering || (mode === 'caldav' && !collection)
            }
          >
            {pending ? 'Загружаем…' : 'Добавить календарь'}
            <ArrowRight size={16} />
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function AgentPanel({ history }: { history: LifeState['history'] }) {
  const [tokens, setTokens] = useState<
      { hash: string; name: string; scope: string; created_at: string }[]
    >([]),
    [name, setName] = useState('Мой агент'),
    [scope, setScope] = useState('read'),
    [secret, setSecret] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/tokens');
      const d = (await r.json()) as typeof tokens & { error?: string };
      if (!r.ok) throw new Error(d.error);
      setTokens(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="settings-stack agent-columns">
      <section className="settings-card">
        <div className="section-heading">
          <Bot size={19} />
          <h2>Подключения</h2>
        </div>
        <div className="endpoint">
          <span>MCP</span>
          <code>
            {typeof window !== 'undefined' ? location.origin : ''}/api/mcp
          </code>
        </div>
        <details className="compact-help">
          <summary>Как подключить</summary>
          <p>
            Используйте адрес MCP и токен ниже. Приватный сайт также требует
            входа через ChatGPT; одного токена недостаточно. Подключение
            внешнего клиента нужно настроить и проверить.
          </p>
        </details>
        <form
          className="token-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError('');
            try {
              const r = await fetch('/api/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, scope }),
              });
              const d = (await r.json()) as { token: string; error?: string };
              if (!r.ok) throw new Error(d.error);
              setSecret(d.token);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            Название
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label>
            Права
            <SelectBox
              value={scope}
              onChange={setScope}
              label="Права агента"
              options={[
                { value: 'read', label: 'Только чтение' },
                { value: 'write', label: 'Чтение и изменения' },
              ]}
            />
          </label>
          <button className="primary" disabled={pending}>
            Создать токен
          </button>
        </form>
        {secret && (
          <div className="token-secret">
            <b>Скопируйте токен — повторно он не появится</b>
            <code>{secret}</code>
            <button
              className="quiet-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret);
                } catch {
                  setError(
                    'Не удалось скопировать автоматически. Выделите токен и скопируйте вручную.',
                  );
                }
              }}
            >
              <Copy size={15} />
              Копировать
            </button>
            <button className="text-button" onClick={() => setSecret('')}>
              Скрыть
            </button>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {tokens.map((t) => (
          <div className="source-row" key={t.hash}>
            <ShieldCheck size={18} />
            <div>
              <b>{t.name}</b>
              <small>
                {t.scope === 'write' ? 'Чтение и изменения' : 'Только чтение'} ·{' '}
                {prettyDate(t.created_at)}
              </small>
            </div>
            <button
              className="danger-button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  const r = await fetch('/api/tokens', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hash: t.hash }),
                  });
                  if (!r.ok) throw new Error('Не удалось отозвать токен');
                  setSecret('');
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setPending(false);
                }
              }}
            >
              Отозвать
            </button>
          </div>
        ))}
      </section>
      <section className="settings-card">
        <div className="section-heading">
          <Clock3 size={21} />
          <div>
            <h2>История изменений</h2>
          </div>
        </div>
        {history.length ? (
          history.slice(0, 25).map((h, i) => (
            <div className="history-row" key={i}>
              <span className="history-dot" />
              <div>
                <b>{h.text}</b>
                <small>
                  {h.actor} · {prettyDate(h.at)}, {clock(h.at)}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="muted">Пока нет изменений.</p>
        )}
      </section>
    </div>
  );
}
