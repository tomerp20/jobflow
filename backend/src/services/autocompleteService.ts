import path from 'path';
import fs from 'fs';
import logger from '../config/logger';

export interface WordEntry {
  word: string;
  source: 'dictionary';
}

// Load the Hebrew dictionary once at module load time (singleton).
// Repeated JSON.parse of a 5MB file on every request would degrade performance under load.
const dictionaryPath = path.join(__dirname, '../data/hebrew-words.json');
let hebrewWords: WordEntry[];

try {
  const raw: string[] = JSON.parse(fs.readFileSync(dictionaryPath, 'utf-8'));
  hebrewWords = raw.map((word) => ({ word, source: 'dictionary' as const }));
  logger.info('Hebrew dictionary loaded', { wordCount: hebrewWords.length });
} catch (err) {
  logger.error('Failed to load Hebrew dictionary', { error: (err as Error).message });
  hebrewWords = [];
}

export const autocompleteService = {
  getWords(): WordEntry[] {
    return hebrewWords;
  },
};
