import { expect } from '@open-wc/testing';
import {
	canMoveBlock,
	duplicateBlock,
	fromClipboard,
	toClipboardValues,
	fitSpan,
	layoutPosition,
	newBlock,
	putBlockInArea,
	withColumnSpan,
	moveBlock,
	moveBlockTo,
	putBlock,
	removeBlock,
	takeBlock,
	type BlockEditorValue,
} from './block-operations.js';

const list = (): BlockEditorValue => ({
	layout: {
		'Umbraco.BlockList': [
			{ contentKey: 'a', settingsKey: 'a-s' },
			{ contentKey: 'b', settingsKey: null },
			{ contentKey: 'c', settingsKey: null },
		],
	},
	contentData: [
		{ key: 'a', contentTypeKey: 't', values: [{ alias: 'title', value: 'A' }] },
		{
			key: 'b',
			contentTypeKey: 't',
			values: [
				{
					alias: 'body',
					value: {
						markup: '<p>x</p><umb-rte-block data-content-key="rte"></umb-rte-block>',
						blocks: {
							layout: { 'Umbraco.RichText': [{ contentKey: 'rte', settingsKey: null }] },
							contentData: [{ key: 'rte', contentTypeKey: 't', values: [] }],
							settingsData: [],
							expose: [{ contentKey: 'rte', culture: null, segment: null }],
						},
					},
				},
			],
		},
		{ key: 'c', contentTypeKey: 't', values: [] },
	],
	settingsData: [{ key: 'a-s', contentTypeKey: 's', values: [] }],
	expose: [
		{ contentKey: 'a', culture: null, segment: null },
		{ contentKey: 'b', culture: null, segment: null },
		{ contentKey: 'c', culture: null, segment: null },
	],
});

const grid = (): BlockEditorValue => ({
	layout: {
		'Umbraco.BlockGrid': [
			{ contentKey: 'row', settingsKey: null, columnSpan: 12, rowSpan: 1, areas: [] },
			{
				contentKey: 'two',
				settingsKey: 'two-s',
				columnSpan: 12,
				rowSpan: 1,
				areas: [
					{
						key: 'left',
						items: [
							{ contentKey: 'l1', settingsKey: null, areas: [] },
							{ contentKey: 'l2', areas: [] },
						],
					},
					{ key: 'right', items: [{ contentKey: 'r1', settingsKey: 'r1-s', areas: [] }] },
				],
			},
		],
	},
	contentData: ['row', 'two', 'l1', 'l2', 'r1'].map((key) => ({ key, contentTypeKey: 't', values: [] })),
	settingsData: [
		{ key: 'two-s', contentTypeKey: 's', values: [] },
		{ key: 'r1-s', contentTypeKey: 's', values: [] },
	],
	expose: ['row', 'two', 'l1', 'l2', 'r1'].map((contentKey) => ({ contentKey, culture: null, segment: null })),
});

const order = (value: BlockEditorValue) => value.layout['Umbraco.BlockList'].map((i) => i.contentKey);

describe('moveBlock', () => {
	it('moves a block up and down among its siblings, not past the ends', () => {
		expect(order(moveBlock(list(), 'b', -1))).to.deep.equal(['b', 'a', 'c']);
		expect(order(moveBlock(list(), 'b', 1))).to.deep.equal(['a', 'c', 'b']);
		expect(canMoveBlock(list(), 'a', -1)).to.equal(false);
		expect(canMoveBlock(list(), 'c', 1)).to.equal(false);
		const value = list();
		expect(moveBlock(value, 'a', -1)).to.equal(value);
	});

	it('moves within a grid area, leaving the rest of the grid alone', () => {
		const value = grid();
		const moved = moveBlock(value, 'l2', -1);
		const two = moved.layout['Umbraco.BlockGrid'][1];
		expect(two.areas![0].items.map((i) => i.contentKey)).to.deep.equal(['l2', 'l1']);
		expect(two.areas![1]).to.equal(value.layout['Umbraco.BlockGrid'][1].areas![1]);
		expect(value.layout['Umbraco.BlockGrid'][1].areas![0].items[0].contentKey).to.equal('l1'); // not mutated
	});
});

describe('removeBlock', () => {
	it('removes the block with its content, settings and expose entries', () => {
		const removed = removeBlock(list(), 'a');
		expect(order(removed)).to.deep.equal(['b', 'c']);
		expect(removed.contentData.map((d) => d.key)).to.deep.equal(['b', 'c']);
		expect(removed.settingsData).to.deep.equal([]);
		expect(removed.expose!.map((e) => e.contentKey)).to.deep.equal(['b', 'c']);
	});

	it('removes a grid block together with the blocks in its areas', () => {
		const removed = removeBlock(grid(), 'two');
		expect(removed.layout['Umbraco.BlockGrid'].map((i) => i.contentKey)).to.deep.equal(['row']);
		expect(removed.contentData.map((d) => d.key)).to.deep.equal(['row']);
		expect(removed.settingsData).to.deep.equal([]);
		expect(removed.expose!.map((e) => e.contentKey)).to.deep.equal(['row']);
	});
});

describe('duplicateBlock', () => {
	let n = 0;
	const newKey = () => `new-${++n}`;
	beforeEach(() => (n = 0));

	it('inserts a copy right after the block, with new keys for it and its settings', () => {
		const result = duplicateBlock(list(), 'a', newKey)!;
		expect(order(result.value)).to.deep.equal(['a', result.contentKey, 'b', 'c']);
		const copy = result.value.layout['Umbraco.BlockList'][1];
		expect(copy.settingsKey).to.not.equal('a-s');
		expect(result.value.contentData.find((d) => d.key === result.contentKey)).to.deep.include({
			contentTypeKey: 't',
			values: [{ alias: 'title', value: 'A' }],
		});
		expect(result.value.settingsData!.map((d) => d.key)).to.deep.equal(['a-s', copy.settingsKey]);
		expect(result.value.expose!.map((e) => e.contentKey)).to.deep.equal(['a', 'b', 'c', result.contentKey]);
	});

	it('gives blocks nested in the copy new keys, including rich text markup references', () => {
		const result = duplicateBlock(list(), 'b', newKey)!;
		const copy = result.value.contentData.find((d) => d.key === result.contentKey)!;
		const body = (copy.values as Array<{ value: { markup: string; blocks: BlockEditorValue } }>)[0].value;
		const nestedKey = body.blocks.contentData[0].key;
		expect(nestedKey).to.not.equal('rte');
		expect(body.blocks.layout['Umbraco.RichText'][0].contentKey).to.equal(nestedKey);
		expect(body.blocks.expose![0].contentKey).to.equal(nestedKey);
		expect(body.markup).to.equal(`<p>x</p><umb-rte-block data-content-key="${nestedKey}"></umb-rte-block>`);
		// The original is untouched.
		expect(JSON.stringify(result.value.contentData.find((d) => d.key === 'b'))).to.contain('"rte"');
	});

	it('copies a grid block with the blocks in its areas', () => {
		const result = duplicateBlock(grid(), 'two', newKey)!;
		const items = result.value.layout['Umbraco.BlockGrid'];
		expect(items.map((i) => i.contentKey)).to.deep.equal(['row', 'two', result.contentKey]);
		const copiedAreaKeys = items[2].areas!.flatMap((a) => a.items.map((i) => i.contentKey));
		expect(copiedAreaKeys).to.have.length(3);
		expect(copiedAreaKeys).to.not.include.members(['l1', 'l2', 'r1']);
		expect(items[2].areas!.map((a) => a.key)).to.deep.equal(['left', 'right']); // area keys are the block type's
		expect(result.value.contentData).to.have.length(9); // 5, plus copies of the block and its 3 area blocks
		expect(result.value.settingsData).to.have.length(4);
	});

	it('is null for a block that is not there', () => {
		expect(duplicateBlock(list(), 'missing', newKey)).to.equal(null);
	});
});

describe('moveBlockTo', () => {
	it('moves a block to a gap in its list, counting gaps before it is taken out', () => {
		expect(order(moveBlockTo(list(), 'a', 3))).to.deep.equal(['b', 'c', 'a']);
		expect(order(moveBlockTo(list(), 'c', 0))).to.deep.equal(['c', 'a', 'b']);
		expect(order(moveBlockTo(list(), 'a', 2))).to.deep.equal(['b', 'a', 'c']);
	});

	it('leaves the value alone when the block would stay where it is', () => {
		const value = list();
		expect(moveBlockTo(value, 'b', 1)).to.equal(value);
		expect(moveBlockTo(value, 'b', 2)).to.equal(value);
	});
});

describe('takeBlock and putBlock', () => {
	it('moves a block with its content, settings and expose entries into another list', () => {
		const { value: without, taken } = takeBlock(list(), 'a')!;
		expect(order(without)).to.deep.equal(['b', 'c']);
		expect(taken.item.contentKey).to.equal('a');
		expect(taken.contentData.map((d) => d.key)).to.deep.equal(['a']);
		expect(taken.settingsData.map((d) => d.key)).to.deep.equal(['a-s']);
		expect(taken.expose.map((e) => e.contentKey)).to.deep.equal(['a']);

		const target: BlockEditorValue = {
			layout: { 'Umbraco.BlockList': [{ contentKey: 'x' }] },
			contentData: [{ key: 'x' }],
			settingsData: [],
			expose: [],
		};
		const into = putBlock(target, 'Umbraco.BlockList', taken, 1);
		expect(into.layout['Umbraco.BlockList'].map((i) => i.contentKey)).to.deep.equal(['x', 'a']);
		expect(into.contentData.map((d) => d.key)).to.deep.equal(['x', 'a']);
		expect(into.settingsData!.map((d) => d.key)).to.deep.equal(['a-s']);
		expect(into.expose!.map((e) => e.contentKey)).to.deep.equal(['a']);
	});

	it('puts into an empty value, clamping the position', () => {
		const { taken } = takeBlock(list(), 'b')!;
		const into = putBlock({ layout: {}, contentData: [] }, 'Umbraco.BlockList', taken, 5);
		expect(into.layout['Umbraco.BlockList'].map((i) => i.contentKey)).to.deep.equal(['b']);
	});
});

describe('grid moves and spans', () => {
	it('finds where a block sits: its layout, and its area', () => {
		expect(layoutPosition(grid(), 'l2')).to.deep.include({
			editorAlias: 'Umbraco.BlockGrid',
			areaOwnerKey: 'two',
			areaKey: 'left',
		});
		expect(layoutPosition(grid(), 'row')).to.deep.include({ areaOwnerKey: null, areaKey: null });
		expect(layoutPosition(grid(), 'missing')).to.equal(null);
	});

	it('puts a block into an area, adding the area when the layout has none for it', () => {
		const { value, taken } = takeBlock(grid(), 'row')!;
		const into = putBlockInArea(value, 'two', 'right', taken, 0);
		const two = into.layout['Umbraco.BlockGrid'][0];
		expect(two.areas!.find((a) => a.key === 'right')!.items.map((i) => i.contentKey)).to.deep.equal(['row', 'r1']);
		expect(into.contentData.map((d) => d.key)).to.include('row');

		const intoNew = putBlockInArea(value, 'two', 'bottom', taken, 3);
		expect(intoNew.layout['Umbraco.BlockGrid'][0].areas!.map((a) => a.key)).to.deep.equal(['left', 'right', 'bottom']);
		expect(intoNew.layout['Umbraco.BlockGrid'][0].areas![2].items.map((i) => i.contentKey)).to.deep.equal(['row']);
	});

	it('sets a column span', () => {
		const value = grid();
		const next = withColumnSpan(value, 'l1', 3);
		expect(next.layout['Umbraco.BlockGrid'][1].areas![0].items[0].columnSpan).to.equal(3);
		expect(withColumnSpan(value, 'row', 12)).to.equal(value);
	});

	it('fits a span to a container: the allowed span nearest to what was asked, that fits', () => {
		expect(fitSpan(6, 12, [12, 6, 4])).to.equal(6);
		expect(fitSpan(12, 6, [12, 6, 4])).to.equal(6);
		expect(fitSpan(5, 12, [12, 6, 4])).to.equal(6); // 4 and 6 are as near: the wider
		expect(fitSpan(9, 12, [])).to.equal(9);
		expect(fitSpan(12, 4, [12, 6])).to.equal(null);
	});
});

describe('newBlock', () => {
	let n = 0;
	const newKey = () => `k${++n}`;
	beforeEach(() => (n = 0));

	it('makes an empty block with settings when its type has them', () => {
		expect(newBlock({ contentTypeKey: 't', settingsTypeKey: 's', exposeCulture: 'en-US', newKey })).to.deep.equal({
			item: { contentKey: 'k1', settingsKey: 'k2' },
			contentData: [{ key: 'k1', contentTypeKey: 't', values: [] }],
			settingsData: [{ key: 'k2', contentTypeKey: 's', values: [] }],
			expose: [{ contentKey: 'k1', culture: 'en-US', segment: null }],
		});
	});

	it('gives a grid block its span, rows and empty areas', () => {
		const block = newBlock({
			contentTypeKey: 't',
			exposeCulture: null,
			grid: { columnSpan: 6, rowSpan: 1, areaKeys: ['l', 'r'] },
			newKey,
		});
		expect(block.item).to.deep.equal({
			contentKey: 'k1',
			settingsKey: null,
			columnSpan: 6,
			rowSpan: 1,
			areas: [
				{ key: 'l', items: [] },
				{ key: 'r', items: [] },
			],
		});
		expect(block.settingsData).to.deep.equal([]);
	});
});

describe('clipboard', () => {
	let n = 0;
	const newKey = () => `c${++n}`;
	beforeEach(() => (n = 0));

	it('copies a list block as a block value, like the standard editor', () => {
		const values = toClipboardValues(takeBlock(list(), 'a')!.taken, false);
		expect(values).to.deep.equal([
			{
				type: 'block',
				value: {
					contentData: [{ key: 'a', contentTypeKey: 't', values: [{ alias: 'title', value: 'A' }] }],
					settingsData: [{ key: 'a-s', contentTypeKey: 's', values: [] }],
					layout: [{ contentKey: 'a', settingsKey: 'a-s' }],
				},
			},
		]);
	});

	it('copies a grid block as a block value and a gridBlock value with its areas', () => {
		const values = toClipboardValues(takeBlock(grid(), 'two')!.taken, true);
		expect(values.map((v) => v.type)).to.deep.equal(['block', 'gridBlock']);
		const block = values[0].value as { contentData: unknown[]; layout: unknown[] };
		expect(block.contentData).to.have.length(1);
		const gridBlock = values[1].value as { contentData: unknown[]; layout: Array<{ areas: unknown[] }> };
		expect(gridBlock.contentData).to.have.length(4);
		expect(gridBlock.layout[0].areas).to.have.length(2);
	});

	it('pastes with new keys throughout, keeping the content', () => {
		const values = toClipboardValues(takeBlock(list(), 'b')!.taken, false);
		const [pasted] = fromClipboard(values, false, newKey);
		expect(pasted.item.contentKey).to.not.equal('b');
		expect(pasted.contentData[0].key).to.equal(pasted.item.contentKey);
		const json = JSON.stringify(pasted);
		expect(json).to.not.contain('"rte"'); // the rich text block inside got a new key too
		expect(json).to.contain('data-content-key');
	});

	it('pastes a grid block into a grid with its areas, and into a list without', () => {
		const values = toClipboardValues(takeBlock(grid(), 'two')!.taken, true);
		const [intoGrid] = fromClipboard(values, true, newKey);
		expect(intoGrid.item.areas).to.have.length(2);
		expect(intoGrid.contentData).to.have.length(4);

		const [intoList] = fromClipboard(values, false, newKey);
		expect(intoList.item).to.have.keys(['contentKey', 'settingsKey']);
		expect(intoList.contentData).to.have.length(1);
	});

	it('pastes a list block into a grid without a span, to be fitted', () => {
		const [pasted] = fromClipboard(toClipboardValues(takeBlock(list(), 'a')!.taken, false), true, newKey);
		expect(pasted.item.columnSpan).to.equal(undefined);
		expect(pasted.item.areas).to.deep.equal([]);
	});

	it('has nothing for entries that are not blocks', () => {
		expect(fromClipboard([{ type: 'text', value: 'x' }], false, newKey)).to.deep.equal([]);
	});
});
