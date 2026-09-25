import { expect } from '@open-wc/testing';
import { format } from './strings.js';
import { historyAction, parseCanvasMessage, parseHostMessage, sameTarget, type TargetRef } from './messages.js';

const title: TargetRef = { kind: 'Property', ownerKey: 'doc-1', ownerIsBlock: false, alias: 'title', culture: 'en-US' };
const block: TargetRef = { kind: 'Block', ownerKey: 'block-1', ownerIsBlock: true, alias: null, culture: null };
const position = { ownerKey: 'doc-1', propertyAlias: 'grid', areaKey: null, index: 0 };

describe('parseCanvasMessage', () => {
	const valid = [
		{ type: 'ready', documentKey: 'doc-1', culture: null, targets: [title, block] },
		{ type: 'rendered', url: '/__visual-editor/render/abc', ok: true },
		{ type: 'hover', target: title },
		{ type: 'hover', target: null },
		{ type: 'select', target: block },
		{ type: 'inlineEditStart', target: title, text: 'Old title' },
		{ type: 'richTextEditStart', target: title, mountId: 'rte-1' },
		{ type: 'inlineEdit', target: title, value: 'New title' },
		{ type: 'inlineEditEnd', target: title, cancelled: false },
		{ type: 'blockAction', blockKey: 'block-1', action: 'duplicate' },
		{ type: 'blockMove', blockKey: 'b', to: { ...position, areaKey: null, areaOwnerKey: 'row', areaAlias: 'left' } },
		{ type: 'blockResize', blockKey: 'block-1', columnSpan: 6 },
		{ type: 'blockMove', blockKey: 'block-1', to: { ...position, areaKey: 'area-1', index: 2 } },
		{ type: 'blockInsertRequest', at: position },
		{ type: 'scroll', x: 0, y: 120.5 },
		{ type: 'history', action: 'undo' },
		{ type: 'history', action: 'redo' },
		{ type: 'openEditor', target: title },
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
		['history with another action', { type: 'history', action: 'save' }],
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
		['rendered without ok', { type: 'rendered', url: '/__visual-editor/render/abc' }],
		['inlineEditEnd without cancelled', { type: 'inlineEditEnd', target: title }],
		['blockResize with a zero span', { type: 'blockResize', blockKey: 'b', columnSpan: 0 }],
		['blockMove with a numeric area alias', { type: 'blockMove', blockKey: 'b', to: { ...position, areaAlias: 3 } }],
		['blockAction with an unknown action', { type: 'blockAction', blockKey: 'b', action: 'explode' }],
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
		{ type: 'setSelection', target: title, reveal: true },
		{ type: 'setErrors', errors: [{ target: title, message: 'Required' }] },
		{ type: 'setErrors', errors: [] },
		{ type: 'setReadonly', readonly: false },
		{ type: 'richTextEditing', target: title, active: true },
		{ type: 'beginInlineEdit', target: title, maxLength: 512, multiline: false },
		{ type: 'beginInlineEdit', target: title, maxLength: null, multiline: true },
		{ type: 'setDevice', width: 375 },
		{ type: 'setDevice', width: null },
		{ type: 'setStrings', strings: { delete: 'Slet' } },
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
		['setStrings with a non-string', { type: 'setStrings', strings: { delete: 1 } }],
		[
			'beginInlineEdit with a zero maxLength',
			{ type: 'beginInlineEdit', target: title, maxLength: 0, multiline: false },
		],
		['setErrors with a malformed target', { type: 'setErrors', errors: [{ target: { kind: 'Page' }, message: 'x' }] }],
		['setErrors without messages', { type: 'setErrors', errors: [{ target: title }] }],
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

describe('TargetRef labels', () => {
	it('accepts optional display labels', () => {
		const labelled = { ...title, label: 'Title' };
		expect(parseCanvasMessage({ type: 'select', target: labelled })).to.deep.equal({
			type: 'select',
			target: labelled,
		});
		const inBlock = { ...block, kind: 'Property', alias: 'caption', label: 'Caption', ownerLabel: 'Image Row' };
		expect(parseCanvasMessage({ type: 'hover', target: inBlock })).to.not.equal(null);
	});

	it('rejects non-string labels', () => {
		expect(parseCanvasMessage({ type: 'select', target: { ...title, label: 42 } })).to.equal(null);
		expect(parseCanvasMessage({ type: 'select', target: { ...title, ownerLabel: {} } })).to.equal(null);
	});

	it('ignores labels when comparing targets', () => {
		expect(sameTarget(title, { ...title, label: 'Title' })).to.equal(true);
	});
});

describe('sameTarget', () => {
	it('matches equal refs', () => expect(sameTarget(title, { ...title })).to.equal(true));
	it('matches null with null', () => expect(sameTarget(null, null)).to.equal(true));
	it('differs by culture', () => expect(sameTarget(title, { ...title, culture: 'da-DK' })).to.equal(false));
	it('differs from null', () => expect(sameTarget(title, null)).to.equal(false));
});

describe('historyAction', () => {
	const keys = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
		key,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...mods,
	});

	it('reads Ctrl+Z and ⌘Z as undo', () => {
		expect(historyAction(keys('z', { ctrlKey: true }))).to.equal('undo');
		expect(historyAction(keys('z', { metaKey: true }))).to.equal('undo');
	});

	it('reads Ctrl+Shift+Z and Ctrl+Y as redo', () => {
		expect(historyAction(keys('Z', { ctrlKey: true, shiftKey: true }))).to.equal('redo');
		expect(historyAction(keys('y', { ctrlKey: true }))).to.equal('redo');
	});

	it('ignores other keys', () => {
		expect(historyAction(keys('z'))).to.equal(null);
		expect(historyAction(keys('z', { ctrlKey: true, altKey: true }))).to.equal(null);
		expect(historyAction(keys('s', { ctrlKey: true }))).to.equal(null);
	});
});

describe('format', () => {
	it('fills in numbered arguments and leaves missing ones', () => {
		expect(format('The {0} area allows at most {1} blocks, {2}', 'left', 3)).to.equal(
			'The left area allows at most 3 blocks, {2}',
		);
	});
});
