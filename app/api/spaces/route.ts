import { forwardMigration } from '@/lib/migration-proxy';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { rawDb } from '@/db/store';
import { body, errorResponse, json } from '@/lib/server';
import { runtime, usesPasswordAuth } from '@/lib/runtime-config';
import { publicOrigin } from '@/lib/password-session';
import {
  authorizeSpace,
  createInvite,
  createSharedSpace,
  acceptInvite,
  getAccount,
  listSpaces,
  removeMember,
} from '@/lib/spaces';

function field(value: unknown) {
  if (typeof value !== 'string')
    throw Object.assign(new Error('Некорректные данные'), { status: 400 });
  return value;
}

async function account(request: Request) {
  const expected = usesPasswordAuth()
    ? publicOrigin(runtime.PUBLIC_BASE_URL)
    : new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== expected) ||
    (request.method !== 'GET' && origin !== expected)
  )
    throw Object.assign(new Error('Недопустимый источник запроса'), {
      status: 403,
    });
  const user = await getChatGPTUser();
  if (!user)
    throw Object.assign(
      new Error('Войдите, чтобы открыть личное пространство'),
      { status: 401 },
    );
  const expectedAccount = request.headers.get('x-life-account');
  if (expectedAccount !== null && expectedAccount !== user.userId)
    throw Object.assign(new Error('Аккаунт изменился. Войдите снова.'), {
      status: 401,
    });
  return user;
}
export async function GET(request: Request) {
  try {
    const forwarded = await forwardMigration(request, true);
    if (forwarded) return forwarded;
    const user = await account(request);
    const url = new URL(request.url),
      selected = url.searchParams.get('space');
    if (!selected) {
      const spaces = await listSpaces(user.userId);
      const profile = await getAccount(user.userId);
      return json({
        user: profile,
        spaces,
        privateSpaceId:
          spaces.find((s) => s.kind === 'private')?.id ?? user.userId,
      });
    }
    const space = await authorizeSpace(user.userId, selected);
    if (!space)
      throw Object.assign(new Error('Пространство не найдено'), {
        status: 404,
      });
    const members = (
      await rawDb()
        .prepare(
          'SELECT u.id, u.name, m.role FROM space_members m JOIN users u ON u.id = m.user_id WHERE m.space_id = ? ORDER BY m.role, u.name',
        )
        .bind(selected)
        .all<{ id: string; name: string; role: string }>()
    ).results;
    const invites =
      space.role === 'owner'
        ? (
            await rawDb()
              .prepare(
                'SELECT hash, expires_at as expiresAt FROM space_invites WHERE space_id = ? AND consumed = 0 AND expires_at > ?',
              )
              .bind(selected, new Date().toISOString())
              .all()
          ).results
        : [];
    return json({ members, invites });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const forwarded = await forwardMigration(request, true);
    if (forwarded) return forwarded;
    const user = await account(request);
    const input = (await body(request, 20000)) as Record<string, unknown>;
    switch (input.action) {
      case 'create':
        return json(
          { space: await createSharedSpace(user.userId, field(input.name)) },
          201,
        );
      case 'invite':
        return json(await createInvite(user.userId, field(input.spaceId)));
      case 'accept':
        return json(await acceptInvite(user.userId, field(input.token)));
      case 'removeMember':
        await removeMember(
          user.userId,
          field(input.spaceId),
          field(input.userId),
        );
        return json({ ok: true });
      case 'revokeInvite': {
        const space = await authorizeSpace(user.userId, field(input.spaceId));
        if (!space || space.role !== 'owner' || space.kind !== 'shared')
          throw Object.assign(new Error('Недостаточно прав'), { status: 403 });
        await rawDb()
          .prepare(
            'DELETE FROM space_invites WHERE space_id = ? AND hash = ? AND consumed = 0',
          )
          .bind(space.id, field(input.hash))
          .run();
        return json({ ok: true });
      }
      default:
        throw Object.assign(new Error('Неизвестное действие'), { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
