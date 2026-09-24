/**
 * Backoffice (host) <-> canvas (rendered page in the iframe) message contract. Shared by both bundles.
 * See docs/protocol.md. Bump PROTOCOL_VERSION on any breaking change; both sides refuse other versions.
 */

export const PROTOCOL_NAME = 'arjo-visual-editor';
export const PROTOCOL_VERSION = 1;

/**
 * What a message is about. Marker ids change every render, so targets are identified by what they point at
 * (ADR 0002): the owner (document key, or a block's content key) plus the property alias and culture.
 */
export interface TargetRef {
	kind: 'Property' | 'Block';
	/** Document key, or the block's content key when `ownerIsBlock`. */
	ownerKey: string;
	ownerIsBlock: boolean;
	/** Property alias; null for a whole block. */
	alias: string | null;
	culture: string | null;
	/** Display name: the property's name, or the block's content type name. Not part of the identity. */
	label?: string;
	/** For a property inside a block: the block's content type name. Not part of the identity. */
	ownerLabel?: string;
}

/** Where a block goes: into `propertyAlias` on `ownerKey` (a document or block), optionally a grid area, at `index`. */
export interface BlockPosition {
	ownerKey: string;
	propertyAlias: string;
	areaKey: string | null;
	index: number;
}

// ---- canvas -> host ----

export type CanvasMessage =
	| { type: 'ready'; documentKey: string; culture: string | null; targets: TargetRef[] }
	/** Outcome of a `render` message: patched in (`ok`), or it couldn't be and the host should reload the frame. */
	| { type: 'rendered'; url: string; ok: boolean }
	| { type: 'hover'; target: TargetRef | null }
	| { type: 'select'; target: TargetRef | null }
	| { type: 'inlineEdit'; target: TargetRef; value: string }
	| { type: 'blockMove'; blockKey: string; to: BlockPosition }
	| { type: 'blockInsertRequest'; at: BlockPosition }
	| { type: 'scroll'; x: number; y: number };

// ---- host -> canvas ----

export type HostMessage =
	/** Show a newer render (render-session URL, ADR 0001): the canvas patches it in and answers with `rendered`. */
	| { type: 'render'; url: string }
	| { type: 'highlight'; target: TargetRef | null }
	| { type: 'setSelection'; target: TargetRef | null }
	| { type: 'setReadonly'; readonly: boolean }
	/** Emulated viewport width in CSS pixels; null for the full width. */
	| { type: 'setDevice'; width: number | null };

export type CanvasMessageType = CanvasMessage['type'];
export type HostMessageType = HostMessage['type'];

// ---- runtime validation ----
// Hand-written guards rather than a schema library: this code also ships inside every rendered page.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNullableStr = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOptionalStr = (v: unknown) => v === undefined || typeof v === 'string';
const isIndex = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;

export function isTargetRef(v: unknown): v is TargetRef {
	return (
		isObj(v) &&
		(v.kind === 'Property' || v.kind === 'Block') &&
		isStr(v.ownerKey) &&
		typeof v.ownerIsBlock === 'boolean' &&
		isNullableStr(v.alias) &&
		isNullableStr(v.culture) &&
		isOptionalStr(v.label) &&
		isOptionalStr(v.ownerLabel)
	);
}

const isNullableTarget = (v: unknown) => v === null || isTargetRef(v);

export function isBlockPosition(v: unknown): v is BlockPosition {
	return isObj(v) && isStr(v.ownerKey) && isStr(v.propertyAlias) && isNullableStr(v.areaKey) && isIndex(v.index);
}

const canvasValidators: Record<CanvasMessageType, (m: Obj) => boolean> = {
	ready: (m) =>
		isStr(m.documentKey) && isNullableStr(m.culture) && Array.isArray(m.targets) && m.targets.every(isTargetRef),
	rendered: (m) => isStr(m.url) && typeof m.ok === 'boolean',
	hover: (m) => isNullableTarget(m.target),
	select: (m) => isNullableTarget(m.target),
	inlineEdit: (m) => isTargetRef(m.target) && isStr(m.value),
	blockMove: (m) => isStr(m.blockKey) && isBlockPosition(m.to),
	blockInsertRequest: (m) => isBlockPosition(m.at),
	scroll: (m) => isNum(m.x) && isNum(m.y),
};

const hostValidators: Record<HostMessageType, (m: Obj) => boolean> = {
	render: (m) => isStr(m.url),
	highlight: (m) => isNullableTarget(m.target),
	setSelection: (m) => isNullableTarget(m.target),
	setReadonly: (m) => typeof m.readonly === 'boolean',
	setDevice: (m) => m.width === null || (isNum(m.width) && m.width > 0),
};

function parse<T>(validators: Record<string, (m: Obj) => boolean>, data: unknown): T | null {
	if (!isObj(data) || !isStr(data.type) || !Object.prototype.hasOwnProperty.call(validators, data.type)) return null;
	return validators[data.type](data) ? (data as T) : null;
}

/** Returns the message if it is a known, well-formed canvas message; otherwise null. */
export const parseCanvasMessage = (data: unknown) => parse<CanvasMessage>(canvasValidators, data);

/** Returns the message if it is a known, well-formed host message; otherwise null. */
export const parseHostMessage = (data: unknown) => parse<HostMessage>(hostValidators, data);

/** Two target refs point at the same thing. */
export const sameTarget = (a: TargetRef | null, b: TargetRef | null) =>
	a === b ||
	(!!a && !!b && a.kind === b.kind && a.ownerKey === b.ownerKey && a.alias === b.alias && a.culture === b.culture);
