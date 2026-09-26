import { expect } from '@open-wc/testing';
import { getOpenDocumentsIn, setOpenDocumentsIn, visualEditorUrlFor } from './open-in.js';

const doc = '/umbraco/section/content/workspace/document/edit/5e1d6a3b-7c42-4f0e-9a51-0b3c2d4e5f67';

describe('open documents in', () => {
	afterEach(() => localStorage.clear());

	it('is the standard editor unless the user chose the Visual editor', () => {
		expect(getOpenDocumentsIn('user-a')).to.equal('standard');
		expect(getOpenDocumentsIn(undefined)).to.equal('standard');
	});

	it('is remembered per user', () => {
		setOpenDocumentsIn('user-a', 'visual');
		expect(getOpenDocumentsIn('user-a')).to.equal('visual');
		expect(getOpenDocumentsIn('user-b')).to.equal('standard');

		setOpenDocumentsIn('user-a', 'standard');
		expect(getOpenDocumentsIn('user-a')).to.equal('standard');
	});
});

describe('visualEditorUrlFor', () => {
	it('opens a document that names no view in the Visual editor', () => {
		expect(visualEditorUrlFor(`${doc}/en-US`)).to.equal(`${doc}/en-US/view/visual-editor`);
		expect(visualEditorUrlFor(`${doc}/invariant/`, '?x=1')).to.equal(`${doc}/invariant/view/visual-editor?x=1`);
	});

	it('leaves a link to a tab alone', () => {
		expect(visualEditorUrlFor(`${doc}/en-US/view/content`)).to.equal(null);
		expect(visualEditorUrlFor(`${doc}/en-US/view/visual-editor`)).to.equal(null);
	});

	it('waits for the variant segment, and ignores other pages', () => {
		expect(visualEditorUrlFor(doc)).to.equal(null);
		expect(visualEditorUrlFor('/umbraco/section/media')).to.equal(null);
	});
});
