import { expect } from '@open-wc/testing';
import { findBlockEntry } from './block-entry.js';

/** An element with an open shadow root holding `html`. */
function withShadow(tag: string, html: string) {
	const element = document.createElement(tag);
	element.attachShadow({ mode: 'open' }).innerHTML = html;
	return element;
}

/** An entry element with its content key as a property, as Umbraco's are. */
function entry(tag: string, key: string) {
	const element = document.createElement(tag) as HTMLElement & { contentKey?: string };
	element.contentKey = key;
	return element;
}

describe('findBlockEntry', () => {
	it('finds an entry in the light tree by its content key', () => {
		const root = document.createElement('div');
		root.append(entry('umb-block-list-entry', 'a'), entry('umb-block-list-entry', 'b'));
		expect(findBlockEntry(root, 'b')?.tagName).to.equal('UMB-BLOCK-LIST-ENTRY');
		expect((findBlockEntry(root, 'b') as unknown as { contentKey: string }).contentKey).to.equal('b');
	});

	it('looks through nested shadow roots, e.g. a grid area inside a block', () => {
		const editor = withShadow('umb-property-editor-ui-block-grid', '<div class="layout"></div>');
		const parent = withShadow(
			'umb-block-grid-entry',
			'<umb-block-grid-areas-container></umb-block-grid-areas-container>',
		);
		parent
			.shadowRoot!.querySelector('umb-block-grid-areas-container')!
			.append(entry('umb-block-grid-entry', 'area-child'));
		editor.shadowRoot!.querySelector('.layout')!.append(parent);
		const root = document.createElement('div');
		root.append(editor);

		expect(findBlockEntry(root, 'area-child')).to.not.equal(null);
	});

	it('reads the key from data-content-key for rich text blocks', () => {
		const root = document.createElement('div');
		root.innerHTML = '<umb-rte-block data-content-key="rte"></umb-rte-block>';
		expect(findBlockEntry(root, 'rte')?.tagName).to.equal('UMB-RTE-BLOCK');
	});

	it('ignores other elements with the key, and returns null when the block is not rendered', () => {
		const root = document.createElement('div');
		const other = document.createElement('div') as HTMLElement & { contentKey?: string };
		other.contentKey = 'x';
		root.append(other);
		expect(findBlockEntry(root, 'x')).to.equal(null);
	});
});
