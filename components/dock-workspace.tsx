'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Inbox,
  PanelsTopLeft,
  CalendarDays,
  GripVertical,
  Maximize2,
  Minimize2,
  Ellipsis,
  X,
  RotateCcw,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
} from 'lucide-react';
import {
  PANEL_IDS,
  dockPanel,
  hidePanel,
  initialDock,
  nodeKey,
  resizeSplit,
  restoreDock,
  serializeDock,
  showPanel,
  visiblePanels,
  type DockNode,
  type DockPanelId,
  type DockSide,
} from '@/lib/dock-layout';
const KEY = 'life-os:dock-layout:v1';
const titles = { inbox: 'Inbox', board: 'Доска', calendar: 'Календарь' };
const icons = { inbox: Inbox, board: PanelsTopLeft, calendar: CalendarDays };
const edges: [DockSide, string, typeof PanelLeft][] = [
  ['left', 'Слева', PanelLeft],
  ['right', 'Справа', PanelRight],
  ['top', 'Сверху', PanelTop],
  ['bottom', 'Снизу', PanelBottom],
];
type Content = { title: string; content: ReactNode };
export default function DockWorkspace({
  panels,
  focus,
  onFocus,
}: {
  panels: Record<DockPanelId, Content>;
  focus: { panel: DockPanelId; request: number };
  onFocus: (id: DockPanelId) => void;
}) {
  const [tree, setTree] = useState<DockNode>(initialDock),
    [ready, setReady] = useState(false),
    [layoutEpoch, setLayoutEpoch] = useState(0),
    [mobile, setMobile] = useState(false),
    [active, setActive] = useState<DockPanelId>('board'),
    [maximized, setMaximized] = useState<DockPanelId | null>(null),
    [moving, setMoving] = useState<DockPanelId | null>(null),
    [hover, setHover] = useState(''),
    [storageError, setStorageError] = useState(false),
    [message, setMessage] = useState('');
  const panelRefs = useRef<Partial<Record<DockPanelId, HTMLElement>>>({});
  useEffect(() => {
    try {
      const restored = restoreDock(localStorage.getItem(KEY));
      setTree(restored);
      if (focus.request === 0) {
        const open = visiblePanels(restored);
        const initialActive = open.includes('board') ? 'board' : open[0];
        setActive(initialActive);
        onFocus(initialActive);
      }
    } catch {
      setStorageError(true);
    }
    setReady(true);
    const m = matchMedia('(max-width: 767px)');
    setMobile(m.matches);
    const change = () => setMobile(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, serializeDock(tree));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [ready, tree]);
  useEffect(() => {
    if (ready && focus.request > 0) {
      setTree((current) => showPanel(current, focus.panel));
      setActive(focus.panel);
      setMaximized(null);
    }
  }, [ready, focus.panel, focus.request]);
  useEffect(() => {
    if (!ready || focus.request === 0) return;
    const frame = requestAnimationFrame(() => {
      const target = panelRefs.current[focus.panel];
      target?.focus({ preventScroll: true });
      if (mobile) target?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, focus.panel, focus.request, mobile]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoving(null);
        setHover('');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const visible = visiblePanels(tree);
  const endMove = useCallback(() => {
    setMoving(null);
    setHover('');
  }, []);
  const place = (
    id: DockPanelId,
    target: DockPanelId | null,
    side: DockSide,
  ) => {
    setTree((current) => dockPanel(current, id, target, side));
    setMaximized(null);
    setActive(id);
    onFocus(id);
    setMessage(
      `${titles[id]}: ${edges.find((e) => e[0] === side)![1].toLowerCase()}${target ? ' от панели «' + titles[target] + '»' : ' рабочего пространства'}`,
    );
    endMove();
  };
  const close = (id: DockPanelId) => {
    if (visible.length === 1) return;
    setTree((current) => hidePanel(current, id));
    if (maximized === id) setMaximized(null);
    if (active === id) {
      const next = visible.find((panel) => panel !== id)!;
      setActive(next);
      onFocus(next);
    }
    setMessage(
      `Панель «${titles[id]}» скрыта. Её можно вернуть кнопкой над рабочим пространством.`,
    );
  };
  const select = (id: DockPanelId) => {
    setActive(id);
    onFocus(id);
  };
  const renderPanel = (id: DockPanelId) => {
    const Icon = icons[id];
    return (
      <section
        className={`dock-panel dock-panel-${id} ${active === id ? 'dock-panel-active' : ''}`}
        aria-label={`Панель ${titles[id]}`}
        tabIndex={-1}
        ref={(node) => {
          if (node) panelRefs.current[id] = node;
          else delete panelRefs.current[id];
        }}
        onPointerDown={() => select(id)}
        onFocusCapture={() => select(id)}
      >
        <header className="dock-panel-header">
          <div
            className="dock-panel-grip"
            draggable={!mobile && !maximized && visible.length > 1}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData('text/life-panel', id);
              e.dataTransfer.effectAllowed = 'move';
              setMoving(id);
              setHover('');
            }}
            onDragEnd={endMove}
            title="Перетащите заголовок к краю другой панели"
          >
            <GripVertical size={15} />
            <Icon size={17} />
            <h2>{panels[id].title}</h2>
          </div>
          <div className="dock-panel-actions">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="dock-icon-button"
                aria-label={`Расположение панели ${titles[id]}`}
              >
                <Ellipsis size={17} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dock-menu">
                {edges.map(([side, label, EdgeIcon]) => (
                  <DropdownMenuItem
                    key={side}
                    disabled={visible.length === 1}
                    onClick={() => place(id, null, side)}
                  >
                    <EdgeIcon size={15} />
                    Закрепить {label.toLowerCase()}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setMaximized(maximized === id ? null : id);
                    select(id);
                  }}
                >
                  {maximized === id ? (
                    <Minimize2 size={15} />
                  ) : (
                    <Maximize2 size={15} />
                  )}{' '}
                  {maximized === id ? 'Вернуть размер' : 'Развернуть панель'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              className="dock-icon-button"
              aria-label={
                maximized === id
                  ? `Вернуть размер панели ${titles[id]}`
                  : `Развернуть панель ${titles[id]}`
              }
              onClick={() => {
                setMaximized(maximized === id ? null : id);
                select(id);
              }}
            >
              {maximized === id ? (
                <Minimize2 size={14} />
              ) : (
                <Maximize2 size={14} />
              )}
            </button>
            <button
              className="dock-icon-button"
              aria-label={`Скрыть панель ${titles[id]}`}
              disabled={visible.length === 1}
              onClick={() => close(id)}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="dock-panel-body">{panels[id].content}</div>
        {moving && moving !== id && !mobile && (
          <div className="dock-drop-overlay">
            <span className="dock-drop-center">
              Куда закрепить
              <br />
              {titles[moving]}?
            </span>
            {edges.map(([side, label, EdgeIcon]) => (
              <div
                key={side}
                className={`dock-drop-zone dock-drop-${side} ${hover === id + side ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('text/life-panel')) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  setHover(id + side);
                }}
                onDragLeave={() =>
                  setHover((current) => (current === id + side ? '' : current))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const source = e.dataTransfer.getData(
                    'text/life-panel',
                  ) as DockPanelId;
                  if (source === moving) place(source, id, side);
                  else endMove();
                }}
              >
                <EdgeIcon size={21} />
                {label}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };
  const renderNode = (node: DockNode): ReactNode => {
    if (node.type === 'panel') return renderPanel(node.id);
    const first = nodeKey(node.first),
      second = nodeKey(node.second);
    return (
      <ResizablePanelGroup
        key={`${node.id}:${layoutEpoch}`}
        id={`dock-group:${node.id}`}
        orientation={node.orientation}
        defaultLayout={{ [first]: node.ratio, [second]: 100 - node.ratio }}
        onLayoutChanged={(sizes) => {
          if (Number.isFinite(sizes[first]))
            setTree((current) => resizeSplit(current, node.id, sizes[first]));
        }}
        className="dock-split"
      >
        <ResizablePanel
          id={first}
          defaultSize={`${node.ratio}%`}
          minSize="10%"
          className="dock-resize-content"
        >
          {renderNode(node.first)}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className="dock-resize-handle"
          aria-label={
            node.orientation === 'horizontal'
              ? 'Изменить ширину панелей'
              : 'Изменить высоту панелей'
          }
        />
        <ResizablePanel
          id={second}
          defaultSize={`${100 - node.ratio}%`}
          minSize="10%"
          className="dock-resize-content"
        >
          {renderNode(node.second)}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  };
  return (
    <div className={`dock-workspace ${mobile ? 'dock-mobile' : ''}`}>
      <div className="dock-toolbar">
        <div className="dock-panel-toggles">
          <span>Панели</span>
          {PANEL_IDS.map((id) => {
            const Icon = icons[id],
              shown = visible.includes(id);
            return (
              <button
                key={id}
                className={shown ? 'is-visible' : ''}
                aria-pressed={shown}
                disabled={!ready || (shown && visible.length === 1)}
                onClick={() => {
                  if (shown) close(id);
                  else {
                    setTree((current) => showPanel(current, id));
                    setMaximized(null);
                    select(id);
                    setMessage(`Панель «${titles[id]}» открыта`);
                  }
                }}
              >
                <Icon size={15} />
                {titles[id]}
              </button>
            );
          })}
        </div>
        <button
          className="dock-reset"
          disabled={!ready}
          onClick={() => {
            setTree(initialDock());
            setLayoutEpoch((epoch) => epoch + 1);
            setMaximized(null);
            setMoving(null);
            setHover('');
            setMessage('Стандартное расположение восстановлено');
          }}
        >
          <RotateCcw size={14} />
          Сбросить расположение
        </button>
      </div>
      <p className="dock-instructions">
        {mobile
          ? 'Меняйте расположение через меню панели. Переносите задачи через их детали.'
          : 'Заголовок — переместить панель. Разделитель — изменить размер. Карточка — перенести задачу.'}
      </p>
      {storageError && (
        <p className="dock-save-error" role="status">
          Браузер не разрешил сохранить расположение на этом устройстве.
        </p>
      )}
      <div className="dock-canvas">
        {ready ? (
          maximized ? (
            renderPanel(maximized)
          ) : mobile ? (
            visible.map((id) => (
              <div className="dock-mobile-slot" key={id}>
                {renderPanel(id)}
              </div>
            ))
          ) : (
            renderNode(tree)
          )
        ) : (
          <div className="dock-loading">Загружаем расположение панелей…</div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
