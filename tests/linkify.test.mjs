import test from 'node:test';
import assert from 'node:assert/strict';
import { hrefForUrl, httpUrls, linkifyText } from '../lib/linkify.ts';

test('keeps URL query, token and fragment while excluding sentence punctuation', () => {
  const value = 'Ссылка https://example.test/path?q=a%20b&token=x#part, затем.';
  assert.deepEqual(httpUrls(value), [
    'https://example.test/path?q=a%20b&token=x#part',
  ]);
  assert.deepEqual(linkifyText(value), [
    { kind: 'text', value: 'Ссылка ' },
    { kind: 'url', value: 'https://example.test/path?q=a%20b&token=x#part' },
    { kind: 'text', value: ', затем.' },
  ]);
});

test('preserves balanced URL parentheses and rejects non-http schemes', () => {
  assert.deepEqual(
    httpUrls('https://example.test/a_(b) and javascript:alert(1) data:text/html,x'),
    ['https://example.test/a_(b)'],
  );
});

test('supports www links, keeps their label, and rejects malformed or credential URLs', () => {
  const value =
    'www.example.test/a_(b)?token=x#part https:// user:pass@example.test https://';
  assert.deepEqual(httpUrls(value), ['www.example.test/a_(b)?token=x#part']);
  assert.equal(hrefForUrl('www.example.test/a'), 'https://www.example.test/a');
  assert.equal(hrefForUrl('https://example.test/a'), 'https://example.test/a');
});

test('retains all text around quoted URLs and skips credentials', () => {
  const value = '<a href="https://example.test/a?token=x#part">join</a> WWW.example.test https://user:pass@example.test';
  assert.deepEqual(httpUrls(value), ['https://example.test/a?token=x#part', 'WWW.example.test']);
  assert.equal(linkifyText(value).map((segment) => segment.value).join(''), value);
  assert.equal(hrefForUrl('WWW.example.test'), 'https://WWW.example.test');
});
