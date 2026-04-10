import logger from '../config/logger';
// resolveJsonModule is enabled in tsconfig — TypeScript validates and bundles
// this at compile time. No runtime path resolution or postbuild copy needed.
import rawWords from '../data/hebrew-words.json';

// Load the Hebrew dictionary once at module load time (singleton).
// Repeated JSON.parse of a 6 MB file on every request would degrade performance under load.
let hebrewWords: string[] | null = null;

try {
  hebrewWords = rawWords as string[];
  logger.info('Hebrew dictionary loaded', { wordCount: hebrewWords.length });
} catch (err) {
  logger.error('Failed to load Hebrew dictionary', { error: (err as Error).message });
}

export const autocompleteService = {
  /** Returns the loaded word list, or null if the dictionary failed to load at startup. */
  getWords(): string[] | null {
    return hebrewWords;
  },
};
