import { expect, request, type Locator, type Page } from '@playwright/test';
import { test } from '@umbraco-cms/acceptance-test-helpers';
import { canvas, openVisualEditor, selectBlock, sidePanel, waitForRender, type DocumentRef } from '../visual-editor.ts';

/*
 * The Visual editor on the Compat Site (#38): plain Umbraco, compiled models, and templates that render content in
 * other ways than the Test Site does: hand-rolled block loops, a view component, a cached partial, output caching.
 * See docs/compatibility.md. The site creates its page on first boot (Composers/CompatContentComposer.cs).
 */
test.describe.configure({ mode: 'serial' });

const COMPAT_PAGE: DocumentRef = { key: '3c7f0b8e-0000-4f6c-9b1d-000000000001', culture: 'invariant' };

const unique = (text: string) => `${text} ${Date.now().toString(36)}`;

/** Edits the text of `element` in place on the page and waits for it to be rendered again. */
async function editInPlace(page: Page, element: Locator, text: string) {
	await element.dblclick();
	await expect(element).toHaveAttribute('contenteditable', /plaintext-only|true/);
	await element.fill(text);
	await element.press('Enter');
	await waitForRender(page);
	await expect(element).toHaveText(text);
}

/** The headings of a list of cards, in order. */
const headings = (list: Locator) => list.locator('.card h3').allInnerTexts();

test('marks a page built with compiled models', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);

	// Title, body, 4 cards (each a block with 2 properties), sidebar, footer note.
	await expect(sidePanel(page).getByText(/editable areas on this page/)).toHaveText(/^1[5-9]|^[2-9]\d/);
	await editInPlace(page, canvas(page).locator('h1'), unique('Compiled models'));
});

test('edits text written by a view component', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	await editInPlace(page, canvas(page).locator('.sidebar'), unique('From the sidebar'));
});

test('edits text in a cached partial, which stays cached for visitors', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const text = unique('Edited in the cached footer');

	await editInPlace(page, canvas(page).locator('.footer-note'), text);

	// The live page (a URL the output cache hasn't seen) still has the saved note, and no markers.
	const live = await (await page.request.get(`/?live=${Date.now()}`)).text();
	expect(live).not.toContain(text);
	expect(live).not.toContain('uve-markers');
});

test("links the site's render stylesheet in the Visual editor, and not on the live site", async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const linked = () =>
		canvas(page)
			.locator('html')
			.evaluate((html) => getComputedStyle(html).getPropertyValue('--compat-render-stylesheet').trim());

	await expect.poll(linked).toBe('linked');
	const live = await (await page.request.get(`/?live=${Date.now()}`)).text();
	expect(live).not.toContain('backoffice-render.css');
});

test("runs the site's render script in the Visual editor, which hears each re-render", async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const script = () =>
		canvas(page)
			.locator('html')
			.evaluate(() => (window as unknown as { compatRenderScript?: { renders: number } }).compatRenderScript ?? null);

	await expect.poll(script).toEqual({ loaded: true, renders: 0 });
	await editInPlace(page, canvas(page).locator('h1'), unique('Re-rendered'));
	await expect.poll(script).toEqual({ loaded: true, renders: 1 });

	const live = await (await page.request.get(`/?live=${Date.now()}`)).text();
	expect(live).not.toContain('backoffice-render.js');
});

test('moves a block a hand-rolled loop renders', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const list = canvas(page).locator('.cards');
	const before = await headings(list);

	await selectBlock(page, list.locator('.card').first());
	await canvas(page).locator('uve-overlay').getByRole('button', { name: 'Move down' }).click();

	await waitForRender(page);
	await expect.poll(() => headings(list)).toEqual([before[1], before[0], ...before.slice(2)]);
});

test('moves a block whose partial only gets its element, marked by the element', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const list = canvas(page).locator('.more-cards');
	const before = await headings(list);

	await selectBlock(page, list.locator('.card').nth(1));
	await canvas(page).locator('uve-overlay').getByRole('button', { name: 'Move up' }).click();

	await waitForRender(page);
	await expect.poll(() => headings(list)).toEqual([before[1], before[0], ...before.slice(2)]);
});

test('moves a block whose markup the loop writes itself, marked with the helper', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const list = canvas(page).locator('.inline-cards');
	const before = await headings(list);

	await selectBlock(page, list.locator('.card').first());
	await canvas(page).locator('uve-overlay').getByRole('button', { name: 'Move down' }).click();

	await waitForRender(page);
	await expect.poll(() => headings(list)).toEqual([before[1], before[0], ...before.slice(2)]);
});

test('renders a True/False as it is set in the side panel', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const sidebar = canvas(page).locator('aside');
	await expect(sidebar).toBeVisible();

	// Not on the page itself (it only decides whether the sidebar shows): under Page settings.
	await sidePanel(page).getByRole('tab', { name: 'Page settings' }).click();
	const toggle = sidePanel(page).locator('umb-property').filter({ hasText: 'Hide Sidebar' }).locator('uui-toggle');
	await toggle.click();
	await waitForRender(page);
	await expect(sidebar).toHaveCount(0);

	await toggle.click();
	await waitForRender(page);
	await expect(sidebar).toBeVisible();
});

// The flows below use the backoffice's own editors inside the Visual editor, which can change between Umbraco
// versions; the Compat Site is the one that runs on Umbraco 17 too, so they're checked here as well.

test('edits rich text in place, with the backoffice editor mounted on the page', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const body = canvas(page).locator('section.body');
	const text = unique('Added on the page');

	await body.locator('p').first().dblclick();
	// The editor is mounted on the page, over the text (not inside the site's own markup).
	const editor = canvas(page).locator('[contenteditable="true"]');
	await expect(editor).toBeVisible();
	await editor.press('Control+End');
	await editor.pressSequentially(` ${text}`);
	// Clicking elsewhere on the page finishes the edit; the page is rendered again from the stored markup.
	await canvas(page).locator('h1').click();

	await waitForRender(page);
	await expect(body).toContainText(text);
	await expect(editor).toHaveCount(0);
});

test('adds a block from the catalogue', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const cards = canvas(page).locator('.cards .card');
	const count = await cards.count();

	await selectBlock(page, cards.first());
	await canvas(page).locator('uve-overlay').getByRole('button', { name: 'Add a block after this one' }).click();
	await page.locator('umb-backoffice-modal-container').getByRole('button', { name: 'Compat Card' }).click();

	await waitForRender(page);
	await expect(cards).toHaveCount(count + 1);
	await expect(sidePanel(page).locator('arjo-visual-editor-block-editor')).toBeVisible();
});

test('undoes and redoes an edit', async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const title = canvas(page).locator('h1');
	const before = await title.innerText();
	const toolbar = page.locator('arjo-visual-editor-toolbar');

	await editInPlace(page, title, unique('To be undone'));
	await toolbar.getByRole('button', { name: 'Undo' }).click();
	await waitForRender(page);
	await expect(title).toHaveText(before);

	await toolbar.getByRole('button', { name: 'Redo' }).click();
	await waitForRender(page);
	await expect(title).not.toHaveText(before);
});

test("doesn't output-cache render sessions", async ({ page }) => {
	await openVisualEditor(page, COMPAT_PAGE);
	const src = await page.locator('iframe[title="Page preview"]').getAttribute('src');
	const renderPath = new URL(src!, page.url()).pathname;

	// Rendered for this user, so it may have been cached. Without their viewer cookie it must be refused, not served
	// from the output cache.
	const stranger = await request.newContext({ ignoreHTTPSErrors: true, baseURL: process.env.URL });
	const response = await stranger.get(renderPath);
	expect(response.status()).toBe(404);
	await stranger.dispose();
});
