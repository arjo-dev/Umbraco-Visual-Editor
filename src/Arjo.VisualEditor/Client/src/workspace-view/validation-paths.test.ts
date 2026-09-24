import { expect } from '@open-wc/testing';
import { inCulture, parseValidationPath, targetsOf } from './validation-paths.js';

const docProp = "$.values[?(@.alias == 'title' && @.culture == 'en-US' && @.segment == null)].value";
const blockProp =
	"$.values[?(@.alias == 'grid' && @.culture == null && @.segment == null)].value" +
	".contentData[?(@.key == 'two-column')].values[?(@.alias == 'items' && @.culture == null && @.segment == null)].value" +
	".contentData[?(@.key == 'image-row')].values[?(@.alias == 'caption' && @.culture == null && @.segment == null)].value";
const blockSettings =
	"$.values[?(@.alias == 'grid' && @.culture == null && @.segment == null)].value" +
	".settingsData[?(@.key == 'row-settings')].values[?(@.alias == 'background' && @.culture == null && @.segment == null)].value";
const name = "$.variants[?(@.culture == 'da-DK' && @.segment == null)].name";

describe('parseValidationPath', () => {
	it('reads a document property', () => {
		expect(parseValidationPath(docProp)).to.deep.equal({
			documentProperty: { alias: 'title', culture: 'en-US' },
			blockKeys: [],
			blockProperty: null,
			inSettings: false,
			variantName: null,
		});
	});

	it('reads a property of a nested block, with the blocks it is inside', () => {
		const parsed = parseValidationPath(blockProp)!;
		expect(parsed.documentProperty).to.deep.equal({ alias: 'grid', culture: null });
		expect(parsed.blockKeys).to.deep.equal(['two-column', 'image-row']);
		expect(parsed.blockProperty).to.deep.equal({ alias: 'caption', culture: null });
	});

	it('reads a variant name', () => {
		expect(parseValidationPath(name)?.variantName).to.deep.equal({ culture: 'da-DK' });
	});

	it("returns null for paths it doesn't understand", () => {
		expect(parseValidationPath('$.values[0].value')).to.equal(null);
		expect(parseValidationPath('title')).to.equal(null);
	});
});

describe('targetsOf', () => {
	it('marks a document property', () => {
		expect(targetsOf(parseValidationPath(docProp)!, 'doc')).to.deep.equal({
			target: { kind: 'Property', ownerKey: 'doc', ownerIsBlock: false, alias: 'title', culture: 'en-US' },
			blocks: [],
		});
	});

	it('marks a block property and every block around it', () => {
		const { target, blocks } = targetsOf(parseValidationPath(blockProp)!, 'doc');
		expect(target).to.deep.equal({
			kind: 'Property',
			ownerKey: 'image-row',
			ownerIsBlock: true,
			alias: 'caption',
			culture: null,
		});
		expect(blocks.map((b) => b.ownerKey)).to.deep.equal(['two-column', 'image-row']);
		expect(blocks[0]).to.include({ kind: 'Block', alias: null });
	});

	it('marks the block itself for a settings error', () => {
		expect(targetsOf(parseValidationPath(blockSettings)!, 'doc').target).to.include({
			kind: 'Block',
			ownerKey: 'row-settings',
		});
	});

	it('has no page target for the document name', () => {
		expect(targetsOf(parseValidationPath(name)!, 'doc').target).to.equal(null);
	});
});

describe('inCulture', () => {
	it('keeps the edited culture and invariant values', () => {
		expect(inCulture(parseValidationPath(docProp)!, 'en-US')).to.equal(true);
		expect(inCulture(parseValidationPath(docProp)!, 'da-DK')).to.equal(false);
		expect(inCulture(parseValidationPath(blockProp)!, 'da-DK')).to.equal(true);
		expect(inCulture(parseValidationPath(name)!, 'en-US')).to.equal(false);
	});
});
