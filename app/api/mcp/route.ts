import { loadState, saveState } from '@/db/store';
import { applyAction } from '@/lib/domain';
import { body, identity, json, errorResponse } from '@/lib/server';
const allowed = [
  'capture',
  'create',
  'update',
  'move',
  'inbox',
  'schedule',
  'complete',
  'step.add',
  'step.toggle',
  'step.delete',
  'board.create',
  'board.rename',
  'column.add',
  'column.rename',
  'tag.create',
  'review.create',
  'review.update',
  'review.prompt',
  'review.finish',
];
const tools = [
  {
    name: 'life_read',
    description:
      'Read this user’s tasks, Inbox, boards, tags, calendar sources/events, review lists and revision. Feed secrets are never returned.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'life_act',
    description:
      'Apply one task, project, calendar or review action through the shared domain service. Read first and pass its revision; stale revisions fail. Action type: ' +
      allowed.join(', ') +
      '. capture/create: title, optional cardType task/sequence/project, boardId, tags. update: id, title/notes/tags/cardType. move: id, boardId, columnId. schedule: id, ISO start/end. complete: id, done boolean. step.add: id,title; step.toggle/delete: id,stepId. Other operations use id/title/boardId/promptId/notes/intervalDays as appropriate.',
    inputSchema: {
      type: 'object',
      properties: {
        revision: { type: 'integer' },
        action: {
          type: 'object',
          properties: { type: { type: 'string', enum: allowed } },
          required: ['type'],
        },
      },
      required: ['revision', 'action'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
];
export async function POST(req: Request) {
  try {
    const r = await body(req),
      id = r.id ?? null;
    if (r.jsonrpc !== '2.0')
      return json(
        {
          jsonrpc: '2.0',
          id,
          error: { code: -32600, message: 'Invalid Request' },
        },
        400,
      );
    const write = r.method === 'tools/call' && r.params?.name === 'life_act';
    const u = await identity(req, write);
    if (r.method === 'notifications/initialized')
      return new Response(null, { status: 202 });
    if (r.method === 'initialize')
      return json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'personal-life-os', version: '1.0.0' },
        },
      });
    if (r.method === 'ping') return json({ jsonrpc: '2.0', id, result: {} });
    if (r.method === 'tools/list')
      return json({ jsonrpc: '2.0', id, result: { tools } });
    if (r.method === 'tools/call') {
      try {
        let state = await loadState(u.owner);
        if (r.params.name === 'life_act') {
          const a = r.params.arguments;
          if (!allowed.includes(a?.action?.type))
            throw new Error('Action not permitted');
          if (a.revision !== state.revision)
            throw new Error('Revision conflict. Read again before retrying.');
          const next = applyAction(
            state,
            a.action,
            u.agent ? u.name : 'Агент (веб-сессия)',
          );
          await saveState(u.owner, state.revision, next);
          state = next;
        } else if (r.params.name !== 'life_read')
          throw new Error('Unknown tool');
        return json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(state) }] },
        });
      } catch (e) {
        return json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: (e as Error).message }],
          },
        });
      }
    }
    return json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
