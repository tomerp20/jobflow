import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '@/types';
import CardPreview from '@/components/Card/CardPreview';

interface SortableCardProps {
  card: Card;
  onCardClick: (id: string) => void;
}

function SortableCard({ card, onCardClick }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`board-card ${isDragging ? 'board-card-ghost' : ''}`}
      onClick={() => {
        if (!isDragging) onCardClick(card.id);
      }}
    >
      <CardPreview card={card} />
    </div>
  );
}

export default memo(SortableCard);
