/**
 * Prototype canvas client, injected into render-session pages (spikes #10/#12): resolves markers, outlines what was
 * found, and, when the page is inside the visual editor (a nonce in the URL fragment), connects to the backoffice
 * over the protocol: sends `ready` with the targets, `select` on click, and outlines the host's `setSelection`.
 * Replaced by the canvas runtime (#17).
 */
import { readManifest, resolveMarkers, type MarkerInfo, type ResolvedTarget } from './markers.js';
import { connectToHost, readNonce, sameTarget, type CanvasChannel, type TargetRef } from '../protocol/index.js';

const toTargetRef = (m: MarkerInfo): TargetRef => ({
	kind: m.kind,
	ownerKey: m.ownerKey,
	ownerIsBlock: m.ownerIsBlock,
	alias: m.alias,
	culture: m.culture,
});

const manifest = readManifest();
if (manifest) {
	const targets = resolveMarkers(manifest);
	(window as unknown as { uveTargets: ResolvedTarget[] }).uveTargets = targets;

	const style = document.createElement('style');
	style.textContent = `
		[data-uve-block] { outline: 2px dashed #f79c37 !important; outline-offset: 2px; }
		[data-uve-prop] { outline: 1px dotted #3544b1 !important; outline-offset: 1px; }
		[data-uve-block], [data-uve-prop] { cursor: pointer; }
		.uve-selected { outline: 3px solid #3544b1 !important; outline-offset: 2px; }
		.uve-debug { position: fixed; bottom: 8px; right: 8px; z-index: 2147483647; max-width: 420px; max-height: 40vh;
			overflow: auto; font: 12px/1.4 system-ui, sans-serif; background: #fff; color: #1b264f; border: 1px solid #d8d7d9;
			border-radius: 6px; padding: 8px 10px; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
		.uve-debug summary { cursor: pointer; font-weight: 600; }
		.uve-debug li { margin: 2px 0; }
	`;
	document.head.append(style);

	// Element -> targets it shows, innermost first when clicking.
	const targetsByElement = new Map<Element, TargetRef[]>();
	for (const { marker, elements, attribute } of targets) {
		const label =
			marker.kind === 'Block'
				? `block ${marker.ownerKey.slice(0, 8)}`
				: `${marker.ownerIsBlock ? 'block ' + marker.ownerKey.slice(0, 8) + ' → ' : ''}${marker.alias}` +
					`${marker.culture ? ` (${marker.culture})` : ''}${attribute ? ` [@${attribute}]` : ''}`;
		for (const el of elements) {
			el.setAttribute(marker.kind === 'Block' ? 'data-uve-block' : 'data-uve-prop', marker.ownerKey);
			el.setAttribute('title', label);
			if (!attribute) targetsByElement.set(el, [...(targetsByElement.get(el) ?? []), toTargetRef(marker)]);
		}
	}

	const found = new Set(targets.map((t) => t.marker.id));
	const missing = manifest.markers.filter((m) => !found.has(m.id));
	const count = (kind: string) => targets.filter((t) => t.marker.kind === kind).length;
	const panel = document.createElement('details');
	panel.className = 'uve-debug';
	panel.innerHTML = `
		<summary>Markers: ${count('Property')} property targets, ${count('Block')} blocks, ${missing.length} unresolved</summary>
		<ul>${targets.map((t) => `<li>${t.marker.kind} #${t.marker.id} ${t.marker.alias ?? t.marker.ownerKey.slice(0, 8)} → ${t.elements.map((e) => e.tagName.toLowerCase()).join(', ')} (${t.via}${t.attribute ? ' @' + t.attribute : ''})</li>`).join('')}</ul>
		${missing.length ? `<strong>Unresolved</strong><ul>${missing.map((m) => `<li>${m.kind} #${m.id} ${m.alias ?? m.ownerKey}</li>`).join('')}</ul>` : ''}
	`;
	document.body.append(panel);

	const nonce = readNonce();
	if (nonce) void connect(nonce);

	async function connect(nonce: string) {
		let channel: CanvasChannel;
		try {
			channel = await connectToHost({
				nonce,
				onMessage: (message) => {
					if (message.type === 'setSelection') showSelection(message.target);
				},
			});
		} catch {
			return; // Opened outside the visual editor (e.g. "Open in new tab").
		}

		const unique: TargetRef[] = [];
		for (const refs of targetsByElement.values())
			for (const ref of refs) if (!unique.some((u) => sameTarget(u, ref))) unique.push(ref);
		channel.send({ type: 'ready', documentKey: manifest!.documentKey, culture: manifest!.culture, targets: unique });

		// Capture phase so the page's own handlers (links, sliders) don't act on clicks meant for selection.
		document.addEventListener(
			'click',
			(event) => {
				for (let el = event.target as Element | null; el; el = el.parentElement) {
					const refs = targetsByElement.get(el);
					if (!refs) continue;
					event.preventDefault();
					event.stopPropagation();
					// Prefer a property over the block that contains it.
					channel.send({ type: 'select', target: refs.find((r) => r.kind === 'Property') ?? refs[0] });
					return;
				}
			},
			true,
		);
	}

	function showSelection(target: TargetRef | null) {
		document.querySelectorAll('.uve-selected').forEach((el) => el.classList.remove('uve-selected'));
		if (!target) return;
		for (const [el, refs] of targetsByElement)
			if (refs.some((r) => sameTarget(r, target))) el.classList.add('uve-selected');
	}
}
