import { test, expect } from '@playwright/test';
import { login, createApplication, DEFAULT_STAGES } from './helpers';

// ---------------------------------------------------------------------------
// Test 1 — Add a Task
// ---------------------------------------------------------------------------
test('user adds a Task to an Application and the Task count appears on the Board', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[0]; // 'Wishlist'
  const companyName = await createApplication(page, stageName);

  const stageColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });

  // Open the Application detail.
  await stageColumn.locator('.board-card', { hasText: companyName }).click();
  await expect(page.locator('h2', { hasText: companyName })).toBeVisible();

  // Add a Task via the task input in the detail panel.
  await page.getByPlaceholder('Add a task for this card...').fill('Send follow-up email');
  await page.getByRole('button', { name: 'Add task' }).click();

  // Wait for the task to appear in the panel list before closing.
  await expect(page.getByTitle('Send follow-up email')).toBeVisible();

  // Close the detail modal.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('h2', { hasText: companyName })).not.toBeVisible();

  // The board card must now display a violet active-Task count badge of 1.
  const boardCard = stageColumn.locator('.board-card', { hasText: companyName });
  await expect(boardCard.locator('.text-violet-500')).toContainText('1', { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Test 2 — Complete a Task
// ---------------------------------------------------------------------------
test('user completes a Task and the active Task count on the Board drops to 0', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[1]; // 'Applied'
  const companyName = await createApplication(page, stageName);

  const stageColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });

  // Open the Application detail.
  await stageColumn.locator('.board-card', { hasText: companyName }).click();
  await expect(page.locator('h2', { hasText: companyName })).toBeVisible();

  // Add a Task.
  await page.getByPlaceholder('Add a task for this card...').fill('Review offer letter');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByTitle('Review offer letter')).toBeVisible();

  // Mark the Task as complete via its checkbox.
  await page.getByRole('checkbox', { name: 'Mark as complete' }).click();
  // After completion the aria-label flips to "Mark as active" and the checkbox is checked.
  await expect(page.getByRole('checkbox', { name: 'Mark as active' })).toBeChecked();

  // Close the detail modal.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('h2', { hasText: companyName })).not.toBeVisible();

  // The violet active-Task badge must be gone (activeTodoCount = 0).
  const boardCard = stageColumn.locator('.board-card', { hasText: companyName });
  await expect(boardCard.locator('.text-violet-500')).not.toBeVisible({ timeout: 10_000 });

  // Reload and confirm the state persists.
  await page.reload();
  await page.waitForURL('/');

  const boardCardAfterReload = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  }).locator('.board-card', { hasText: companyName });
  await expect(boardCardAfterReload.locator('.text-violet-500')).not.toBeVisible();
});
