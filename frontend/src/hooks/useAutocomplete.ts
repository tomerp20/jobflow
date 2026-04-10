import { useState, useRef, useCallback, useEffect } from 'react';
import trieWorker from '@/workers/trieWorker';

interface UseAutocompleteResult {
  suggestions: string[];
  isLoading: boolean;
  triggerInit: () => void;
  query: (prefix: string) => void;
}

export function useAutocomplete(): UseAutocompleteResult {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const initializedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'ready' }
        | { type: 'results'; suggestions: string[] };

      if (data.type === 'ready') {
        setIsLoading(false);
      } else if (data.type === 'results') {
        setSuggestions(data.suggestions);
      }
    };

    trieWorker.addEventListener('message', handleMessage);
    return () => {
      trieWorker.removeEventListener('message', handleMessage);
    };
  }, []);

  const triggerInit = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    setIsLoading(true);

    fetch('/api/autocomplete/words')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch words: ${res.status}`);
        }
        return res.json() as Promise<{ source: string; words: string[] }>;
      })
      .then((data) => {
        trieWorker.postMessage({ type: 'build', words: data.words });
      })
      .catch(() => {
        setIsLoading(false);
        initializedRef.current = false;
      });
  }, []);

  const query = useCallback((prefix: string) => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      trieWorker.postMessage({ type: 'query', prefix });
    }, 150);
  }, []);

  return { suggestions, isLoading, triggerInit, query };
}
