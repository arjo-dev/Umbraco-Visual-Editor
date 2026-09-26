import { expect } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import { Editor, Extension, resolveFocusPosition } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import { createFrameFocus } from './frame-focus.js';

describe('createFrameFocus', () => {
	it('brings focus back into the frame for toolbar commands run from the backoffice window', async () => {
		const frame = document.createElement('iframe');
		frame.srcdoc = '<div id="e"></div>';
		const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
		document.body.append(frame);
		await loaded;
		const editor = new Editor({
			element: frame.contentDocument!.getElementById('e')!,
			extensions: [Document, Paragraph, Text, Bold, createFrameFocus({ Extension, resolveFocusPosition })],
			content: '<p>Hi</p>',
			injectCSS: false,
		});
		try {
			// Focus is on a toolbar button in the backoffice window, as after clicking one.
			const button = document.createElement('button');
			document.body.append(button);
			button.focus();
			editor.commands.setTextSelection(3);

			expect(editor.chain().focus().toggleBold().run()).to.equal(true);
			expect(frame.contentDocument!.activeElement).to.equal(editor.view.dom);

			await sendKeys({ type: 'X' });
			expect(editor.getHTML()).to.equal('<p>Hi<strong>X</strong></p>');
			button.remove();
		} finally {
			editor.destroy();
			frame.remove();
		}
	});
});
