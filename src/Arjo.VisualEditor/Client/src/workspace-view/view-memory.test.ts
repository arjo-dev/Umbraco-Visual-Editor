import { expect } from '@open-wc/testing';
import { recallView, rememberView } from './view-memory.js';

describe('view memory', () => {
	const view = { request: '{}', url: '/__visual-editor/render/abc', selected: null, scrollY: 420 };

	it('remembers per document and culture', () => {
		rememberView('doc-a', 'en-US', view);
		expect(recallView('doc-a', 'en-US')).to.include({ url: view.url, scrollY: 420, reusable: true });
		expect(recallView('doc-a', 'da-DK')).to.equal(null);
		expect(recallView('doc-b', 'en-US')).to.equal(null);
	});

	it("doesn't reuse a render session that may have expired", () => {
		rememberView('doc-c', null, view);
		expect(recallView('doc-c', null, Date.now() + 6 * 60 * 1000)).to.include({ scrollY: 420, reusable: false });
	});
});
