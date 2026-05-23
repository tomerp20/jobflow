// ~40 tech keywords spanning languages, frameworks, infra, databases, cloud platforms
const TECH_KEYWORDS = [
  'react', 'vue', 'angular', 'svelte', 'nextjs', 'next\\.js',
  'typescript', 'javascript', 'python', 'golang', 'rust', 'java', 'kotlin', 'swift',
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
  'graphql', 'grpc', 'rest', 'openapi',
  'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'cassandra', 'elasticsearch',
  'aws', 'gcp', 'azure', 'cloudflare',
  'kafka', 'rabbitmq', 'nats',
  'github.actions', 'ci/cd', 'cicd',
  'llm', 'openai', 'langchain', 'embeddings',
  'wasm', 'webassembly',
];

const TECH_RE = new RegExp('\\b(' + TECH_KEYWORDS.join('|') + ')\\b', 'i');
const TECH_FULL_RE = new RegExp('\\b(' + TECH_KEYWORDS.join('|') + ')\\b', 'gi');

function extractTexts(event) {
  switch (event.type) {
    case 'PushEvent': {
      const commits = event.payload?.commits ?? [];
      return commits.map(c => c.message ?? '').filter(Boolean);
    }
    case 'PullRequestEvent': {
      const pr = event.payload?.pull_request ?? {};
      return [pr.title, pr.body].filter(Boolean);
    }
    case 'IssuesEvent': {
      const issue = event.payload?.issue ?? {};
      const labels = (issue.labels ?? []).map(l => (typeof l === 'string' ? l : l.name ?? ''));
      return [issue.title, issue.body, ...labels].filter(Boolean);
    }
    case 'ReleaseEvent': {
      const rel = event.payload?.release ?? {};
      return [rel.name, rel.body, rel.tag_name].filter(Boolean);
    }
    default:
      return [];
  }
}

export function extractTags(event) {
  const texts = extractTexts(event);
  const tags = new Set();
  for (const text of texts) {
    const matches = text.match(TECH_FULL_RE);
    if (matches) {
      for (const m of matches) tags.add(m.toLowerCase());
    }
  }
  return tags;
}

// Exported for use in ai-detector (same field sources)
export { extractTexts };
