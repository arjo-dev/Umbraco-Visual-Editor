import { expect } from '@open-wc/testing';
import { GAP, placeToolbars } from './toolbar-position.js';

const layer = { width: 1000, height: 800 };
const toolbar = { width: 400, height: 40 };

describe('placeToolbars', () => {
	it('puts the toolbar just above the element, left-aligned', () => {
		const placed = placeToolbars({ left: 100, top: 300, width: 600, height: 200 }, layer, toolbar, null);
		expect(placed).to.deep.equal({ toolbar: { left: 100, top: 300 - 40 - GAP }, statusbar: null, visible: true });
	});

	it('sticks to the top of the canvas while the element is scrolled partly out of view', () => {
		expect(placeToolbars({ left: 100, top: -150, width: 600, height: 400 }, layer, toolbar, null).toolbar.top).to.equal(
			GAP,
		);
	});

	it("doesn't go past the element's bottom", () => {
		expect(placeToolbars({ left: 100, top: -150, width: 600, height: 180 }, layer, toolbar, null).toolbar.top).to.equal(
			30 - 40,
		);
	});

	it('stays inside the canvas horizontally', () => {
		expect(placeToolbars({ left: 800, top: 300, width: 150, height: 50 }, layer, toolbar, null).toolbar.left).to.equal(
			600,
		);
		expect(placeToolbars({ left: -20, top: 300, width: 150, height: 50 }, layer, toolbar, null).toolbar.left).to.equal(
			0,
		);
	});

	it('puts the statusbar just below the element, right-aligned', () => {
		const placed = placeToolbars({ left: 100, top: 300, width: 600, height: 200 }, layer, toolbar, {
			width: 150,
			height: 24,
		});
		expect(placed.statusbar).to.deep.equal({ left: 550, top: 500 + GAP });
	});

	it('is hidden when the element is out of view', () => {
		expect(placeToolbars({ left: 0, top: -300, width: 600, height: 200 }, layer, toolbar, null).visible).to.equal(
			false,
		);
		expect(placeToolbars({ left: 0, top: 900, width: 600, height: 200 }, layer, toolbar, null).visible).to.equal(false);
	});
});
