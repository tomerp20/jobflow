import { type Page } from '@playwright/test';

export const TEST_USER_EMAIL = 'test@jobflow.io';
export const TEST_USER_PASSWORD = 'Test1234!';

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

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', TEST_USER_EMAIL);
  await page.fill('#password', TEST_USER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
}
