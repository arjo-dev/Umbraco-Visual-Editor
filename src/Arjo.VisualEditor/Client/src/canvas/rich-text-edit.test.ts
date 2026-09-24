import { expect } from '@open-wc/testing';
import type { CanvasMessage, TargetRef } from '../protocol/index.js';
import { MOUNT_ATTRIBUTE, RichTextEditState, richTextMount } from './rich-text-edit.js';
import type { CanvasTarget } from './targets.js';

const ref: TargetRef = { kind: 'Property', ownerKey: 'doc', ownerIsBlock: false, alias: 'body', culture: null };

function richText(html: string): { host: HTMLElement; target: CanvasTarget } {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.append(host);
	const region = host.querySelector('[data-region]') ?? host;
	return {
		host,
		target: { ref, elements: [...region.querySelectorAll(':scope > .rt')], editorAlias: 'Umbraco.RichText' },
	};
}

describe('richTextMount', () => {
	afterEach(() => document.querySelectorAll('body > div').forEach((el) => el.remove()));

	it("uses the site's own element when it holds only the rich text", () => {
		const { host, target } = richText(
			'<div class="richtext" data-region> <!--uve:p:6--><p class="rt">One</p><p class="rt">Two</p><!--/uve:p:6--> </div>',
		);
		expect(richTextMount(target)).to.equal(host.querySelector('.richtext'));
	});

	it('wraps the rich text when its element holds other things too', () => {
		const { host, target } = richText(
			'<div data-region><h2>Heading</h2><!--uve:p:6--><p class="rt">One</p> and <p class="rt">Two</p><!--/uve:p:6--><footer>F</footer></div>',
		);
		const mount = richTextMount(target)!;
		expect(mount.hasAttribute('data-uve-rte-wrapper')).to.equal(true);
		expect(mount.innerHTML).to.equal('<p class="rt">One</p> and <p class="rt">Two</p>');
		expect([...host.querySelector('[data-region]')!.children].map((c) => c.tagName)).to.deep.equal([
			'H2',
			'DIV',
			'FOOTER',
		]);
	});

	it('is null for anything but rich text', () => {
		const { target } = richText('<div data-region><p class="rt">x</p></div>');
		expect(richTextMount({ ...target, editorAlias: 'Umbraco.TextBox' })).to.equal(null);
		expect(richTextMount({ ...target, elements: [] })).to.equal(null);
	});
});

describe('RichTextEditState', () => {
	it('asks the host with a marked mount element, then follows what the host says', () => {
		const { host, target } = richText('<div class="richtext" data-region><p class="rt">One</p></div>');
		const sent: CanvasMessage[] = [];
		let ended = 0;
		const state = new RichTextEditState(
			(m) => sent.push(m),
			() => ended++,
		);

		expect(state.request(target)).to.equal(true);
		const mount = host.querySelector('.richtext')!;
		const id = mount.getAttribute(MOUNT_ATTRIBUTE);
		expect(sent).to.deep.equal([{ type: 'richTextEditStart', target: ref, mountId: id }]);
		expect(state.element).to.equal(null); // not until the host starts

		state.setActive(ref, true);
		expect(state.element).to.equal(mount);
		expect(state.request(target)).to.equal(false); // one at a time

		state.setActive(ref, false);
		expect(state.element).to.equal(null);
		expect(mount.hasAttribute(MOUNT_ATTRIBUTE)).to.equal(false);
		expect(ended).to.equal(1);
		host.remove();
	});
});
