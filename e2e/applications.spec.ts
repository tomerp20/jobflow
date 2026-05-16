import { test, expect } from '@playwright/test';
import { login, createApplication, DEFAULT_STAGES } from './helpers';

// ---------------------------------------------------------------------------
// Test 1 — Create Application
// ---------------------------------------------------------------------------
test('user creates a new Application and it appears in the correct Stage', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[0]; // 'Wishlist'
  const companyName = await createApplication(page, stageName);

  // The card must be visible inside the Wishlist Stage column.
  const stageColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });
  await expect(stageColumn.locator('.board-card', { hasText: companyName })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 2 — View Application details
// ---------------------------------------------------------------------------
test('user opens an Application and sees company name and role title', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[1]; // 'Applied'
  const companyName = await createApplication(page, stageName);

  // Click the card to open the detail modal.
  const stageColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });
  await stageColumn.locator('.board-card', { hasText: companyName }).click();

  // The CardDetail header shows "<companyName> - Software Engineer".
  const detailHeader = page.locator('h2', { hasText: companyName });
  await expect(detailHeader).toBeVisible();
  await expect(detailHeader).toContainText('Software Engineer');
});

// ---------------------------------------------------------------------------
// Test 3 — Edit field and persist after reload
// ---------------------------------------------------------------------------
test('user edits the role title in an Application and it persists after reload', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[2]; // 'Recruiter Call'
  const companyName = await createApplication(page, stageName);

  // Open the Application detail modal.
  const stageColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });
  await stageColumn.locator('.board-card', { hasText: companyName }).click();
  await expect(page.locator('h2', { hasText: companyName })).toBeVisible();

  // Edit the Role Title field (label text is "Role Title", no htmlFor — traverse to parent, then input).
  const roleTitleInput = page.locator('label', { hasText: 'Role Title' }).locator('..').locator('input');
  const updatedTitle = 'Senior Engineer E2E';
  await roleTitleInput.fill(updatedTitle);

  // Save and wait for the full async round-trip: button enters "Saving..." state, then returns to "Save".
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saving...' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

  // Close modal.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('h2', { hasText: companyName })).not.toBeVisible();

  // Reload to confirm persistence.
  await page.reload();
  await page.waitForURL('/');

  // The card should now display the updated role title in CardPreview.
  await expect(
    page.locator('.board-card', { hasText: companyName }),
  ).toContainText(updatedTitle);
});

// ---------------------------------------------------------------------------
// Test 4 — Move Application to a different Stage via drag-and-drop, persist after reload
// ---------------------------------------------------------------------------
test('user moves an Application to a different Stage and it persists after reload', async ({ page }) => {
  await login(page);

  const sourceStage = DEFAULT_STAGES[0]; // 'Wishlist'
  const targetStage = DEFAULT_STAGES[1]; // 'Applied'
  const companyName = await createApplication(page, sourceStage);

  const sourceColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: sourceStage }),
  });
  const targetColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: targetStage }),
  });

  const card = sourceColumn.locator('.board-card', { hasText: companyName });
  await expect(card).toBeVisible();

  // Drag the card from the source column to the target column using low-level
  // mouse events, which work reliably with @dnd-kit's pointer-event listeners.
  const cardBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!cardBox || !targetBox) throw new Error('Could not get bounding boxes for DnD');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in small increments so @dnd-kit's distance threshold (5px) is satisfied.
  await page.mouse.move(startX + 5, startY, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();

  // Wait for the card to appear in the target column.
  await expect(targetColumn.locator('.board-card', { hasText: companyName })).toBeVisible({
    timeout: 10_000,
  });

  // Reload to confirm persistence.
  await page.reload();
  await page.waitForURL('/');

  const targetColumnAfterReload = page.locator('.board-column', {
    has: page.locator('h3', { hasText: targetStage }),
  });
  await expect(
    targetColumnAfterReload.locator('.board-card', { hasText: companyName }),
  ).toBeVisible();

  // The card must NOT appear in the source column after the move.
  const sourceColumnAfterReload = page.locator('.board-column', {
    has: page.locator('h3', { hasText: sourceStage }),
  });
  await expect(
    sourceColumnAfterReload.locator('.board-card', { hasText: companyName }),
  ).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 5 — Delete Application and confirm it is gone after reload
// ---------------------------------------------------------------------------
test('user deletes an Application and it is gone after reload', async ({ page }) => {
  await login(page);

  const stageName = DEFAULT_STAGES[3]; // 'Technical Screen'
  const companyName = await createApplication(page, stageName);

  // Open the Application detail modal.
  const stageColumn = page.locator('.board-column', {
    has: page.locator('h3', { hasText: stageName }),
  });
  await stageColumn.locator('.board-card', { hasText: companyName }).click();
  await expect(page.locator('h2', { hasText: companyName })).toBeVisible();

  // Click "Delete" to show the confirmation prompt.
  await page.locator('button', { hasText: 'Delete' }).first().click();

  // A second "Delete" button appears in the confirmation row — click it to confirm.
  await page.locator('button', { hasText: 'Delete' }).last().click();

  // The modal should close and the card should no longer be on the Board.
  await expect(page.locator('h2', { hasText: companyName })).not.toBeVisible();
  await expect(page.locator('.board-card', { hasText: companyName })).not.toBeVisible();

  // Reload to confirm the deletion persisted.
  await page.reload();
  await page.waitForURL('/');

  await expect(page.locator('.board-card', { hasText: companyName })).not.toBeVisible();
});
