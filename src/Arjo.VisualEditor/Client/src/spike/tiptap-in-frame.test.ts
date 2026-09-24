/**
 * Spike #21 (docs/adr/0004-inline-rich-text.md): can a Tiptap editor created in the backoffice window edit an element
 * inside the canvas iframe (same origin), so the rich text is edited in place with the site's own CSS?
 *
 * Here the test window plays the backoffice and a srcdoc frame plays the canvas. Tiptap is imported from npm (the
 * version the backoffice bundles); the real thing would use `@umbraco-cms/backoffice/external/tiptap` and the data
 * type's configured `tiptapExtension`s, as `umb-input-tiptap` does. Keys are real key presses (Playwright), not
 * synthetic events.
 */
import { expect } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Heading from '@tiptap/extension-heading';
import { UndoRedo } from '@tiptap/extensions';

async function canvasFrame(): Promise<Document> {
	const frame = document.createElement('iframe');
	frame.style.cssText = 'width: 800px; height: 400px';
	frame.srcdoc = `<!doctype html>
		<style>
			.site-body p { color: rgb(10, 20, 30); font-family: Georgia, serif; }
			.site-body strong { color: rgb(200, 0, 0); }
		</style>
		<body><article class="site-body"><div id="rte"><p><strong>Hello</strong> world</p></div></article></body>`;
	const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
	document.body.append(frame);
	await loaded;
	return frame.contentDocument!;
}

describe('spike #21: backoffice Tiptap editing an element inside the canvas frame', () => {
	let doc: Document;
	let editor: Editor;

	beforeEach(async () => {
		doc = await canvasFrame();
		const host = doc.getElementById('rte')!;
		const content = host.innerHTML;
		host.replaceChildren();
		editor = new Editor({
			element: host,
			extensions: [Document, Paragraph, Text, Bold, Heading, UndoRedo],
			content,
			injectCSS: false,
		});
	});

	/**
	 * Tiptap's focus() command focuses from the backoffice window and doesn't move focus into the frame; focus the
	 * editable element itself, then place the caret.
	 */
	async function focusEnd() {
		editor.view.dom.focus();
		editor.commands.setTextSelection(editor.state.doc.content.size - 1);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	afterEach(() => {
		editor.destroy();
		doc.defaultView!.frameElement!.remove();
	});

	it('mounts into the frame document, where the site CSS styles it', () => {
		expect(editor.view.dom.ownerDocument).to.equal(doc);
		const strong = editor.view.dom.querySelector('strong')!;
		expect(doc.defaultView!.getComputedStyle(strong).color).to.equal('rgb(200, 0, 0)');
		expect(doc.defaultView!.getComputedStyle(editor.view.dom.querySelector('p')!).fontFamily).to.contain('Georgia');
	});

	it('takes real typing, Enter and keyboard shortcuts', async () => {
		await focusEnd();
		expect(doc.activeElement).to.equal(editor.view.dom);

		await sendKeys({ type: '!' });
		await sendKeys({ press: 'Enter' });
		await sendKeys({ press: 'Control+b' });
		await sendKeys({ type: 'Bold line' });

		expect(editor.getHTML()).to.equal('<p><strong>Hello</strong> world!</p><p><strong>Bold line</strong></p>');
	});

	it('runs commands from the backoffice (what a toolbar would do) and undoes them', async () => {
		await focusEnd();
		editor.chain().toggleHeading({ level: 2 }).run();
		expect(editor.getHTML()).to.equal('<h2><strong>Hello</strong> world</h2>');

		await sendKeys({ press: 'Control+z' });
		expect(editor.getHTML()).to.equal('<p><strong>Hello</strong> world</p>');
	});

	it('uses the frame selection (the DOM selection lives in the frame)', async () => {
		await focusEnd();
		await sendKeys({ press: 'Shift+Home' });
		const selection = doc.getSelection()!;
		expect(selection.toString()).to.equal('Hello world');
		expect(editor.state.selection.empty).to.equal(false);
	});

	it("can take over the site's own element (`element: { mount }`), with no wrapper", async () => {
		const frameDoc = await canvasFrame();
		const host = frameDoc.getElementById('rte') as HTMLElement;
		const content = host.innerHTML;
		const mounted = new Editor({
			element: { mount: host },
			extensions: [Document, Paragraph, Text, Bold],
			content,
			injectCSS: false,
		});
		try {
			expect(mounted.view.dom).to.equal(host);
			expect(host.getAttribute('contenteditable')).to.equal('true');
			expect(host.parentElement!.className).to.equal('site-body');
		} finally {
			mounted.destroy();
			frameDoc.defaultView!.frameElement!.remove();
		}
	});
});
