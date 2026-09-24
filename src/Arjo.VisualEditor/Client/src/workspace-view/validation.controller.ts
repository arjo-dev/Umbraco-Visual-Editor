import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UMB_VALIDATION_CONTEXT } from '@umbraco-cms/backoffice/validation';
import type { TargetRef } from '../protocol/index.js';
import { contentKeyOfSettings } from './property-values.js';
import { inCulture, parseValidationPath, targetsOf } from './validation-paths.js';

/** A validation message, placed on the page. */
export interface VisualEditorError {
	/** Validation message key (stable while the message stands). */
	key: string;
	/** Message text, or a localization key (`#…`). */
	body: string;
	/** What it's about: a property or block; null for the document name. */
	target: TargetRef | null;
	/** The blocks it is inside, outermost first. */
	blocks: TargetRef[];
	/** Display name of a document property (from the document type), for properties that may not be on the page. */
	propertyName?: string;
}

/**
 * Follows the validation messages (client and server, #23) and reports those for the variant being edited (its
 * culture, and invariant values), placed on the page's targets.
 */
export class ArjoValidationController extends UmbControllerBase {
	#documentKey?: string;
	#culture: string | null = null;
	#messages: Array<{ key: string; path: string; body: string }> = [];
	#names = new Map<string, string>();
	#values: Parameters<typeof contentKeyOfSettings>[0] = [];
	#onChange: (errors: VisualEditorError[]) => void;

	constructor(host: UmbControllerHost, onChange: (errors: VisualEditorError[]) => void) {
		super(host);
		this.#onChange = onChange;
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			this.observe(workspace.unique, (unique) => {
				this.#documentKey = unique ?? undefined;
				this.#emit();
			});
			this.observe(workspace.values, (values) => (this.#values = values ?? []));
			this.observe(workspace.structure.contentTypeProperties, (properties) => {
				this.#names = new Map(properties.map((p) => [p.alias, p.name]));
				this.#emit();
			});
		});
		// The active variant's validation context, provided by the split view. It inherits all of the workspace's
		// messages at the root, so paths are the document's own.
		this.consumeContext(UMB_VALIDATION_CONTEXT, (validation) => {
			if (!validation) return;
			this.observe(
				validation.messages.messages,
				(messages) => {
					this.#messages = messages;
					this.#emit();
				},
				'arjoValidationMessages',
			);
		});
	}

	/** The culture being edited; errors in other cultures aren't shown. */
	setCulture(culture: string | null) {
		if (culture === this.#culture) return;
		this.#culture = culture;
		this.#emit();
	}

	#emit() {
		const documentKey = this.#documentKey;
		if (!documentKey) return;
		const errors: VisualEditorError[] = [];
		for (const message of this.#messages) {
			const parsed = parseValidationPath(message.path);
			if (!parsed || !inCulture(parsed, this.#culture)) continue;
			// Settings are keyed by their own key; the page marks blocks by their content key.
			if (parsed.inSettings) {
				const last = parsed.blockKeys.length - 1;
				parsed.blockKeys[last] = contentKeyOfSettings(this.#values, parsed.blockKeys[last]) ?? parsed.blockKeys[last];
			}
			const { target, blocks } = targetsOf(parsed, documentKey);
			errors.push({
				key: message.key,
				body: message.body,
				target,
				blocks,
				propertyName: target && !target.ownerIsBlock && target.alias ? this.#names.get(target.alias) : undefined,
			});
		}
		this.#onChange(errors);
	}
}
