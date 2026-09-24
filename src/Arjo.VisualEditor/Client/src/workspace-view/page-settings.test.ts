import { expect } from '@open-wc/testing';
import { pageSettings, type ContainerModel, type PropertyModel } from './page-settings.js';

const containers: ContainerModel[] = [
	{ id: 'content-tab', parent: null, name: 'Content', type: 'Tab', sortOrder: 0 },
	{ id: 'seo-tab', parent: null, name: 'SEO', type: 'Tab', sortOrder: 10 },
	{ id: 'hero', parent: { id: 'content-tab' }, name: 'Hero', type: 'Group', sortOrder: 1 },
	{ id: 'meta', parent: { id: 'seo-tab' }, name: 'Meta', type: 'Group', sortOrder: 0 },
	// A composition's own "SEO" tab and "Meta" group: merged with the ones above by name.
	{ id: 'seo-tab-2', parent: null, name: 'SEO', type: 'Tab', sortOrder: 10 },
	{ id: 'meta-2', parent: { id: 'seo-tab-2' }, name: 'Meta', type: 'Group', sortOrder: 0 },
	{ id: 'nav', parent: { id: 'seo-tab-2' }, name: 'Navigation', type: 'Group', sortOrder: 5 },
	{ id: 'settings', parent: null, name: 'Settings', type: 'Group', sortOrder: 0 },
];

const properties: PropertyModel[] = [
	{ alias: 'title', sortOrder: 0, container: { id: 'hero' } },
	{ alias: 'subtitle', sortOrder: 1, container: { id: 'hero' } },
	{ alias: 'metaDescription', sortOrder: 1, container: { id: 'meta' } },
	{ alias: 'metaTitle', sortOrder: 0, container: { id: 'meta-2' } },
	{ alias: 'umbracoNaviHide', sortOrder: 0, container: { id: 'nav' } },
	{ alias: 'onTab', sortOrder: 0, container: { id: 'content-tab' } },
	{ alias: 'theme', sortOrder: 0, container: { id: 'settings' } },
];

describe('pageSettings', () => {
	it("lists the properties the page doesn't show, by tab then group, in sort order, merging compositions", () => {
		const result = pageSettings(containers, properties, new Set(['title']));
		expect(result).to.deep.equal([
			{ name: null, groups: [{ name: 'Settings', aliases: ['theme'] }] },
			{
				name: 'Content',
				groups: [
					{ name: null, aliases: ['onTab'] },
					{ name: 'Hero', aliases: ['subtitle'] },
				],
			},
			{
				name: 'SEO',
				groups: [
					{ name: 'Meta', aliases: ['metaTitle', 'metaDescription'] },
					{ name: 'Navigation', aliases: ['umbracoNaviHide'] },
				],
			},
		]);
	});

	it('leaves out tabs and groups whose properties are all on the page', () => {
		const visible = new Set(['title', 'subtitle', 'onTab', 'theme']);
		expect(pageSettings(containers, properties, visible).map((t) => t.name)).to.deep.equal(['SEO']);
	});

	it('is empty when everything is on the page', () => {
		expect(pageSettings(containers, properties, new Set(properties.map((p) => p.alias)))).to.deep.equal([]);
	});
});
