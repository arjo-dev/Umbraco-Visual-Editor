import { expect, type Page } from '@playwright/test';
import { test, type UiHelpers } from '@umbraco-cms/acceptance-test-helpers';
import { PLAYGROUND, waitForCanvas } from './visual-editor.ts';

/*
 * Opening documents in the Visual editor (#48): each user's explicit choice in their profile. Each test starts with a
 * fresh browser context, so the choice made in one doesn't carry over to the next.
 */
const documentPath = `/umbraco/section/content/workspace/document/edit/${PLAYGROUND.key}`;

/** Chooses where documents open, in the current user's profile. */
async function chooseOpenDocumentsIn(page: Page, umbracoUi: UiHelpers, option: 'standard' | 'visual') {
	await umbracoUi.goToBackOffice();
	await umbracoUi.currentUserProfile.clickCurrentUserAvatarButton();
	const profileApp = page.locator('arjo-visual-editor-profile-app');
	await expect(profileApp).toBeVisible();
	await profileApp.locator('select').selectOption(option);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
}

test('opens documents in the standard editor by default', async ({ page }) => {
	await page.goto(documentPath);

	await expect(page.locator('umb-document-workspace-editor')).toBeVisible();
	// Give an unwanted redirect time to happen.
	await page.waitForTimeout(3000);
	await expect(page).not.toHaveURL(/\/view\/visual-editor/);
	await expect(page.locator('arjo-visual-editor-workspace-view')).toHaveCount(0);
});

test('opens documents in the Visual editor for users who choose it', async ({ page, umbracoUi }) => {
	await chooseOpenDocumentsIn(page, umbracoUi, 'visual');

	// Opening a document without naming a tab: as from the content tree.
	await page.goto(documentPath);
	await expect(page).toHaveURL(/\/en-US\/view\/visual-editor$/);
	await waitForCanvas(page);

	// Back leaves the document, rather than landing in the Visual editor again: the redirect replaced the entry.
	await page.goBack();
	await expect(page).not.toHaveURL(/\/view\/visual-editor/);
});

test('a link to a tab still opens that tab', async ({ page, umbracoUi }) => {
	await chooseOpenDocumentsIn(page, umbracoUi, 'visual');

	await page.goto(`${documentPath}/en-US/view/content`);
	await expect(page.locator('umb-document-workspace-editor')).toBeVisible();
	await page.waitForTimeout(3000);
	await expect(page).toHaveURL(/\/view\/content$/);
});

test('choosing the standard editor again opens documents there', async ({ page, umbracoUi }) => {
	await chooseOpenDocumentsIn(page, umbracoUi, 'visual');
	await chooseOpenDocumentsIn(page, umbracoUi, 'standard');

	await page.goto(documentPath);
	await expect(page.locator('umb-document-workspace-editor')).toBeVisible();
	await page.waitForTimeout(3000);
	await expect(page).not.toHaveURL(/\/view\/visual-editor/);
});
