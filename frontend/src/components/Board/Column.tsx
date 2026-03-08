import { useState, useRef, useEffect, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Stage, Card } from '@/types';
import SortableCard from './SortableCard';
import { Plus, MoreVertical, GripVertical, Pencil, Trash2 } from 'lucide-react';

interface ColumnProps {
  stage: Stage;
  cards: Card[];
  onCardClick: (cardId: string) => void;
  onAddCard: () => void;
  onEditStage?: (stage: Stage) => void;
  onDeleteStage?: (stage: Stage) => void;
  onResizeStage?: (stageId: string, width: number) => void;
  dragHandleProps?: Record<string, unknown>;
}

export default function Column({ stage, cards, onCardClick, onAddCard, onEditStage, onDeleteStage, onResizeStage, dragHandleProps }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const lastWidthRef = useRef(0);

  const columnWidth = resizeWidth ?? stage.width ?? 320;

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = columnWidth;
    lastWidthRef.current = startW;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.min(800, Math.max(200, startW + delta));
      lastWidthRef.current = newWidth;
      setResizeWidth(newWidth);
    };

    const handleMouseUp = () => {
      const finalWidth = lastWidthRef.current;
      setResizeWidth(null);
      if (onResizeStage && finalWidth !== (stage.width ?? 320)) {
        onResizeStage(stage.id, finalWidth);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidth, onResizeStage, stage.id, stage.width]);

  const cardIds = cards.map((c) => c.id);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      className={`board-column transition-colors ${isOver ? 'bg-primary-50/60 border-primary-300' : ''}`}
      style={{ width: columnWidth, minWidth: 200, maxWidth: 800 }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-1.5">
          {dragHandleProps && (
            <button
              className="cursor-grab text-gray-300 hover:text-gray-500 transition -ml-1"
              {...dragHandleProps}
            >
              <GripVertical size={14} />
            </button>
          )}
          <h3 className="text-sm font-semibold text-gray-700">{stage.name}</h3>
          <span className="flex items-center justify-center h-5 min-w-[20px] rounded-full bg-gray-200 px-1.5 text-xs font-medium text-gray-600">
            {cards.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onAddCard}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition"
            title="Add card"
          >
            <Plus size={16} />
          </button>

          {(onEditStage || onDeleteStage) && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition"
                title="Stage options"
              >
                <MoreVertical size={16} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  {onEditStage && (
                    <button
                      onClick={() => { setMenuOpen(false); onEditStage(stage); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition"
                    >
                      <Pencil size={14} />
                      Rename
                    </button>
                  )}
                  {onDeleteStage && (
                    <button
                      onClick={() => { setMenuOpen(false); onDeleteStage(stage); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="board-column-cards min-h-[60px]">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} onClick={() => onCardClick(card.id)} />
          ))}
        </div>
      </SortableContext>

      {onResizeStage && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="column-resize-handle"
        />
      )}
    </div>
  );
}
