import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const classificationSchema = z.object({
  isRejection: z.boolean(),
  companyName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type EmailClassification = z.infer<typeof classificationSchema>;

function getModel() {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic';
  switch (provider) {
    case 'anthropic':
    default:
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })('claude-haiku-20240307');
  }
}

export async function classifyEmail(
  subject: string,
  body: string
): Promise<EmailClassification> {
  const { object } = await generateObject({
    model: getModel(),
    schema: classificationSchema,
    prompt: `You are analyzing job application emails. Determine if this email is a rejection from a job application process.

A rejection email typically says the company decided not to move forward with the candidate, they went with other candidates, or the position has been filled.

Subject: ${subject}

Body:
${body}

Return your analysis as JSON.`,
  });
  return object;
}
