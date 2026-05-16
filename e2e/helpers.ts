import { type Page, expect } from '@playwright/test';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './constants';

export { TEST_USER_EMAIL, TEST_USER_PASSWORD };
export { DEFAULT_STAGES } from './constants';

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', TEST_USER_EMAIL);
  await page.fill('#password', TEST_USER_PASSWORD);
  await page.click('button[type="submit"]');
  // Assert we left the login page before waiting for the redirect, so a failed
  // login produces a clear error rather than a generic timeout after 60s.
  await expect(page).not.toHaveURL('/login');
  await page.waitForURL('/');
}
