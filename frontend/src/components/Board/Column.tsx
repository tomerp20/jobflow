import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Stage, Card } from '@/types';
import SortableCard from './SortableCard';
import { Plus } from 'lucide-react';

interface ColumnProps {
  stage: Stage;
  cards: Card[];
  onCardClick: (cardId: string) => void;
  onAddCard: () => void;
}

export default function Column({ stage, cards, onCardClick, onAddCard }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  const cardIds = cards.map((c) => c.id);

  return (
    <div
      className={`board-column transition-colors ${isOver ? 'bg-primary-50/60 border-primary-300' : ''}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">{stage.name}</h3>
          <span className="flex items-center justify-center h-5 min-w-[20px] rounded-full bg-gray-200 px-1.5 text-xs font-medium text-gray-600">
            {cards.length}
          </span>
        </div>
        <button
          onClick={onAddCard}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition"
          title="Add card"
        >
          <Plus size={16} />
        </button>
      </div>

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="board-column-cards min-h-[60px]">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} onClick={() => onCardClick(card.id)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
