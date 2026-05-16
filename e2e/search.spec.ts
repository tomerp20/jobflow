import { test, expect } from '@playwright/test';
import { login, createApplication, DEFAULT_STAGES } from './helpers';

// ---------------------------------------------------------------------------
// Test — Search filters Applications by company name
// ---------------------------------------------------------------------------
test('search shows only the matching Application and restores all on clear', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[0]; // 'Wishlist'

  // Create three Applications with distinct, timestamp-based company names.
  const companyA = await createApplication(page, stageName);
  const companyB = await createApplication(page, stageName);
  const companyC = await createApplication(page, stageName);

  const searchInput = page.getByPlaceholder('Search companies, roles, tech stack...');

  // Type the first company name into the search input.
  await searchInput.fill(companyA);

  // Only the matching Application card should be visible.
  await expect(page.locator('.board-card', { hasText: companyA })).toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyB })).not.toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyC })).not.toBeVisible();

  // Clear the search input.
  await searchInput.clear();

  // All three Application cards must be visible again.
  await expect(page.locator('.board-card', { hasText: companyA })).toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyB })).toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyC })).toBeVisible();
});
