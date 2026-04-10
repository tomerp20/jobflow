const trieWorker = new Worker(new URL('./trie.worker.ts', import.meta.url), {
  type: 'module',
});

export default trieWorker;
