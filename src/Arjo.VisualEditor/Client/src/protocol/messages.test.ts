import { expect } from '@open-wc/testing';
import { parseCanvasMessage, parseHostMessage, sameTarget, type TargetRef } from './messages.js';

const title: TargetRef = { kind: 'Property', ownerKey: 'doc-1', ownerIsBlock: false, alias: 'title', culture: 'en-US' };
const block: TargetRef = { kind: 'Block', ownerKey: 'block-1', ownerIsBlock: true, alias: null, culture: null };
const position = { ownerKey: 'doc-1', propertyAlias: 'grid', areaKey: null, index: 0 };

describe('parseCanvasMessage', () => {
	const valid = [
		{ type: 'ready', documentKey: 'doc-1', culture: null, targets: [title, block] },
		{ type: 'hover', target: title },
		{ type: 'hover', target: null },
		{ type: 'select', target: block },
		{ type: 'inlineEdit', target: title, value: 'New title' },
		{ type: 'blockMove', blockKey: 'block-1', to: { ...position, areaKey: 'area-1', index: 2 } },
		{ type: 'blockInsertRequest', at: position },
		{ type: 'scroll', x: 0, y: 120.5 },
	];

	for (const message of valid) {
		it(`accepts ${message.type}`, () => {
			expect(parseCanvasMessage(message)).to.equal(message);
		});
	}

	const invalid: Array<[string, unknown]> = [
		['null', null],
		['a string', 'ready'],
		['an array', [{ type: 'hover', target: null }]],
		['no type', { target: null }],
		['an unknown type', { type: 'navigate', url: '/' }],
		['a host message', { type: 'setReadonly', readonly: true }],
		['a prototype key as type', { type: 'toString' }],
		['ready without targets', { type: 'ready', documentKey: 'doc-1', culture: null }],
		[
			'ready with a malformed target',
			{ type: 'ready', documentKey: 'doc-1', culture: null, targets: [{ kind: 'Page' }] },
		],
		['hover with a bad target kind', { type: 'hover', target: { ...title, kind: 'Page' } }],
		['inlineEdit with a non-string value', { type: 'inlineEdit', target: title, value: 42 }],
		['inlineEdit without a target', { type: 'inlineEdit', target: null, value: 'x' }],
		['blockMove with a negative index', { type: 'blockMove', blockKey: 'b', to: { ...position, index: -1 } }],
		['blockMove with a fractional index', { type: 'blockMove', blockKey: 'b', to: { ...position, index: 1.5 } }],
		['scroll with NaN', { type: 'scroll', x: Number.NaN, y: 0 }],
	];

	for (const [name, data] of invalid) {
		it(`rejects ${name}`, () => {
			expect(parseCanvasMessage(data)).to.equal(null);
		});
	}
});

describe('parseHostMessage', () => {
	const valid = [
		{ type: 'render', url: '/__visual-editor/render/abc' },
		{ type: 'highlight', target: null },
		{ type: 'setSelection', target: title },
		{ type: 'setReadonly', readonly: false },
		{ type: 'setDevice', width: 375 },
		{ type: 'setDevice', width: null },
	];

	for (const message of valid) {
		it(`accepts ${message.type}`, () => {
			expect(parseHostMessage(message)).to.equal(message);
		});
	}

	const invalid: Array<[string, unknown]> = [
		['an unknown type', { type: 'eval', code: 'alert(1)' }],
		['a canvas message', { type: 'select', target: null }],
		['render without a url', { type: 'render' }],
		['setReadonly with a string', { type: 'setReadonly', readonly: 'true' }],
		['setDevice with zero width', { type: 'setDevice', width: 0 }],
		['setDevice with a string width', { type: 'setDevice', width: '375px' }],
	];

	for (const [name, data] of invalid) {
		it(`rejects ${name}`, () => {
			expect(parseHostMessage(data)).to.equal(null);
		});
	}
});

describe('sameTarget', () => {
	it('matches equal refs', () => expect(sameTarget(title, { ...title })).to.equal(true));
	it('matches null with null', () => expect(sameTarget(null, null)).to.equal(true));
	it('differs by culture', () => expect(sameTarget(title, { ...title, culture: 'da-DK' })).to.equal(false));
	it('differs from null', () => expect(sameTarget(title, null)).to.equal(false));
});
