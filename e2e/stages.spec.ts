import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('user creates a new Stage and it appears as a column on the Board', async ({ page }) => {
  await login(page);

  // Use a timestamp-suffixed name so repeated runs never collide with existing stages.
  const stageName = `E2E Stage ${Date.now()}`;

  // Open the "Add Stage" modal via the dashed button at the end of the board.
  await page.click('button:has-text("Add Stage")');

  // The StageForm modal should be visible.
  await expect(page.locator('h2', { hasText: 'New Stage' })).toBeVisible();

  // Fill in the stage name and submit.
  await page.fill('#stage-name', stageName);
  await page.click('button[type="submit"]:has-text("Create")');

  // The modal should close and the new Stage column header should be on the Board.
  await expect(page.locator('h2', { hasText: 'New Stage' })).not.toBeVisible();
  await expect(page.locator('h3', { hasText: stageName })).toBeVisible();
});
