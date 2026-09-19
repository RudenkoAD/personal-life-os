# Deployment — 2026-09-12

Primary app: https://personal-life-os.51-250-78-132.sslip.io

| Resource | Value |
| --- | --- |
| YC CLI profile | `personal-life-os` (original active profile remains `default`) |
| Personal cloud | `cloud-mrdragonlol` / `b1gi9205vmog1cefa80n` |
| Project folder | `personal-life-os` / `b1gos07rgvoleucf00ge` |
| VM | `fhmbbfb3pkfbusmaecm1`, Ubuntu 24.04, standard-v3, 2 vCPU at 20%, 2 GB RAM |
| Network | Existing default network `enptqaqqlm7iujca5d5s`; new dedicated subnet `e9boii2jti99f45k6odn` and security group `enp1occdf4oj2lboqmcq` in app folder |
| Static IP | `51.250.78.132` / `e9bk80rcs38rra4btqpo` |
| Persistent data disk | `fhm799naia91a1gonnis`, 10 GB network SSD, auto-delete disabled |
| Host app directory | `/opt/personal-life-os/app` |
| Data and secrets | `/srv/personal-life-os`; secrets directory root-only, SQLite owned by UID 1000 |
| Containers | `personal-life-os-app-1`, `personal-life-os-https-1` |
| Daily local backup | `life-os-backup.timer`, 02:00 UTC with up to 5 minutes delay |
| Daily disk snapshots | `fd80c5evoru8te3qj5i6`, 02:30 UTC, retain 7 |
| Cutover disk snapshot | `fd86f0v331jvpen2amvp`, verified READY |
| Original Sites version | 17, source `d8e594ff4aa1ed8131fcd9cd2b4b182559f819bd` |
| Source compatibility deployment | `appgdep_6aa548cae4408191bae5e066725f3a77`, environment revision 4 |

At cutover, all five source tables matched destination rows exactly: workspace revision 444, 4 private ICS feeds, 1 encrypted CalDAV connection, 1 agent token and 86 mutation receipts. Workspace data included 17 cards, 2 boards, 1 archived card, 1 calendar series, and 1,026 events. These are cutover counts, not ongoing invariants.

Verified: HTTPS with a trusted certificate; password login and anonymous 401; authenticated state and static assets; MCP tools with the original app token; old-address GET and POST forwarding; disabled export endpoint (404); SQLite integrity and rollback under the real container UID; restoring an online backup and decrypting its CalDAV connection offline. No manual fetch of private calendar feeds was performed.

Source D1 remains frozen as a recovery snapshot. The old Site is a compatibility proxy to the new database and still authenticates its old tabs through ChatGPT. Retire this bridge only after their pending changes have synced. Rotate the destination session secret when retiring the bridge. Do not deploy an old source version or remove `MIGRATION_DESTINATION` to revive independent D1 writes.

Browser panel layout is local to each browser origin. Refresh the old tab and use **Открыть в Yandex Cloud** after its queue drains to transfer that layout. The technical `sslip.io` hostname can later be replaced by an owned domain; update Caddy, PUBLIC_BASE_URL, source migration destination and the Codex MCP URL together.

Private local handoff files (not committed) live in `work/cloud-migration/`: `login.txt`, SSH key and pinned known_hosts, encrypted exports and their recipient private key. Codex credentials remain under its existing protected `mcp-secrets` path. Never add those files or runtime.env to an image or repository.

SSH access updated on 2026-09-13: TCP/22 is allowed from `0.0.0.0/0` at the user's request; key authentication remains required. The previous two administration `/32` rules excluded the current connection source. Successful SSH after the rule change confirmed the cause of the timeout.
