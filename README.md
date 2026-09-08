# Personal Life OS

A private, server-backed personal workspace built from the supplied design draft. Russian interface. The web client, REST API and MCP endpoint share the same domain operations.

## Run locally

Requires Node 22.13+ for the app (Node 24+ recommended for the native TypeScript test runner) and npm.

```sh
npm ci
npm run dev
```

The Sites development plugin provides a **local-only mock account** through `/signin-with-chatgpt`. Hosted identity comes from Sites' authenticated dispatcher; never expose the raw Worker behind that dispatcher or trust these headers from arbitrary Internet callers.

Generate schema changes with `npm run db:generate`. Production migrations are packaged in `drizzle/` and applied by Sites. For local D1 setup, use a temporary Wrangler config with the D1 binding from `vite.config.ts`, then run `wrangler d1 execute DB --local --config <local-config> --persist-to .wrangler/state --file drizzle/0000_right_longshot.sql`.

```sh
npm run check
npm test
LIFE_OS_TEST_URL=http://localhost:3000 npm test # local API contract tests
npm run build
```

API tests only accept localhost and clean up their own cards, sources and tokens. They use the generated local development account; they must never target a production workspace.

## Included

- Instant capture into Inbox, with keyboard focus via Ctrl/Cmd+K.
- Navigation opens in a drawer above the workspace. Panel visibility, search, filters and layout reset live in the topbar; the working canvas contains only Inbox, board and calendar. Ctrl/Cmd+K opens Inbox and focuses its capture input.
- Dockable Inbox, board and calendar panels in one workspace: drag a panel header to another panel edge, resize dividers, hide, maximize and reset. Menus provide keyboard alternatives; mobile stacks the panels. Layout preferences persist on this device only.
- Multiple boards and custom columns; task, sequence and project cards.
- Nested project boards, parent navigation and cycle prevention. Projects cannot be scheduled; converting a scheduled task into a project returns it to its board.
- Flexible sequence checklist steps.
- Scope/tag filtering across Inbox, boards, projects and calendar.
- Exclusive Inbox/board/calendar placement. Drag between columns, directly from Inbox or a board onto a calendar hour, and back to a board column or Inbox. Keyboard/touch alternatives in task details.
- Server persistence per authenticated owner, optimistic revision checking and a bounded activity history.
- Calendar day/week views in Europe/Moscow. ICS file import and read-only subscriptions, source visibility and event provenance. Recurrence expansion with exceptions and cancellation handling.
- Review lists, editable notes and interval, completion history, next-review date and creation of Inbox tasks from a prompt.
- Mobile-friendly online capture page and home-screen web manifest.
- Scoped, revocable agent tokens; stateless MCP HTTP adapter over the same domain service.

## Explicit boundaries

- Hosted first version uses private Sites access and ChatGPT identity. Yandex ID and other OAuth providers are not implemented.
- App data is stored in D1; only dock layout preferences use browser localStorage. Each owner has an atomic, versioned workspace aggregate. This is intentionally sized for a personal workspace, with bounded counts and a 1.8 MB serialized limit; larger/multi-user deployments should migrate to normalized entity tables while preserving IDs.
- All API mutations use optimistic revision checks. A lost response is not automatically replayed. General idempotency keys and change merging are future work.
- Calendar source URLs are stored separately server-side and excluded from state/API/MCP responses. Subscriptions are HTTPS and limited to approved calendar hosts to prevent arbitrary server-side network access. Redirects are not followed. Other sources may be imported as ICS files.
- Subscription polling runs **while the app is open**, at most once per source per 15 minutes. This is not an independent background sync worker. Real private calendar feeds have not been connected or tested.
- ICS import keeps a 31-day past / 366-day future window, at most 2,000 occurrences, 1 MB source size and daily-or-slower RRULEs. It fails closed on unsupported/invalid data and preserves the previous snapshot. Imported events are read-only. Provider write-back, CalDAV, native internal recurring tasks, push notifications and deadlines are not implemented.
- Mobile is an online responsive web companion, not a native widget or offline app.
- MCP `/api/mcp` supports `initialize`, `ping`, `tools/list`, `tools/call`, and initialized notification, with JSON responses. Tools are `life_read` and `life_act`; actions are validated by the shared domain. No SSE stream is offered. An external MCP client also needs authorization through the private Sites gateway: the app token alone cannot bypass it. An external client connection has not been configured or verified.
- Tokens grant either read or read/write access and can be revoked. Expiry, fine-grained capability scopes and OAuth registration for agent clients are future work. Agent tokens cannot manage tokens, import feeds, or read feed URLs.
- UI/browser automation and device testing were not performed. Build, domain/calendar fixtures, HTTP persistence, concurrency and authorization were tested directly.

See [architecture](docs/architecture.md) for data and service boundaries.

## Dependency verification

Runtime dependencies were patched to React / RSC 19.2.8, Vinext 1.0.0-beta.9 and Vite 8.2.2; Undici is constrained to patched 7.29.1. Remaining package audit advisories in development tooling are not resolved by downgrading Drizzle or forcing incompatible dependencies. Keep development servers on loopback, and update that tooling through its own compatibility check before exposing it on a network.
