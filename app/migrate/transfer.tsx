'use client';
import { useEffect, useState } from 'react';
import { restoreDock, serializeDock } from '@/lib/dock-layout';
export default function MigrationLayout() {
  const [error, setError] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const layout = params.get('layout');
      if (layout)
        localStorage.setItem(
          'life-os:dock-layout:v1',
          serializeDock(restoreDock(layout)),
        );
      history.replaceState(null, '', '/migrate');
      location.replace('/');
    } catch {
      setError(true);
    }
  }, []);
  return error ? (
    <p>
      Не удалось перенести расположение панелей.{' '}
      <a href="/">Открыть приложение</a>
    </p>
  ) : null;
}
