/**
 * Resolves the edit-mode markers the server emits into DOM targets (see docs/adr/0002-dom-markers.md):
 * - text/attribute stega: U+2063, base-4 zero-width digits, U+2063 (Markers/Stega.cs), prefixed to text values
 * - comments: <!--uve:p:ID--> ... <!--/uve:p:ID--> (rich text) and <!--uve:b:ID--> ... <!--/uve:b:ID--> (blocks)
 * Runs inside the rendered page. Strips the stega characters so the page's text is clean afterwards.
 */

export type MarkerKind = 'Property' | 'Block';

/** Where a block sits in the document (#24; Markers/BlockLayout.cs), for the block tools. */
export interface BlockPlacement {
	/** Its layout: Umbraco.BlockList, Umbraco.BlockGrid, Umbraco.SingleBlock or Umbraco.RichText. */
	editorAlias: string;
	/** The block editor property holding it, and that value's culture. */
	propertyAlias: string;
	propertyCulture: string | null;
	/** Whose property that is: the document key, or a block's content key. */
	ownerKey: string;
	ownerIsBlock: boolean;
	/** Its position among its siblings (in the layout, or in its grid area). */
	index: number;
	/** Block Grid: its area (null at the grid's root) and the block whose area that is. */
	areaKey: string | null;
	areaOwnerKey: string | null;
	columnSpan: number | null;
	rowSpan: number | null;
	settingsKey: string | null;
	contentTypeKey: string | null;
	contentTypeAlias: string | null;
	/** Content keys of the blocks it is inside, outermost first. */
	path: string[];
}

export interface MarkerInfo {
	id: number;
	kind: MarkerKind;
	ownerKey: string;
	ownerIsBlock: boolean;
	alias: string | null;
	culture: string | null;
	editorAlias: string | null;
	contentTypeKey?: string | null;
	/** Display name: property name, or block content type name (filled in by the server). */
	label?: string | null;
	/** For properties inside blocks: the block content type name. */
	ownerLabel?: string | null;
	/** Block markers: where the block sits in the document (#24). */
	block?: BlockPlacement | null;
}

export interface MarkerManifest {
	documentKey: string;
	culture: string | null;
	/** False when the site turns off editing text and rich text on the page (VisualEditor:EnablePropertyLevelEditing). */
	propertyLevelEditing?: boolean;
	markers: MarkerInfo[];
}

export interface ResolvedTarget {
	marker: MarkerInfo;
	elements: Element[];
	/** Set when the marker was found in an attribute value rather than text. */
	attribute?: string;
	via: 'text' | 'attribute' | 'comment';
}

// Written as escapes on purpose: the real characters are invisible.
const DELIMITER = '\u2063';
const DIGITS = ['\u200B', '\u200C', '\u200D', '\u2060'];
// Alternation, not a character class: U+200D (zero-width joiner) in a class trips no-misleading-character-class.
const STEGA = /\u2063((?:\u200B|\u200C|\u200D|\u2060)+)\u2063/g;
const COMMENT = /^(\/?)uve:([pb]):(\d+)$/;

const decode = (digits: string) => [...digits].reduce((n, c) => n * 4 + DIGITS.indexOf(c), 0);

export function readManifest(doc: Document = document): MarkerManifest | null {
	const el = doc.getElementById('uve-markers');
	return el?.textContent ? (JSON.parse(el.textContent) as MarkerManifest) : null;
}

export function resolveMarkers(manifest: MarkerManifest, root: Document = document): ResolvedTarget[] {
	const byId = new Map(manifest.markers.map((m) => [m.id, m]));
	const targets: ResolvedTarget[] = [];
	const add = (id: number, elements: Element[], via: ResolvedTarget['via'], attribute?: string) => {
		const marker = byId.get(id);
		if (marker && elements.length) targets.push({ marker, elements, via, attribute });
	};

	// Text nodes (stega).
	// Whole document, not just <body>: text properties often end up in <title> and <meta> too.
	const texts = root.createTreeWalker(root.documentElement, NodeFilter.SHOW_TEXT);
	for (let node = texts.nextNode(); node; node = texts.nextNode()) {
		const text = node.nodeValue ?? '';
		if (!text.includes(DELIMITER)) continue;
		for (const match of text.matchAll(STEGA)) add(decode(match[1]), [node.parentElement!], 'text');
		node.nodeValue = text.replace(STEGA, '');
	}

	// Attribute values (stega), e.g. alt/title/aria-label/data-* built from text properties.
	for (const el of root.querySelectorAll('*')) {
		for (const attr of [...el.attributes]) {
			if (!attr.value.includes(DELIMITER)) continue;
			for (const match of attr.value.matchAll(STEGA)) add(decode(match[1]), [el], 'attribute', attr.name);
			el.setAttribute(attr.name, attr.value.replace(STEGA, ''));
		}
	}

	// Comment ranges. Start and end are emitted by the same partial/value, so they share a parent.
	const comments = root.createTreeWalker(root.body, NodeFilter.SHOW_COMMENT);
	const starts = new Map<string, Comment>();
	for (let node = comments.nextNode() as Comment | null; node; node = comments.nextNode() as Comment | null) {
		const m = COMMENT.exec(node.data.trim());
		if (!m) continue;
		const [, closing, type, id] = m;
		const key = `${type}:${id}`;
		if (!closing) {
			// Nested partials for the same block reuse the id; keep the outermost range.
			if (!starts.has(key)) starts.set(key, node);
			continue;
		}
		const start = starts.get(key);
		if (!start || start.parentNode !== node.parentNode) continue;
		starts.delete(key);
		let elements: Element[] = [];
		// nodeType, not instanceof: the document may belong to another window (e.g. a frame driven from its host).
		for (let n = start.nextSibling; n && n !== node; n = n.nextSibling)
			if (n.nodeType === Node.ELEMENT_NODE) elements.push(n as Element);
		if (type === 'b' && !elements.length) elements = [standInFor(node)];
		add(Number(id), type === 'b' ? blockRoot(elements) : elements, 'comment');
	}

	return targets;
}

/**
 * A block whose partial rendered nothing (e.g. a Block List item just added, whose partial returns early without
 * content): an empty element in its place, so it can be selected and gets a placeholder. Block Grid items always
 * have their layout item.
 */
function standInFor(end: Comment): Element {
	const el = end.ownerDocument.createElement('div');
	el.setAttribute('data-uve-empty-block', '');
	el.style.display = 'block';
	el.style.minWidth = '8rem';
	end.parentNode!.insertBefore(el, end);
	return el;
}

/** Block Grid's default items partial puts each block in a layout item; that cell is the block's real box. */
function blockRoot(elements: Element[]): Element[] {
	const parent = elements[0]?.parentElement;
	return parent?.matches('.umb-block-grid__layout-item') && elements.every((e) => e.parentElement === parent)
		? [parent]
		: elements;
}
