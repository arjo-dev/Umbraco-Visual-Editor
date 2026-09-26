import { expect, type Locator } from '@playwright/test';
import { test } from '@umbraco-cms/acceptance-test-helpers';
import {
	canvas,
	openStandardEditor,
	openVisualEditor,
	PLAYGROUND,
	selectBlock,
	sidePanel,
	waitForCanvas,
	waitForRender,
} from './visual-editor.ts';

/*
 * The core flows of the Visual editor (#37), on the Test Site's Playground page. They share that document, so they run
 * one after another. Each test has a page of its own, so edits it doesn't save are gone for the next; only the last
 * test saves and publishes.
 */
test.describe.configure({ mode: 'serial' });

const unique = (text: string) => `${text} ${Date.now().toString(36)}`;

/**
 * The blocks of the page's first Block List, by their first line of text: enough to tell them apart, and not what the
 * site's own scripts add after loading (e.g. a code block's Copy button), which a patched-in render doesn't run again.
 */
const blockTexts = async (blocks: Locator) =>
	(await blocks.allInnerTexts()).map((text) => text.split('\n').find((line) => line.trim()) ?? '');

test('switches into visual mode from the standard editor', async ({ page }) => {
	await openStandardEditor(page);

	await page.getByRole('tab', { name: 'Visual editor' }).click();

	await waitForCanvas(page);
	await expect(page).toHaveURL(/\/view\/visual-editor/);
	// Visual mode gives the page the room: the content tree is hidden.
	await expect(page.locator('umb-section-sidebar')).toBeHidden();
});

test('edits the title in place on the page', async ({ page }) => {
	await openVisualEditor(page);
	const title = canvas(page).locator('h1');
	const text = unique('Edited in place');

	await title.dblclick();
	await expect(title).toHaveAttribute('contenteditable', /plaintext-only|true/);
	await title.fill(text);
	await title.press('Enter');

	// Rendered again through the template, from the unsaved value.
	await waitForRender(page);
	await expect(title).toHaveText(text);
	await expect(title).not.toHaveAttribute('contenteditable');
});

test('edits a picker in the side panel', async ({ page, umbracoUi }) => {
	await openVisualEditor(page);
	const header = canvas(page).locator('header.masthead');
	const before = (await header.getAttribute('style')) ?? '';
	const [name, slug] = before.includes('chairs-lamps')
		? ['Friendly chair', 'friendly-chair']
		: ['Chairs lamps', 'chairs-lamps'];

	// The hero image isn't a part of the page of its own (it's the header's background): it's under Page settings.
	await sidePanel(page).getByRole('tab', { name: 'Page settings' }).click();
	const heroImage = sidePanel(page).locator('umb-property').filter({ hasText: 'Hero Image' });
	await heroImage.getByRole('button', { name: 'Remove' }).click();
	await page.locator('#confirm').getByLabel('Remove').click();
	await heroImage.getByRole('button', { name: 'Choose' }).click();
	await page.getByRole('button', { name: 'Sample Images' }).click();
	await umbracoUi.content.selectMediaWithName(name);
	// The helpers' submit locator is from an older version: the button says Choose.
	await page.locator('umb-media-picker-modal').getByRole('button', { name: 'Choose', exact: true }).click();

	await expect(heroImage.getByText(name)).toBeVisible();
	await waitForRender(page);
	await expect(header).toHaveAttribute('style', new RegExp(slug));
	// Editing under Page settings keeps you there.
	await expect(sidePanel(page).locator('arjo-visual-editor-page-settings')).toBeVisible();
});

test('reorders blocks on the page', async ({ page }) => {
	await openVisualEditor(page);
	const blocks = canvas(page).locator('.umb-block-list').first().locator(':scope > *');
	const before = await blockTexts(blocks);
	expect(before.length).toBeGreaterThan(1);

	await selectBlock(page, blocks.nth(1));
	await canvas(page).locator('uve-overlay').getByRole('button', { name: 'Move up' }).click();

	await waitForRender(page);
	await expect.poll(() => blockTexts(blocks)).toEqual([before[1], before[0], ...before.slice(2)]);
});

test('adds a block from the page', async ({ page }) => {
	await openVisualEditor(page);
	const blocks = canvas(page).locator('.umb-block-list').first().locator(':scope > *');
	const count = await blocks.count();

	await selectBlock(page, blocks.first());
	await canvas(page).locator('uve-overlay').getByRole('button', { name: 'Add a block after this one' }).click();
	await page.locator('umb-backoffice-modal-container').getByRole('button', { name: 'Rich Text Row' }).click();

	await waitForRender(page);
	await expect(blocks).toHaveCount(count + 1);
	// The new block is selected, with its content to fill in in the side panel.
	await expect(canvas(page).locator('uve-overlay').getByRole('status')).toHaveText('Rich Text Row selected');
	await expect(sidePanel(page).locator('arjo-visual-editor-block-editor')).toBeVisible();
});

test('switches back to the standard editor with the changes', async ({ page }) => {
	await openVisualEditor(page);
	const title = canvas(page).locator('h1');
	const text = unique('Kept when switching');
	await title.dblclick();
	await title.fill(text);
	await title.press('Enter');
	await waitForRender(page);

	await page.locator('arjo-visual-editor-toolbar').getByRole('link', { name: 'Standard editor' }).click();

	await expect(page).toHaveURL(/\/view\/content/);
	await expect(page.locator('[data-mark="property:title"] input')).toHaveValue(text);
});

test('saves and publishes from the visual editor', async ({ page, umbracoUi }) => {
	await openVisualEditor(page);
	const title = canvas(page).locator('h1');
	const text = unique('Published from the Visual editor');
	await title.dblclick();
	await title.fill(text);
	await title.press('Enter');
	await waitForRender(page);

	await umbracoUi.content.clickSaveAndPublishButton();
	await umbracoUi.content.clickConfirmToPublishButton();

	// The live page shows it.
	await expect.poll(async () => (await page.request.get(PLAYGROUND.path)).text(), { timeout: 30_000 }).toContain(text);
});
