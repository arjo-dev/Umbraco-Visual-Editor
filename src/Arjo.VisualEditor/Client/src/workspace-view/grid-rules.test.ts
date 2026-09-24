import { expect } from '@open-wc/testing';
import { areaOf, checkGridDrop, gridConfigOf, type GridConfig } from './grid-rules.js';

// Like the Playground's grid: rich text and image rows go anywhere; the two-column block only at the root, with a
// left area (any block) and a right area for images only, holding at most one.
const config: GridConfig = gridConfigOf([
	{
		alias: 'blocks',
		value: [
			{
				contentElementTypeKey: 'text',
				allowAtRoot: true,
				allowInAreas: true,
				columnSpanOptions: [{ columnSpan: 12 }, { columnSpan: 6 }],
			},
			{
				contentElementTypeKey: 'image',
				groupKey: 'media',
				allowAtRoot: true,
				allowInAreas: true,
				columnSpanOptions: [],
			},
			{
				contentElementTypeKey: 'two',
				allowAtRoot: true,
				allowInAreas: false,
				columnSpanOptions: [{ columnSpan: 12 }],
				areas: [
					{ key: 'left-key', alias: 'left', columnSpan: 6, specifiedAllowance: [] },
					{
						key: 'right-key',
						alias: 'right',
						columnSpan: 6,
						maxAllowed: 1,
						specifiedAllowance: [{ groupKey: 'media' }],
					},
				],
			},
			{ contentElementTypeKey: 'banner', allowAtRoot: false, allowInAreas: true },
		],
	},
	{ alias: 'gridColumns', value: 12 },
	{ alias: 'validationLimit', value: { min: null, max: 5 } },
]);

describe('grid rules', () => {
	const left = areaOf(config, 'two', null, 'left');
	const right = areaOf(config, 'two', 'right-key');

	it('finds areas by key or alias', () => {
		expect(left?.key).to.equal('left-key');
		expect(right?.alias).to.equal('right');
		expect(areaOf(config, 'text', null, 'left')).to.equal(null);
	});

	it('lets a block into an area, narrowing it to fit', () => {
		expect(checkGridDrop(config, 'text', 12, left, 0)).to.deep.equal({ ok: true, columnSpan: 6 });
		expect(checkGridDrop(config, 'image', 12, left, 3)).to.deep.equal({ ok: true, columnSpan: 6 });
	});

	it('keeps to the allowed types of the root and of each area', () => {
		expect(checkGridDrop(config, 'two', 12, left, 0)).to.include({ ok: false }); // not allowed in areas
		expect(checkGridDrop(config, 'text', 6, right, 0)).to.include({ ok: false }); // right: media only
		expect(checkGridDrop(config, 'image', 6, right, 0)).to.deep.equal({ ok: true, columnSpan: 6 });
		expect(checkGridDrop(config, 'banner', 12, null, 0)).to.include({ ok: false }); // areas only
		expect(checkGridDrop(config, 'other', 12, null, 0)).to.include({ ok: false }); // not in this grid
	});

	it('keeps to the maximums of an area and of the grid', () => {
		expect(checkGridDrop(config, 'image', 6, right, 1)).to.include({ ok: false });
		expect(checkGridDrop(config, 'text', 12, null, 5)).to.include({ ok: false });
		expect(checkGridDrop(config, 'text', 12, null, 4)).to.deep.equal({ ok: true, columnSpan: 12 });
	});

	it('refuses a block that has no allowed span narrow enough', () => {
		expect(checkGridDrop(config, 'two', 12, null, 0)).to.deep.equal({ ok: true, columnSpan: 12 });
		const narrow: GridConfig = { ...config, gridColumns: 6 };
		expect(checkGridDrop(narrow, 'two', 12, null, 0)).to.include({ ok: false });
	});
});
