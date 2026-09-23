/**
 * Handshake + private channel between the backoffice (host) and the canvas runtime inside the iframe.
 *
 * 1. The host picks a random nonce and loads the render URL with it in the fragment (`#uve-nonce=...`; fragments
 *    never reach the server).
 * 2. The canvas posts `hello {nonce, version}` to `window.parent`, retrying until answered.
 * 3. The host accepts it only if it comes from its own iframe (`event.source`), the expected origin, with the right
 *    nonce and protocol version; it then transfers one end of a `MessageChannel` in a `connect` reply.
 * 4. The canvas accepts `connect` only from `window.parent`, the expected origin, with the same nonce.
 * From then on every message goes over the private port and is validated with parseCanvasMessage/parseHostMessage.
 * The site's own scripts share the iframe's window, so they could post to the parent, but they never get the port.
 * Each new page load in the iframe (a re-render) repeats the handshake and replaces the port.
 */
import {
	PROTOCOL_NAME,
	PROTOCOL_VERSION,
	parseCanvasMessage,
	parseHostMessage,
	type CanvasMessage,
	type HostMessage,
} from './messages.js';

const NONCE_PARAM = 'uve-nonce';

interface HandshakeMessage {
	protocol: typeof PROTOCOL_NAME;
	version: number;
	kind: 'hello' | 'connect';
	nonce: string;
}

const handshake = (kind: HandshakeMessage['kind'], nonce: string): HandshakeMessage => ({
	protocol: PROTOCOL_NAME,
	version: PROTOCOL_VERSION,
	kind,
	nonce,
});

function isHandshake(data: unknown, kind: HandshakeMessage['kind'], nonce: string): boolean {
	const m = data as Partial<HandshakeMessage> | null;
	return (
		typeof m === 'object' &&
		m !== null &&
		m.protocol === PROTOCOL_NAME &&
		m.kind === kind &&
		m.nonce === nonce &&
		m.version === PROTOCOL_VERSION
	);
}

/** Random, unguessable nonce for one canvas host. */
export const createNonce = () => crypto.randomUUID();

/** The render URL with the nonce in its fragment. */
export function withNonce(url: string, nonce: string): string {
	const [base] = url.split('#');
	return `${base}#${NONCE_PARAM}=${encodeURIComponent(nonce)}`;
}

/** The nonce from the current page's fragment, if the host provided one. */
export function readNonce(loc: Pick<Location, 'hash'> = location): string | null {
	return new URLSearchParams(loc.hash.replace(/^#/, '')).get(NONCE_PARAM);
}

// ---- host side ----

export interface HostChannelOptions {
	iframe: HTMLIFrameElement;
	nonce: string;
	/** Origin the canvas is served from. Render sessions are same-origin, so this defaults to ours. */
	origin?: string;
	onMessage: (message: CanvasMessage) => void;
	/** Called on each (re)connection: resend any state the canvas should have (selection, device, readonly). */
	onConnect?: () => void;
	/** A message arrived on the port but wasn't a known, well-formed canvas message. */
	onInvalid?: (data: unknown) => void;
}

export interface HostChannel {
	readonly connected: boolean;
	/** Returns false (and drops the message) while no canvas is connected. */
	send(message: HostMessage): boolean;
	close(): void;
}

export function createHostChannel(options: HostChannelOptions): HostChannel {
	const origin = options.origin ?? location.origin;
	let port: MessagePort | null = null;

	const onWindowMessage = (event: MessageEvent) => {
		const canvasWindow = options.iframe.contentWindow;
		if (!canvasWindow || event.source !== canvasWindow || event.origin !== origin) return;
		if (!isHandshake(event.data, 'hello', options.nonce)) return;

		// A new page in the iframe: replace any previous connection.
		port?.close();
		const channel = new MessageChannel();
		port = channel.port1;
		port.onmessage = (e) => {
			const message = parseCanvasMessage(e.data);
			if (message) options.onMessage(message);
			else options.onInvalid?.(e.data);
		};
		canvasWindow.postMessage(handshake('connect', options.nonce), origin, [channel.port2]);
		options.onConnect?.();
	};

	window.addEventListener('message', onWindowMessage);

	return {
		get connected() {
			return port !== null;
		},
		send(message) {
			if (!port) return false;
			port.postMessage(message);
			return true;
		},
		close() {
			window.removeEventListener('message', onWindowMessage);
			port?.close();
			port = null;
		},
	};
}

// ---- canvas side ----

export interface CanvasChannelOptions {
	nonce: string;
	/** Origin of the backoffice. Defaults to ours (render sessions are same-origin). */
	hostOrigin?: string;
	onMessage: (message: HostMessage) => void;
	onInvalid?: (data: unknown) => void;
	/** Give up after this long without a `connect` reply. */
	timeoutMs?: number;
	/** How often to repeat `hello` until the host answers. */
	retryMs?: number;
}

export interface CanvasChannel {
	send(message: CanvasMessage): void;
	close(): void;
}

export function connectToHost(options: CanvasChannelOptions): Promise<CanvasChannel> {
	const hostOrigin = options.hostOrigin ?? location.origin;
	const { timeoutMs = 5000, retryMs = 250 } = options;

	return new Promise((resolve, reject) => {
		if (window.parent === window) {
			reject(new Error('Not inside a frame'));
			return;
		}

		const sayHello = () => window.parent.postMessage(handshake('hello', options.nonce), hostOrigin);
		const retry = setInterval(sayHello, retryMs);
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('No response from the visual editor host'));
		}, timeoutMs);

		const onWindowMessage = (event: MessageEvent) => {
			if (event.source !== window.parent || event.origin !== hostOrigin) return;
			if (!isHandshake(event.data, 'connect', options.nonce) || !event.ports[0]) return;

			cleanup();
			const port = event.ports[0];
			port.onmessage = (e) => {
				const message = parseHostMessage(e.data);
				if (message) options.onMessage(message);
				else options.onInvalid?.(e.data);
			};
			resolve({
				send: (message) => port.postMessage(message),
				close: () => port.close(),
			});
		};

		function cleanup() {
			clearInterval(retry);
			clearTimeout(timeout);
			window.removeEventListener('message', onWindowMessage);
		}

		window.addEventListener('message', onWindowMessage);
		sayHello();
	});
}
