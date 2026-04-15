import { useState, useEffect, useCallback } from 'react';
import { stagesApi, cardsApi } from '@/services/api';
import type { Stage, Card, CardFilters } from '@/types';
import Board from '@/components/Board/Board';
import SearchBar from '@/components/Search/SearchBar';
import ReminderBanner from '@/components/Reminders/ReminderBanner';
import CardDetail from '@/components/Card/CardDetail';
import CardForm from '@/components/Card/CardForm';
import StageForm from '@/components/Board/StageForm';
import TodoPanel from '@/components/Todo/TodoPanel';

export default function BoardPage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CardFilters>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createStageId, setCreateStageId] = useState<string>('');

  // Stage form state
  const [showStageForm, setShowStageForm] = useState(false);
  const [editingStage, setEditingStage] = useState<Stage | undefined>(undefined);
  const [deleteConfirmStage, setDeleteConfirmStage] = useState<Stage | null>(null);

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
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, stageId: newStageId, position: newPosition } : c
      )
    );
    try {
      const updatedCard = await cardsApi.moveCard(cardId, newStageId, newPosition);
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== cardId) return c;
          if (c.lastInteractionDate === updatedCard.lastInteractionDate) return c;
          return { ...c, lastInteractionDate: updatedCard.lastInteractionDate };
        })
      );
    } catch {
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

  // ── Stage handlers ──────────────────────────────────────────────────────────

  const handleAddStage = () => {
    setEditingStage(undefined);
    setShowStageForm(true);
  };

  const handleEditStage = (stage: Stage) => {
    setEditingStage(stage);
    setShowStageForm(true);
  };

  const handleStageSaved = (saved: Stage) => {
    if (editingStage) {
      // Rename: update in place
      setStages((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    } else {
      // New stage: append
      setStages((prev) => [...prev, saved]);
    }
    setShowStageForm(false);
    setEditingStage(undefined);
  };

  const handleDeleteStage = (stage: Stage) => {
    setDeleteConfirmStage(stage);
  };

  const confirmDeleteStage = async () => {
    if (!deleteConfirmStage) return;
    try {
      await stagesApi.deleteStage(deleteConfirmStage.id);
      // Refetch everything since cards were moved
      setDeleteConfirmStage(null);
      fetchData();
    } catch (err: any) {
      console.error('Failed to delete stage:', err);
      alert(err.response?.data?.error?.message || 'Failed to delete stage');
    }
  };

  const handleResizeStage = async (stageId: string, width: number) => {
    // Optimistic update
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, width } : s)));
    try {
      const updated = await stagesApi.updateStage(stageId, { width });
      setStages((prev) => prev.map((s) => (s.id === stageId ? updated : s)));
    } catch {
      fetchData();
    }
  };

  const handleReorderStages = async (stageIds: string[]) => {
    // Optimistic update
    const reordered = stageIds.map((id, i) => {
      const stage = stages.find((s) => s.id === id)!;
      return { ...stage, position: i };
    });
    setStages(reordered);

    try {
      await stagesApi.reorderStages(stageIds);
    } catch {
      fetchData();
    }
  };

  const stageCardCount = deleteConfirmStage
    ? cards.filter((c) => c.stageId === deleteConfirmStage.id).length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <ReminderBanner />
      <SearchBar filters={filters} onFiltersChange={setFilters} stages={stages} />
      <div className="px-4 mb-4">
        <TodoPanel />
      </div>
      <div className="flex-1 px-4 pb-4">
        <Board
          stages={stages}
          cards={cards}
          loading={loading}
          onMoveCard={handleMoveCard}
          onCardClick={setSelectedCardId}
          onAddCard={handleAddCard}
          onEditStage={handleEditStage}
          onDeleteStage={handleDeleteStage}
          onReorderStages={handleReorderStages}
          onResizeStage={handleResizeStage}
          onAddStage={handleAddStage}
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

      {showStageForm && (
        <StageForm
          stage={editingStage}
          totalStages={stages.length}
          onClose={() => { setShowStageForm(false); setEditingStage(undefined); }}
          onSaved={handleStageSaved}
        />
      )}

      {deleteConfirmStage && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmStage(null)}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Stage</h3>
            <p className="text-sm text-gray-600 mb-1">
              Are you sure you want to delete <strong>{deleteConfirmStage.name}</strong>?
            </p>
            {stageCardCount > 0 && (
              <p className="text-sm text-amber-600 mb-4">
                {stageCardCount} card{stageCardCount !== 1 ? 's' : ''} will be moved to the first stage.
              </p>
            )}
            {stageCardCount === 0 && <div className="mb-4" />}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmStage(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteStage}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
