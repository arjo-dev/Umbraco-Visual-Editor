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

/** A render-session-like page: manifest, a marked title and a nested block with a caption. */
const pageHtml = ({
	title = 'Hello',
	caption = 'A caption',
	after = '',
} = {}) => `<!doctype html><body style="margin:0">
		<h1 id="title" style="margin:40px 0 0">${stega(1)}${title}</h1>
		<!--uve:b:2--><div id="outer" style="padding:20px"><!--uve:b:3--><div id="inner" style="padding:20px">
			<p id="caption">${stega(4)}${caption}</p>
		</div><!--/uve:b:3--></div><!--/uve:b:2-->
		<p id="plain">Not editable</p>
		<input id="field">
		<div style="height:2000px"></div>
		${after}
		<script type="application/json" id="uve-markers">${JSON.stringify(manifest)}</script>
	</body>`;

/** The page in a same-origin frame. */
async function page(): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
	const frame = document.createElement('iframe');
	frame.style.cssText = 'width: 800px; height: 600px';
	frame.srcdoc = pageHtml();
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

	describe('live re-render', () => {
		const realFetch = window.fetch;
		/** Render URL -> [html, delay ms]; anything else is a 404. */
		let responses: Record<string, [string, number?]>;

		beforeEach(() => {
			responses = {};
			window.fetch = (async (input: RequestInfo | URL) => {
				const entry = responses[String(input)];
				if (entry?.[1]) await new Promise((resolve) => setTimeout(resolve, entry[1]));
				return entry
					? new Response(entry[0], { headers: { 'content-type': 'text/html; charset=utf-8' } })
					: new Response('Not found', { status: 404 });
			}) as typeof fetch;
		});

		afterEach(() => {
			window.fetch = realFetch;
		});

		const rendered = () => sent.filter((m) => m.type === 'rendered');

		it('patches the new render into the page instead of replacing it', async () => {
			const outer = doc.getElementById('outer');
			responses['/r/2'] = [pageHtml({ title: 'Hello again' })];

			expect(await runtime.render('/r/2')).to.equal(true);

			expect(doc.getElementById('title')!.textContent).to.equal('Hello again');
			expect(doc.getElementById('outer')).to.equal(outer); // the same element, updated in place
			expect(rendered()).to.deep.equal([{ type: 'rendered', url: '/r/2', ok: true }]);
			expect(sent.filter((m) => m.type === 'ready')).to.have.length(2);
		});

		it('re-resolves markers: new text is selectable and has no marker characters left', async () => {
			responses['/r/2'] = [pageHtml({ caption: 'New caption' })];
			await runtime.render('/r/2');

			expect(doc.getElementById('caption')!.textContent).to.equal('New caption');
			click(doc, 'caption');
			const msg = lastSelect();
			expect(msg?.type === 'select' && msg.target).to.include({ alias: 'caption', ownerKey: 'inner' });
		});

		it('keeps the selection, scroll position, focus and overlay', async () => {
			click(doc, 'caption');
			sent = [];
			doc.getElementById('field')!.focus({ preventScroll: true });
			doc.defaultView!.scrollTo(0, 300);
			responses['/r/2'] = [pageHtml({ caption: 'Changed' })];

			await runtime.render('/r/2');

			expect(selectionLabel(runtime).name).to.equal('Caption');
			expect(runtime.overlay.host.isConnected).to.equal(true);
			expect(runtime.overlay.host.matches(':popover-open')).to.equal(true);
			expect(doc.defaultView!.scrollY).to.equal(300);
			expect(doc.activeElement?.id).to.equal('field');
			expect(lastSelect()).to.equal(undefined); // kept, not re-reported
		});

		it('clears the selection when the selected block is gone', async () => {
			click(doc, 'inner');
			responses['/r/2'] = [pageHtml().replace(/<!--uve:b:3-->[\s\S]*<!--\/uve:b:3-->/, '')];

			await runtime.render('/r/2');

			expect(doc.getElementById('inner')).to.equal(null);
			expect(runtime.overlay.host.shadowRoot!.querySelector('.box.selected')).to.equal(null);
		});

		it("answers not ok, leaving the page as it is, when the render didn't produce markers", async () => {
			responses['/r/2'] = ['<!doctype html><body><h1>Error</h1></body>'];

			expect(await runtime.render('/r/2')).to.equal(false);
			expect(await runtime.render('/r/missing')).to.equal(false);

			expect(doc.getElementById('title')!.textContent).to.equal('Hello');
			expect(rendered()).to.deep.equal([
				{ type: 'rendered', url: '/r/2', ok: false },
				{ type: 'rendered', url: '/r/missing', ok: false },
			]);
		});

		it('drops a render that a newer one overtook', async () => {
			responses['/r/slow'] = [pageHtml({ title: 'Stale' }), 50];
			responses['/r/fast'] = [pageHtml({ title: 'Latest' })];

			const slow = runtime.render('/r/slow');
			const fast = runtime.render('/r/fast');

			expect(await Promise.all([slow, fast])).to.deep.equal([false, true]);
			expect(doc.getElementById('title')!.textContent).to.equal('Latest');
			expect(rendered()).to.deep.equal([{ type: 'rendered', url: '/r/fast', ok: true }]);
		});

		it('handles the render message from the host', async () => {
			responses['/r/2'] = [pageHtml({ title: 'Via message' })];
			handleHostMessage(runtime, { type: 'render', url: '/r/2' });
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(doc.getElementById('title')!.textContent).to.equal('Via message');
		});
	});

	describe('inline editing', () => {
		const titleRef = () => runtime.index.targets.find((t) => t.ref.alias === 'title')!.ref;
		const title = () => doc.getElementById('title')!;
		const ofType = <T extends CanvasMessage['type']>(type: T) =>
			sent.filter((m): m is Extract<CanvasMessage, { type: T }> => m.type === type);
		const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

		function doubleClick(id: string) {
			const win = doc.defaultView as typeof window;
			doc.getElementById(id)!.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
		}

		function type(text: string) {
			const win = doc.defaultView as typeof window;
			title().textContent = text;
			title().dispatchEvent(new win.InputEvent('input', { bubbles: true }));
		}

		function key(name: string) {
			const win = doc.defaultView as typeof window;
			title().dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
		}

		function begin(maxLength: number | null = 512, multiline = false) {
			doubleClick('title');
			handleHostMessage(runtime, { type: 'beginInlineEdit', target: titleRef(), maxLength, multiline });
		}

		it('asks the host on double-click, with the text the element shows', () => {
			doubleClick('title');
			expect(ofType('inlineEditStart')).to.deep.equal([{ type: 'inlineEditStart', target: titleRef(), text: 'Hello' }]);
		});

		it("doesn't ask for blocks", () => {
			doubleClick('inner');
			expect(ofType('inlineEditStart')).to.have.length(0);
		});

		it('asks on Enter when a text property is selected', () => {
			click(doc, 'caption');
			const win = doc.defaultView as typeof window;
			doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }));
			expect(ofType('inlineEditStart').map((m) => m.target.alias)).to.deep.equal(['caption']);
		});

		it('edits in place after the go-ahead, sending changes and committing on blur', async () => {
			begin();
			expect(title().getAttribute('contenteditable')).to.equal('plaintext-only');
			expect(doc.activeElement).to.equal(title());

			type('Hello world');
			await wait(200);
			expect(ofType('inlineEdit').map((m) => m.value)).to.deep.equal(['Hello world']);

			type('Hello there');
			title().blur();
			expect(ofType('inlineEdit').map((m) => m.value)).to.deep.equal(['Hello world', 'Hello there']);
			expect(ofType('inlineEditEnd')).to.deep.equal([{ type: 'inlineEditEnd', target: titleRef(), cancelled: false }]);
			expect(title().hasAttribute('contenteditable')).to.equal(false);
		});

		it('Escape cancels: puts the text back, without selecting the parent', () => {
			begin();
			sent = [];
			type('Oops');
			key('Escape');
			expect(title().textContent).to.equal('Hello');
			expect(ofType('inlineEditEnd')).to.deep.equal([{ type: 'inlineEditEnd', target: titleRef(), cancelled: true }]);
			expect(ofType('inlineEdit')).to.have.length(0);
			expect(lastSelect()).to.equal(undefined);
		});

		it('keeps single-line text on one line, within the max length; Enter commits', () => {
			begin(8, false);
			type('Line one\nand two');
			expect(title().textContent).to.equal('Line one');
			key('Enter');
			expect(ofType('inlineEdit').map((m) => m.value)).to.deep.equal(['Line one']);
			expect(ofType('inlineEditEnd')).to.have.length(1);
		});

		it('lets the host know when it no longer wants a go-ahead', () => {
			handleHostMessage(runtime, { type: 'beginInlineEdit', target: titleRef(), maxLength: null, multiline: false });
			expect(ofType('inlineEditEnd')).to.have.length(1);
			expect(title().hasAttribute('contenteditable')).to.equal(false);
		});

		it('holds back a re-render until editing ends', async () => {
			const realFetch = window.fetch;
			window.fetch = (async () =>
				new Response(pageHtml({ title: 'From server' }), { headers: { 'content-type': 'text/html' } })) as typeof fetch;
			try {
				begin();
				type('Typing');
				expect(await runtime.render('/r/2')).to.equal(false);
				expect(title().textContent).to.equal('Typing');

				title().blur();
				await wait(20);
				expect(title().textContent).to.equal('From server');
				expect(ofType('rendered')).to.deep.equal([{ type: 'rendered', url: '/r/2', ok: true }]);
			} finally {
				window.fetch = realFetch;
			}
		});
	});

	describe('validation errors', () => {
		const ref = (alias: string | null, ownerKey: string) =>
			runtime.index.targets.find((t) => t.ref.alias === alias && t.ref.ownerKey === ownerKey)!.ref;
		const errorBoxes = () => [...runtime.overlay.host.shadowRoot!.querySelectorAll<HTMLElement>('.box.error')];

		it('marks each invalid target with an outline and a badge, joining its messages', () => {
			handleHostMessage(runtime, {
				type: 'setErrors',
				errors: [
					{ target: ref('caption', 'inner'), message: 'Required' },
					{ target: ref('caption', 'inner'), message: 'Too long' },
					{ target: ref(null, 'inner'), message: 'Required' },
				],
			});
			const boxes = errorBoxes();
			expect(boxes.map((b) => b.className)).to.have.members(['box error property', 'box error block']);
			expect(
				boxes
					.find((b) => b.classList.contains('property'))!
					.querySelector('.badge')!
					.getAttribute('title'),
			).to.equal('Required\nToo long');
		});

		it('ignores errors for targets that are not on the page, and clears', () => {
			const missing = {
				kind: 'Property' as const,
				ownerKey: 'doc',
				ownerIsBlock: false,
				alias: 'metaTitle',
				culture: null,
			};
			handleHostMessage(runtime, { type: 'setErrors', errors: [{ target: missing, message: 'Required' }] });
			expect(errorBoxes()).to.have.length(0);
			handleHostMessage(runtime, { type: 'setErrors', errors: [{ target: ref('title', 'doc'), message: 'Required' }] });
			expect(errorBoxes()).to.have.length(1);
			handleHostMessage(runtime, { type: 'setErrors', errors: [] });
			expect(errorBoxes()).to.have.length(0);
		});

		it('keeps marking errors after a live re-render', async () => {
			const realFetch = window.fetch;
			window.fetch = (async () =>
				new Response(pageHtml({ caption: 'Changed' }), { headers: { 'content-type': 'text/html' } })) as typeof fetch;
			try {
				handleHostMessage(runtime, {
					type: 'setErrors',
					errors: [{ target: ref('caption', 'inner'), message: 'Required' }],
				});
				await runtime.render('/r/2');
				expect(errorBoxes()).to.have.length(1);
			} finally {
				window.fetch = realFetch;
			}
		});

		it('scrolls a revealed selection into view', () => {
			const caption = doc.getElementById('caption')!;
			let revealed = false;
			caption.scrollIntoView = () => {
				revealed = true;
			};
			handleHostMessage(runtime, { type: 'setSelection', target: ref('caption', 'inner'), reveal: true });
			expect(revealed).to.equal(true);
			expect(selectionLabel(runtime).name).to.equal('Caption');
		});
	});
});
