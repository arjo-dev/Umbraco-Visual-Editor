/**
 * Spike #10 debug overlay, injected into render-session pages: resolves markers, outlines what was found and
 * lists manifest entries that were rendered without a findable DOM target. Replaced by the canvas runtime (#17).
 */
import { readManifest, resolveMarkers, type ResolvedTarget } from './markers.js';

const manifest = readManifest();
if (manifest) {
	const targets = resolveMarkers(manifest);
	(window as unknown as { uveTargets: ResolvedTarget[] }).uveTargets = targets;

	const style = document.createElement('style');
	style.textContent = `
		[data-uve-block] { outline: 2px dashed #f79c37 !important; outline-offset: 2px; }
		[data-uve-prop] { outline: 1px dotted #3544b1 !important; outline-offset: 1px; }
		.uve-debug { position: fixed; bottom: 8px; right: 8px; z-index: 2147483647; max-width: 420px; max-height: 40vh;
			overflow: auto; font: 12px/1.4 system-ui, sans-serif; background: #fff; color: #1b264f; border: 1px solid #d8d7d9;
			border-radius: 6px; padding: 8px 10px; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
		.uve-debug summary { cursor: pointer; font-weight: 600; }
		.uve-debug li { margin: 2px 0; }
	`;
	document.head.append(style);

	for (const { marker, elements, attribute } of targets) {
		const label =
			marker.kind === 'Block'
				? `block ${marker.ownerKey.slice(0, 8)}`
				: `${marker.ownerIsBlock ? 'block ' + marker.ownerKey.slice(0, 8) + ' → ' : ''}${marker.alias}` +
					`${marker.culture ? ` (${marker.culture})` : ''}${attribute ? ` [@${attribute}]` : ''}`;
		for (const el of elements) {
			el.setAttribute(marker.kind === 'Block' ? 'data-uve-block' : 'data-uve-prop', marker.ownerKey);
			el.setAttribute('title', label);
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
}
