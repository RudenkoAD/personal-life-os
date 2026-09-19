import { forwardMigration } from '@/lib/migration-proxy';
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
  'settings.update',
  'reminders.defaults',
  'reminders.set',
  'event.tasks.set',
  'step.add',
  'step.toggle',
  'step.delete',
  'board.create',
  'board.rename',
  'column.add',
  'column.rename',
  'column.move',
  'column.color',
  'tag.create',
  'tag.update',
  'tag.delete',
  'event.create',
  'event.update',
  'event.override',
  'event.restore',
  'event.delete',
  'recurrence.create',
  'recurrence.update',
  'recurrence.delete',
  'review.create',
  'review.update',
  'review.prompt',
  'review.prompt.move',
  'review.prompt.delete',
  'review.finish',
];
const tools = [
  {
    name: 'life_read',
    description:
      'Read this user’s settings, tasks (including archived cards), Inbox, boards, scopes, recurring task rules, calendar sources/events, fixed calendarSeries with exceptions, review lists and revision. Due recurring rules produce one Inbox task on read. Feed secrets are never returned.',
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
      ' column.move: boardId,id,beforeId (another column ID in the same board, or null for the end); preserves cards and column identities. column.color: boardId,id,color (#RRGGBB or null to reset). ' +
      ' Review lists: prompts are flat nodes {id,title,done,parentId?}; parentId links nodes in the same list. Branch checkboxes affect all descendants, partial completion is derived, and progress counts leaves. review.create accepts title and optional nested prompts [{title,children?:[...]}] for atomic bulk creation. review.prompt adds title with optional parentId, or edits title/parentId when promptId is supplied; editing does not toggle. With promptId and done it sets the whole subtree; omit all edit fields and done to toggle. review.prompt.move requires id,promptId,parentId (null for root), optional beforeId (sibling ID or null for end); moves the whole subtree, rejects cycles. review.prompt.delete requires id,promptId and deletes its subtree. review.update accepts nestBySeparator:" → " to explicitly convert path-encoded flat prompts into a hierarchy, preserving existing leaf IDs and completion; it never runs automatically. review.finish requires all leaves done and resets every node. ' +
      ' Reminder actions: reminders.set target {kind:series|occurrence|external|card,id,occurrenceDate?}, minutes null to inherit, [] to turn off, or up to 8 custom minute values from 0 to 525600; reminders.defaults accepts optional scopeId and minutes, with null removing a per-sphere override. event.tasks.set accepts the same target and up to 8 rules {id,title,notes,minutesBefore}. ' +
      '. capture/create: title, optional cardType task/sequence/project, boardId, tags. update: id, title/notes/tags/cardType. move: id, boardId, columnId. schedule: id, ISO start/end. complete: id, done boolean; true auto-archives when settings.autoArchiveCompleted is enabled (default true); false reopens and unarchives, preserving placement and schedule. Working views omit archived cards. settings.update: autoArchiveCompleted boolean; enabling archives existing completed cards, disabling affects future completions only. step.add: id,title; step.toggle/delete: id,stepId. tag.create/update: title,color (#RRGGBB); update/delete require id. Deleting a scope unlinks its tags but keeps tasks. recurrence.create: title,intervalMinutes (1..525600),firstAt (ISO instant), optional notes,tags (scope IDs); recurrence.update: id and changed fields only; firstAt explicitly resets the next appearance if not paused. Recurrences pause while any generated task is unfinished in Inbox, then restart from its completion or exit time. recurrence.delete: id; keeps existing tasks. event.create: title,startDate (YYYY-MM-DD), optional startTime (HH:mm, default09:00), durationMinutes (1..10080 whole minutes for timed events; all-day events must be whole days from 1 to 7 days), allDay (whole days), notes,location,tags,repeat {frequency:none/daily/weekly/monthly/yearly,interval:1..366,weekdays:0=Sunday..6=Saturday,monthlyMode:date/weekday,until:inclusive date OR count:1..10000}. Times use Moscow UTC+03. Missing month/leap dates are skipped. These events never create Inbox tasks. Birthday creation: pass birthday {name} (1..180 characters) instead of ordinary event fields; it uses canonical title День рождения ${name}, all-day 00:00 for 1440 minutes, yearly interval 1 and no ending. event.update: id and changed series fields; omit birthday to preserve birthday metadata, pass birthday {name} to edit it, or birthday:null to convert to an ordinary event. Birthday series are edited as a whole and only notes/location may be overridden per occurrence. event.override: id,occurrenceDate (original date), patch of changed event fields OR cancelled:true, affects one occurrence only. event.restore: id,occurrenceDate removes the exception. event.delete: id removes entire series. Other operations use id/title/boardId/promptId/notes/intervalDays as appropriate.',
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
      destructiveHint: true,
      idempotentHint: false,
    },
  },
];
export async function POST(req: Request) {
  try {
    const forwarded = await forwardMigration(req);
    if (forwarded) return forwarded;
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
