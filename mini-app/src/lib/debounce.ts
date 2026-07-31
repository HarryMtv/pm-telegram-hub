import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce: returns `value` once it has held still for `delay` ms.
 * Lets a control stay bound to the live value while whatever it drives — a query
 * key, a request — only moves after the user stops typing. Callers that render
 * from the debounced value should treat `value !== useDebounce(value, d)` as
 * "what's on screen is one step behind".
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
