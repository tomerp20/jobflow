import { memo, useCallback } from 'react';
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

  const handleClick = useCallback(() => {
    if (!isDragging) onCardClick(card.id);
  }, [isDragging, onCardClick, card.id]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`board-card ${isDragging ? 'board-card-ghost' : ''}`}
      onClick={handleClick}
    >
      <CardPreview card={card} />
    </div>
  );
}

export default memo(SortableCard);
