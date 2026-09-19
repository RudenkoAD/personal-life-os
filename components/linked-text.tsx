import { Fragment } from 'react';
import { hrefForUrl, httpUrls, linkifyText } from '@/lib/linkify';

export function LinkedText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <span className={className}>
      {linkifyText(value).map((segment, index) =>
        segment.kind === 'url' ? (
          <a
            key={`${segment.value}-${index}`}
            href={hrefForUrl(segment.value)}
            target="_blank"
            rel="noreferrer"
          >
            {segment.value}
          </a>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </span>
  );
}

export function EventLinks({ value }: { value: string }) {
  const urls = [...new Set(httpUrls(value))];
  if (!urls.length) return null;
  return (
    <div className="event-note-links" aria-label="Ссылки в заметках">
      {urls.map((url) => (
        <a key={url} href={hrefForUrl(url)} target="_blank" rel="noreferrer">
          {url}
        </a>
      ))}
    </div>
  );
}
