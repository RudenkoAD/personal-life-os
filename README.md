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
- Every tab uses the workspace density: one compact topbar, full-width working content, short labels, and contextual help instead of introductory paragraphs. Projects are rows; review notes collapse; recurrence editing opens in a sheet; settings and agent history use adjacent panels on wide screens.
- Completed cards auto-archive by default. Settings → Completed tasks controls the persisted `settings.autoArchiveCompleted` preference; enabling it also archives existing completed cards, while disabling affects later completions. Legacy workspaces receive the enabled default on read. Archive keeps the original placement, schedule, notes, steps, and project relationships; reopen a card from Archive with its checked completion control. Archive has independent search/scope filtering and is excluded from working views. `complete` and `settings.update` share these semantics between the UI and MCP.
- Navigation opens in a drawer above the workspace. Panel visibility, search, filters and layout reset live in the topbar; the working canvas contains only Inbox, board and calendar. Ctrl/Cmd+K opens Inbox and focuses its capture input.
- Dockable Inbox, board and calendar panels in one workspace: drag a panel header to another panel edge, resize dividers, hide, maximize and reset. Menus provide keyboard alternatives; mobile stacks the panels. Layout preferences persist on this device only.
- Multiple boards and custom columns; task, sequence and project cards.
- Nested project boards, parent navigation and cycle prevention. Projects cannot be scheduled; converting a scheduled task into a project returns it to its board.
- Flexible sequence checklist steps.
- Editable life scopes (names/colors) and scope filtering across Inbox, boards, projects and calendar. Scope deletion removes references from tasks, events, sources and recurrence templates, preserving all tasks and events.
- Exclusive Inbox/board/calendar placement. Drag between columns, directly from Inbox or a board onto a quarter-hour calendar slot, and back to a board column or Inbox. Keyboard/touch alternatives in task details.
- Immediate local actions with an ordered background sync queue, owner-scoped server persistence and a bounded activity history. Cards and project IDs stay stable before and after acknowledgement, so newly created objects can be edited or moved immediately.
- Calendar day/week views in Europe/Moscow. Resizable task start/end edges with 15-minute snapping. Dragging preserves the point grabbed within the task, including fragments crossing midnight. ICS file import and read-only ICS/CalDAV subscriptions, source visibility and event provenance. Recurrence expansion with exceptions and cancellation handling.
- Local calendar events support daily, selected-weekday weekly, monthly by date or ordinal/last weekday, and yearly repeats, with intervals and optional inclusive end date or occurrence count. Birthdays can be all-day. Calendar times use Moscow UTC+03; missing dates (day 31, February 29) skip that occurrence. One-occurrence edits/deletions are exceptions; series edits preserve explicit exception fields. Events never create Inbox tasks. Create from the calendar toolbar or an empty time slot; manage series in Recurring → Events. Drag/resize changes one occurrence with 15-minute snapping through the existing optimistic queue. `event.create/update/override/restore/delete` are also available via MCP.
- Internal recurring tasks with a first appearance and an interval in minutes/hours/days/weeks. Each rule creates one Inbox task and pauses while any unfinished occurrence remains in Inbox. Completion or exit restarts the interval from that transition; subsequent completion outside Inbox does not restart it again. Templates can be edited or deleted without changing existing tasks.
- Review lists, editable notes and interval, completion history, next-review date and creation of Inbox tasks from a prompt.
- Mobile-friendly online capture page and home-screen web manifest.
- Scoped, revocable agent tokens; stateless MCP HTTP adapter over the same domain service.

## Explicit boundaries

- Hosted first version uses private Sites access and ChatGPT identity. Yandex ID and other OAuth providers are not implemented.
- App data is stored in D1; dock layout preferences use browser localStorage, and pending action drafts use account-scoped sessionStorage in the current tab. The server remains authoritative; acknowledged drafts are removed. The action outbox survives a reload in the same tab, but is not a general offline database or a durable backup after closing the tab. Each owner has an atomic, versioned workspace aggregate. This is intentionally sized for a personal workspace, with bounded counts and a 1.8 MB serialized limit; larger/multi-user deployments should migrate to normalized entity tables while preserving IDs.
- All API mutations use optimistic revision checks. Browser domain actions carry a stable mutation ID, timestamp and explicit toggle result. D1 stores a compact owner-scoped hash/revision receipt atomically with each accepted action and its credential-deletion effects. Retries reuse the same ID; the server returns current state for a known identical action and rejects changed payload reuse. Receipts are retained so delayed drafts cannot execute twice. The client rebases queued actions over fresh state on conflict, pauses on an invalid action, and allows explicit cancellation of rejected changes plus any drafts using objects they created.
- Signed ICS subscriptions accept tokens embedded in the complete HTTPS path or query, including DataSchool classes/assignments links. Paste the full private link under ICS subscriptions; no separate token field is needed for DataSchool. Settings allows replacing an expired link in place after a successful fetch, preserving source identity and event tags. Failed replacement keeps the prior URL and events. Redirects/login HTML and denied access report actionable errors without echoing secrets.
- Calendar source URLs are stored separately server-side and excluded from state/API/MCP responses. Subscriptions are HTTPS and limited to approved calendar hosts to prevent arbitrary server-side network access. ICS redirects are not followed. CalDAV allows at most two same-origin redirects; it discovers calendars with PROPFIND and reads events with REPORT. Other sources may be imported as ICS files.
- Recurring task deadlines are stored server-side and materialized on authenticated state loads, with a 15-second check while the page is visible and a check on focus. A closed app catches up on next access with one pending task per rule and no backlog. This deployment has no independent scheduled worker. Materialization uses the workspace CAS and stable generation IDs, so concurrent reads do not create duplicate tasks. At the workspace count/size limit, due tasks wait until space is freed.
- Subscription polling runs **while the app is open**, at most once per source per 15 minutes. This is not an independent background sync worker. Real private calendar feeds have not been connected or tested.
- ICS import keeps a 31-day past / 366-day future window, at most 2,000 occurrences, 1 MB source size and daily-or-slower RRULEs. It fails closed on unsupported/invalid data and preserves the previous snapshot. Imported events are read-only. Provider write-back, push notifications and deadlines are not implemented.
- Mobile is an online responsive web companion, not a native widget or offline app.
- MCP `/api/mcp` supports `initialize`, `ping`, `tools/list`, `tools/call`, and initialized notification, with JSON responses. Tools are `life_read` and `life_act`; actions are validated by the shared domain. No SSE stream is offered. An external MCP client also needs authorization through the private Sites gateway: the app token alone cannot bypass it. An external client connection has not been configured or verified.
- Tokens grant either read or read/write access and can be revoked. Expiry, fine-grained capability scopes and OAuth registration for agent clients are future work. Agent tokens cannot manage tokens, import feeds, or read feed URLs.
- UI/browser automation and device testing were not performed. Build, domain/calendar fixtures, HTTP persistence, concurrency and authorization were tested directly.

See [architecture](docs/architecture.md) for data and service boundaries.

## Dependency verification

Runtime dependencies were patched to React / RSC 19.2.8, Vinext 1.0.0-beta.9 and Vite 8.2.2; Undici is constrained to patched 7.29.1. Remaining package audit advisories in development tooling are not resolved by downgrading Drizzle or forcing incompatible dependencies. Keep development servers on loopback, and update that tooling through its own compatibility check before exposing it on a network.

## CalDAV setup

`CALDAV_ENCRYPTION_KEY` is a base64-encoded random 32-byte AES-GCM key. Configure it as a Sites runtime secret before publishing; local development reads an independent key from ignored `.env.local`. Keep the production key stable: replacing it makes existing encrypted connections unreadable. Usernames/passwords are encrypted with fresh IVs and authenticated owner/source context in `caldav_connections`, separate from public application state. Source deletion removes the connection in the same CAS-protected transaction.

Built-in servers: `caldav.yandex.ru`, `caldav.yandex.com`, `caldav-mob.yandex-team.ru`, `caldav.icloud.com`, `pNN-caldav.icloud.com`, and `caldav.fastmail.com`. For Nextcloud or another public server, configure its exact hostname in the operator-controlled comma-separated `CALDAV_ALLOWED_HOSTS` runtime variable, then deploy to apply it. Only HTTPS is accepted. Credentials are never forwarded to another origin; if a provider assigns a different server (for example an iCloud shard), enter that server's calendar URL directly. Use a provider app password or token and the complete CalDAV server or collection URL in Settings → Add calendar → CalDAV → Find calendars.

The “Рабочий Яндекс” shortcut fills `https://caldav-mob.yandex-team.ru`. The [corporate Calendar instructions](https://docs.yandex-team.ru/calendar/sync/sync-mobile) specify the full `login@yandex-team.ru` email as username and an OAuth token in the password field, transported using HTTP Basic authentication. Enter credentials only in the connection form. No corporate account has been connected as part of implementing this preset.

Discovery and REPORT responses are bounded to 1 MB per operation, 500 resources, 20 collections and 2,000 expanded events. Unsupported, partial and malformed responses preserve the previous snapshot. Calendar connections are account-only; agent tokens cannot discover, add or refresh them. Protocol fixtures are tested; a real provider account has not yet been connected.

API requests explicitly accept JSON. The client detects authentication redirects and HTML gateway errors. Domain actions are retried safely using their server receipts with bounded backoff; uncertain actions cannot be discarded until their outcome is reconciled. Calendar imports/refreshes remain separate network jobs, contain no optimistic credentials in browser storage, and are never automatically replayed. They do not lock task editing. The topbar distinguishes queued, saved and blocked work, with retry/cancel controls and a before-unload warning for outstanding work.
