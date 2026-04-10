import { useState, useRef, useCallback, useEffect } from 'react';
import trieWorker from '@/workers/trieWorker';

// Sequence counter shared across all instances so each query can be
// matched back to the instance that issued it.
let globalSeq = 0;

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
  const isReadyRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The seq number this instance assigned to its most recent query.
  const lastSeqRef = useRef<number>(-1);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'ready' }
        | { type: 'results'; suggestions: string[]; seq: number };

      if (data.type === 'ready') {
        isReadyRef.current = true;
        setIsLoading(false);
      } else if (data.type === 'results') {
        // Only accept results that this instance requested.
        if (data.seq === lastSeqRef.current) {
          setSuggestions(data.suggestions);
        }
      }
    };

    trieWorker.addEventListener('message', handleMessage);
    return () => {
      trieWorker.removeEventListener('message', handleMessage);
      // Cancel any pending debounce to avoid posting to the worker after unmount.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const triggerInit = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    setIsLoading(true);

    const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
    fetch(`${baseUrl}/autocomplete/words`)
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
    // Do not send queries before the trie has been built.
    if (!isReadyRef.current) return;

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const seq = ++globalSeq;
      lastSeqRef.current = seq;
      trieWorker.postMessage({ type: 'query', prefix, seq });
    }, 150);
  }, []);

  return { suggestions, isLoading, triggerInit, query };
}
