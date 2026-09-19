import { forwardMigration } from '@/lib/migration-proxy';
import { rawDb } from '@/db/store';
import { textValue } from '@/lib/domain';
import { identity, body, json, errorResponse, hashToken } from '@/lib/server';
export async function GET(req: Request) {
  try {
    const forwarded = await forwardMigration(req, true);
    if (forwarded) return forwarded;
    const u = await identity(req, false, true);
    const r = await rawDb()
      .prepare(
        "SELECT hash, name, scope, created_at FROM agent_tokens WHERE owner_id = ? AND (user_id = ? OR ? = 'owner')",
      )
      .bind(u.owner, u.userId, u.role)
      .all();
    return json(r.results);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(req: Request) {
  try {
    const forwarded = await forwardMigration(req, true);
    if (forwarded) return forwarded;
    const u = await identity(req, true, true),
      a = await body(req);
    const name = textValue(a.name, 'Название', 80);
    const scope = a.scope === 'write' ? 'write' : 'read';
    const token =
      'life_' +
      crypto.randomUUID().replaceAll('-', '') +
      crypto.randomUUID().replaceAll('-', '');
    const inserted = await rawDb()
      .prepare(
        'INSERT INTO agent_tokens (hash, owner_id, user_id, name, scope, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?)',
      )
      .bind(
        await hashToken(token),
        u.owner,
        u.userId,
        name,
        scope,
        new Date().toISOString(),
        u.owner,
        u.userId,
      )
      .run();
    if (inserted.meta.changes !== 1)
      return json({ error: 'Нет доступа к пространству' }, 403);
    return json({ token });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(req: Request) {
  try {
    const forwarded = await forwardMigration(req, true);
    if (forwarded) return forwarded;
    const u = await identity(req, true, true),
      a = await body(req);
    const removed = await rawDb()
      .prepare(
        "DELETE FROM agent_tokens WHERE hash = ? AND owner_id = ? AND (user_id = ? OR ? = 'owner')",
      )
      .bind(textValue(a.hash, 'Токен', 100), u.owner, u.userId, u.role)
      .run();
    if (removed.meta.changes !== 1)
      return json({ error: 'Токен не найден или недоступен' }, 403);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
