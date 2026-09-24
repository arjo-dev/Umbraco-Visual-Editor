import { expect } from '@open-wc/testing';
import type { BlockPlacement } from './markers.js';
import { blockListsOf, dropSpotAt } from './drag.js';
import type { CanvasTarget } from './targets.js';

const placement = (ownerKey: string, propertyAlias: string, index: number, path: string[] = []): BlockPlacement => ({
	editorAlias: 'Umbraco.BlockList',
	propertyAlias,
	propertyCulture: null,
	ownerKey,
	ownerIsBlock: ownerKey !== 'doc',
	index,
	areaKey: null,
	areaOwnerKey: null,
	columnSpan: null,
	rowSpan: null,
	settingsKey: null,
	contentTypeKey: 'row',
	contentTypeAlias: 'row',
	path,
});

/**
 * Three 100px blocks in the document's list at y = 0, 100, 200 (x 0–400). The middle one holds a nested list with two
 * 30px blocks at y = 120 and 150 (x 20–380).
 */
function page() {
	const root = document.createElement('div');
	root.style.cssText = 'position: fixed; left: 0; top: 0; width: 400px';
	root.innerHTML = `
		<div id="a" style="height: 100px"></div>
		<div id="b" style="height: 100px; padding: 20px; box-sizing: border-box">
			<div id="b1" style="height: 30px"></div>
			<div id="b2" style="height: 30px"></div>
		</div>
		<div id="c" style="height: 100px"></div>`;
	document.body.append(root);
	const el = (id: string) => root.querySelector(`#${id}`)!;
	const block = (key: string, block: BlockPlacement): CanvasTarget => ({
		ref: { kind: 'Block', ownerKey: key, ownerIsBlock: true, alias: null, culture: null },
		elements: [el(key)],
		editorAlias: null,
		block,
	});
	const targets = [
		block('a', placement('doc', 'blocks', 0)),
		block('b', placement('doc', 'blocks', 1)),
		block('c', placement('doc', 'blocks', 2)),
		block('b1', placement('b', 'items', 0, ['b'])),
		block('b2', placement('b', 'items', 1, ['b'])),
	];
	return {
		root,
		targets,
		lists: blockListsOf(targets),
		get: (key: string) => targets.find((t) => t.ref.ownerKey === key)!,
	};
}

describe('drop spots', () => {
	let p: ReturnType<typeof page>;
	beforeEach(() => (p = page()));
	afterEach(() => p.root.remove());

	it('groups placed Block List blocks into lists, in order', () => {
		expect(
			p.lists.map((l) => `${l.ownerKey}/${l.propertyAlias}: ${l.blocks.map((b) => b.ref.ownerKey).join(',')}`),
		).to.deep.equal(['doc/blocks: a,b,c', 'b/items: b1,b2']);
	});

	it('drops before the first block whose middle is below the pointer', () => {
		const spot = dropSpotAt(200, 20, p.get('c'), p.lists, p.targets)!;
		expect(spot.to.propertyAlias).to.equal('blocks');
		expect(spot.to.index).to.equal(0);
		expect(spot.line).to.deep.equal({ left: 0, top: -5.5, width: 400, height: 3 });

		const between = dropSpotAt(200, 80, p.get('c'), p.lists, p.targets)!;
		expect(between.to.index).to.equal(1);
		expect(between.line.top).to.equal(98.5);
	});

	it('drops at the end below the last block', () => {
		const spot = dropSpotAt(200, 290, p.get('a'), p.lists, p.targets)!;
		expect(spot.to.index).to.equal(3);
		expect(spot.line.top).to.equal(302.5);
	});

	it("is nowhere when the block wouldn't move", () => {
		expect(dropSpotAt(200, 80, p.get('b'), p.lists, p.targets)).to.equal(null); // just above itself
		expect(dropSpotAt(200, 220, p.get('b'), p.lists, p.targets)).to.equal(null); // just below itself
		expect(dropSpotAt(600, 20, p.get('c'), p.lists, p.targets)).to.equal(null); // outside every list
	});

	it('uses the innermost list under the pointer', () => {
		const spot = dropSpotAt(200, 125, p.get('a'), p.lists, p.targets)!;
		expect(spot.to.propertyAlias).to.equal('items');
		expect(spot.to.index).to.equal(0);
	});

	it("doesn't drop a block into a list inside itself", () => {
		const spot = dropSpotAt(200, 125, p.get('b'), p.lists, p.targets);
		// Over its own nested list: that list is off limits, and the outer spot would leave it where it is.
		expect(spot).to.equal(null);
	});
});
