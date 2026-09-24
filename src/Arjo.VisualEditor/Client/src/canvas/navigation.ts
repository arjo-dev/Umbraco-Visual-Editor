/**
 * Keeps the canvas on the page being edited (#16). Inside the visual editor, following a link or submitting a form
 * would replace the page being edited, so:
 * - ordinary link clicks do nothing (in-page `#anchor` links still scroll);
 * - Ctrl/Cmd/Shift+click opens the link in a new tab instead;
 * - form submissions are blocked.
 * Anything that still navigates the frame (scripts, meta refresh) is caught by the host, which loads the edit page
 * again. Only active when the page is framed, so opening a render URL directly behaves normally.
 */
export interface NavigationGuardOptions {
	/** Opens a URL in a new tab; injectable for tests. */
	openInNewTab?: (url: string) => void;
}

export function guardNavigation(win: Window = window, options: NavigationGuardOptions = {}): () => void {
	if (win.parent === win) return () => {};
	const openInNewTab = options.openInNewTab ?? ((url: string) => win.open(url, '_blank', 'noopener'));

	const onClick = (event: MouseEvent) => {
		if (event.defaultPrevented || event.button !== 0) return;
		const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
		if (!link || isSamePageAnchor(link, win)) return;

		event.preventDefault();
		if (event.ctrlKey || event.metaKey || event.shiftKey) openInNewTab(link.href);
	};

	const onSubmit = (event: SubmitEvent) => event.preventDefault();

	// Capture phase, so this runs before the site's own handlers (which might navigate).
	win.document.addEventListener('click', onClick, true);
	win.document.addEventListener('submit', onSubmit, true);
	return () => {
		win.document.removeEventListener('click', onClick, true);
		win.document.removeEventListener('submit', onSubmit, true);
	};
}

function isSamePageAnchor(link: HTMLAnchorElement, win: Window) {
	const href = link.getAttribute('href') ?? '';
	if (href.startsWith('#')) return true;
	const target = new URL(link.href, win.location.href);
	return target.hash !== '' && target.origin === win.location.origin && target.pathname === win.location.pathname;
}
