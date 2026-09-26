import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';
import { changesBetween, snapshot, ValueHistory } from './history.js';

export interface HistoryAvailability {
	canUndo: boolean;
	canRedo: boolean;
}

/**
 * Undo / redo in the Visual editor (#33). Follows the document workspace's values, whatever changed them (text edited
 * on the page, the side panel, block moves and inserts), and restores an earlier snapshot by writing back the values
 * that differ. The history lasts as long as the Visual editor is open on the document.
 */
export class ArjoHistoryController extends UmbControllerBase {
	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;
	#history = new ValueHistory();
	#unique?: string | null;
	/** Writing a snapshot back: the changes that causes aren't new steps. */
	#restoring = false;
	#onChange: (availability: HistoryAvailability) => void;

	constructor(host: UmbControllerHost, onChange: (availability: HistoryAvailability) => void) {
		super(host);
		this.#onChange = onChange;
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			this.#workspace = workspace;
			if (!workspace) return;
			this.observe(
				workspace.unique,
				(unique) => {
					// Another document: its own history, from its values as they are now.
					if (unique === this.#unique) return;
					this.#unique = unique;
					const values = workspace.getValues();
					if (values) this.#history.reset(snapshot(values));
					this.#notify();
				},
				'arjoHistoryUnique',
			);
			this.observe(
				workspace.values,
				(values) => {
					if (!values || this.#restoring) return;
					if (this.#history.record(snapshot(values))) this.#notify();
				},
				'arjoHistoryValues',
			);
		});
	}

	get canUndo() {
		return this.#history.canUndo;
	}

	get canRedo() {
		return this.#history.canRedo;
	}

	/** Everything written until `endGroup` is one step: text edited in place on the page. */
	beginGroup() {
		this.#history.beginGroup();
	}

	endGroup() {
		this.#history.endGroup();
	}

	async undo() {
		const from = this.#history.current;
		const to = this.#history.undo();
		if (from && to) await this.#restore(changesBetween(from, to));
	}

	async redo() {
		const from = this.#history.current;
		const to = this.#history.redo();
		if (from && to) await this.#restore(changesBetween(from, to));
	}

	async #restore(changes: ReturnType<typeof changesBetween>) {
		const workspace = this.#workspace;
		this.#notify();
		if (!workspace) return;
		this.#restoring = true;
		try {
			for (const change of changes) {
				await workspace.setPropertyValue(change.alias, change.value, new UmbVariantId(change.culture, change.segment));
			}
		} finally {
			this.#restoring = false;
		}
	}

	#notify() {
		this.#onChange({ canUndo: this.#history.canUndo, canRedo: this.#history.canRedo });
	}
}
