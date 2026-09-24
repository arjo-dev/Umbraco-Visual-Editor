/**
 * The canvas's model of what can be selected: which elements show which property or block, the innermost target
 * under a point, and a target's parent blocks (for the breadcrumb). Built from resolved markers (markers.ts).
 */
import { sameTarget, type TargetRef } from '../protocol/index.js';
import type { BlockPlacement, MarkerInfo, ResolvedTarget } from './markers.js';

export interface CanvasTarget {
	ref: TargetRef;
	/** Elements showing it. Attribute-only occurrences (e.g. <meta content>) aren't selectable and aren't included. */
	elements: Element[];
	/** Property editor alias (e.g. Umbraco.TextBox); null for blocks. */
	editorAlias: string | null;
	/** Blocks: where the block sits in the document (#24); null when the server couldn't place it. */
	block: BlockPlacement | null;
}

export function toTargetRef(marker: MarkerInfo): TargetRef {
	return {
		kind: marker.kind,
		ownerKey: marker.ownerKey,
		ownerIsBlock: marker.ownerIsBlock,
		alias: marker.alias,
		culture: marker.culture,
		...(marker.label ? { label: marker.label } : {}),
		...(marker.ownerLabel ? { ownerLabel: marker.ownerLabel } : {}),
	};
}

/** What to call a target in labels: its display name, falling back to the alias, then "Block". */
export const targetLabel = (ref: TargetRef) => ref.label ?? ref.alias ?? 'Block';

export class TargetIndex {
	readonly targets: CanvasTarget[] = [];
	#byElement = new Map<Element, CanvasTarget[]>();

	constructor(resolved: ResolvedTarget[]) {
		for (const { marker, elements, attribute } of resolved) {
			if (attribute) continue;
			const ref = toTargetRef(marker);
			let target = this.targets.find((t) => sameTarget(t.ref, ref));
			if (!target) {
				target = { ref, elements: [], editorAlias: marker.editorAlias ?? null, block: marker.block ?? null };
				this.targets.push(target);
			}
			for (const el of elements) {
				if (!target.elements.includes(el)) target.elements.push(el);
				const list: CanvasTarget[] = this.#byElement.get(el) ?? [];
				if (!list.includes(target)) this.#byElement.set(el, [...list, target]);
			}
		}
	}

	/**
	 * The innermost target at `element`: the nearest ancestor (or itself) that shows one. When one element shows both
	 * a block and a property, the property wins - it's the more specific thing to edit.
	 */
	targetAt(element: Element | null): CanvasTarget | null {
		for (let el = element; el; el = el.parentElement) {
			const list = this.#byElement.get(el);
			if (list?.length) return list.find((t) => t.ref.kind === 'Property') ?? list[0];
		}
		return null;
	}

	find(ref: TargetRef | null): CanvasTarget | null {
		return ref ? (this.targets.find((t) => sameTarget(t.ref, ref)) ?? null) : null;
	}

	/**
	 * Blocks that contain `target`, nearest first: for a property inside a block, that block comes first. Used for the
	 * breadcrumb and for Escape (select the parent).
	 */
	ancestorsOf(target: CanvasTarget): CanvasTarget[] {
		const first = target.elements[0];
		if (!first) return [];
		const ancestors: CanvasTarget[] = [];
		for (let el = first as Element | null; el; el = el.parentElement) {
			for (const t of this.#byElement.get(el) ?? []) {
				if (t === target || t.ref.kind !== 'Block' || ancestors.includes(t)) continue;
				// A block on the same element as a property is that property's owner, so it counts as a parent.
				if (el === first && target.ref.kind === 'Block') continue;
				ancestors.push(t);
			}
		}
		return ancestors;
	}
}
