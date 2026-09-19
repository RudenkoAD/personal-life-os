'use client';
// oxlint-disable react/react-compiler -- Mount effects synchronize external authentication and browser storage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Workspace from '@/components/workspace';
import { apiRequest, ApiError } from '@/lib/api-client';

type Space = {
  id: string;
  name: string;
  kind: 'private' | 'shared';
  role: 'owner' | 'member';
};
type SpacesResponse = {
  user: { id: string; login: string; name: string };
  spaces: Space[];
  privateSpaceId: string;
};
type SpaceDetails = {
  members: { id: string; name: string; role: string }[];
  invites: { hash: string; expiresAt: string }[];
};

export default function SpaceShell({
  ownerId,
  passwordAuth = false,
  migrationDestination,
}: {
  ownerId: string;
  passwordAuth?: boolean;
  migrationDestination?: string;
}) {
  const accountHeaders = useMemo(
    () => ({ 'X-Life-Account': ownerId }),
    [ownerId],
  );
  const [data, setData] = useState<SpacesResponse | null>(null);
  const [selected, setSelected] = useState('');
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const detailVersion = useRef(0);
  const [detailData, setDetails] = useState<
    (SpaceDetails & { spaceId: string }) | null
  >(null);
  const details = detailData?.spaceId === selected ? detailData : null;
  const [newInvite, setNewInvite] = useState<{
    spaceId: string;
    hash: string;
    link: string;
    expiresAt: string;
  } | null>(null);
  const [name, setName] = useState('');
  const [managing, setManaging] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const load = useCallback(
    async (preferred?: string) => {
      try {
        const result = await apiRequest<SpacesResponse>(
          '/api/spaces',
          undefined,
          60000,
          accountHeaders,
        );
        setData(result);
        setSelected((current) => {
          const wanted = preferred ?? current;
          return result.spaces.some((s) => s.id === wanted)
            ? wanted
            : result.privateSpaceId;
        });
        setError('');
        setNeedsLogin(false);
      } catch (e) {
        if (e instanceof ApiError && (e.needsSignIn || e.status === 403)) {
          setData(null);
          setSelected('');
          setDetails(null);
          setNewInvite(null);
          setNeedsLogin(true);
        }
        setError(
          e instanceof Error ? e.message : 'Не удалось загрузить пространства',
        );
      }
    },
    [accountHeaders],
  );
  const accessRevoked = useCallback(() => {
    void load();
  }, [load]);
  // Fetch the authenticated space list on mount; updates follow the network response.
  useEffect(() => {
    void load();
  }, [load]);
  const current = data?.spaces.find((space) => space.id === selected);
  const reloadDetails = useCallback(
    async (id: string) => {
      const version = ++detailVersion.current;
      try {
        const result = await apiRequest<SpaceDetails>(
          `/api/spaces?space=${encodeURIComponent(id)}`,
          undefined,
          60000,
          accountHeaders,
        );
        if (selectedRef.current === id && detailVersion.current === version)
          setDetails({ ...result, spaceId: id });
      } catch (e) {
        if (selectedRef.current === id && detailVersion.current === version)
          setError(
            e instanceof Error ? e.message : 'Не удалось загрузить участников',
          );
      }
    },
    [accountHeaders],
  );
  useEffect(() => {
    ++detailVersion.current;
    if (current?.kind === 'shared') void reloadDetails(current.id);
  }, [current?.id, current?.kind, reloadDetails]);
  const run = async (action: Record<string, unknown>) => {
    if (managing || queueBusy) return;
    setManaging(true);
    setError('');
    try {
      const result = await apiRequest<{
        space?: Space;
        token?: string;
        expiresAt?: string;
      }>('/api/spaces', action, 60000, accountHeaders);
      if (action.action === 'invite' && result.token && result.expiresAt) {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(result.token),
        );
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        setNewInvite({
          spaceId: String(action.spaceId),
          hash,
          link: `${location.origin}/join#${result.token}`,
          expiresAt: result.expiresAt,
        });
      }
      if (action.action === 'revokeInvite')
        setNewInvite((invite) =>
          invite?.hash === action.hash ? null : invite,
        );
      if (action.action === 'create') setName('');
      await load(result.space?.id);
      if (action.spaceId === selectedRef.current)
        await reloadDetails(String(action.spaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не выполнено');
    } finally {
      setManaging(false);
    }
  };
  const busy = managing || queueBusy;
  const controls = current ? (
    <div className="space-controls">
      <label
        className="space-picker"
        title={
          queueBusy ? 'Дождитесь сохранения изменений' : 'Текущее пространство'
        }
      >
        <span className="space-picker-label">Пространство</span>
        <select
          value={current.id}
          disabled={busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          {data?.spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
              {space.kind === 'private' ? ' · личное' : ' · общее'}
            </option>
          ))}
        </select>
      </label>
      <details className="space-manage">
        <summary>Управление</summary>
        <div className="space-manage-popover">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim())
                void run({ action: 'create', name: name.trim() });
            }}
          >
            <input
              aria-label="Название общего пространства"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Новое общее пространство"
              maxLength={80}
            />
            <button className="text-button" disabled={busy || !name.trim()}>
              Создать
            </button>
          </form>
          {current.kind === 'shared' && (
            <>
              {current.role === 'owner' && (
                <>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run({ action: 'invite', spaceId: current.id })
                    }
                  >
                    Пригласить по ссылке
                  </button>
                  {newInvite?.spaceId === current.id && (
                    <InviteLink key={newInvite.hash} link={newInvite.link} />
                  )}
                  {details?.invites.map((invite, index) => (
                    <div className="space-invite" key={invite.hash}>
                      <span>
                        Приглашение {index + 1} · до{' '}
                        {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}
                      </span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run({
                            action: 'revokeInvite',
                            spaceId: current.id,
                            hash: invite.hash,
                          })
                        }
                      >
                        Отозвать
                      </button>
                    </div>
                  ))}
                </>
              )}
              {details?.members.map((member) => (
                <div className="space-member" key={member.id}>
                  <span>{member.name}</span>
                  <small>
                    {member.role === 'owner' ? 'владелец' : 'участник'}
                  </small>
                  {current.role === 'owner' && member.role !== 'owner' && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run({
                          action: 'removeMember',
                          spaceId: current.id,
                          userId: member.id,
                        })
                      }
                    >
                      Удалить
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </details>
    </div>
  ) : null;
  if (!data)
    return (
      <main className="space-loading">
        <p role={error ? 'alert' : 'status'}>
          {error || 'Загружаем пространства…'}
        </p>
        {error && <button onClick={() => void load()}>Повторить</button>}
        {needsLogin && <a href={passwordAuth ? '/login' : '/'}>Войти снова</a>}
      </main>
    );
  return (
    <>
      {error && (
        <div className="error-banner space-error" role="alert">
          {error}
          <button onClick={() => void load()}>Повторить</button>
        </div>
      )}
      <Workspace
        key={`${data.user.id}:${selected}`}
        ownerId={data.user.id}
        spaceId={selected || data.privateSpaceId}
        passwordAuth={passwordAuth}
        migrationDestination={migrationDestination}
        spaceControls={controls}
        onBusyChange={setQueueBusy}
        onAccessRevoked={accessRevoked}
      />
    </>
  );
}

function InviteLink({ link }: { link: string }) {
  const [message, setMessage] = useState('');
  return (
    <div className="space-invite">
      <label>
        Ссылка доступна только сейчас
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          aria-label="Ссылка-приглашение"
        />
      </label>
      <button
        className="text-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setMessage('Скопировано');
          } catch {
            setMessage('Выделите ссылку и скопируйте вручную.');
          }
        }}
      >
        Копировать
      </button>
      {message && <output>{message}</output>}
    </div>
  );
}
