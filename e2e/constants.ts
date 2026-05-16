/**
 * Shared constants between the seed script and E2E test helpers.
 * This is the single source of truth for test credentials and default stage names.
 * Both backend/scripts/seed-test.ts and e2e/helpers.ts import from here.
 */

export const TEST_USER_EMAIL = 'test@jobflow.io';
export const TEST_USER_PASSWORD = 'Test1234!';
export const TEST_USER_NAME = 'Test User';

export const DEFAULT_STAGES = [
  'Wishlist',
  'Applied',
  'Recruiter Call',
  'Technical Screen',
  'Home Assignment',
  'Final Interview',
  'Offer',
  'Rejected',
  'Accepted',
];
