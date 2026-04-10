interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
}

function createNode(): TrieNode {
  return { children: new Map(), isEnd: false };
}

const root: TrieNode = createNode();

function insert(word: string): void {
  let node = root;
  for (const char of word) {
    if (!node.children.has(char)) {
      node.children.set(char, createNode());
    }
    node = node.children.get(char)!;
  }
  node.isEnd = true;
}

function getWordsWithPrefix(prefix: string, limit: number): string[] {
  let node = root;
  for (const char of prefix) {
    if (!node.children.has(char)) {
      return [];
    }
    node = node.children.get(char)!;
  }

  const results: string[] = [];

  function dfs(current: TrieNode, path: string): void {
    if (results.length >= limit) return;
    if (current.isEnd) {
      results.push(path);
    }
    for (const [char, child] of current.children) {
      if (results.length >= limit) return;
      dfs(child, path + char);
    }
  }

  dfs(node, prefix);
  results.sort();
  return results.slice(0, limit);
}

self.onmessage = (event: MessageEvent) => {
  const data = event.data as
    | { type: 'build'; words: string[] }
    | { type: 'query'; prefix: string };

  if (data.type === 'build') {
    for (const word of data.words) {
      insert(word);
    }
    self.postMessage({ type: 'ready' });
  } else if (data.type === 'query') {
    const suggestions = getWordsWithPrefix(data.prefix, 5);
    self.postMessage({ type: 'results', suggestions });
  }
};

export type {};
