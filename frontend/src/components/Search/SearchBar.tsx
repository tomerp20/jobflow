import { useState, useEffect, useRef, useCallback } from 'react';
import type { CardFilters, Stage } from '@/types';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { useAutocomplete } from '@/hooks/useAutocomplete';
import AutocompleteDropdown from '@/components/AutocompleteDropdown';

interface SearchBarProps {
  filters: CardFilters;
  onFiltersChange: (filters: CardFilters) => void;
  stages: Stage[];
}

export default function SearchBar({ filters, onFiltersChange, stages }: SearchBarProps) {
  const [searchText, setSearchText] = useState(filters.search || '');
  const [showFilters, setShowFilters] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { suggestions, isLoading, triggerInit, query } = useAutocomplete();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      const newSearch = searchText || undefined;
      if (newSearch !== filters.search) {
        onFiltersChange({ ...filters, search: newSearch });
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchText]);

  useEffect(() => {
    query(searchText);
  }, [searchText, query]);

  const handleSelect = useCallback(
    (word: string) => {
      setSearchText(word);
      setInputFocused(false);
      // Cancel the pending debounce and fire immediately
      clearTimeout(debounceRef.current);
      onFiltersChange({ ...filters, search: word || undefined });
    },
    [filters, onFiltersChange],
  );

  const handleDismiss = useCallback(() => {
    setInputFocused(false);
  }, []);

  const showDropdown = inputFocused && (isLoading || suggestions.length > 0);

  const hasActiveFilters = filters.stageId || filters.priority || filters.workMode;

  const clearFilters = () => {
    setSearchText('');
    onFiltersChange({});
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => {
              setInputFocused(true);
              triggerInit();
            }}
            onBlur={() => setInputFocused(false)}
            placeholder="Search companies, roles, tech stack..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-8 text-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          {showDropdown && (
            <AutocompleteDropdown
              suggestions={suggestions}
              isLoading={isLoading}
              onSelect={handleSelect}
              onDismiss={handleDismiss}
            />
          )}
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
            showFilters || hasActiveFilters
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal size={14} />
          Filters
          {hasActiveFilters && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[10px] text-white">
              {[filters.stageId, filters.priority, filters.workMode].filter(Boolean).length}
            </span>
          )}
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700 transition"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Filter dropdowns */}
      {showFilters && (
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filters.stageId || ''}
            onChange={(e) => onFiltersChange({ ...filters, stageId: e.target.value || undefined })}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none"
          >
            <option value="">All Stages</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={filters.priority || ''}
            onChange={(e) => onFiltersChange({ ...filters, priority: e.target.value || undefined })}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none"
          >
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={filters.workMode || ''}
            onChange={(e) => onFiltersChange({ ...filters, workMode: e.target.value || undefined })}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none"
          >
            <option value="">All Work Modes</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </select>
        </div>
      )}
    </div>
  );
}
