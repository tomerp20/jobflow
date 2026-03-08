import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Stage, Card } from '@/types';
import Column from './Column';

interface SortableColumnProps {
  stage: Stage;
  cards: Card[];
  onCardClick: (cardId: string) => void;
  onAddCard: () => void;
  onEditStage: (stage: Stage) => void;
  onDeleteStage: (stage: Stage) => void;
  onResizeStage?: (stageId: string, width: number) => void;
}

export default function SortableColumn({ stage, cards, onCardClick, onAddCard, onEditStage, onDeleteStage, onResizeStage }: SortableColumnProps) {
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

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Column
        stage={stage}
        cards={cards}
        onCardClick={onCardClick}
        onAddCard={onAddCard}
        onEditStage={onEditStage}
        onDeleteStage={onDeleteStage}
        onResizeStage={onResizeStage}
        dragHandleProps={listeners}
      />
    </div>
  );
}
