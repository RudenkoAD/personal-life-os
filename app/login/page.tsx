import { redirect, notFound } from 'next/navigation';
import './login.css';
import { usesPasswordAuth } from '@/lib/runtime-config';
import { safeReturnPath } from '@/lib/password-session';
import { getChatGPTUser } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string; error?: string }>;
}) {
  if (!usesPasswordAuth()) notFound();
  const params = await searchParams;
  const target = safeReturnPath(params.return_to ?? null);
  if (await getChatGPTUser()) redirect(target);
  return (
    <main className="password-login">
      <form
        method="post"
        action="/api/session/login"
        className="settings-card form-stack"
      >
        <h1>Personal Life OS</h1>
        <input type="hidden" name="return_to" value={target} />
        <label>
          Логин
          <input
            name="login"
            autoComplete="username"
            maxLength={180}
            placeholder="owner"
            autoFocus
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </label>
        {params.error && (
          <p role="alert" className="form-error">
            {params.error === 'limit'
              ? 'Слишком много попыток. Попробуйте через 10 минут.'
              : 'Не удалось войти. Проверьте логин и пароль.'}
          </p>
        )}
        <button type="submit" className="primary">
          Войти
        </button>
      </form>
    </main>
  );
}
