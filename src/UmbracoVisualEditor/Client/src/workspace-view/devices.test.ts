import { expect } from '@open-wc/testing';
import { deviceFor, fitScale, sizeFor, sizeLabel, VISUAL_EDITOR_DEVICES } from './devices.js';

describe('devices', () => {
	it('defaults each device to its first size', () => {
		expect(sizeFor('desktop', undefined).width).to.equal(null);
		expect(sizeFor('tablet', undefined).width).to.equal(768);
		expect(sizeFor('mobile', undefined).id).to.equal('iphone-16');
	});

	it('finds a chosen size', () => {
		expect(sizeFor('desktop', 'macbook-pro-14').width).to.equal(1512);
	});

	it('falls back to the default for a size from another device or a removed one', () => {
		// e.g. a size remembered in localStorage that no longer exists
		expect(sizeFor('mobile', 'macbook-pro-14').id).to.equal('iphone-16');
		expect(sizeFor('desktop', 'no-such-size').id).to.equal('fill');
	});

	it('labels sizes with their dimensions', () => {
		expect(sizeLabel(sizeFor('desktop', 'desktop-1920'))).to.equal('Standard desktop (1920 × 1080)');
		expect(sizeLabel(sizeFor('desktop', 'fill'))).to.equal('Fill available space');
	});

	it('has unique size ids within each device', () => {
		for (const device of VISUAL_EDITOR_DEVICES) {
			const ids = device.sizes.map((s) => s.id);
			expect(new Set(ids).size, device.alias).to.equal(ids.length);
		}
	});

	it('gives every fixed size both a width and a height', () => {
		for (const size of VISUAL_EDITOR_DEVICES.flatMap((d) => d.sizes)) {
			expect(size.width === null, size.id).to.equal(size.height === null);
		}
	});

	it('returns desktop for an unknown device', () => {
		expect(deviceFor('watch' as never).alias).to.equal('desktop');
	});
});

describe('fitScale', () => {
	const desktop = { width: 1920, height: 1080 };

	it('does not scale when the size fits', () => {
		expect(fitScale(desktop, 2000, 1200)).to.equal(1);
	});

	it('never enlarges', () => {
		expect(fitScale({ width: 375, height: 667 }, 3000, 3000)).to.equal(1);
	});

	it('is limited by whichever dimension is tighter', () => {
		expect(fitScale(desktop, 960, 1080)).to.equal(0.5); // width-bound
		expect(fitScale(desktop, 1920, 270)).to.equal(0.25); // height-bound
	});

	it('does not scale sizes that fill the space', () => {
		expect(fitScale({ width: null, height: null }, 500, 500)).to.equal(1);
	});

	it('does not scale before the canvas has any size', () => {
		expect(fitScale(desktop, 0, 0)).to.equal(1);
	});
});
