// Singleton trie Web Worker instance — created once at module level.
// All autocomplete consumers share this single worker to avoid duplicate
// trie builds and unnecessary memory usage.
const trieWorker = new Worker(new URL('./trie.worker.ts', import.meta.url), {
  type: 'module',
});

export default trieWorker;
