import { expect } from '@open-wc/testing';
import { isRenderUrl } from './patch.js';

describe('isRenderUrl', () => {
	const base = 'https://site.test/__visual-editor/render/abc#uve-nonce=1';

	it('accepts render-session pages of the same site', () => {
		expect(isRenderUrl('/__visual-editor/render/def', base)).to.equal(true);
		expect(isRenderUrl('https://site.test/__visual-editor/render/def', base)).to.equal(true);
	});

	it('refuses other pages and other sites', () => {
		expect(isRenderUrl('/umbraco/management/api/v1/user/current', base)).to.equal(false);
		expect(isRenderUrl('https://evil.test/__visual-editor/render/def', base)).to.equal(false);
		expect(isRenderUrl('javascript:alert(1)', base)).to.equal(false);
	});
});
