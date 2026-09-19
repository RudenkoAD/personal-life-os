# Model and service boundaries

The React workspace in `components/workspace.tsx` calls API routes in `app/api`. `lib/domain.ts` owns all card, board, review and tag transitions, while `lib/ical.ts` owns bounded read-only iCalendar parsing. `db/store.ts` owns persistence. Both web and MCP call the same domain transition function.

`workspaces.owner_id` is the storage identity of a space. Existing private-space IDs equal their account IDs; shared spaces use separate IDs. `users`, `spaces`, and `space_members` hold account and membership records. Every request resolves an authenticated user and verifies membership before loading a selected space. Bearer tokens bind both a space and their creator, so loss of membership revokes access. See [spaces](SPACES.md) for invitation and migration contracts. The state aggregate stores cards, boards, scopes, review lists/runs, source metadata, materialized calendar events and a bounded activity history. The client may select a space through `X-Life-Space`, but the server authorizes membership; `X-Life-Account` additionally binds browser drafts to the expected session user. `feeds` stores owner-scoped private ICS URLs; `caldav_connections` stores collection URLs and AES-GCM encrypted credentials bound to owner/source, using a stable Sites runtime secret; `agent_tokens` stores SHA-256 token hashes, owner and scope. Neither credential value is returned by state reads.

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

The REST API uses `GET /api/state` and `POST /api/actions` with `{ revision, action }`. `/api/calendars` and `/api/tokens` are browser-account-only. The MCP route has no independent write path: it selects allowed operations and calls the same `applyAction` and CAS store. Yandex production uses signed per-user sessions and ignores hosting identity headers. The Sites compatibility target depends on its dispatcher removing spoofed identity headers. Local development's mock identity is deliberately confined to localhost by the starter plugin.

## Optimistic action synchronization

The browser keeps a confirmed `LifeState` plus an ordered queue of deterministic mutations. Local validation and projection use the same domain reducer as the server; acknowledgements replace only the confirmed base, then remaining actions replay. Generated IDs derive from a validated mutation UUID and allocation slot, covering project boards, columns, steps, reviews and demo data. Desired boolean values replace ambiguous toggles. Review completion saves its notes and interval atomically.

`mutations` has a composite owner/ID primary key and stores only a canonical payload hash and committed revision. Its insert shares the workspace CAS transaction, including source credential deletion. Duplicate requests check receipts before revision; current state is returned rather than an old response snapshot. `/api/state?mutations=...` acknowledges only receipts at or below the returned state revision, allowing safe outbox recovery.

Only unsent action drafts live in account-scoped, tab-local sessionStorage. CalDAV credentials, ICS text and remote calendar jobs are never stored in the outbox. The 100-action bound, bounded retries, explicit rejected-action cancellation, and unload warning limit loss or repeated work without treating browser storage as the authoritative database.

## Internal recurring tasks

Recurring templates live in the workspace JSON as `recurrences`; older workspaces normalize the missing field to an empty array without resetting any data. Each template holds its interval, first/next instant, generation number and optional Inbox task reference. Tasks retain `recurrenceId`. Domain transitions pause while any unfinished generated occurrence is in Inbox; when the final blocker is completed or leaves Inbox, the next deadline is measured from that action's recorded instant. Returning an unfinished occurrence to Inbox pauses the rule again. Deleting a rule retains its generated tasks and removes their rule reference.

Authenticated `loadState` calls materialize at most one due task per rule and save through the normal revision CAS. The occurrence ID derives from rule ID and generation, and a racing reader retries against the committed snapshot. A visible client checks state every 15 seconds through the same sync queue and refreshes on focus. Local actions arriving during a read remain optimistic and are rebased before sending. No deployed scheduler is configured: a closed app catches up on next authenticated access with one waiting task, without a missed-occurrence backlog. Count/serialized-size limits defer materialization until capacity is available.
