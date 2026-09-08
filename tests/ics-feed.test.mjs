import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCalendar, validateFeedUrl } from '../lib/ical.ts';
import { DomainError } from '../lib/domain.ts';
const signedPath =
  'https://lk.dataschool.yandex.ru/users/fixture%3Asignature-_123/classes.ics';
const signedQuery =
  'https://lk.dataschool.yandex.ru/assignments.ics?token=fixture%2Btoken%2F%3D&part=one+two&part=three';
const calendar = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';

test('signed ICS paths and queries survive without token rewriting', () => {
  for (const url of [
    signedPath,
    signedQuery,
    signedPath.replace('classes.ics', 'assignments.ics'),
    'https://calendar.google.com/calendar/ical/fixture/private-token/basic.ics',
  ])
    assert.equal(validateFeedUrl(url), url);
  assert.equal(
    validateFeedUrl(signedPath.replace('https:', 'webcal:')),
    signedPath,
  );
  for (const url of [
    signedPath.replace('https:', 'http:'),
    signedPath.replace(
      'lk.dataschool.yandex.ru',
      'lk.dataschool.yandex.ru.evil.test',
    ),
    signedPath.replace('lk.dataschool.yandex.ru', '127.0.0.1'),
    signedPath.replace('https://', 'https://user:password@'),
  ])
    assert.throws(() => validateFeedUrl(url));
});

test('fetch sends the complete signed URL with no separate credentials or redirects', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(calendar, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
    });
  };
  try {
    for (const url of [signedPath, signedQuery])
      assert.equal(await fetchCalendar(url), calendar);
    assert.deepEqual(
      calls.map((call) => call.url),
      [signedPath, signedQuery],
    );
    for (const { options } of calls) {
      assert.equal(options.redirect, 'manual');
      assert.equal(new Headers(options.headers).get('Accept'), 'text/calendar');
      assert.equal(new Headers(options.headers).has('Authorization'), false);
      assert.equal(new Headers(options.headers).has('Cookie'), false);
      assert.ok(options.signal instanceof AbortSignal);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('auth denial, login HTML and redirects return safe actionable errors', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 404, 302]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response(signedPath, {
          status,
          headers: { Location: signedQuery },
        });
      };
      await assert.rejects(
        fetchCalendar(signedPath),
        (error) =>
          error instanceof DomainError &&
          error.status === 400 &&
          /ICS/.test(error.message) &&
          !error.message.includes(signedPath) &&
          !error.message.includes('fixture'),
      );
      assert.equal(calls, 1);
    }
    for (const contentType of [
      'text/html',
      'application/xhtml+xml',
      'text/plain',
    ]) {
      globalThis.fetch = async () =>
        new Response('<!DOCTYPE html><html>Login: ' + signedPath + '</html>', {
          headers: { 'Content-Type': contentType },
        });
      await assert.rejects(
        fetchCalendar(signedPath),
        (error) =>
          /Вместо ICS/.test(error.message) &&
          !error.message.includes('fixture'),
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('network and stream errors cannot expose URLs; size limit cancels the response', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch ' + signedPath);
    };
    await assert.rejects(
      fetchCalendar(signedPath),
      (error) =>
        error instanceof DomainError && !error.message.includes('fixture'),
    );
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(signedQuery));
          },
        }),
      );
    await assert.rejects(
      fetchCalendar(signedQuery),
      (error) =>
        error instanceof DomainError && !error.message.includes('fixture'),
    );
    let cancelled = false;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1000001));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    await assert.rejects(fetchCalendar(signedPath), /1 МБ/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});
