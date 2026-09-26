/** Side panel width limits (the panel is resizable by dragging its edge, or with the arrow keys). */
export const PANEL_DEFAULT_WIDTH = 360;
export const PANEL_MIN_WIDTH = 280;
/** Room always left for the canvas. */
export const CANVAS_MIN_WIDTH = 320;

/** `width` kept between the minimum and what leaves the canvas its minimum, within `available` (the view's width). */
export function clampPanelWidth(width: number, available: number): number {
	const max = Math.max(PANEL_MIN_WIDTH, available - CANVAS_MIN_WIDTH);
	return Math.round(Math.min(Math.max(width, PANEL_MIN_WIDTH), max));
}
