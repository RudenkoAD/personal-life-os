import { rawDb } from '@/db/store';
import { textValue } from '@/lib/domain';
import { identity, body, json, errorResponse, hashToken } from '@/lib/server';
export async function GET(req: Request) {
  try {
    const u = await identity(req, false, true);
    const r = await rawDb()
      .prepare(
        'SELECT hash, name, scope, created_at FROM agent_tokens WHERE owner_id = ?',
      )
      .bind(u.owner)
      .all();
    return json(r.results);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await identity(req, true, true),
      a = await body(req);
    const name = textValue(a.name, 'Название', 80);
    const scope = a.scope === 'write' ? 'write' : 'read';
    const token =
      'life_' +
      crypto.randomUUID().replaceAll('-', '') +
      crypto.randomUUID().replaceAll('-', '');
    await rawDb()
      .prepare(
        'INSERT INTO agent_tokens (hash, owner_id, name, scope, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        await hashToken(token),
        u.owner,
        name,
        scope,
        new Date().toISOString(),
      )
      .run();
    return json({ token });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(req: Request) {
  try {
    const u = await identity(req, true, true),
      a = await body(req);
    await rawDb()
      .prepare('DELETE FROM agent_tokens WHERE hash = ? AND owner_id = ?')
      .bind(textValue(a.hash, 'Токен', 100), u.owner)
      .run();
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
