import { useEffect } from 'react';
import type { Card } from '@/types';
import { cardsApi } from '@/services/api';

interface UseCardEventsProps {
  setCards: React.Dispatch<React.SetStateAction<Card[]>>;
}

export function useCardEvents({ setCards }: UseCardEventsProps): void {
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    const es = new EventSource(`${baseUrl}/events?token=${encodeURIComponent(token)}`);

    es.onmessage = async (event: MessageEvent) => {
      let payload: { event: string; cardId: string };
      try {
        payload = JSON.parse(event.data as string);
      } catch (err) {
        console.error('[useCardEvents] Failed to parse SSE payload:', err);
        return;
      }

      const { event: eventName, cardId } = payload;

      switch (eventName) {
        case 'card.created': {
          try {
            const { card } = await cardsApi.getCard(cardId);
            // Guard against duplicates — the optimistic update from the local
            // create handler may have already inserted this card into state.
            setCards((prev) =>
              prev.some((c) => c.id === card.id) ? prev : [...prev, card]
            );
          } catch (err) {
            console.error('[useCardEvents] Failed to fetch created card:', err);
          }
          break;
        }

        case 'card.updated':
        case 'card.moved': {
          try {
            const { card } = await cardsApi.getCard(cardId);
            setCards((prev) => prev.map((c) => (c.id === cardId ? card : c)));
          } catch (err) {
            console.error(`[useCardEvents] Failed to fetch ${eventName} card:`, err);
          }
          break;
        }

        case 'card.deleted': {
          setCards((prev) => prev.filter((c) => c.id !== cardId));
          break;
        }

        case 'connected':
          // No-op — server sends this to confirm the SSE stream is open
          break;

        default:
          break;
      }
    };

    es.onerror = (err) => {
      console.error('[useCardEvents] SSE connection error:', err);
      // EventSource auto-reconnects by default. On reconnect it will reuse the
      // same URL (with the original token). If the access token has been
      // silently refreshed while the connection was open, close this instance
      // so the parent can re-mount with the current token.
      const currentToken = localStorage.getItem('accessToken');
      if (currentToken && currentToken !== token) {
        es.close();
      }
    };

    return () => {
      es.close();
    };
    // setCards is a stable useState dispatcher — safe to omit from deps.
    // The effect intentionally runs once per mount so a single SSE connection
    // is opened for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
