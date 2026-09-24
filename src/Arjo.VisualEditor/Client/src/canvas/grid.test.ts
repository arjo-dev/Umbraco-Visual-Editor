import { expect } from '@open-wc/testing';
import type { BlockPlacement } from './markers.js';
import { gridContainersOf, gridDropSpotAt, spanAt } from './grid.js';
import type { CanvasTarget } from './targets.js';

const placement = (index: number, columnSpan: number, area?: { owner: string; key: string }): BlockPlacement => ({
	editorAlias: 'Umbraco.BlockGrid',
	propertyAlias: 'grid',
	propertyCulture: null,
	ownerKey: 'doc',
	ownerIsBlock: false,
	index,
	areaKey: area?.key ?? null,
	areaOwnerKey: area?.owner ?? null,
	columnSpan,
	rowSpan: 1,
	settingsKey: null,
	contentTypeKey: 'row',
	contentTypeAlias: 'row',
	path: area ? [area.owner] : [],
});

/**
 * A 1200px, 12-column grid (like Umbraco's default partials): two 6-column blocks side by side ("a", "b"), then a
 * full-width two-column block ("two") whose left area holds "l1" and whose right area is empty.
 */
function page() {
	const root = document.createElement('div');
	root.style.cssText = 'position: fixed; left: 0; top: 0; width: 1200px';
	const grid = 'display: grid; grid-template-columns: repeat(var(--umb-block-grid--grid-columns), 1fr); gap: 0';
	const item = (key: string, span: number, inner = '') =>
		`<div class="umb-block-grid__layout-item" id="${key}" style="grid-column: span ${span}; min-height: 100px">${inner}</div>`;
	root.innerHTML = `
		<div class="umb-block-grid" data-grid-columns="12" style="--umb-block-grid--grid-columns: 12">
			<div class="umb-block-grid__layout-container" style="${grid}">
				${item('a', 6)}${item('b', 6)}
				${item(
					'two',
					12,
					`<div class="umb-block-grid__area-container" style="display: grid; grid-template-columns: repeat(12, 1fr)">
						<div class="umb-block-grid__area" data-area-alias="left" style="--umb-block-grid--grid-columns: 6; grid-column: span 6">
							<div class="umb-block-grid__layout-container" style="${grid}">${item('l1', 6)}</div>
						</div>
						<div class="umb-block-grid__area" data-area-alias="right" style="--umb-block-grid--grid-columns: 6; grid-column: span 6; min-height: 60px">
							<div class="umb-block-grid__layout-container" style="${grid}; min-height: 60px"></div>
						</div>
					</div>`,
				)}
			</div>
		</div>`;
	document.body.append(root);
	const block = (key: string, p: BlockPlacement): CanvasTarget => ({
		ref: { kind: 'Block', ownerKey: key, ownerIsBlock: true, alias: null, culture: null },
		elements: [root.querySelector(`#${key}`)!],
		editorAlias: null,
		block: p,
	});
	const targets = [
		block('a', placement(0, 6)),
		block('b', placement(1, 6)),
		block('two', placement(2, 12)),
		block('l1', placement(0, 6, { owner: 'two', key: 'left-key' })),
	];
	const get = (key: string) => targets.find((t) => t.ref.ownerKey === key)!;
	const rect = (key: string) => root.querySelector(`#${key}`)!.getBoundingClientRect();
	return { root, targets, containers: gridContainersOf(targets), get, rect };
}

describe('grid containers', () => {
	let p: ReturnType<typeof page>;
	beforeEach(() => (p = page()));
	afterEach(() => p.root.remove());

	it('finds the root and every area, empty ones included', () => {
		expect(
			p.containers.map((c) => ({
				area: c.areaAlias,
				key: c.areaKey,
				columns: c.columns,
				blocks: c.blocks.map((b) => b.ref.ownerKey),
			})),
		).to.deep.equal([
			{ area: null, key: null, columns: 12, blocks: ['a', 'b', 'two'] },
			{ area: 'left', key: 'left-key', columns: 6, blocks: ['l1'] },
			{ area: 'right', key: null, columns: 6, blocks: [] },
		]);
	});

	it('drops before a block when the pointer is on its left half, with a vertical line', () => {
		const b = p.rect('b');
		const spot = gridDropSpotAt(b.left + 20, b.top + 20, p.get('l1'), p.containers, p.targets)!;
		expect(spot.to).to.deep.include({ areaOwnerKey: null, index: 1 });
		expect(spot.line.height).to.equal(b.height);
		expect(spot.line.width).to.equal(3);
	});

	it('drops into an empty area by its alias', () => {
		const right = p.root.querySelector('[data-area-alias="right"]')!.getBoundingClientRect();
		const spot = gridDropSpotAt(right.left + 50, right.top + 20, p.get('a'), p.containers, p.targets)!;
		expect(spot.to).to.deep.equal({
			ownerKey: 'doc',
			propertyAlias: 'grid',
			areaKey: null,
			index: 0,
			areaOwnerKey: 'two',
			areaAlias: 'right',
		});
		expect(spot.line.width).to.equal(right.width);
	});

	it("is nowhere when the block wouldn't move, and never inside the block itself", () => {
		const a = p.rect('a');
		expect(gridDropSpotAt(a.right - 20, a.top + 20, p.get('b'), p.containers, p.targets)).to.equal(null); // just before b
		const right = p.root.querySelector('[data-area-alias="right"]')!.getBoundingClientRect();
		// "two" over its own empty area: not into itself; the root spot there would leave it in place.
		expect(gridDropSpotAt(right.left + 50, right.top + 20, p.get('two'), p.containers, p.targets)).to.equal(null);
	});

	it('works out a resized span in whole columns of the container', () => {
		const a = p.rect('a');
		const root = p.containers[0];
		expect(spanAt(a.left + 400, a, root)).to.equal(4);
		expect(spanAt(a.left + 5000, a, root)).to.equal(12);
		expect(spanAt(a.left - 100, a, root)).to.equal(1);
	});
});
