import { expect } from '@open-wc/testing';
import { resolveMarkers, type MarkerManifest } from './markers.js';

const block = (id: number, ownerKey: string) => ({
	id,
	kind: 'Block' as const,
	ownerKey,
	ownerIsBlock: true,
	alias: null,
	culture: null,
	editorAlias: 'Umbraco.BlockList',
});

const manifest: MarkerManifest = { documentKey: 'doc', culture: null, markers: [block(1, 'full'), block(2, 'empty')] };

function documentWith(body: string) {
	const doc = document.implementation.createHTMLDocument();
	doc.body.innerHTML = body;
	return doc;
}

describe('resolveMarkers', () => {
	it('gives a block the elements between its comments', () => {
		const doc = documentWith('<!--uve:b:1--><section id="a"></section><p id="b"></p><!--/uve:b:1-->');
		const [target] = resolveMarkers(manifest, doc);
		expect(target.elements.map((e) => e.id)).to.deep.equal(['a', 'b']);
	});

	it('puts a stand-in where a block rendered nothing, so it can still be selected (a new Block List item)', () => {
		const doc = documentWith('<div class="umb-block-list"><!--uve:b:2-->\n  <!--/uve:b:2--></div>');
		const [target] = resolveMarkers(manifest, doc);
		expect(target.marker.ownerKey).to.equal('empty');
		expect(target.elements).to.have.length(1);
		expect(target.elements[0].hasAttribute('data-uve-empty-block')).to.equal(true);
		expect(target.elements[0].parentElement?.className).to.equal('umb-block-list');
	});
});
