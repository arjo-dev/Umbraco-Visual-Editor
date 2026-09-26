/**
 * Where the floating rich text toolbar and statusbar go (#57), in the coordinates of the layer over the canvas.
 * The toolbar sits just above the edited element, left-aligned with it. When the element's top has scrolled out of
 * view it sticks to the top of the canvas, but never past the element's bottom. The statusbar sits just below the
 * element, right-aligned. Both stay inside the canvas.
 */
export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Placement {
	toolbar: { left: number; top: number };
	statusbar: { left: number; top: number } | null;
	/** The element is at least partly in view; otherwise the bars are hidden. */
	visible: boolean;
}

/** Space between the element and the bars, and from the canvas edges. */
export const GAP = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function placeToolbars(element: Box, layer: Size, toolbar: Size, statusbar: Size | null): Placement {
	const bottom = element.top + element.height;
	const visible = bottom > 0 && element.top < layer.height;

	let top = Math.max(element.top - toolbar.height - GAP, GAP);
	top = Math.min(top, bottom - toolbar.height);
	const placement: Placement = {
		toolbar: {
			left: Math.round(clamp(element.left, 0, layer.width - toolbar.width)),
			// Negative once the element has nearly scrolled out: the bar slides out with it.
			top: Math.round(top),
		},
		statusbar: null,
		visible,
	};
	if (statusbar) {
		placement.statusbar = {
			left: Math.round(clamp(element.left + element.width - statusbar.width, 0, layer.width - statusbar.width)),
			top: Math.round(clamp(bottom + GAP, 0, layer.height - statusbar.height - GAP)),
		};
	}
	return placement;
}
