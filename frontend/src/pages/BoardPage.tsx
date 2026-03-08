import { useState, useEffect, useCallback } from 'react';
import { stagesApi, cardsApi } from '@/services/api';
import type { Stage, Card, CardFilters } from '@/types';
import Board from '@/components/Board/Board';
import SearchBar from '@/components/Search/SearchBar';
import ReminderBanner from '@/components/Reminders/ReminderBanner';
import CardDetail from '@/components/Card/CardDetail';
import CardForm from '@/components/Card/CardForm';

export default function BoardPage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CardFilters>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createStageId, setCreateStageId] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      const [stagesData, cardsData] = await Promise.all([
        stagesApi.getStages(),
        cardsApi.getCards(filters),
      ]);
      setStages(stagesData);
      setCards(cardsData);
    } catch (err) {
      console.error('Failed to fetch board data:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleMoveCard = async (cardId: string, newStageId: string, newPosition: number) => {
    // Optimistic update
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, stageId: newStageId, position: newPosition } : c
      )
    );
    try {
      await cardsApi.moveCard(cardId, newStageId, newPosition);
    } catch {
      // Revert on failure
      fetchData();
    }
  };

  const handleCardCreated = (card: Card) => {
    setCards((prev) => [...prev, card]);
    setShowCreateForm(false);
  };

  const handleCardUpdated = (updatedCard: Card) => {
    setCards((prev) => prev.map((c) => (c.id === updatedCard.id ? updatedCard : c)));
  };

  const handleCardDeleted = (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    setSelectedCardId(null);
  };

  const handleAddCard = (stageId: string) => {
    setCreateStageId(stageId);
    setShowCreateForm(true);
  };

  return (
    <div className="flex flex-col h-full">
      <ReminderBanner />
      <SearchBar filters={filters} onFiltersChange={setFilters} stages={stages} />
      <div className="flex-1 overflow-hidden px-4 pb-4">
        <Board
          stages={stages}
          cards={cards}
          loading={loading}
          onMoveCard={handleMoveCard}
          onCardClick={setSelectedCardId}
          onAddCard={handleAddCard}
        />
      </div>

      {selectedCardId && (
        <CardDetail
          cardId={selectedCardId}
          onClose={() => setSelectedCardId(null)}
          onUpdated={handleCardUpdated}
          onDeleted={handleCardDeleted}
        />
      )}

      {showCreateForm && (
        <CardForm
          stageId={createStageId}
          stages={stages}
          onClose={() => setShowCreateForm(false)}
          onCreated={handleCardCreated}
        />
      )}
    </div>
  );
}
