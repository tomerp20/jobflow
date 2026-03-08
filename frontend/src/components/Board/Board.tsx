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
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import type { Stage, Card } from '@/types';
import SortableColumn from './SortableColumn';
import Column from './Column';
import CardPreview from '@/components/Card/CardPreview';
import { Plus } from 'lucide-react';

interface BoardProps {
  stages: Stage[];
  cards: Card[];
  loading: boolean;
  onMoveCard: (cardId: string, stageId: string, position: number) => void;
  onCardClick: (cardId: string) => void;
  onAddCard: (stageId: string) => void;
  onEditStage?: (stage: Stage) => void;
  onDeleteStage?: (stage: Stage) => void;
  onReorderStages?: (stageIds: string[]) => void;
  onResizeStage?: (stageId: string, width: number) => void;
  onAddStage?: () => void;
}

type DragType = 'card' | 'column' | null;

export default function Board({
  stages, cards, loading, onMoveCard, onCardClick, onAddCard,
  onEditStage, onDeleteStage, onReorderStages, onResizeStage, onAddStage,
}: BoardProps) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeColumn, setActiveColumn] = useState<Stage | null>(null);
  const [dragType, setDragType] = useState<DragType>(null);

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

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const columnIds = sortedStages.map((s) => `column-${s.id}`);

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = event.active.id as string;

    if (activeId.startsWith('column-')) {
      const stageId = activeId.replace('column-', '');
      const stage = stages.find((s) => s.id === stageId);
      if (stage) {
        setActiveColumn(stage);
        setDragType('column');
      }
    } else {
      const card = cards.find((c) => c.id === activeId);
      if (card) {
        setActiveCard(card);
        setDragType('card');
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (dragType === 'column' && over && onReorderStages) {
      const activeId = (active.id as string).replace('column-', '');
      const overId = (over.id as string).replace('column-', '');

      if (activeId !== overId) {
        const oldIndex = sortedStages.findIndex((s) => s.id === activeId);
        const newIndex = sortedStages.findIndex((s) => s.id === overId);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(sortedStages, oldIndex, newIndex);
          onReorderStages(newOrder.map((s) => s.id));
        }
      }
    }

    if (dragType === 'card' && over) {
      const activeId = active.id as string;
      const overId = over.id as string;

      const activeCardData = cards.find((c) => c.id === activeId);
      if (!activeCardData) {
        resetDragState();
        return;
      }

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
        if (!overCard) {
          resetDragState();
          return;
        }
        targetStageId = overCard.stageId;
        const stageCards = getCardsByStage(targetStageId);
        const overIndex = stageCards.findIndex((c) => c.id === overId);
        targetPosition = overIndex >= 0 ? overIndex : stageCards.length;
      }

      if (activeCardData.stageId === targetStageId && activeCardData.position === targetPosition) {
        resetDragState();
        return;
      }

      onMoveCard(activeId, targetStageId, targetPosition);
    }

    resetDragState();
  };

  const resetDragState = () => {
    setActiveCard(null);
    setActiveColumn(null);
    setDragType(null);
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="board-container">
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          {sortedStages.map((stage) => (
            <SortableColumn
              key={stage.id}
              stage={stage}
              cards={getCardsByStage(stage.id)}
              onCardClick={onCardClick}
              onAddCard={() => onAddCard(stage.id)}
              onEditStage={onEditStage || (() => {})}
              onDeleteStage={onDeleteStage || (() => {})}
              onResizeStage={onResizeStage}
            />
          ))}
        </SortableContext>

        {onAddStage && (
          <button
            onClick={onAddStage}
            className="flex-shrink-0 w-[280px] h-fit border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center gap-2 py-8 text-gray-400 hover:border-primary-400 hover:text-primary-500 hover:bg-primary-50/30 transition"
          >
            <Plus size={18} />
            <span className="text-sm font-medium">Add Stage</span>
          </button>
        )}
      </div>

      <DragOverlay>
        {activeCard ? (
          <div className="board-card board-card-dragging">
            <CardPreview card={activeCard} />
          </div>
        ) : null}
        {activeColumn ? (
          <div className="board-column opacity-80">
            <div className="px-3 py-2.5 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700">{activeColumn.name}</h3>
            </div>
            <div className="p-2 space-y-2">
              {getCardsByStage(activeColumn.id).slice(0, 3).map((card) => (
                <div key={card.id} className="board-card">
                  <CardPreview card={card} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
