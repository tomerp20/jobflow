import { useState, useEffect } from 'react';

export default function useDebouncedValue<T>(value: T, delay = 200) {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
