export type TextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'url'; value: string };

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/;

function trimUrl(value: string) {
  let url = value.replace(TRAILING_PUNCTUATION, '');
  for (const [closing, opening] of [
    [')', '('],
    [']', '['],
    ['}', '{'],
  ] as const) {
    while (
      url.endsWith(closing) &&
      (url.match(new RegExp(`\\${closing}`, 'g'))?.length ?? 0) >
        (url.match(new RegExp(`\\${opening}`, 'g'))?.length ?? 0)
    )
      url = url.slice(0, -1);
  }
  return url;
}

export function isSafeHttpUrl(value: string) {
  const href = hrefForUrl(value);
  try {
    const url = new URL(href);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function hrefForUrl(value: string) {
  return /^www\./i.test(value) ? `https://${value}` : value;
}

/** Split plain text into safe, absolute HTTP(S) URL and text segments. */
export function linkifyText(value: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    if (!url || !isSafeHttpUrl(url)) continue;
    if (start > cursor) segments.push({ kind: 'text', value: value.slice(cursor, start) });
    segments.push({ kind: 'url', value: url });
    cursor = start + url.length;
  }
  if (cursor < value.length) segments.push({ kind: 'text', value: value.slice(cursor) });
  return segments;
}

export function httpUrls(value: string): string[] {
  return linkifyText(value)
    .filter((segment): segment is Extract<TextSegment, { kind: 'url' }> => segment.kind === 'url')
    .map((segment) => segment.value);
}
