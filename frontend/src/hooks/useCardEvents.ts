import { useEffect } from 'react';
import type { Card } from '@/types';
import { cardsApi } from '@/services/api';

interface UseCardEventsProps {
  cards: Card[];
  setCards: React.Dispatch<React.SetStateAction<Card[]>>;
}

export function useCardEvents({ setCards }: UseCardEventsProps): void {
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const es = new EventSource(`/api/events?token=${token}`);

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
            setCards((prev) => [...prev, card]);
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
      // EventSource auto-reconnects by default; no manual reconnect needed
    };

    return () => {
      es.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
