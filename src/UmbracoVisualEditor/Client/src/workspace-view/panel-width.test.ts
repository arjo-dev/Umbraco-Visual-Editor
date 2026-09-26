import { expect } from '@open-wc/testing';
import { clampPanelWidth } from './panel-width.js';

describe('clampPanelWidth', () => {
	it('keeps the panel between its minimum and what leaves the canvas room', () => {
		expect(clampPanelWidth(500, 1400)).to.equal(500);
		expect(clampPanelWidth(100, 1400)).to.equal(280);
		expect(clampPanelWidth(1300, 1400)).to.equal(1080);
	});

	it('never goes below the minimum, even in a narrow view', () => {
		expect(clampPanelWidth(400, 500)).to.equal(280);
	});
});
