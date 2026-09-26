import { expect } from '@open-wc/testing';
import { isEnabledFor } from './availability.js';

const settings = (overrides = {}) => ({
	enabled: true,
	allowedDocumentTypes: [] as Array<string>,
	excludedDocumentTypes: [] as Array<string>,
	...overrides,
});

describe('isEnabledFor', () => {
	it('offers every document type by default', () => {
		expect(isEnabledFor(settings(), 'home')).to.equal(true);
	});

	it('offers none when disabled', () => {
		expect(isEnabledFor(settings({ enabled: false }), 'home')).to.equal(false);
	});

	it('limits to the allowed types, ignoring case', () => {
		const allowed = settings({ allowedDocumentTypes: ['contentPage'] });
		expect(isEnabledFor(allowed, 'ContentPage')).to.equal(true);
		expect(isEnabledFor(allowed, 'article')).to.equal(false);
	});

	it('leaves out the excluded types', () => {
		const excluded = settings({ excludedDocumentTypes: ['Error'] });
		expect(isEnabledFor(excluded, 'error')).to.equal(false);
		expect(isEnabledFor(excluded, 'home')).to.equal(true);
	});
});
