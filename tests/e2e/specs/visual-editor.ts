import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

/**
 * The Test Site's Visual Editor Playground (uSync, #7): every property shape, in en-US and da-DK. Its content comes from
 * the uSync files in the working tree, so the specs read what's on the page rather than expecting exact text.
 */
export const PLAYGROUND = {
	key: '5e1d6a3b-7c42-4f0e-9a51-0b3c2d4e5f67',
	culture: 'en-US',
	path: '/playground/',
};

const documentUrl = (view: string) =>
	`/umbraco/section/content/workspace/document/edit/${PLAYGROUND.key}/${PLAYGROUND.culture}/view/${view}`;

/** The rendered page inside the Visual editor. */
export const canvas = (page: Page): FrameLocator => page.frameLocator('iframe[title="Page preview"]');

/** Opens the Playground's Content tab (the standard editor). */
export async function openStandardEditor(page: Page) {
	await page.goto(documentUrl('content'));
	await expect(page.locator('umb-document-workspace-editor')).toBeVisible();
}

/** Opens the Playground in the Visual editor and waits for the page to be ready to edit. */
export async function openVisualEditor(page: Page) {
	await page.goto(documentUrl('visual-editor'));
	await waitForCanvas(page);
}

/**
 * The page is in the frame and connected to the backoffice, so it can be edited. The overlay appears before the
 * canvas has connected: a click then is lost, and the connection resets the selection. The side panel counts the
 * page's editable areas once the canvas has connected and reported them.
 */
export async function waitForCanvas(page: Page) {
	await expect(page.locator('arjo-visual-editor-workspace-view')).toBeVisible();
	await expect(canvas(page).locator('uve-overlay')).toBeAttached();
	await expect(sidePanel(page).getByText(/editable areas on this page/)).toBeVisible();
}

/** Waits for the latest edits to be rendered on the page (the toolbar's spinner has gone). */
export async function waitForRender(page: Page) {
	await expect(page.locator('arjo-visual-editor-toolbar uui-loader-circle')).toBeHidden();
}

/**
 * Selects a block on the page: clicking selects the innermost part under the pointer (often a property inside the
 * block), and Escape goes up to the block around it, which gets the block toolbar.
 */
export async function selectBlock(page: Page, element: Locator) {
	const toolbar = canvas(page).locator('uve-overlay').getByRole('toolbar');
	await element.click();
	for (let i = 0; i < 3 && !(await toolbar.isVisible()); i++) await element.press('Escape');
	await expect(toolbar).toBeVisible();
}

/** The side panel, where the selection is edited. */
export const sidePanel = (page: Page) => page.locator('arjo-visual-editor-side-panel');

/** Leaves the document without saving, answering the "discard changes?" dialog if there is one. */
export async function discardChanges(page: Page) {
	await page.goto('/umbraco/section/content');
	const discard = page.getByRole('button', { name: /discard/i });
	if (await discard.isVisible({ timeout: 3000 }).catch(() => false)) await discard.click();
}
