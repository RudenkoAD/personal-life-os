'use client';
import { useEffect, useRef, useState } from 'react';
/** Adopt external changes only while the field still matches its last saved value. */
export function useSyncedDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const old = previous.current;
    if (JSON.stringify(old) !== JSON.stringify(value)) {
      previous.current = value;
      setDraft((current) =>
        JSON.stringify(current) === JSON.stringify(old) ? value : current,
      );
    }
  }, [value]);
  return [draft, setDraft] as const;
}
