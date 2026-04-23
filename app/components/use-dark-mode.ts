'use client';

import { useEffect, useState } from 'react';

/** Detects if dark mode is active by watching the <html> class list. */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    setDark(el.classList.contains('dark'));

    const observer = new MutationObserver(() => {
      setDark(el.classList.contains('dark'));
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
