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

/**
 * Creates a new Application through the UI and waits for it to appear on the Board.
 *
 * Returns the unique company name used, so callers can locate the card afterwards.
 *
 * @param page      - Playwright Page (must already be logged in and on the Board).
 * @param stageName - The Stage column to create the Application in (must be one of DEFAULT_STAGES).
 */
export async function createApplication(page: Page, stageName: string): Promise<string> {
  const companyName = `E2E Co ${Date.now()}`;
  const roleTitle = 'Software Engineer';

  // Click the "Add card" (+) button in the matching Stage column header.
  const stageColumn = page.locator('.board-column', { has: page.locator('h3', { hasText: stageName }) });
  await stageColumn.locator('[title="Add card"]').click();

  // The CardForm modal ("New Application") should appear.
  await expect(page.locator('h2', { hasText: 'New Application' })).toBeVisible();

  // The Stage select is pre-filled with the clicked column's stage; no change needed.
  // Fill the required fields using placeholder selectors (labels have no htmlFor in this UI).
  await page.getByPlaceholder('Acme Inc.').fill(companyName);
  await page.getByPlaceholder('Senior Frontend Engineer').fill(roleTitle);

  // Submit the form.
  const submitBtn = page.locator('form').getByRole('button', { name: 'Add', exact: true });
  await expect(submitBtn).toBeEnabled();
  await submitBtn.click();

  // Modal closes and the new card must be visible in the correct Stage column.
  await expect(page.locator('h2', { hasText: 'New Application' })).not.toBeVisible();
  await expect(
    stageColumn.locator('.board-card', { hasText: companyName }),
  ).toBeVisible();

  return companyName;
}
