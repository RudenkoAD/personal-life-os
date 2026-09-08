'use client';
import {
  useCallback,
  useEffect,
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
  SidebarTrigger,
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
import { Checkbox } from '@/components/ui/checkbox';
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
  CircleHelp,
  List,
  LayoutGrid,
  CornerDownLeft,
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
      <p>{detail}</p>
      {children}
    </div>
  );
}
export default function Workspace() {
  const [state, setState] = useState<LifeState | null>(null),
    stateRef = useRef<LifeState | null>(null);
  const [view, setView] = useState<View>('board'),
    [boardId, setBoardId] = useState('main'),
    [scope, setScope] = useState('all'),
    [query, setQuery] = useState(''),
    [showDone, setShowDone] = useState(true);
  const [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    busy = useRef(false),
    [loadError, setLoadError] = useState(''),
    [notice, setNotice] = useState(''),
    [failure, setFailure] = useState('');
  const [capture, setCapture] = useState(''),
    [inboxCapture, setInboxCapture] = useState(''),
    captureRef = useRef<HTMLInputElement>(null),
    [selected, setSelected] = useState<string | null>(null),
    [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null),
    [newForm, setNewForm] = useState<NewForm | null>(null),
    [importOpen, setImportOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const lastSyncAttempt = useRef<Record<string, number>>({});
  const [day, setDay] = useState(dateKey()),
    [calendarMode, setCalendarMode] = useState('week'),
    [mobileCapture, setMobileCapture] = useState(false),
    [dragged, setDragged] = useState<string | null>(null),
    [dropTarget, setDropTarget] = useState<string | null>(null);
  const update = useCallback((data: LifeState) => {
    stateRef.current = data;
    setState(data);
  }, []);
  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/state');
      const data = (await r.json()) as LifeState & { error?: string };
      if (!r.ok)
        throw new Error(data.error ?? 'Не удалось загрузить пространство');
      update(data);
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [update]);
  useEffect(() => {
    void reload();
    if (new URLSearchParams(location.search).get('capture') === '1') {
      setView('inbox');
      setMobileCapture(true);
    }
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        captureRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [reload]);
  useEffect(() => {
    if (view === 'calendar' && calendarRef.current)
      calendarRef.current.scrollTop = 8 * 72;
  }, [view, calendarMode]);
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
      if (busy.current || !stateRef.current) return false;
      busy.current = true;
      setPending(true);
      setFailure('');
      try {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            revision: stateRef.current.revision,
          }),
        });
        const data = (await r.json()) as LifeState & { error?: string };
        if (!r.ok) {
          if (r.status === 409) await reload();
          throw new Error(data.error ?? 'Не удалось сохранить');
        }
        update(data);
        if (success) setNotice(success);
        return true;
      } catch (e) {
        setFailure((e as Error).message);
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [reload, update],
  );
  const act = useCallback(
    (action: Action, success?: string) =>
      request('/api/actions', { action }, success),
    [request],
  );
  useEffect(() => {
    const t = setInterval(async () => {
      for (const source of stateRef.current?.sources ?? []) {
        if (
          source.kind === 'feed' &&
          Date.now() - Date.parse(source.lastSynced) > 15 * 60000 &&
          Date.now() - (lastSyncAttempt.current[source.id] ?? 0) > 15 * 60000 &&
          !busy.current
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
    if (id) setBoardId(id);
    setSelected(null);
  };
  const submitCapture = async (e: FormEvent) => {
    e.preventDefault();
    if (
      await act({ type: 'capture', title: capture }, 'Добавлено во входящие')
    ) {
      setCapture('');
      captureRef.current?.focus();
    }
  };
  const board = state?.boards.find((b) => b.id === boardId) ?? state?.boards[0];
  const matches = (c: { title: string; tags: string[]; done?: boolean }) =>
    (scope === 'all' || c.tags.includes(scope)) &&
    c.title.toLowerCase().includes(query.toLowerCase()) &&
    (showDone || !c.done);
  const visible = state?.cards.filter(matches) ?? [],
    inbox = visible.filter((c) => c.placement === 'inbox'),
    scheduled = visible.filter((c) => c.placement === 'calendar');
  const events =
    state?.events.filter(
      (e) =>
        state.sources.some((s) => s.id === e.sourceId && s.enabled) &&
        matches(e),
    ) ?? [];
  const currentCard = state?.cards.find((c) => c.id === selected);
  const openNew = (columnId?: string) =>
    setNewForm({ kind: 'card', title: '', cardType: 'task', columnId });
  const newSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newForm || !board) return;
    let a: Action = { type: 'capture', title: newForm.title };
    switch (newForm.kind) {
      case 'card':
        a =
          view === 'inbox'
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
  const scheduleDrop = (e: React.DragEvent, date: string, hour: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/life-card');
    setDragged(null);
    if (!id) return;
    const c = state?.cards.find((c) => c.id === id);
    const start = new Date(
      `${date}T${String(hour).padStart(2, '0')}:00:00+03:00`,
    );
    const duration =
      c?.start && c.end ? Date.parse(c.end) - Date.parse(c.start) : 3600000;
    void act(
      {
        type: 'schedule',
        id,
        start: start.toISOString(),
        end: new Date(start.getTime() + duration).toISOString(),
      },
      'Время запланировано',
    );
  };
  const cardTile = (c: Card, compact = false) => (
    <article
      key={c.id}
      className={`task-card ${c.done ? 'completed' : ''} ${dragged === c.id ? 'dragging' : ''} ${compact ? 'compact' : ''}`}
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/life-card', c.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragged(c.id);
      }}
      onDragEnd={endDrag}
    >
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
      <button className="card-title" onClick={() => setSelected(c.id)}>
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
      {c.placement === 'inbox' && view === 'board' && board && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inbox-move-button"
            disabled={pending}
            aria-label={`Переместить «${c.title}» на доску «${board.title}»`}
          >
            <PanelsTopLeft size={14} /> На доску <ArrowRight size={14} />
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
    ['inbox', 'Входящие', Inbox],
    ['board', 'Моя доска', PanelsTopLeft],
    ['calendar', 'Календарь', CalendarDays],
    ['projects', 'Проекты', Layers],
    ['reviews', 'Обзоры', Repeat2],
  ];
  const titles: Record<View, string> = {
    board: board?.title ?? 'Моя доска',
    inbox: 'Входящие',
    calendar: 'Календарь',
    projects: 'Проекты',
    reviews: 'Время свериться с собой',
    settings: 'Календари и настройки',
    agent: 'Ваш агент',
  };
  let monday = day;
  const weekday = new Date(`${day}T12:00:00+03:00`).getUTCDay();
  monday = addDays(day, -((weekday + 6) % 7));
  const days =
    calendarMode === 'day'
      ? [day]
      : Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const todayItems = [
    ...scheduled
      .filter((c) => c.start && dateKey(new Date(c.start)) === dateKey())
      .map((c) => ({
        id: c.id,
        title: c.title,
        start: c.start!,
        end: c.end!,
        color: '#6677dd',
        card: true,
      })),
    ...events
      .filter((e) => dateKey(new Date(e.start)) === dateKey())
      .map((e) => ({
        ...e,
        color:
          state?.sources.find((s) => s.id === e.sourceId)?.color ?? '#6677dd',
        card: false,
      })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '238px' } as React.CSSProperties}
    >
      <Sidebar className="life-sidebar">
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
                  isActive={view === v}
                  onClick={() =>
                    navigate(v, v === 'board' ? 'main' : undefined)
                  }
                >
                  <Icon />
                  <span>{label}</span>
                  {v === 'inbox' &&
                    !!state?.cards.filter((c) => c.placement === 'inbox')
                      .length && (
                      <span className="nav-count">
                        {
                          state.cards.filter((c) => c.placement === 'inbox')
                            .length
                        }
                      </span>
                    )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="nav-section-head">
            <p className="nav-label">МОИ ДОСКИ</p>
            <button
              aria-label="Создать доску"
              onClick={() => setNewForm({ kind: 'board', title: '' })}
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
            {!state?.boards.some((b) => b.id !== 'main' && !b.parentCardId) && (
              <p className="nav-hint">
                Отдельная доска для любого направления.
              </p>
            )}
          </SidebarMenu>
          <div className="nav-section-head">
            <p className="nav-label">СФЕРЫ ЖИЗНИ</p>
            <button
              aria-label="Добавить тег"
              onClick={() => setNewForm({ kind: 'tag', title: '' })}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="scope-nav">
            <button
              className={scope === 'all' ? 'active' : ''}
              onClick={() => setScope('all')}
            >
              <span className="all-scopes" />
              Все сферы
            </button>
            {state?.tags.map((t) => (
              <button
                key={t.id}
                className={scope === t.id ? 'active' : ''}
                onClick={() => setScope(t.id)}
              >
                <ScopeDot color={t.color} />
                {t.title}
              </button>
            ))}
          </div>
          <div className="sidebar-note">
            <Orbit size={21} />
            <p>
              Всё важное —<br />в одном пространстве.
            </p>
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
      <SidebarInset className="app-inset">
        <header className="topbar">
          <SidebarTrigger />
          <span>Моё пространство</span>
          <ChevronRight size={14} />
          <b>{view === 'board' ? 'Доски' : titles[view]}</b>
          <div className="topbar-right">
            <span className="save-indicator">
              <span />
              {pending ? 'Сохраняем…' : 'Личное пространство'}
            </span>
            <button
              className="icon-btn"
              aria-label="Быстрый захват"
              onClick={() => captureRef.current?.focus()}
            >
              <Plus size={19} />
            </button>
          </div>
        </header>
        <main className="workspace">
          <div className="heading-kicker">
            <span className="eyebrow">
              {view === 'board'
                ? 'ДЕЛА В СВОЁМ ТЕМПЕ'
                : view === 'inbox'
                  ? 'СНАЧАЛА ЗАПИСАТЬ, ПОТОМ РАЗОБРАТЬ'
                  : view === 'calendar'
                    ? 'МЕСТО ДЛЯ ВАШЕГО ВРЕМЕНИ'
                    : view === 'reviews'
                      ? 'ПОСМОТРЕТЬ НА ЖИЗНЬ ЦЕЛИКОМ'
                      : 'ЛИЧНОЕ ПРОСТРАНСТВО'}
            </span>
            <span className="current-date">
              {prettyDate(new Date().toISOString())}
            </span>
          </div>
          <div className="page-title">
            <div>
              {board?.parentCardId && view === 'board' && (
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
              <h1>{titles[view]}</h1>
              <p className="page-subtitle">
                {view === 'board'
                  ? 'Освободите голову. Выберите следующий шаг.'
                  : view === 'inbox'
                    ? `${inbox.length} записей, которым нужно найти своё место.`
                    : view === 'calendar'
                      ? 'Когда именно вы займётесь важным. Время Москвы, UTC+3.'
                      : view === 'projects'
                        ? 'Большие замыслы начинаются с небольших шагов.'
                        : view === 'reviews'
                          ? 'Постоянные списки помогают помнить о важных сферах.'
                          : view === 'agent'
                            ? 'Доступ к вашим задачам через общие правила приложения.'
                            : 'Внешние события рядом с вашими планами.'}
              </p>
            </div>
            {['board', 'inbox', 'projects'].includes(view) && (
              <button
                className="primary"
                disabled={!state}
                onClick={() =>
                  view === 'projects'
                    ? setNewForm({
                        kind: 'card',
                        title: '',
                        cardType: 'project',
                      })
                    : openNew()
                }
              >
                <Plus size={17} />
                {view === 'projects' ? 'Новый проект' : 'Новая карточка'}
              </button>
            )}
            {view === 'reviews' && (
              <button
                className="primary"
                onClick={() => setNewForm({ kind: 'review', title: '' })}
              >
                <Plus size={17} />
                Новый список
              </button>
            )}
            {view === 'settings' && (
              <button className="primary" onClick={() => setImportOpen(true)}>
                <Plus size={17} />
                Добавить календарь
              </button>
            )}
          </div>
          <form className="capture" onSubmit={submitCapture}>
            <span className="capture-icon">
              <Plus size={19} />
            </span>
            <input
              ref={captureRef}
              autoFocus={mobileCapture}
              aria-label="Быстрый захват во входящие"
              placeholder="Что нужно сделать? Запишите, разберётесь позже…"
              value={capture}
              maxLength={200}
              onChange={(e) => setCapture(e.target.value)}
              disabled={!state}
            />
            <kbd>⌘ K</kbd>
            <button
              className="capture-submit"
              type="submit"
              disabled={pending || !capture.trim() || !state}
              aria-label="Отправить во входящие"
            >
              <CornerDownLeft size={19} />
            </button>
          </form>
          {failure && (
            <div className="error-banner" role="alert">
              <span>{failure}</span>
              <button
                aria-label="Закрыть ошибку"
                onClick={() => setFailure('')}
              >
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
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
              >
                Войти
              </a>
            </EmptyState>
          ) : (
            state && (
              <>
                {['board', 'inbox', 'calendar', 'projects'].includes(view) && (
                  <div className="filterbar">
                    <div className="filter-left">
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
                      <span className="filter-divider" />
                      <label className="search-box">
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
                    </div>
                    <label className="checkbox-label">
                      <Checkbox
                        checked={showDone}
                        onCheckedChange={(v) => setShowDone(v === true)}
                      />
                      Показывать готовые
                    </label>
                  </div>
                )}
                {view === 'board' && board && (
                  <div className="board-workspace">
                    <aside
                      className={`board-inbox ${dropTarget === 'inbox' ? 'drop-active' : ''}`}
                      aria-label="Inbox рядом с доской"
                      onDragOver={(e) => acceptDrop(e, 'inbox')}
                      onDragLeave={leaveDrop}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData('text/life-card');
                        endDrag();
                        if (
                          id &&
                          state.cards.some(
                            (c) => c.id === id && c.placement !== 'inbox',
                          )
                        )
                          void act(
                            { type: 'inbox', id },
                            'Возвращено во входящие',
                          );
                      }}
                    >
                      <div className="board-inbox-heading">
                        <h2>
                          <Inbox size={18} /> Inbox
                        </h2>
                        <span
                          className="count"
                          aria-label={`${inbox.length} входящих`}
                        >
                          {inbox.length}
                        </span>
                      </div>
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
                        Перетащите задачу в нужную колонку справа.
                      </p>
                      {state.cards.filter((c) => c.placement === 'inbox')
                        .length > inbox.length && (
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
                              Новые мысли можно записать здесь и сразу
                              распределить по доске.
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="inbox-return-hint">
                        <ArrowDownToLine size={15} />
                        <span>Сюда можно вернуть задачу с доски</span>
                      </div>
                    </aside>
                    <div className="board-with-agenda">
                      <div className="board-area">
                        <div className="board-tools">
                          <span>
                            <PanelsTopLeft size={15} /> Доска{' '}
                            <span className="muted">
                              ·{' '}
                              {
                                visible.filter(
                                  (c) =>
                                    c.placement === 'board' &&
                                    c.boardId === board.id,
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
                              onClick={() =>
                                setNewForm({ kind: 'column', title: '' })
                              }
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
                                  .map((c) => cardTile(c))}
                                <button
                                  className="add-card"
                                  onClick={() => openNew(col.id)}
                                >
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
                                Запишите мысль выше или посмотрите, как устроены
                                карточки, проекты и последовательности.
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
                      <details className="board-agenda">
                        <summary>
                          <CalendarDays size={16} />
                          <span>
                            Сегодня · {todayItems.length} запланировано
                          </span>
                          <ChevronRight size={16} />
                        </summary>
                        <aside className="today-panel">
                          <div className="today-heading">
                            <span>
                              <CalendarDays size={17} /> Сегодня
                            </span>
                            <button
                              aria-label="Открыть календарь"
                              onClick={() => navigate('calendar')}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                          <div className="today-date">
                            {prettyDate(new Date().toISOString())}
                            <span>МСК</span>
                          </div>
                          {todayItems.length ? (
                            todayItems.map((e) => (
                              <button
                                className="agenda-event"
                                key={e.id}
                                style={{ borderLeftColor: e.color }}
                                onClick={() =>
                                  e.card
                                    ? setSelected(e.id)
                                    : setSelectedEvent(
                                        state.events.find(
                                          (x) => x.id === e.id,
                                        ) ?? null,
                                      )
                                }
                              >
                                <small>
                                  {clock(e.start)} — {clock(e.end)}
                                </small>
                                <b>{e.title}</b>
                              </button>
                            ))
                          ) : (
                            <div className="today-empty">
                              <CalendarClock size={26} />
                              <b>Есть место для важного</b>
                              <p>Сегодня пока ничего не запланировано.</p>
                            </div>
                          )}
                          <div
                            className={`today-drop ${dragged ? 'ready' : ''}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => scheduleDrop(e, dateKey(), 17)}
                          >
                            <CalendarDays size={18} />
                            <span>
                              Перетащите дело
                              <br />
                              на сегодня, 17:00
                            </span>
                          </div>
                          <button
                            className="agenda-link"
                            onClick={() => navigate('calendar')}
                          >
                            Открыть календарь
                            <ArrowRight size={15} />
                          </button>
                          {state.reviews.some(
                            (r) => r.nextDue <= dateKey(),
                          ) && (
                            <button
                              className="review-nudge"
                              onClick={() => navigate('reviews')}
                            >
                              <Repeat2 size={20} />
                              <b>Время для обзора</b>
                              <span>
                                Проверьте, что сейчас важно
                                <ArrowRight size={14} />
                              </span>
                            </button>
                          )}
                        </aside>
                      </details>
                    </div>
                  </div>
                )}
                {view === 'inbox' &&
                  (inbox.length ? (
                    <div className="inbox-list">
                      <div className="list-heading">
                        <span>НЕРАЗОБРАННОЕ</span>
                        <span>{inbox.length}</span>
                      </div>
                      {inbox.map((c) => (
                        <article className="inbox-row" key={c.id}>
                          <Inbox size={19} />
                          <button
                            className="inbox-title"
                            onClick={() => setSelected(c.id)}
                          >
                            <b>{c.title}</b>
                            <small>
                              {prettyDate(c.createdAt)}
                              {c.tags.length
                                ? ' · ' +
                                  c.tags
                                    .map(
                                      (id) =>
                                        state.tags.find((t) => t.id === id)
                                          ?.title,
                                    )
                                    .join(', ')
                                : ''}
                            </small>
                          </button>
                          <button
                            className="quiet-button"
                            disabled={pending}
                            onClick={() =>
                              void act(
                                { type: 'move', id: c.id, boardId: 'main' },
                                'Перемещено на доску',
                              )
                            }
                          >
                            <PanelsTopLeft size={15} />
                            На доску
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`Разобрать ${c.title}`}
                            onClick={() => setSelected(c.id)}
                          >
                            <ArrowUpRight size={18} />
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title={
                        scope !== 'all' || query
                          ? 'Записей не найдено'
                          : 'В голове стало свободнее'
                      }
                      detail={
                        scope !== 'all' || query
                          ? 'Попробуйте другую сферу или поисковый запрос.'
                          : 'Всё разобрано. Новые мысли можно сразу записывать в поле выше.'
                      }
                    />
                  ))}
                {view === 'projects' &&
                  (visible.some((c) => c.type === 'project') ? (
                    <div className="project-grid">
                      {visible
                        .filter((c) => c.type === 'project')
                        .map((c) => (
                          <section className="project-card" key={c.id}>
                            <div className="project-card-head">
                              <span className="project-icon">
                                <FolderOpen size={23} />
                              </span>
                              <button
                                className="icon-btn"
                                aria-label={`Детали проекта ${c.title}`}
                                onClick={() => setSelected(c.id)}
                              >
                                <Settings2 size={17} />
                              </button>
                            </div>
                            <button
                              className="project-name"
                              onClick={() => navigate('board', c.childBoardId)}
                            >
                              {c.title}
                              <ArrowUpRight size={18} />
                            </button>
                            <p>
                              {c.notes ||
                                'Собственная доска для задач и следующих шагов.'}
                            </p>
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
                          </section>
                        ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={Layers}
                      title="Дайте замыслу своё пространство"
                      detail="У каждого проекта будет собственная доска. Внутри можно создавать задачи и другие проекты."
                    />
                  ))}
                {view === 'calendar' && (
                  <>
                    <div className="calendar-toolbar">
                      <div>
                        <button
                          className="quiet-button"
                          onClick={() => setDay(dateKey())}
                        >
                          Сегодня
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Предыдущий период"
                          onClick={() =>
                            setDay(
                              addDays(day, calendarMode === 'day' ? -1 : -7),
                            )
                          }
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Следующий период"
                          onClick={() =>
                            setDay(addDays(day, calendarMode === 'day' ? 1 : 7))
                          }
                        >
                          <ChevronRight size={18} />
                        </button>
                        <b>
                          {prettyDate(`${days[0]}T12:00:00+03:00`)}
                          {days.length > 1
                            ? ' — ' +
                              prettyDate(`${days.at(-1)}T12:00:00+03:00`)
                            : ''}
                        </b>
                      </div>
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
                      <div className="calendar-scroll" ref={calendarRef}>
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
                            <div key={'all-' + d} className="all-day-cell">
                              {events
                                .filter(
                                  (e) =>
                                    e.allDay &&
                                    dateKey(new Date(e.start)) <= d &&
                                    dateKey(new Date(e.end)) > d,
                                )
                                .map((e) => (
                                  <button
                                    key={e.id}
                                    onClick={() => setSelectedEvent(e)}
                                  >
                                    {e.title}
                                  </button>
                                ))}
                            </div>
                          ))}
                          {Array.from({ length: 24 }, (_, i) => i).map(
                            (hour) => (
                              <CalendarRow
                                key={hour}
                                hour={hour}
                                days={days}
                                scheduled={scheduled}
                                events={events}
                                state={state}
                                scheduleDrop={scheduleDrop}
                                setSelected={setSelected}
                                setSelectedEvent={setSelectedEvent}
                                setDragged={setDragged}
                              />
                            ),
                          )}
                        </div>
                      </div>
                      <aside className="calendar-backlog">
                        <h2>
                          <PanelsTopLeft size={16} />
                          Без времени
                        </h2>
                        <p>
                          Перетащите карточку на нужный час или задайте время в
                          её деталях.
                        </p>
                        {visible
                          .filter((c) => c.placement === 'board' && !c.done)
                          .slice(0, 30)
                          .map((c) => cardTile(c, true))}
                        {!visible.some(
                          (c) => c.placement === 'board' && !c.done,
                        ) && (
                          <p className="backlog-empty">
                            Все дела распределены.
                          </p>
                        )}
                        <div
                          className="return-drop"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = e.dataTransfer.getData('text/life-card');
                            if (id)
                              void act(
                                { type: 'move', id },
                                'Возвращено на доску',
                              );
                            setDragged(null);
                          }}
                        >
                          <PanelsTopLeft size={18} />
                          Вернуть дело на доску
                        </div>
                      </aside>
                    </div>
                    <div className="calendar-sources">
                      <span>Календари:</span>
                      <span>
                        <ScopeDot color="#6677dd" />
                        Мои задачи
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
                      <button
                        className="text-button"
                        onClick={() => setImportOpen(true)}
                      >
                        <Plus size={14} />
                        Добавить
                      </button>
                    </div>
                    <p className="muted calendar-hint">
                      Внешние события доступны для чтения. Повторяющиеся
                      события: 31 день назад и 12 месяцев вперёд.
                    </p>
                  </>
                )}
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
                            cardType: 'task',
                          });
                        }}
                      />
                    ))}
                  </div>
                )}
                {view === 'settings' && (
                  <div className="settings-stack">
                    <section className="settings-card">
                      <div className="section-heading">
                        <CalendarDays size={21} />
                        <div>
                          <h2>Внешние календари</h2>
                          <p>
                            Подписки обновляются каждые 15 минут, пока
                            приложение открыто.
                          </p>
                        </div>
                      </div>
                      {state.sources.length ? (
                        state.sources.map((s) => (
                          <div className="source-row" key={s.id}>
                            <ScopeDot color={s.color} />
                            <div>
                              <b>{s.title}</b>
                              <small>
                                {s.kind === 'feed'
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
                            {s.kind === 'feed' && (
                              <button
                                className="icon-btn"
                                aria-label={`Обновить ${s.title}`}
                                disabled={pending}
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
                        <EmptyState
                          icon={CalendarDays}
                          title="Все календари рядом"
                          detail="Добавьте ссылку подписки ICS или импортируйте файл календаря."
                        />
                      )}
                      <button
                        className="quiet-button"
                        onClick={() => setImportOpen(true)}
                      >
                        <Plus size={16} />
                        Добавить календарь
                      </button>
                    </section>
                    <section className="settings-card">
                      <div className="section-heading">
                        <ArrowDownToLine size={21} />
                        <div>
                          <h2>Быстрый захват на телефоне</h2>
                          <p>
                            Откройте страницу захвата и добавьте её на домашний
                            экран через меню браузера.
                          </p>
                        </div>
                      </div>
                      <a className="quiet-button" href="/?capture=1">
                        Открыть страницу захвата
                        <ArrowUpRight size={15} />
                      </a>
                      <p className="setting-footnote">
                        Веб-клиенту нужен интернет. Нативный виджет и
                        офлайн-очередь пока не подключены.
                      </p>
                    </section>
                    <section className="settings-card">
                      <div className="section-heading">
                        <ShieldCheck size={21} />
                        <div>
                          <h2>Личное пространство</h2>
                          <p>
                            Данные хранятся на сервере и привязаны к вашему
                            аккаунту.
                          </p>
                        </div>
                      </div>
                      <div className="settings-line">
                        <span>Часовой пояс</span>
                        <b>Москва · UTC+3</b>
                      </div>
                      <div className="settings-line">
                        <span>Вход</span>
                        <b>ChatGPT</b>
                      </div>
                      <p className="setting-footnote">
                        Яндекс ID, CalDAV и редактирование событий у провайдера
                        — следующие интеграции.
                      </p>
                      <a
                        className="text-button"
                        href="/signout-with-chatgpt?return_to=%2F"
                        target="_top"
                      >
                        <LogOut size={15} />
                        Выйти
                      </a>
                    </section>
                  </div>
                )}
                {view === 'agent' && <AgentPanel history={state.history} />}
              </>
            )
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <Orbit size={14} /> life os
          </span>
          <span>Меньше держать в голове. Больше внимания жизни.</span>
        </footer>
      </SidebarInset>
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
            <DialogDescription>
              {view === 'inbox' && newForm?.kind === 'card'
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
            {newForm?.kind === 'card' && view !== 'inbox' && (
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
      <ImportCalendar
        tags={state?.tags ?? []}
        open={importOpen}
        setOpen={setImportOpen}
        pending={pending}
        submit={(payload) =>
          request('/api/calendars', payload, 'Календарь добавлен')
        }
      />
    </SidebarProvider>
  );
}
function CalendarRow({
  hour,
  days,
  scheduled,
  events,
  state,
  scheduleDrop,
  setSelected,
  setSelectedEvent,
  setDragged,
}: {
  hour: number;
  days: string[];
  scheduled: Card[];
  events: CalendarEvent[];
  state: LifeState;
  scheduleDrop: (e: React.DragEvent, d: string, h: number) => void;
  setSelected: (id: string) => void;
  setSelectedEvent: (e: CalendarEvent) => void;
  setDragged: (id: string | null) => void;
}) {
  return (
    <>
      <div className="time-label">{String(hour).padStart(2, '0')}:00</div>
      {days.map((d) => {
        const begin = Date.parse(
            `${d}T${String(hour).padStart(2, '0')}:00:00+03:00`,
          ),
          end = begin + 3600000;
        const all = [
          ...scheduled
            .filter((c) => c.start && c.end)
            .map((c) => ({
              id: c.id,
              start: c.start!,
              end: c.end!,
              title: c.title,
              color: '#6677dd',
              card: true,
              done: c.done,
            })),
          ...events
            .filter((e) => !e.allDay)
            .map((e) => ({
              ...e,
              color:
                state.sources.find((s) => s.id === e.sourceId)?.color ??
                '#3e9a82',
              card: false,
              done: false,
            })),
        ].filter((e) => Date.parse(e.start) < end && Date.parse(e.end) > begin);
        return (
          <div
            className="calendar-cell"
            key={d}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => scheduleDrop(e, d, hour)}
          >
            {all.map((e) => (
              <button
                className={`time-event ${e.done ? 'completed' : ''}`}
                key={e.id}
                style={{
                  background: e.color + '15',
                  borderLeftColor: e.color,
                  color: e.color,
                }}
                draggable={e.card}
                onDragStart={(ev) => {
                  if (e.card) {
                    ev.dataTransfer.setData('text/life-card', e.id);
                    setDragged(e.id);
                  }
                }}
                onDragEnd={() => setDragged(null)}
                onClick={() =>
                  e.card
                    ? setSelected(e.id)
                    : setSelectedEvent(events.find((x) => x.id === e.id)!)
                }
              >
                <b>{e.title}</b>
                <small>
                  {clock(e.start)}–{clock(e.end)}
                  {!e.card ? ' · внешний' : ''}
                </small>
              </button>
            ))}
          </div>
        );
      })}
    </>
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
  const [title, setTitle] = useState(card.title),
    [notes, setNotes] = useState(card.notes),
    [tags, setTags] = useState(card.tags),
    [type, setType] = useState(card.type),
    [start, setStart] = useState(localInput(card.start)),
    [duration, setDuration] = useState(
      card.start && card.end
        ? String((Date.parse(card.end) - Date.parse(card.start)) / 60000)
        : '60',
    ),
    [target, setTarget] = useState(card.boardId),
    [column, setColumn] = useState(card.columnId),
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
          {labels[card.type]} ·{' '}
          {card.placement === 'inbox'
            ? 'Входящие'
            : card.placement === 'calendar'
              ? 'Календарь'
              : state.boards.find((b) => b.id === card.boardId)?.title}
        </div>
        <SheetTitle>{card.title}</SheetTitle>
        <SheetDescription>
          Детали, следующие шаги и место в вашем расписании.
        </SheetDescription>
      </SheetHeader>
      <div className="detail-body">
        <form className="form-stack" onSubmit={save}>
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
          <button className="primary" disabled={pending}>
            Сохранить детали
          </button>
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
                <span className={s.done ? 'strike' : ''}>{s.title}</span>
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
                setColumn(state.boards.find((b) => b.id === v)!.columns[0].id);
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
                  ?.columns.map((c) => ({ value: c.id, label: c.title })) ?? []
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
        <div className="detail-actions">
          <button
            className="primary"
            disabled={pending}
            onClick={() =>
              void act({ type: 'complete', id: card.id, done: !card.done })
            }
          >
            <Check size={17} />
            {card.done ? 'Вернуть в работу' : 'Завершить'}
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
  const [notes, setNotes] = useState(r.notes),
    [interval, setIntervalValue] = useState(String(r.intervalDays));
  const done = r.prompts.filter((p) => p.done).length;
  return (
    <section className="review-card">
      <div className="review-card-top">
        <span className="review-icon">
          <Repeat2 size={23} />
        </span>
        <span className={`review-due ${r.nextDue <= dateKey() ? 'due' : ''}`}>
          {r.nextDue <= dateKey()
            ? 'Можно пройти сейчас'
            : 'Следующий · ' + prettyDate(r.nextDue + 'T12:00:00+03:00')}
        </span>
      </div>
      <h2>{r.title}</h2>
      <p className="muted">Нужно ли мне что-то сделать в этой сфере?</p>
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
        Добавить сферу для размышления
      </button>
      <div className="form-stack review-notes">
        <label>
          Мысли после обзора
          <textarea
            rows={3}
            value={notes}
            maxLength={8000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Что хочется изменить или продолжить?"
          />
        </label>
        <label>
          Повторять через, дней
          <input
            type="number"
            min={1}
            max={365}
            value={interval}
            onChange={(e) => setIntervalValue(e.target.value)}
          />
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
                await act(
                  {
                    type: 'review.update',
                    id: r.id,
                    notes,
                    intervalDays: Number(interval),
                  },
                  '',
                )
              ) {
                if (
                  await act(
                    { type: 'review.finish', id: r.id },
                    'Обзор завершён. Следующая дата обновлена.',
                  )
                )
                  setNotes('');
              }
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
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) {
      setTitle('');
      setUrl('');
      setIcs('');
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
            if (mode === 'file' && !ics) {
              setError('Выберите файл ICS');
              return;
            }
            if (
              await submit(
                mode === 'feed'
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
              <TabsTrigger value="file">
                <FileUp size={15} />
                Файл
              </TabsTrigger>
            </TabsList>
            <TabsContent value="feed">
              <label className="form-field">
                Секретная ссылка ICS
                <input
                  type="url"
                  autoComplete="off"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  required={mode === 'feed'}
                />
              </label>
              <p className="setting-footnote">
                Google, Яндекс, Outlook и DataSchool. Ссылка сохраняется только
                на сервере и не передаётся агенту.
              </p>
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
          <button className="primary" disabled={pending}>
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
    <div className="settings-stack">
      <section className="settings-card">
        <div className="section-heading">
          <Bot size={24} />
          <div>
            <h2>Личный помощник с понятными правами</h2>
            <p>
              Читайте задачи, разбирайте входящие и планируйте время через MCP.
            </p>
          </div>
        </div>
        <div className="agent-capabilities">
          <span>
            <Check size={15} />
            Общая модель задач
          </span>
          <span>
            <Check size={15} />
            Проверка прав
          </span>
          <span>
            <Check size={15} />
            История изменений
          </span>
        </div>
        <div className="endpoint">
          <span>MCP · Streamable HTTP</span>
          <code>
            {typeof window !== 'undefined' ? location.origin : ''}/api/mcp
          </code>
        </div>
        <p className="setting-footnote">
          Токен задаёт права внутри приложения. Для обращения к этому приватному
          сайту клиенту также нужен доступ через вход ChatGPT. Внешнее
          подключение MCP-клиента ещё нужно настроить и проверить.
        </p>
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
            <h2>Последние изменения</h2>
            <p>Действия человека и агента видны в одной истории.</p>
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
          <p className="muted">
            Здесь появятся действия с карточками и обзорами.
          </p>
        )}
      </section>
    </div>
  );
}
