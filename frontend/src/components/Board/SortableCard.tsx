import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '@/types';
import CardPreview from '@/components/Card/CardPreview';

interface SortableCardProps {
  card: Card;
  onClick: () => void;
}

export default function SortableCard({ card, onClick }: SortableCardProps) {
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
      onClick={(e) => {
        // Don't fire click when finishing a drag
        if (!isDragging) onClick();
      }}
    >
      <CardPreview card={card} />
    </div>
  );
}
