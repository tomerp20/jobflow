import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const classificationSchema = z.object({
  type: z.enum(['rejection', 'application_receipt', 'other']),
  companyName: z.string().nullable(),
  roleTitle: z.string().nullable(),
  jobUrl: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type EmailClassification = z.infer<typeof classificationSchema>;

// Instantiate providers once at module level rather than on every call.
// Warn at startup if the active provider's key is missing so misconfiguration
// is caught early rather than surfacing as a cryptic SDK error at runtime.
const activeProvider = process.env.LLM_PROVIDER ?? 'google';
if (activeProvider === 'google' && !process.env.GOOGLE_AI_API_KEY) {
  console.warn('[emailClassifier] GOOGLE_AI_API_KEY is not set — email classification will fail');
}
if (activeProvider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  console.warn('[emailClassifier] ANTHROPIC_API_KEY is not set — email classification will fail');
}

// Only instantiate the active provider's client — the inactive provider's API
// key may be absent, and some SDKs validate at construction time.
const anthropicProvider = activeProvider === 'anthropic'
  ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const googleProvider = activeProvider === 'google'
  ? createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_AI_API_KEY })
  : null;

function getModel() {
  // Use the module-level constant — avoids re-reading env per call and keeps
  // getModel() consistent with the startup warning above.
  switch (activeProvider) {
    case 'anthropic':
      return anthropicProvider!('claude-3-haiku-20240307');
    case 'google':
    default:
      return googleProvider!('gemini-2.5-flash-lite');
  }
}

/**
 * Strip patterns that are commonly used in prompt-injection attacks before
 * interpolating external content (email subject / body) into an LLM prompt.
 * This is a defence-in-depth measure (OWASP LLM01); the XML-tag delimiters
 * below are the primary boundary enforcement.
 */
function sanitizeForPrompt(s: string, maxLen: number): string {
  return s
    .replace(/```/g, "'''")       // break out of code fences
    .replace(/---+/g, '–––') // break markdown separators
    .replace(/\n{4,}/g, '\n\n\n') // collapse excessive blank lines
    .slice(0, maxLen);
}

export async function classifyEmail(
  subject: string,
  body: string
): Promise<EmailClassification> {
  const safeSubject = sanitizeForPrompt(subject, 200);
  const safeBody = sanitizeForPrompt(body, 2000);

  const { object } = await generateObject({
    model: getModel(),
    schema: classificationSchema,
    prompt: `You are analyzing job application emails. Classify this email and extract structured data.

Email types:
- "rejection": The company has decided not to move forward with the candidate, they went with other candidates, or the position has been filled.
- "application_receipt": The company is acknowledging receipt of a job application (e.g. "Thank you for applying", "We received your application").
- "other": The email is unrelated to a job application.

Extract:
- type: one of "rejection", "application_receipt", or "other"
- companyName: the company name if mentioned, otherwise null
- roleTitle: the job title or role being applied for if mentioned, otherwise null
- jobUrl: any URL linking to the specific job posting if mentioned, otherwise null
- confidence: your confidence in the classification from 0 to 1

<email>
<subject>${safeSubject}</subject>
<body>${safeBody}</body>
</email>

Return your analysis as JSON.`,
  });
  return object;
}
