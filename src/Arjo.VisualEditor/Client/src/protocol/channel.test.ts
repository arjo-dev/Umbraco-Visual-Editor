import { expect } from '@open-wc/testing';
import { createHostChannel, createNonce, readNonce, withNonce, type HostChannel } from './channel.js';
import type { CanvasMessage } from './messages.js';

/**
 * A same-origin iframe running `body` as a module, with the real canvas-side channel code imported as `channel`,
 * the nonce it should use as `nonce` and the host origin as `hostOrigin`. (Inside a srcdoc frame `location.origin`
 * is "null", so the canvas can't default to it here; real render URLs are normal same-origin pages.)
 */
function canvasFrame(nonce: string, body: string): HTMLIFrameElement {
	const iframe = document.createElement('iframe');
	iframe.srcdoc = `<!doctype html><script type="module">
		import * as channel from '/src/protocol/channel.ts';
		const nonce = ${JSON.stringify(nonce)};
		const hostOrigin = ${JSON.stringify(location.origin)};
		${body}
	</script>`;
	document.body.append(iframe);
	return iframe;
}

/** Canvas script: connect, announce itself, and answer every host message with a scroll message. */
const echoCanvas = `
	const ch = await channel.connectToHost({
		nonce,
		hostOrigin,
		timeoutMs: 2000,
		onMessage: (m) => ch.send({ type: 'scroll', x: m.type === 'setDevice' ? m.width : -1, y: 0 }),
		onInvalid: () => ch.send({ type: 'scroll', x: -99, y: 0 }),
	});
	ch.send({ type: 'ready', documentKey: 'doc-1', culture: null, targets: [] });
`;

function nextMessage(messages: CanvasMessage[], timeoutMs = 1500): Promise<CanvasMessage> {
	const start = messages.length;
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const poll = () => {
			if (messages.length > start) resolve(messages[start]);
			else if (Date.now() > deadline) reject(new Error('timed out waiting for a canvas message'));
			else setTimeout(poll, 10);
		};
		poll();
	});
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('channel handshake', () => {
	let host: HostChannel | undefined;
	let frames: HTMLIFrameElement[] = [];

	afterEach(() => {
		host?.close();
		host = undefined;
		frames.forEach((f) => f.remove());
		frames = [];
	});

	it('connects and exchanges validated messages both ways', async () => {
		const nonce = createNonce();
		const messages: CanvasMessage[] = [];
		const iframe = canvasFrame(nonce, echoCanvas);
		frames.push(iframe);
		let connects = 0;
		host = createHostChannel({ iframe, nonce, onMessage: (m) => messages.push(m), onConnect: () => connects++ });

		const ready = await nextMessage(messages);
		expect(ready).to.deep.equal({ type: 'ready', documentKey: 'doc-1', culture: null, targets: [] });
		expect(host.connected).to.equal(true);
		expect(connects).to.equal(1);

		expect(host.send({ type: 'setDevice', width: 375 })).to.equal(true);
		expect(await nextMessage(messages)).to.deep.equal({ type: 'scroll', x: 375, y: 0 });
	});

	it('ignores a canvas with the wrong nonce', async () => {
		const messages: CanvasMessage[] = [];
		const iframe = canvasFrame('not-the-nonce', echoCanvas);
		frames.push(iframe);
		host = createHostChannel({ iframe, nonce: createNonce(), onMessage: (m) => messages.push(m) });

		await delay(600);
		expect(host.connected).to.equal(false);
		expect(messages).to.have.length(0);
		expect(host.send({ type: 'setReadonly', readonly: true })).to.equal(false);
	});

	it('ignores a hello from a different frame, even with the right nonce', async () => {
		const nonce = createNonce();
		const messages: CanvasMessage[] = [];
		// The host's own iframe stays silent; another frame on the page tries to connect in its place.
		const ownFrame = canvasFrame(nonce, '');
		const intruder = canvasFrame(nonce, echoCanvas);
		frames.push(ownFrame, intruder);
		host = createHostChannel({ iframe: ownFrame, nonce, onMessage: (m) => messages.push(m) });

		await delay(600);
		expect(host.connected).to.equal(false);
		expect(messages).to.have.length(0);
	});

	it('ignores a hello from the wrong origin', async () => {
		const nonce = createNonce();
		const iframe = canvasFrame(nonce, echoCanvas);
		frames.push(iframe);
		host = createHostChannel({ iframe, nonce, origin: 'https://example.com', onMessage: () => {} });

		await delay(600);
		expect(host.connected).to.equal(false);
	});

	it('reports unknown message types instead of delivering them', async () => {
		const nonce = createNonce();
		const messages: CanvasMessage[] = [];
		const invalid: unknown[] = [];
		const iframe = canvasFrame(
			nonce,
			`const ch = await channel.connectToHost({ nonce, hostOrigin, onMessage: () => {} });
			 ch.send({ type: 'navigate', url: 'https://evil.example' });
			 ch.send({ type: 'hover', target: null });`,
		);
		frames.push(iframe);
		host = createHostChannel({
			iframe,
			nonce,
			onMessage: (m) => messages.push(m),
			onInvalid: (d) => invalid.push(d),
		});

		expect(await nextMessage(messages)).to.deep.equal({ type: 'hover', target: null });
		expect(invalid).to.deep.equal([{ type: 'navigate', url: 'https://evil.example' }]);
	});

	it('the canvas drops unknown host messages', async () => {
		const nonce = createNonce();
		const messages: CanvasMessage[] = [];
		const iframe = canvasFrame(nonce, echoCanvas);
		frames.push(iframe);
		host = createHostChannel({ iframe, nonce, onMessage: (m) => messages.push(m) });
		await nextMessage(messages); // ready

		// Bypass the typed send() to put a bogus message on the wire.
		(host.send as (m: unknown) => boolean)({ type: 'eval', code: 'alert(1)' });
		expect(await nextMessage(messages)).to.deep.equal({ type: 'scroll', x: -99, y: 0 });
	});

	it('reconnects when the iframe loads a new page (a re-render)', async () => {
		const nonce = createNonce();
		const messages: CanvasMessage[] = [];
		const iframe = canvasFrame(nonce, echoCanvas);
		frames.push(iframe);
		let connects = 0;
		host = createHostChannel({ iframe, nonce, onMessage: (m) => messages.push(m), onConnect: () => connects++ });
		await nextMessage(messages);

		iframe.srcdoc = iframe.srcdoc + ' '; // new document in the same iframe
		expect(await nextMessage(messages)).to.have.property('type', 'ready');
		expect(connects).to.equal(2);
	});

	it('connectToHost rejects when not inside a frame', async () => {
		const { connectToHost } = await import('./channel.js');
		let error: unknown;
		try {
			await connectToHost({ nonce: 'x', onMessage: () => {} });
		} catch (e) {
			error = e;
		}
		expect(String(error)).to.contain('Not inside a frame');
	});
});

describe('nonce in the URL fragment', () => {
	it('round-trips through withNonce/readNonce', () => {
		const url = withNonce('/__visual-editor/render/abc', 'n-1');
		expect(url).to.equal('/__visual-editor/render/abc#uve-nonce=n-1');
		expect(readNonce({ hash: '#uve-nonce=n-1' })).to.equal('n-1');
	});

	it('replaces an existing fragment', () => {
		expect(withNonce('/page#top', 'n-2')).to.equal('/page#uve-nonce=n-2');
	});

	it('returns null without a nonce', () => {
		expect(readNonce({ hash: '' })).to.equal(null);
	});
});
