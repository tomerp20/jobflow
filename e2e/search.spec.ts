import { test, expect } from '@playwright/test';
import { login, createApplication, DEFAULT_STAGES } from './helpers';

// ---------------------------------------------------------------------------
// Test — Search filters Applications by company name
// ---------------------------------------------------------------------------
test('search shows only the matching Application and restores all on clear', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[0]; // 'Wishlist'

  // Locate the Wishlist column once and reuse it throughout the test.
  // Scoping to the column is consistent with applications.spec.ts and prevents
  // strict-mode violations if the same company name ever appears in another column.
  const wishlistColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });

  // Create three Applications with distinct, timestamp-based company names.
  const companyA = await createApplication(page, stageName);
  const companyB = await createApplication(page, stageName);
  const companyC = await createApplication(page, stageName);

  const searchInput = page.getByPlaceholder('Search companies, roles, tech stack...');

  // Type the first company name into the search input.
  await searchInput.fill(companyA);

  // Wait for the filtered board state to settle: the Wishlist column must contain
  // exactly 1 board-card before asserting individual card visibility. This guards
  // against useDeferredValue in BoardPage completing after the initial assertion
  // attempt, which would produce a flaky retry rather than a clean first-pass.
  await expect(wishlistColumn.locator('.board-card')).toHaveCount(1);

  // Only the matching Application card should be visible.
  await expect(wishlistColumn.locator('.board-card', { hasText: companyA })).toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyB })).not.toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyC })).not.toBeVisible();

  // Clear the search input.
  await searchInput.clear();

  // All three Application cards must be visible again — scoped to the Wishlist column.
  await expect(wishlistColumn.locator('.board-card', { hasText: companyA })).toBeVisible();
  await expect(wishlistColumn.locator('.board-card', { hasText: companyB })).toBeVisible();
  await expect(wishlistColumn.locator('.board-card', { hasText: companyC })).toBeVisible();
});
