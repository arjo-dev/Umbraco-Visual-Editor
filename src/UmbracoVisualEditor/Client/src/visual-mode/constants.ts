import type { VisualEditorConfigurationResponseModel } from '../api/index.js';

export const ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS = 'Arjo.VisualEditor.Condition.VisualEditorAvailable';

/** The editor mode, as the configuration API sends it (by property, so a renamed generated schema doesn't matter). */
export type VisualEditorMode = VisualEditorConfigurationResponseModel['editorMode'];

/** VisualEditor:EditorMode (VisualEditorMode.cs): the side panel (the default), or Umbraco's block overlay. */
export const VISUAL_EDITOR_MODE = {
	sidePanel: 'SidePanel',
	overlay: 'Overlay',
} as const satisfies Record<string, VisualEditorMode>;
