import path from 'path';
import fs from 'fs';
import logger from '../config/logger';

export interface WordEntry {
  word: string;
  source: 'dictionary';
}

// Load the Hebrew dictionary once at module load time (singleton).
// Repeated JSON.parse of a 5MB file on every request would degrade performance under load.
// postbuild copies src/data → dist/data so __dirname resolves correctly in both dev and prod.
const dictionaryPath = path.join(__dirname, '../data/hebrew-words.json');
let hebrewWords: WordEntry[] | null = null;

try {
  const raw: string[] = JSON.parse(fs.readFileSync(dictionaryPath, 'utf-8'));
  hebrewWords = raw.map((word) => ({ word, source: 'dictionary' as const }));
  logger.info('Hebrew dictionary loaded', { wordCount: hebrewWords.length });
} catch (err) {
  logger.error('Failed to load Hebrew dictionary', { error: (err as Error).message });
}

export const autocompleteService = {
  /** Returns the loaded word list, or null if the dictionary failed to load at startup. */
  getWords(): WordEntry[] | null {
    return hebrewWords;
  },
};
