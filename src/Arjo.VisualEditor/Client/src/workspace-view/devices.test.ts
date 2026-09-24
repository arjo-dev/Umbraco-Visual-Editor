import { expect } from '@open-wc/testing';
import { deviceFor, sizeFor, sizeLabel, VISUAL_EDITOR_DEVICES } from './devices.js';

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

	it('labels sizes with their width', () => {
		expect(sizeLabel(sizeFor('desktop', 'desktop-1920'))).to.equal('Standard desktop (1920px)');
		expect(sizeLabel(sizeFor('desktop', 'fill'))).to.equal('Fill available space');
	});

	it('has unique size ids within each device', () => {
		for (const device of VISUAL_EDITOR_DEVICES) {
			const ids = device.sizes.map((s) => s.id);
			expect(new Set(ids).size, device.alias).to.equal(ids.length);
		}
	});

	it('returns desktop for an unknown device', () => {
		expect(deviceFor('watch' as never).alias).to.equal('desktop');
	});
});
