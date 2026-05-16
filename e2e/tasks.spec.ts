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
  // The Tasks section is near the bottom of a scrollable modal — scroll into view first.
  const taskInput = page.getByPlaceholder('Add a task for this card...');
  await taskInput.scrollIntoViewIfNeeded();
  await taskInput.fill('Send follow-up email');
  await page.getByRole('button', { name: 'Add task' }).click();

  // Wait for the task to appear in the panel list before closing.
  // Scoped to the modal to avoid false matches from other page content.
  const modal = page.locator('.modal-backdrop');
  await expect(modal.getByTitle('Send follow-up email')).toBeVisible();

  // Close the detail modal.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('h2', { hasText: companyName })).not.toBeVisible();

  // The board does not re-fetch todo counts on modal close — reload to verify persistence.
  await page.reload();
  await page.waitForURL('/');

  const boardCardAfterReload = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  }).locator('.board-card', { hasText: companyName });
  await expect(boardCardAfterReload).toBeVisible();
  await expect(boardCardAfterReload.locator('.text-violet-500')).toBeVisible();
  await expect(boardCardAfterReload.locator('.text-violet-500')).toContainText('1');
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
  // The Tasks section is near the bottom of a scrollable modal — scroll into view first.
  const taskInput = page.getByPlaceholder('Add a task for this card...');
  await taskInput.scrollIntoViewIfNeeded();
  await taskInput.fill('Review offer letter');
  await page.getByRole('button', { name: 'Add task' }).click();

  // Scope task visibility check to the modal to avoid ambiguity.
  const modal = page.locator('.modal-backdrop');
  await expect(modal.getByTitle('Review offer letter')).toBeVisible();

  // Mark the Task as complete via its checkbox.
  // Scoped to the modal to avoid matching other checkboxes on the page.
  await modal.getByRole('checkbox', { name: 'Mark as complete' }).click();
  // After completion the aria-label flips to "Mark as active" and the checkbox is checked.
  await expect(modal.getByRole('checkbox', { name: 'Mark as active' })).toBeChecked();

  // Close the detail modal.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('h2', { hasText: companyName })).not.toBeVisible();

  // The violet active-Task badge must be gone (activeTodoCount = 0).
  // totalTodoCount = 1, so the span is still rendered but with text-gray-400, not text-violet-500.
  const boardCard = stageColumn.locator('.board-card', { hasText: companyName });
  await expect(boardCard.locator('.text-violet-500')).not.toBeVisible({ timeout: 10_000 });

  // Reload and confirm the completed state persists.
  await page.reload();
  await page.waitForURL('/');

  const boardCardAfterReload = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  }).locator('.board-card', { hasText: companyName });
  // Wait for the card to be visible before asserting badge state.
  await expect(boardCardAfterReload).toBeVisible();
  await expect(boardCardAfterReload.locator('.text-violet-500')).not.toBeVisible();
});
