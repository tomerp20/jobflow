import { memo, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Stage, Card } from '@/types';
import Column from './Column';

interface SortableColumnProps {
  stage: Stage;
  cards: Card[];
  onCardClick: (cardId: string) => void;
  onAddCard: (stageId: string) => void;
  onEditStage?: (stage: Stage) => void;
  onDeleteStage?: (stage: Stage) => void;
  onResizeStage?: (stageId: string, width: number) => void;
}

function SortableColumn({ stage, cards, onCardClick, onAddCard, onEditStage, onDeleteStage, onResizeStage }: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `column-${stage.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Bind stage.id here so Column receives a no-arg () => void callback.
  // useCallback keeps this stable for as long as stage.id and onAddCard don't change.
  const handleAddCard = useCallback(() => onAddCard(stage.id), [onAddCard, stage.id]);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Column
        stage={stage}
        cards={cards}
        onCardClick={onCardClick}
        onAddCard={handleAddCard}
        onEditStage={onEditStage}
        onDeleteStage={onDeleteStage}
        onResizeStage={onResizeStage}
        dragHandleProps={listeners}
      />
    </div>
  );
}

export default memo(SortableColumn);
