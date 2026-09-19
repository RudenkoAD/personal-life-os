import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinkedText } from '../components/linked-text.tsx';

test('renders escaped literal HTML around safe links', () => {
  const value = '<b title="x">Open www.example.test/a?q=1&x=2</b>.';
  const markup = renderToStaticMarkup(
    React.createElement(LinkedText, { value }),
  );
  assert.match(markup, /&lt;b title=&quot;x&quot;&gt;Open /);
  assert.match(
    markup,
    /<a href="https:\/\/www\.example\.test\/a\?q=1&amp;x=2" target="_blank" rel="noreferrer">www\.example\.test\/a\?q=1&amp;x=2<\/a>/,
  );
  assert.match(markup, /&lt;\/b&gt;\./);
});
