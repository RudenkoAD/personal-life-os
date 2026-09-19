'use client';
// oxlint-disable react/react-compiler -- Mount effects synchronize external authentication and browser storage.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest, ApiError } from '@/lib/api-client';

const pendingInviteKey = 'life-os-pending-invite';
export default function JoinClient() {
  const [token, setToken] = useState('');
  const [auth, setAuth] = useState<'loading' | 'guest' | 'user' | 'error'>(
    'loading',
  );
  const [accountId, setAccountId] = useState('');
  const [form, setForm] = useState({ login: '', name: '', password: '' });
  const [status, setStatus] = useState('Проверяем вход…');
  const [busy, setBusy] = useState(false);
  const checkAccount = useCallback(async () => {
    let value = location.hash.slice(1).trim();
    try {
      if (!value) {
        const stored = JSON.parse(
          sessionStorage.getItem(pendingInviteKey) ?? 'null',
        );
        if (typeof stored?.token === 'string' && stored.until > Date.now())
          value = stored.token;
      }
    } catch {
      /* A fragment link still works without browser storage. */
    }
    setToken(value);
    if (!value || value.length > 200) {
      setAuth('error');
      setStatus('В ссылке нет действительного приглашения.');
      return;
    }
    try {
      const result = await apiRequest<{ user: { id: string; name: string } }>(
        '/api/spaces',
      );
      setAccountId(result.user.id);
      setAuth('user');
      setStatus(`Вы вошли как ${result.user.name}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth('guest');
        setStatus('Создайте аккаунт или войдите, чтобы присоединиться.');
      } else {
        setAuth('error');
        setStatus('Не удалось проверить вход. Повторите попытку.');
      }
    }
  }, []);
  useEffect(() => {
    void checkAccount();
  }, [checkAccount]);
  function done() {
    try {
      sessionStorage.removeItem(pendingInviteKey);
    } catch {
      /* Optional transient storage. */
    }
    location.replace('/');
  }
  async function accept() {
    setBusy(true);
    setStatus('Присоединяем…');
    try {
      await apiRequest('/api/spaces', { action: 'accept', token }, 60000, {
        'X-Life-Account': accountId,
      });
      done();
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : 'Приглашение недействительно.',
      );
      setBusy(false);
    }
  }
  async function register() {
    setBusy(true);
    setStatus('Создаём аккаунт…');
    try {
      await apiRequest('/api/session/register', { token, ...form });
      done();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Не удалось создать аккаунт.');
      setBusy(false);
    }
  }
  function login() {
    try {
      // Keep the invitation out of login query strings and server access logs.
      sessionStorage.setItem(
        pendingInviteKey,
        JSON.stringify({ token, until: Date.now() + 3600000 }),
      );
      location.assign('/login?return_to=%2Fjoin');
    } catch {
      setStatus('Войдите в другой вкладке, затем обновите эту страницу.');
    }
  }
  return (
    <main className="join-page">
      <section className="settings-card join-card">
        <h1>Присоединиться к пространству</h1>
        <p className="muted">
          Приглашение одноразовое. Личное пространство останется доступно только
          вам.
        </p>
        {token && auth === 'user' && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void accept()}
          >
            Принять приглашение
          </button>
        )}
        {token && auth === 'guest' && (
          <>
            <button className="text-button" onClick={login} disabled={busy}>
              Уже есть аккаунт — войти
            </button>
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void register();
              }}
            >
              <label>
                Логин
                <input
                  required
                  maxLength={180}
                  value={form.login}
                  onChange={(e) => setForm({ ...form, login: e.target.value })}
                  autoComplete="username"
                />
              </label>
              <label>
                Имя
                <input
                  required
                  maxLength={180}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoComplete="name"
                />
              </label>
              <label>
                Пароль
                <input
                  required
                  minLength={12}
                  maxLength={1024}
                  type="password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  autoComplete="new-password"
                />
              </label>
              <small>От 12 символов</small>
              <button className="primary" disabled={busy}>
                Создать аккаунт и присоединиться
              </button>
            </form>
          </>
        )}
        <output className="join-status">{status}</output>
        {auth === 'error' && (
          <button onClick={() => void checkAccount()}>Повторить</button>
        )}
        <Link href="/">На главную</Link>
      </section>
    </main>
  );
}
