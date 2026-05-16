import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('user creates a new Stage and it appears as a column on the Board', async ({ page }) => {
  await login(page);

  // Use a timestamp-suffixed name so repeated runs never collide with existing stages.
  const stageName = `E2E Stage ${Date.now()}`;

  // Wait for the Board to finish loading before attempting to open the modal.
  // This guards against the async fetchData calls that hydrate the board after login.
  const addStageButton = page.locator('button', { hasText: 'Add Stage' });
  await expect(addStageButton).toBeVisible();
  await addStageButton.click();

  // The StageForm modal should be visible.
  await expect(page.getByRole('heading', { name: 'New Stage' })).toBeVisible();

  // Fill in the stage name and submit.
  await page.locator('#stage-name').fill(stageName);
  await page.locator('button[type="submit"]', { hasText: 'Create' }).click();

  // The modal should close and the new Stage column header should be on the Board.
  await expect(page.getByRole('heading', { name: 'New Stage' })).not.toBeVisible();
  await expect(page.locator('h3', { hasText: stageName })).toBeVisible();
});
