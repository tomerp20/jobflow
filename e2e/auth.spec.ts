import { test, expect } from '@playwright/test';
import { login, DEFAULT_STAGES } from './helpers';

test('user logs in and lands on the Board', async ({ page }) => {
  await login(page);

  await expect(page).toHaveURL('/');
  // Board has rendered at least the first Stage column (Wishlist) after login.
  await expect(page.locator('h3', { hasText: DEFAULT_STAGES[0] })).toBeVisible();
});

test('all expected Stages are visible on the Board after login', async ({ page }) => {
  await login(page);

  for (const stage of DEFAULT_STAGES) {
    await expect(page.locator('h3', { hasText: stage })).toBeVisible();
  }
});
