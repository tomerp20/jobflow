import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface AutocompleteDropdownProps {
  suggestions: string[];
  isLoading: boolean;
  onSelect: (word: string) => void;
  onDismiss: () => void;
}

export default function AutocompleteDropdown({
  suggestions,
  isLoading,
  onSelect,
  onDismiss,
}: AutocompleteDropdownProps) {
  const containerRef = useRef<HTMLUListElement>(null);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const visibleSuggestions = suggestions.slice(0, 5);

  if (!isLoading && visibleSuggestions.length === 0) {
    return null;
  }

  return (
    <ul
      ref={containerRef}
      role="listbox"
      className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      onBlur={(e) => {
        // Dismiss when focus leaves the dropdown entirely
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setTimeout(onDismiss, 150);
        }
      }}
    >
      {isLoading ? (
        <li className="flex items-center justify-center px-3 py-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin mr-2" />
          Loading…
        </li>
      ) : (
        visibleSuggestions.map((word) => (
          <li key={word} role="option" aria-selected={false}>
            <button
              type="button"
              dir="auto"
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors focus:outline-none focus:bg-primary-50 focus:text-primary-700"
              onMouseDown={(e) => {
                // Prevent blur from firing before click registers
                e.preventDefault();
              }}
              onClick={() => {
                onSelect(word);
              }}
            >
              {word}
            </button>
          </li>
        ))
      )}
    </ul>
  );
}
