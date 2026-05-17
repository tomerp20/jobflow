jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: jest.fn(() => jest.fn()),
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => jest.fn()),
}));

import { generateObject } from 'ai';
import { classifyEmail, EmailClassification } from '../src/services/emailClassifier';

const mockGenerateObject = generateObject as jest.MockedFunction<typeof generateObject>;

function makeResult(overrides: Partial<EmailClassification>): { object: EmailClassification } {
  return {
    object: {
      type: 'other',
      companyName: null,
      roleTitle: null,
      jobUrl: null,
      confidence: 0.95,
      ...overrides,
    },
  };
}

describe('classifyEmail', () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  it('classifies a clear application receipt with companyName, roleTitle, and jobUrl', async () => {
    mockGenerateObject.mockResolvedValue(makeResult({
      type: 'application_receipt',
      companyName: 'Acme Corp',
      roleTitle: 'Software Engineer',
      jobUrl: 'https://acme.com/jobs/123',
      confidence: 0.97,
    }) as any);

    const result = await classifyEmail(
      'We received your application for Software Engineer at Acme Corp',
      'Thank you for applying to the Software Engineer role. View the posting: https://acme.com/jobs/123',
    );

    expect(result.type).toBe('application_receipt');
    expect(result.companyName).toBe('Acme Corp');
    expect(result.roleTitle).toBe('Software Engineer');
    expect(result.jobUrl).toBe('https://acme.com/jobs/123');
  });

  it('classifies a clear rejection email', async () => {
    mockGenerateObject.mockResolvedValue(makeResult({
      type: 'rejection',
      companyName: 'BigTech Inc',
      roleTitle: 'Backend Developer',
      jobUrl: null,
      confidence: 0.98,
    }) as any);

    const result = await classifyEmail(
      'Your application to BigTech Inc',
      'Thank you for applying. After careful consideration, we have decided to move forward with other candidates.',
    );

    expect(result.type).toBe('rejection');
    expect(result.companyName).toBe('BigTech Inc');
    expect(result.confidence).toBe(0.98);
  });

  it('classifies an unrelated email as other', async () => {
    mockGenerateObject.mockResolvedValue(makeResult({
      type: 'other',
      companyName: null,
      roleTitle: null,
      jobUrl: null,
      confidence: 0.99,
    }) as any);

    const result = await classifyEmail(
      'Your Amazon order has shipped',
      'Your package is on its way! Expected delivery: tomorrow.',
    );

    expect(result.type).toBe('other');
  });

  it('returns roleTitle as null when no role is mentioned in a receipt', async () => {
    mockGenerateObject.mockResolvedValue(makeResult({
      type: 'application_receipt',
      companyName: 'StartupXYZ',
      roleTitle: null,
      jobUrl: null,
      confidence: 0.88,
    }) as any);

    const result = await classifyEmail(
      'We got your application',
      'Thank you for applying to StartupXYZ. We will be in touch.',
    );

    expect(result.type).toBe('application_receipt');
    expect(result.roleTitle).toBeNull();
  });

  it('returns jobUrl as null when no URL is mentioned in a receipt', async () => {
    mockGenerateObject.mockResolvedValue(makeResult({
      type: 'application_receipt',
      companyName: 'CoolCo',
      roleTitle: 'Product Manager',
      jobUrl: null,
      confidence: 0.92,
    }) as any);

    const result = await classifyEmail(
      'Application received — Product Manager at CoolCo',
      'We received your application for Product Manager. We will review it shortly.',
    );

    expect(result.type).toBe('application_receipt');
    expect(result.jobUrl).toBeNull();
  });

  it('propagates errors from generateObject so the caller can log classifier_error', async () => {
    mockGenerateObject.mockRejectedValue(new Error('LLM API timeout'));

    await expect(
      classifyEmail('Subject', 'Body')
    ).rejects.toThrow('LLM API timeout');
  });
});
