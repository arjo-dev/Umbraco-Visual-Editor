import { expect } from '@open-wc/testing';
import { viewInPath } from './routes.js';

const doc = '/umbraco/section/content/workspace/document/edit/5e1d6a3b-7c42-4f0e-9a51-0b3c2d4e5f67';

describe('viewInPath', () => {
	it('finds the view in a variant document URL', () => {
		expect(viewInPath(`${doc}/en-US/view/visual-editor`)).to.deep.equal({
			base: `${doc}/en-US`,
			view: 'visual-editor',
		});
	});

	it('finds the view in an invariant document URL', () => {
		expect(viewInPath(`${doc}/invariant/view/content`)).to.deep.equal({ base: `${doc}/invariant`, view: 'content' });
	});

	it('reports no view when the URL does not name one (the workspace shows its first view)', () => {
		expect(viewInPath(`${doc}/en-US`)).to.deep.equal({ base: `${doc}/en-US`, view: null });
		expect(viewInPath(`${doc}/en-US/`)).to.deep.equal({ base: `${doc}/en-US`, view: null });
	});

	it('ignores non-document routes', () => {
		expect(viewInPath('/umbraco/section/settings/workspace/document-type/edit/abc')).to.equal(null);
		expect(viewInPath('/umbraco/section/content')).to.equal(null);
		expect(viewInPath('/umbraco/section/content/workspace/document/create/parent/document/x')).to.equal(null);
	});
});
