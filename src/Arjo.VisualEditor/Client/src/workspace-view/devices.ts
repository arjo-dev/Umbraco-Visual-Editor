/** Canvas widths the editor can preview at. `width: null` fills the available space. */
export interface VisualEditorDevice {
	alias: 'desktop' | 'tablet' | 'mobile';
	label: string;
	icon: string;
	width: number | null;
}

export const VISUAL_EDITOR_DEVICES: ReadonlyArray<VisualEditorDevice> = [
	{ alias: 'desktop', label: 'Desktop', icon: 'icon-desktop', width: null },
	{ alias: 'tablet', label: 'Tablet (768px)', icon: 'icon-ipad', width: 768 },
	{ alias: 'mobile', label: 'Mobile (375px)', icon: 'icon-mobile', width: 375 },
];

export type VisualEditorDeviceAlias = VisualEditorDevice['alias'];
