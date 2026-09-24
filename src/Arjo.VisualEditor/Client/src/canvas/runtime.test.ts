import { expect } from '@open-wc/testing';
import type { CanvasMessage } from '../protocol/index.js';
import { createRuntime, handleHostMessage, type CanvasRuntime } from './runtime.js';

// Invisible marker text (Stega.cs), built from code points so none end up in this file.
const DIGITS = [0x200b, 0x200c, 0x200d, 0x2060].map((c) => String.fromCharCode(c));
const DELIMITER = String.fromCharCode(0x2063);
const stega = (id: number) => DELIMITER + [...id.toString(4)].map((d) => DIGITS[Number(d)]).join('') + DELIMITER;

const manifest = {
	documentKey: 'doc',
	culture: 'en-US',
	markers: [
		{
			id: 1,
			kind: 'Property',
			ownerKey: 'doc',
			ownerIsBlock: false,
			alias: 'title',
			culture: 'en-US',
			editorAlias: 'Umbraco.TextBox',
			label: 'Title',
		},
		{
			id: 2,
			kind: 'Block',
			ownerKey: 'outer',
			ownerIsBlock: true,
			alias: null,
			culture: null,
			editorAlias: null,
			label: 'Two Column',
		},
		{
			id: 3,
			kind: 'Block',
			ownerKey: 'inner',
			ownerIsBlock: true,
			alias: null,
			culture: null,
			editorAlias: null,
			label: 'Image Row',
		},
		{
			id: 4,
			kind: 'Property',
			ownerKey: 'inner',
			ownerIsBlock: true,
			alias: 'caption',
			culture: null,
			editorAlias: 'Umbraco.TextBox',
			label: 'Caption',
			ownerLabel: 'Image Row',
		},
	],
};

/** A render-session-like page in a same-origin frame: manifest, a marked title and a nested block with a caption. */
async function page(): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
	const frame = document.createElement('iframe');
	frame.style.cssText = 'width: 800px; height: 600px';
	frame.srcdoc = `<!doctype html><body style="margin:0">
		<h1 id="title" style="margin:40px 0 0">${stega(1)}Hello</h1>
		<!--uve:b:2--><div id="outer" style="padding:20px"><!--uve:b:3--><div id="inner" style="padding:20px">
			<p id="caption">${stega(4)}A caption</p>
		</div><!--/uve:b:3--></div><!--/uve:b:2-->
		<p id="plain">Not editable</p>
		<script type="application/json" id="uve-markers">${JSON.stringify(manifest)}</script>
	</body>`;
	const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
	document.body.append(frame);
	await loaded;
	return { frame, doc: frame.contentDocument! };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

function click(doc: Document, id: string) {
	const win = doc.defaultView as typeof window;
	doc.getElementById(id)!.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

function pointerOver(doc: Document, id: string) {
	const win = doc.defaultView as typeof window;
	doc.getElementById(id)!.dispatchEvent(new win.PointerEvent('pointerover', { bubbles: true }));
}

function selectionLabel(runtime: CanvasRuntime) {
	const label = runtime.overlay.host.shadowRoot!.querySelector('.box.selected .label');
	return {
		crumbs: [...(label?.querySelectorAll('.crumb') ?? [])].map((c) => c.textContent),
		name: label?.querySelector('span')?.textContent ?? null,
	};
}

describe('canvas runtime', () => {
	let frame: HTMLIFrameElement;
	let doc: Document;
	let runtime: CanvasRuntime;
	let sent: CanvasMessage[];

	beforeEach(async () => {
		({ frame, doc } = await page());
		sent = [];
		runtime = createRuntime(doc, { send: (m) => sent.push(m) })!;
	});

	afterEach(() => {
		runtime.destroy();
		frame.remove();
	});

	const lastSelect = () => [...sent].reverse().find((m) => m.type === 'select');

	it('announces its targets, with display labels', () => {
		const ready = sent.find((m) => m.type === 'ready');
		expect(ready && ready.type === 'ready' && ready.targets.map((t) => t.label)).to.have.members([
			'Title',
			'Two Column',
			'Image Row',
			'Caption',
		]);
	});

	it('selects the innermost target: a property rather than the block around it', () => {
		click(doc, 'caption');
		const msg = lastSelect();
		expect(msg?.type === 'select' && msg.target).to.include({ alias: 'caption', ownerKey: 'inner', label: 'Caption' });
	});

	it('selects the block when clicking the block outside its properties', () => {
		click(doc, 'inner');
		const msg = lastSelect();
		expect(msg?.type === 'select' && msg.target).to.include({ kind: 'Block', ownerKey: 'inner' });
	});

	it('shows a breadcrumb of parent blocks and selects a parent from it', () => {
		click(doc, 'caption');
		expect(selectionLabel(runtime)).to.deep.equal({ crumbs: ['Two Column', 'Image Row'], name: 'Caption' });

		(runtime.overlay.host.shadowRoot!.querySelector('.crumb') as HTMLButtonElement).click();
		const msg = lastSelect();
		expect(msg?.type === 'select' && msg.target?.ownerKey).to.equal('outer');
		expect(selectionLabel(runtime)).to.deep.equal({ crumbs: [], name: 'Two Column' });
	});

	it('Escape selects the parent, then clears', () => {
		const win = doc.defaultView as typeof window;
		const escape = () => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
		click(doc, 'caption');

		escape();
		let msg = lastSelect();
		expect(msg?.type === 'select' && msg.target).to.include({ kind: 'Block', ownerKey: 'inner' });
		escape();
		msg = lastSelect();
		expect(msg?.type === 'select' && msg.target).to.include({ kind: 'Block', ownerKey: 'outer' });
		escape();
		msg = lastSelect();
		expect(msg?.type === 'select' && msg.target).to.equal(null);
	});

	it('ignores clicks outside any target', () => {
		click(doc, 'plain');
		expect(lastSelect()).to.equal(undefined);
	});

	it('reports hover changes once each', () => {
		pointerOver(doc, 'title');
		pointerOver(doc, 'title');
		pointerOver(doc, 'caption');
		expect(sent.filter((m) => m.type === 'hover').map((m) => m.type === 'hover' && m.target?.alias)).to.deep.equal([
			'title',
			'caption',
		]);
	});

	it("shows the host's selection without echoing it back", () => {
		handleHostMessage(runtime, { type: 'setSelection', target: runtime.index.targets[0].ref });
		expect(lastSelect()).to.equal(undefined);
		expect(selectionLabel(runtime).name).to.equal('Title');
	});

	it('is inert while read-only', () => {
		handleHostMessage(runtime, { type: 'setReadonly', readonly: true });
		click(doc, 'caption');
		pointerOver(doc, 'caption');
		expect(sent.filter((m) => m.type === 'select' || m.type === 'hover')).to.have.length(0);
	});

	it('draws the selection box over the element', async () => {
		click(doc, 'title');
		await nextFrame();
		const box = runtime.overlay.host.shadowRoot!.querySelector<HTMLElement>('.box.selected')!;
		const rect = doc.getElementById('title')!.getBoundingClientRect();
		expect(Math.round(parseFloat(box.style.top))).to.equal(Math.round(rect.top));
		expect(Math.round(parseFloat(box.style.width))).to.equal(Math.round(rect.width));
	});

	it('keeps the overlay out of the page: its own element, in the top layer', () => {
		expect(runtime.overlay.host.shadowRoot).to.not.equal(null);
		expect(runtime.overlay.host.matches(':popover-open')).to.equal(true);
	});
});
