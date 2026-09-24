import { expect } from '@open-wc/testing';
import type { TargetRef } from '../protocol/index.js';
import {
	contentKeyOfSettings,
	locateValue,
	showsValue,
	withBlockPropertyValue,
	type PropertyValueModel,
} from './property-values.js';

const caption = (value: string, key = 'image-row') => ({
	key,
	contentTypeKey: 'image-row-type',
	values: [{ alias: 'caption', culture: null, segment: null, value }],
});

/** A grid whose Two Column block holds a nested Block List with an Image Row. */
const grid = (culture: string | null, text: string) => ({
	alias: 'grid',
	culture,
	segment: null,
	value: {
		layout: {},
		contentData: [
			{
				key: 'two-column',
				contentTypeKey: 'two-column-type',
				values: [{ alias: 'items', culture: null, segment: null, value: { layout: {}, contentData: [caption(text)] } }],
			},
		],
		settingsData: [],
	},
});

const values: PropertyValueModel[] = [
	{ alias: 'title', culture: 'en-US', segment: null, value: 'Hello' },
	{ alias: 'title', culture: 'da-DK', segment: null, value: 'Hej' },
	{ alias: 'subtitle', culture: null, segment: null, value: 'Sub' },
	grid('da-DK', 'Billedtekst'),
	grid('en-US', 'Caption'),
];

const ref = (partial: Partial<TargetRef>): TargetRef => ({
	kind: 'Property',
	ownerKey: 'doc',
	ownerIsBlock: false,
	alias: 'title',
	culture: null,
	...partial,
});

describe('locateValue', () => {
	it('finds a document property by alias and culture', () => {
		expect(locateValue(values, ref({ culture: 'da-DK' }), 'da-DK')?.value).to.equal('Hej');
		expect(locateValue(values, ref({ alias: 'subtitle' }), 'en-US')?.value).to.equal('Sub');
		expect(locateValue(values, ref({ alias: 'missing' }), 'en-US')).to.equal(null);
	});

	it("finds a nested block's property, in the active culture's block editor value first", () => {
		const target = ref({ ownerIsBlock: true, ownerKey: 'image-row', alias: 'caption' });
		const found = locateValue(values, target, 'en-US');
		expect(found?.value).to.equal('Caption');
		expect(found?.property).to.include({ alias: 'grid', culture: 'en-US' });
		expect(found?.block).to.deep.equal({ key: 'image-row', contentTypeKey: 'image-row-type' });
		expect(locateValue(values, target, 'da-DK')?.value).to.equal('Billedtekst');
	});
});

describe('withBlockPropertyValue', () => {
	it('replaces a nested block property, copying only the path to it', () => {
		const before = grid('en-US', 'Caption').value;
		const after = withBlockPropertyValue(before, 'image-row', 'caption', null, 'New') as typeof before;

		expect(after).to.not.equal(before);
		const nested = after.contentData[0].values[0].value as { contentData: ReturnType<typeof caption>[] };
		expect(nested.contentData[0].values[0].value).to.equal('New');
		expect(before.contentData[0].values[0].value.contentData[0].values[0].value).to.equal('Caption');
		expect(after.settingsData).to.equal(before.settingsData);
	});

	it('returns the value itself when the block is not there', () => {
		const before = grid('en-US', 'Caption').value;
		expect(withBlockPropertyValue(before, 'other', 'caption', null, 'New')).to.equal(before);
	});
});

describe('showsValue', () => {
	it('matches text shown as stored, ignoring surrounding whitespace', () => {
		expect(showsValue('\n   Hello  ', 'Hello')).to.equal(true);
		expect(showsValue('Line 1\nLine 2', 'Line 1\r\nLine 2')).to.equal(true);
	});

	it('rejects transformed text', () => {
		expect(showsValue('HELLO', 'Hello')).to.equal(false);
		expect(showsValue('Hello…', 'Hello world')).to.equal(false);
		expect(showsValue('42', 42)).to.equal(false);
	});
});

describe('contentKeyOfSettings', () => {
	it('finds the block a settings key belongs to, in nested grid areas', () => {
		const grid: PropertyValueModel = {
			alias: 'grid',
			culture: null,
			segment: null,
			value: {
				layout: {
					'Umbraco.BlockGrid': [
						{
							contentKey: 'row',
							settingsKey: null,
							areas: [{ key: 'left', items: [{ contentKey: 'nested', settingsKey: 'nested-settings' }] }],
						},
					],
				},
				contentData: [],
				settingsData: [],
			},
		};
		expect(contentKeyOfSettings([grid], 'nested-settings')).to.equal('nested');
		expect(contentKeyOfSettings([grid], 'missing')).to.equal(null);
	});
});
