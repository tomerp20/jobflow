import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const classificationSchema = z.object({
  isRejection: z.boolean(),
  companyName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type EmailClassification = z.infer<typeof classificationSchema>;

// Instantiate the provider once at module level rather than on every call
const anthropicProvider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getModel() {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic';
  switch (provider) {
    case 'anthropic':
    default:
      return anthropicProvider('claude-3-haiku-20240307');
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
