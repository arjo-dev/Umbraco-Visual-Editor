import { expect } from '@open-wc/testing';
import { readShowTree, showTreeFor, writeShowTree } from './tree-preference.js';

describe('tree preference', () => {
	beforeEach(() => localStorage.removeItem('arjo.visualEditor.showTree'));
	afterEach(() => localStorage.removeItem('arjo.visualEditor.showTree'));

	it('defaults per editor mode while the user has not chosen: hidden beside the side panel, shown in overlay mode', () => {
		expect(readShowTree()).to.equal(null);
		expect(showTreeFor(false)).to.equal(false);
		expect(showTreeFor(true)).to.equal(true);
	});

	it('lets a remembered choice win in both modes', () => {
		writeShowTree(false);
		expect(showTreeFor(true)).to.equal(false);
		writeShowTree(true);
		expect(showTreeFor(false)).to.equal(true);
	});
});
