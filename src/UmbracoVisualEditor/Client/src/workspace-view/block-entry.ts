/**
 * Finding a block's entry element in a block property editor (overlay mode, ADR 0005).
 *
 * Umbraco's block property editors render each block as an entry element that provides `UMB_BLOCK_ENTRY_CONTEXT`, whose
 * `edit()` opens the block's overlay. The elements are public custom elements with a public `contentKey`, but not a
 * documented API: this file is the one place that depends on them, so an Umbraco upgrade that changes them is fixed here.
 */

/** The entry elements of Block List, Block Grid (including areas), Block Single and blocks in rich text. */
export const BLOCK_ENTRY_TAGS = [
	'umb-block-list-entry',
	'umb-block-grid-entry',
	'umb-block-single-entry',
	'umb-rte-block',
	'umb-rte-block-inline',
] as const;

const ENTRY_SELECTOR = BLOCK_ENTRY_TAGS.join(',');

/** An entry element: its block's content key is a property (the rich text ones keep it in `data-content-key` too). */
type BlockEntryElement = HTMLElement & { contentKey?: string };

const keyOf = (element: BlockEntryElement) => element.contentKey ?? element.dataset.contentKey;

/**
 * The entry element of block `contentKey` under `root`, looking through shadow roots: property editors nest them there
 * (a grid area's entries sit in the shadow root of the block that has the area). Null when it isn't rendered (yet).
 */
export function findBlockEntry(root: ParentNode, contentKey: string): HTMLElement | null {
	for (const element of root.querySelectorAll<BlockEntryElement>(ENTRY_SELECTOR)) {
		if (keyOf(element) === contentKey) return element;
	}
	// Not in this tree: search the shadow roots under it.
	for (const element of root.querySelectorAll('*')) {
		if (!element.shadowRoot) continue;
		const found = findBlockEntry(element.shadowRoot, contentKey);
		if (found) return found;
	}
	return null;
}
