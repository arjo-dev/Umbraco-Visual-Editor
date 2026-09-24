import { expect } from '@open-wc/testing';
import { guardNavigation } from './navigation.js';

/** A same-origin frame (so `parent !== window` inside it) with some links and a form. */
async function frame(): Promise<HTMLIFrameElement> {
	const iframe = document.createElement('iframe');
	iframe.srcdoc = `<!doctype html>
		<a id="other" href="/some/other/page/">Other page</a>
		<a id="anchor" href="#section">Jump</a>
		<a id="nested" href="/nested/"><span id="inner">Nested text</span></a>
		<form id="form" action="/search/"><button id="submit">Go</button></form>`;
	const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
	document.body.append(iframe);
	await loaded;
	return iframe;
}

function click(win: Window, id: string, init: MouseEventInit = {}) {
	const event = new (win as typeof window).MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
	win.document.getElementById(id)!.dispatchEvent(event);
	return event;
}

describe('guardNavigation', () => {
	let iframe: HTMLIFrameElement;
	let win: Window;
	let opened: string[];
	let release: () => void;

	beforeEach(async () => {
		iframe = await frame();
		win = iframe.contentWindow!;
		opened = [];
		release = guardNavigation(win, { openInNewTab: (url) => opened.push(url) });
	});

	afterEach(() => {
		release();
		iframe.remove();
	});

	it('stops ordinary link clicks', () => {
		expect(click(win, 'other').defaultPrevented).to.equal(true);
		expect(opened).to.have.length(0);
	});

	it('stops clicks on elements inside links', () => {
		expect(click(win, 'inner').defaultPrevented).to.equal(true);
	});

	it('opens the link in a new tab with Ctrl, Cmd or Shift', () => {
		click(win, 'other', { ctrlKey: true });
		click(win, 'other', { metaKey: true });
		click(win, 'nested', { shiftKey: true });
		expect(opened.map((u) => new URL(u).pathname)).to.deep.equal([
			'/some/other/page/',
			'/some/other/page/',
			'/nested/',
		]);
	});

	it('lets in-page anchor links scroll', () => {
		expect(click(win, 'anchor').defaultPrevented).to.equal(false);
	});

	it('blocks form submission', () => {
		const event = new (win as typeof window).SubmitEvent('submit', { bubbles: true, cancelable: true });
		win.document.getElementById('form')!.dispatchEvent(event);
		expect(event.defaultPrevented).to.equal(true);
	});

	it('releases its listeners', () => {
		release();
		expect(click(win, 'other').defaultPrevented).to.equal(false);
	});

	it('does nothing when the page is not framed', () => {
		const releaseTop = guardNavigation(window, { openInNewTab: (url) => opened.push(url) });
		const link = document.createElement('a');
		link.href = '/somewhere/';
		document.body.append(link);
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		link.addEventListener('click', (e) => e.preventDefault()); // don't actually navigate the test runner
		link.dispatchEvent(event);
		releaseTop();
		link.remove();
		expect(opened).to.have.length(0);
	});
});
