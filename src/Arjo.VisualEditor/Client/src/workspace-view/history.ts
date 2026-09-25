/**
 * Undo / redo for the Visual editor (#33): a list of snapshots of the document workspace's property values, with a
 * pointer to the current one. Every change is a snapshot, but changes close together to the same properties (typing
 * in the side panel) are merged into one, as is everything written during a group (editing text in place).
 */
import type { PropertyValueModel } from './property-values.js';

/** Changes to the same properties within this long of each other are one step. */
export const HISTORY_MERGE_MS = 1000;
/** Oldest steps are dropped beyond this many. */
export const HISTORY_LIMIT = 100;

/** A snapshot: the values, serialised (for comparing, and so later changes to the objects can't alter it). */
export interface HistoryState {
	json: string;
	/** Keys (alias, culture, segment) of the values, with their serialised values. */
	values: Map<string, string>;
}

const keyOf = (v: PropertyValueModel) => JSON.stringify([v.alias, v.culture ?? null, v.segment ?? null]);

export function snapshot(values: readonly PropertyValueModel[]): HistoryState {
	const entries = values.map((v) => [keyOf(v), JSON.stringify(v.value ?? null)] as const);
	const map = new Map(entries);
	return { json: JSON.stringify([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), values: map };
}

/** The keys whose value differs between two snapshots. */
function changedKeys(a: HistoryState, b: HistoryState) {
	const keys = new Set<string>();
	for (const [key, value] of a.values) if (b.values.get(key) !== value) keys.add(key);
	for (const key of b.values.keys()) if (!a.values.has(key)) keys.add(key);
	return keys;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

/** A value to write to get from one snapshot to another. */
export interface ValueChange {
	alias: string;
	culture: string | null;
	segment: string | null;
	value: unknown;
}

/** The writes that turn `from` into `to`: changed values, and values `to` doesn't have cleared. */
export function changesBetween(from: HistoryState, to: HistoryState): ValueChange[] {
	return [...changedKeys(from, to)].map((key) => {
		const [alias, culture, segment] = JSON.parse(key) as [string, string | null, string | null];
		const json = to.values.get(key);
		return { alias, culture, segment, value: json === undefined ? undefined : JSON.parse(json) };
	});
}

export class ValueHistory {
	#states: HistoryState[] = [];
	#index = -1;
	#lastRecordAt = -Infinity;
	/** The properties the newest step changed, for merging the next change into it. */
	#lastChanged = new Set<string>();
	/** The newest step may take more changes: typing, or a group. Undo and redo close it. */
	#open = false;
	#grouping = false;

	constructor(
		readonly mergeMs = HISTORY_MERGE_MS,
		readonly limit = HISTORY_LIMIT,
	) {}

	get canUndo() {
		return this.#index > 0;
	}

	get canRedo() {
		return this.#index < this.#states.length - 1;
	}

	get current(): HistoryState | undefined {
		return this.#states[this.#index];
	}

	/** Starts over from `state` (another document, or its first values). */
	reset(state: HistoryState) {
		this.#states = [state];
		this.#index = 0;
		this.#open = false;
		this.#lastChanged = new Set();
	}

	/** Everything recorded until `endGroup` is one step (editing text in place). */
	beginGroup() {
		this.#grouping = true;
		this.#open = false;
	}

	endGroup() {
		this.#grouping = false;
		this.#open = false;
	}

	/** The values changed. Returns whether it made a change to the history. */
	record(state: HistoryState, now = Date.now()): boolean {
		const current = this.current;
		if (!current) {
			this.reset(state);
			return true;
		}
		if (state.json === current.json) return false;

		const changed = changedKeys(current, state);
		const merge =
			this.#open &&
			this.#index > 0 &&
			this.#index === this.#states.length - 1 &&
			(this.#grouping || (now - this.#lastRecordAt < this.mergeMs && sameSet(changed, this.#lastChanged)));

		if (merge && state.json === this.#states[this.#index - 1].json) {
			// Changed back (a cancelled edit, text retyped as it was): no step after all.
			this.#states.pop();
			this.#index--;
			this.#open = false;
			return true;
		} else if (merge) {
			this.#states[this.#index] = state;
		} else {
			this.#states = [...this.#states.slice(0, this.#index + 1), state];
			if (this.#states.length > this.limit + 1) this.#states = this.#states.slice(-(this.limit + 1));
			this.#index = this.#states.length - 1;
		}
		this.#lastChanged = changed;
		this.#lastRecordAt = now;
		this.#open = true;
		return true;
	}

	/** Steps back; returns the snapshot to restore. */
	undo(): HistoryState | undefined {
		if (!this.canUndo) return undefined;
		this.#open = false;
		return this.#states[--this.#index];
	}

	/** Steps forward again; returns the snapshot to restore. */
	redo(): HistoryState | undefined {
		if (!this.canRedo) return undefined;
		this.#open = false;
		return this.#states[++this.#index];
	}
}
