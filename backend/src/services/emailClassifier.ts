import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { env } from '../config/env';

const classificationSchema = z.object({
  type: z.enum(['rejection', 'application_receipt', 'other']),
  companyName: z.string().max(200).nullable(),
  roleTitle: z.string().max(255).nullable(),
  jobUrl: z.string().url().max(2048).refine(
    url => /^https?:\/\//i.test(url),
    { message: 'jobUrl must use http or https scheme' }
  ).nullable(),
  confidence: z.number().min(0).max(1),
});

export type EmailClassification = z.infer<typeof classificationSchema>;

// Only instantiate the active provider's client — the inactive provider's API
// key may be absent, and some SDKs validate at construction time.
const anthropicProvider = env.LLM_PROVIDER === 'anthropic'
  ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;
const googleProvider = env.LLM_PROVIDER === 'google'
  ? createGoogleGenerativeAI({ apiKey: env.GOOGLE_AI_API_KEY })
  : null;

function getModel() {
  switch (env.LLM_PROVIDER) {
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
    .replace(/[<>]/g, '')          // prevent XML delimiter escape (OWASP LLM01)
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
