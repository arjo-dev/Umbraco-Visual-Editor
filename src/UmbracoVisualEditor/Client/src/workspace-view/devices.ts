/**
 * Canvas sizes the editor can preview at. Sizes are CSS (logical) pixels at each device's default display setting -
 * what a page's responsive CSS sees - not physical pixels. Heights are the full screen; a real browser loses some of
 * that to its own toolbars. `width`/`height` null fills the available space.
 */
export interface VisualEditorSize {
	id: string;
	label: string;
	/** Localisation key for a generic name (#35); product names aren't translated. */
	term?: string;
	width: number | null;
	height: number | null;
}

export interface VisualEditorDevice {
	alias: 'desktop' | 'tablet' | 'mobile';
	label: string;
	/** Localisation key for the name (#35). */
	term: string;
	icon: string;
	/** The first size is the default for the category. */
	sizes: ReadonlyArray<VisualEditorSize>;
}

export const VISUAL_EDITOR_DEVICES: ReadonlyArray<VisualEditorDevice> = [
	{
		alias: 'desktop',
		label: 'Desktop',
		term: 'arjoVisualEditor_deviceDesktop',
		icon: 'icon-desktop',
		sizes: [
			{ id: 'fill', label: 'Fill available space', term: 'arjoVisualEditor_sizeFill', width: null, height: null },
			{
				id: 'desktop-1920',
				label: 'Standard desktop',
				term: 'arjoVisualEditor_sizeStandardDesktop',
				width: 1920,
				height: 1080,
			},
			{ id: 'macbook-pro-16', label: 'MacBook Pro 16"', width: 1728, height: 1117 },
			{ id: 'macbook-pro-14', label: 'MacBook Pro 14"', width: 1512, height: 982 },
			{ id: 'macbook-air-13', label: 'MacBook Air 13"', width: 1470, height: 956 },
			{ id: 'macbook-air-15', label: 'MacBook Air 15"', width: 1440, height: 932 },
			{ id: 'laptop-1366', label: 'Laptop', term: 'arjoVisualEditor_sizeLaptop', width: 1366, height: 768 },
			{ id: 'laptop-1280', label: 'Small laptop', term: 'arjoVisualEditor_sizeSmallLaptop', width: 1280, height: 800 },
		],
	},
	{
		alias: 'tablet',
		label: 'Tablet',
		term: 'arjoVisualEditor_deviceTablet',
		icon: 'icon-ipad',
		sizes: [
			{
				id: 'tablet-768',
				label: 'Generic tablet',
				term: 'arjoVisualEditor_sizeGenericTablet',
				width: 768,
				height: 1024,
			},
			{ id: 'ipad-pro-13', label: 'iPad Pro 13"', width: 1032, height: 1376 },
			{ id: 'ipad-pro-11', label: 'iPad Pro 11"', width: 834, height: 1210 },
			{ id: 'ipad-air-11', label: 'iPad Air 11"', width: 820, height: 1180 },
			{ id: 'ipad-mini', label: 'iPad mini', width: 744, height: 1133 },
		],
	},
	{
		alias: 'mobile',
		label: 'Mobile',
		term: 'arjoVisualEditor_deviceMobile',
		icon: 'icon-mobile',
		sizes: [
			{ id: 'iphone-16', label: 'iPhone 16', width: 393, height: 852 },
			{ id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', width: 440, height: 956 },
			{ id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
			{ id: 'pixel-9', label: 'Pixel 9', width: 412, height: 923 },
			{ id: 'galaxy-s24', label: 'Galaxy S24', width: 360, height: 780 },
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

/** Option text: the name plus its dimensions, so the exact size is visible. */
export const sizeLabel = (size: VisualEditorSize, name: string = size.label) =>
	size.width && size.height ? `${name} (${size.width} × ${size.height})` : name;

/** Zoom that fits a size into the available space (never enlarges). 1 for sizes that fill the space. */
export function fitScale(
	size: Pick<VisualEditorSize, 'width' | 'height'>,
	availableWidth: number,
	availableHeight: number,
) {
	if (!size.width || !size.height || availableWidth <= 0 || availableHeight <= 0) return 1;
	return Math.min(1, availableWidth / size.width, availableHeight / size.height);
}
