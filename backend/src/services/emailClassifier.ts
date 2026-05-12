import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const classificationSchema = z.object({
  isRejection: z.boolean(),
  companyName: z.string().nullable(),
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

const anthropicProvider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const googleProvider = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

function getModel() {
  const provider = process.env.LLM_PROVIDER ?? 'google';
  switch (provider) {
    case 'anthropic':
      return anthropicProvider('claude-3-haiku-20240307');
    case 'google':
    default:
      return googleProvider('gemini-2.5-flash-lite');
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
    prompt: `You are analyzing job application emails. Determine if this email is a rejection from a job application process.

A rejection email typically says the company decided not to move forward with the candidate, they went with other candidates, or the position has been filled.

<email>
<subject>${safeSubject}</subject>
<body>${safeBody}</body>
</email>

Return your analysis as JSON.`,
  });
  return object;
}
