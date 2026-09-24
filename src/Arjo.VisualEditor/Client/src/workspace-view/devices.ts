/**
 * Canvas sizes the editor can preview at. Widths are CSS (logical) viewport widths at each device's default display
 * setting - what a page's responsive CSS sees - not physical pixels. `width: null` fills the available space.
 */
export interface VisualEditorSize {
	id: string;
	label: string;
	width: number | null;
}

export interface VisualEditorDevice {
	alias: 'desktop' | 'tablet' | 'mobile';
	label: string;
	icon: string;
	/** The first size is the default for the category. */
	sizes: ReadonlyArray<VisualEditorSize>;
}

export const VISUAL_EDITOR_DEVICES: ReadonlyArray<VisualEditorDevice> = [
	{
		alias: 'desktop',
		label: 'Desktop',
		icon: 'icon-desktop',
		sizes: [
			{ id: 'fill', label: 'Fill available space', width: null },
			{ id: 'desktop-1920', label: 'Standard desktop', width: 1920 },
			{ id: 'macbook-pro-16', label: 'MacBook Pro 16"', width: 1728 },
			{ id: 'macbook-pro-14', label: 'MacBook Pro 14"', width: 1512 },
			{ id: 'macbook-air-13', label: 'MacBook Air 13"', width: 1470 },
			{ id: 'macbook-air-15', label: 'MacBook Air 15"', width: 1440 },
			{ id: 'laptop-1366', label: 'Laptop', width: 1366 },
			{ id: 'laptop-1280', label: 'Small laptop', width: 1280 },
		],
	},
	{
		alias: 'tablet',
		label: 'Tablet',
		icon: 'icon-ipad',
		sizes: [
			{ id: 'tablet-768', label: 'Generic tablet', width: 768 },
			{ id: 'ipad-pro-13', label: 'iPad Pro 13"', width: 1032 },
			{ id: 'ipad-pro-11', label: 'iPad Pro 11"', width: 834 },
			{ id: 'ipad-air-11', label: 'iPad Air 11"', width: 820 },
			{ id: 'ipad-mini', label: 'iPad mini', width: 744 },
		],
	},
	{
		alias: 'mobile',
		label: 'Mobile',
		icon: 'icon-mobile',
		sizes: [
			{ id: 'iphone-16', label: 'iPhone 16', width: 393 },
			{ id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', width: 440 },
			{ id: 'iphone-se', label: 'iPhone SE', width: 375 },
			{ id: 'pixel-9', label: 'Pixel 9', width: 412 },
			{ id: 'galaxy-s24', label: 'Galaxy S24', width: 360 },
		],
	},
];

export type VisualEditorDeviceAlias = VisualEditorDevice['alias'];

export const deviceFor = (alias: VisualEditorDeviceAlias) =>
	VISUAL_EDITOR_DEVICES.find((d) => d.alias === alias) ?? VISUAL_EDITOR_DEVICES[0];

/** The size with `id` in the device's list, or the device's default. */
export const sizeFor = (alias: VisualEditorDeviceAlias, id: string | undefined) => {
	const device = deviceFor(alias);
	return device.sizes.find((s) => s.id === id) ?? device.sizes[0];
};

/** Option text: the name plus its width, so the exact size is visible. */
export const sizeLabel = (size: VisualEditorSize) => (size.width ? `${size.label} (${size.width}px)` : size.label);
