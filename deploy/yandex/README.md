# Yandex Cloud

One Ubuntu VM runs the Node standalone build and Caddy. SQLite, its WAL, calendar secrets, TLS state and backups live on a separate persistent disk. Do not run additional app replicas or delete the data disk when replacing a VM.

Build with `LIFE_OS_TARGET=yandex npm run build`; container deployment uses `docker compose -f deploy/yandex/compose.yaml up -d --build`. Node 24 is required for the SQLite adapter. Run `npm run check`, `LIFE_OS_TEST_SQLITE=1 node --test tests/store.test.mjs tests/migration.test.mjs` and, after a Node build, `LIFE_OS_TEST_NODE_HTTP=1 node --test tests/node-http.test.mjs`.

## Migration

1. Enable the source export with an unpredictable `MIGRATION_EXPORT_TOKEN`, a short `MIGRATION_EXPORT_EXPIRES_AT` and the existing `MIGRATION_OWNER_ID`. Deploy that environment. A regular app token alone cannot export credentials.
2. `scripts/export-migration.mjs` authenticates with existing headers and the operator secret, generates a local RSA recipient key, and writes only an encrypted snapshot. Keep the private key outside Git and build contexts.
3. `scripts/import-migration.mjs SNAPSHOT PRIVATE_KEY NEW_DATABASE DERIVED_ENV` imports all five tables into new files. It verifies owner/revision and decrypts CalDAV credentials offline. The generated environment contains **only imported values**. Add `PUBLIC_BASE_URL`, a new `AUTH_PASSWORD_HASH` (PBKDF2 SHA-256/600000), `AUTH_SESSION_SECRET` (32 random bytes, base64), and optionally `AUTH_OWNER_EMAIL` separately. Never substitute a local development CalDAV key.
4. Provision the named data disk with `bootstrap-data.sh`; runtime secrets belong in `/srv/personal-life-os/secrets/runtime.env`. Use `format: raw` for the Compose env file, since passwords/keys must not undergo interpolation. Set `SITE_HOST` in `https.env`. Import files must be owned by UID/GID 1000 and mode 600; the database directory must be mode 700.
5. Validate the destination with an isolated fixture first. Set source `MIGRATION_PAUSED=1`, deploy, and let in-flight source requests drain. Take the final snapshot only after this gate is active. Replace the destination fixture with the final imported database while its app container is stopped. Keep a pre-cutover backup.
6. Verify exact database rows, login/MCP, HTTPS and restore before switching. Set source `MIGRATION_DESTINATION` to the new HTTPS origin and `MIGRATION_SESSION_SECRET` to the destination session secret; clear the pause and export token/expiry. The old Site now forwards authenticated API calls to the one new database, so existing outboxes can retry with the same mutation receipts. Do not roll back to a stale D1 snapshot after destination writes begin.
7. The old UI's transition button waits for the outbox and transfers the browser's dock layout through a URL fragment. The new app uses password login. Update the Codex MCP endpoint and remove its obsolete Sites gateway header. Retire the old Site/proxy only after all old tabs are closed; then rotate the shared session secret on the destination (invalidating existing sessions).

## Recovery

The daily timer creates a SQLite online backup and checks its integrity, with the matching runtime secrets. Retain daily snapshots of the **entire data disk**, including secrets and backup files. Restrict snapshot access as carefully as production data.

To restore: stop the app, retain current database/WAL/SHM together, restore a verified backup and matching runtime.env, set database ownership to 1000:1000, and start the app. Never replace the database under a running process or reuse an old WAL with a restored file. Check authenticated state and calendar decryption before allowing writes.

The public app port is reachable only through Caddy. SSH (TCP/22) is allowed from all IPv4 addresses, as requested on 2026-09-13, and requires the deployment key. HTTPS authentication uses HttpOnly signed cookies and requires the configured Origin for cookie writes. Existing agent bearer tokens retain their original scopes.

## Android update files

The Caddy container serves public Android update files from `/srv/personal-life-os/android`, mounted read-only at `/srv/android`. The route `/android/latest.json` contains release metadata; versioned APKs live below `/android/releases/<versionCode>/`. An administrator must create the directory and grant the dedicated deployment user write access (`android/`, `android/releases/`, and the staging/lock paths); the Caddy container remains read-only. The Android repository's `scripts/publish-update.sh --publish` performs local APK validation and atomically promotes a prepared tree over SSH. Keep the deployment key outside both repositories; never put it, the signing keystore, or runtime secrets into the image.
