import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { passwordHash } from '../lib/password-session.ts';

test(
  'nested reviews persist through MCP, queued actions and a server restart',
  {
    skip: process.env.LIFE_OS_TEST_NODE_HTTP !== '1',
    timeout: 60000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'life-os-review-http-'));
    const base = 'http://127.0.0.1:3198';
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3198',
      DATABASE_PATH: join(root, 'app.sqlite'),
      MIGRATIONS_DIR: resolve('drizzle'),
      PUBLIC_BASE_URL: base,
      AUTH_OWNER_ID: 'review-http-fixture',
      AUTH_SESSION_SECRET: Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString('base64'),
      AUTH_PASSWORD_HASH: await passwordHash('isolated review fixture'),
    };
    let server;
    const start = async () => {
      server = spawn(process.execPath, ['dist/standalone/server.js'], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      server.stderr.on('data', (c) => {
        stderr += c;
      });
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(stderr);
        try {
          if ((await fetch(base + '/login')).status === 200) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Fixture server did not start: ' + stderr);
    };
    const stop = async () => {
      if (server?.exitCode === null) {
        server.kill();
        await new Promise((r) => server.once('exit', r));
      }
    };
    try {
      await start();
      const login = await fetch(base + '/api/session/login', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Origin: base,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ password: 'isolated review fixture' }),
      });
      assert.equal(login.status, 303);
      const auth = {
        Cookie: login.headers.get('set-cookie').split(';')[0],
        Origin: base,
        'Content-Type': 'application/json',
      };
      const read = async () =>
        (await fetch(base + '/api/state', { headers: auth })).json();
      let state = await read();
      const rpc = async (method, params) =>
        (
          await fetch(base + '/api/mcp', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          })
        ).json();
      const schema = await rpc('tools/list');
      const names = schema.result.tools.find((t) => t.name === 'life_act')
        .inputSchema.properties.action.properties.type.enum;
      assert.ok(names.includes('review.prompt.move'));
      assert.ok(names.includes('review.prompt.delete'));
      const act = async (action, revision = state.revision) => {
        const response = await rpc('tools/call', {
          name: 'life_act',
          arguments: { revision, action },
        });
        assert.equal(
          response.result.isError,
          undefined,
          response.result.content[0].text,
        );
        state = JSON.parse(response.result.content[0].text);
      };
      await act({
        type: 'review.create',
        title: 'Nested HTTP fixture',
        prompts: [
          {
            title: 'Personal',
            children: [
              {
                title: 'Health',
                children: [{ title: 'Doctor' }, { title: 'Dentist' }],
              },
            ],
          },
          { title: 'Work' },
        ],
      });
      const reviewId = state.reviews.at(-1).id;
      const review = () => state.reviews.find((r) => r.id === reviewId);
      const prompt = (title) => review().prompts.find((p) => p.title === title);
      assert.equal(prompt('Doctor').parentId, prompt('Health').id);
      const personalId = prompt('Personal').id,
        healthId = prompt('Health').id,
        dentistId = prompt('Dentist').id;
      await act({
        type: 'review.prompt',
        id: reviewId,
        promptId: healthId,
        done: true,
      });
      assert.equal(prompt('Doctor').done, true);
      assert.equal(prompt('Dentist').done, true);
      const rev = state.revision;
      await act({
        type: 'review.prompt',
        id: reviewId,
        promptId: dentistId,
        title: 'Dental appointment',
      });
      assert.equal(prompt('Dental appointment').done, true);
      const conflict = await rpc('tools/call', {
        name: 'life_act',
        arguments: {
          revision: rev,
          action: {
            type: 'review.prompt.delete',
            id: reviewId,
            promptId: personalId,
          },
        },
      });
      assert.equal(conflict.result.isError, true);
      assert.deepEqual(await read(), state);
      await act({
        type: 'review.prompt.move',
        id: reviewId,
        promptId: dentistId,
        parentId: null,
      });
      assert.equal(prompt('Dental appointment').parentId ?? null, null);
      const mutation = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        action: {
          type: 'review.prompt',
          id: reviewId,
          title: 'Queued child',
          parentId: healthId,
        },
      };
      const queuedPayload = { revision: state.revision, mutation };
      const postQueued = () =>
        fetch(base + '/api/actions', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify(queuedPayload),
        });
      const queued = await postQueued();
      assert.equal(queued.status, 200);
      state = await queued.json();
      assert.equal(prompt('Queued child').parentId, healthId);
      assert.equal(prompt('Health').done, false);
      assert.equal(prompt('Queued child').id, `m_${mutation.id}_0`);
      const replay = await postQueued();
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), state);
      await act({
        type: 'review.prompt.delete',
        id: reviewId,
        promptId: personalId,
      });
      assert.deepEqual(
        review()
          .prompts.map((p) => p.title)
          .sort(),
        ['Dental appointment', 'Work'],
      );
      const beforeRestart = structuredClone(state);
      await stop();
      await start();
      assert.deepEqual(await read(), beforeRestart);
    } finally {
      await stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
