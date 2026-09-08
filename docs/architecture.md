# Model and service boundaries

The React workspace in `components/workspace.tsx` calls API routes in `app/api`. `lib/domain.ts` owns all card, board, review and tag transitions, while `lib/ical.ts` owns bounded read-only iCalendar parsing. `db/store.ts` owns persistence. Both web and MCP call the same domain transition function.

`workspaces.owner_id` is the authenticated account identity. The state aggregate stores cards, boards, scopes, review lists/runs, source metadata, materialized calendar events and a bounded activity history. The owner is never accepted from client parameters. `feeds` stores owner-scoped private URLs; `agent_tokens` stores SHA-256 token hashes, owner and scope. Neither credential value is returned by state reads.

A card has a stable identity and a `placement` discriminator: `inbox`, `board`, or `calendar`. `boardId` and `columnId` always identify its board return destination; when a card is scheduled, they are metadata rather than a visible board placement. Calendar transfers update placement/start/end in a single aggregate CAS write. Return removes start/end and preserves identity, project board and checklist state. Column names are arbitrary and do not determine completion; completion is explicit.

Projects link to a child board, whose `parentCardId` points back to the project. Moves walk ancestors and reject cycles. Deleting a nonempty project is rejected. Sequences have ordered flexible checklist steps; steps do not block one another and do not acquire separate calendar placements in this release.

Mutation flow:

1. Verify browser identity or hashed bearer token and mutation scope.
2. Reject cross-origin browser requests.
3. Load only the authenticated owner's state and compare the submitted revision.
4. Validate the domain operation on a clone.
5. Persist an atomic D1 batch with a conditional `UPDATE ... WHERE owner_id = ? AND revision = ?`; reject a lost race with 409. A unique commit marker guards any feed-secret insertion/deletion inside the same batch, so a lost CAS or statement failure cannot orphan a credential.
6. Return the committed state. The frontend adopts only successful responses; errors preserve drafts and expose retry information.

Calendar imports fetch and parse before replacing an existing snapshot. Source-scoped UID plus recurrence identity prevents cross-source conflation. Source tags apply to newly materialized occurrences; existing occurrence tags survive refresh. Failed fetches, unsupported recurrence and parse failures do not delete prior events.

The REST API uses `GET /api/state` and `POST /api/actions` with `{ revision, action }`. `/api/calendars` and `/api/tokens` are browser-account-only. The MCP route has no independent write path: it selects allowed operations and calls the same `applyAction` and CAS store. Production depends on the hosting dispatcher removing spoofed identity headers and enforcing private access. Local development's mock identity is deliberately confined to localhost by the starter plugin.
