import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Stage, Card } from '@/types';
import Column from './Column';
import CardPreview from '@/components/Card/CardPreview';

interface BoardProps {
  stages: Stage[];
  cards: Card[];
  loading: boolean;
  onMoveCard: (cardId: string, stageId: string, position: number) => void;
  onCardClick: (cardId: string) => void;
  onAddCard: (stageId: string) => void;
}

export default function Board({ stages, cards, loading, onMoveCard, onCardClick, onAddCard }: BoardProps) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const getCardsByStage = useCallback(
    (stageId: string) =>
      cards
        .filter((c) => c.stageId === stageId)
        .sort((a, b) => a.position - b.position),
    [cards]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const card = cards.find((c) => c.id === event.active.id);
    if (card) setActiveCard(card);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Determine target stage and position
    const activeCardData = cards.find((c) => c.id === activeId);
    if (!activeCardData) return;

    // Check if dropped on a column or on a card
    const isOverColumn = stages.some((s) => s.id === overId);
    let targetStageId: string;
    let targetPosition: number;

    if (isOverColumn) {
      targetStageId = overId;
      const stageCards = getCardsByStage(overId);
      targetPosition = stageCards.length;
    } else {
      const overCard = cards.find((c) => c.id === overId);
      if (!overCard) return;
      targetStageId = overCard.stageId;
      const stageCards = getCardsByStage(targetStageId);
      const overIndex = stageCards.findIndex((c) => c.id === overId);
      targetPosition = overIndex >= 0 ? overIndex : stageCards.length;
    }

    if (activeCardData.stageId === targetStageId && activeCardData.position === targetPosition) {
      return;
    }

    onMoveCard(activeId, targetStageId, targetPosition);
  };

  if (loading) {
    return (
      <div className="board-container">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="board-column">
            <div className="p-3 border-b border-gray-200">
              <div className="skeleton h-5 w-24" />
            </div>
            <div className="p-2 space-y-2">
              {[...Array(3)].map((_, j) => (
                <div key={j} className="skeleton h-28 rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="board-container">
        {sortedStages.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            cards={getCardsByStage(stage.id)}
            onCardClick={onCardClick}
            onAddCard={() => onAddCard(stage.id)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="board-card board-card-dragging">
            <CardPreview card={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
