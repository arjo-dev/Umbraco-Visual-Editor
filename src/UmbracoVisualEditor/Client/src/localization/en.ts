import { DEFAULT_CANVAS_STRINGS } from '../protocol/strings.js';

/** The Visual editor's UI text (#35). English is the fallback for every other language. */
export default {
	arjoVisualEditor: {
		tabName: 'Visual editor',

		// Toolbar
		standardEditor: 'Standard editor',
		showContentTree: 'Show content tree',
		hideContentTree: 'Hide content tree',
		history: 'History',
		undo: 'Undo',
		redo: 'Redo',
		undoShortcut: 'Undo ({0}+Z)',
		redoShortcut: 'Redo ({0}+Shift+Z)',
		device: 'Device',
		previewSize: 'Preview size',
		scaledDown: 'The page is scaled down so the whole width fits',
		readOnly: 'Read-only',
		readOnlyDescription: 'You can look, but not change this page here',
		updatingPreview: 'Updating preview',
		showSidePanel: 'Show side panel',
		hideSidePanel: 'Hide side panel',
		deviceDesktop: 'Desktop',
		deviceTablet: 'Tablet',
		deviceMobile: 'Mobile',
		sizeFill: 'Fill available space',
		sizeStandardDesktop: 'Standard desktop',
		sizeLaptop: 'Laptop',
		sizeSmallLaptop: 'Small laptop',
		sizeGenericTablet: 'Generic tablet',

		// Canvas
		loadingPage: 'Loading the page',
		pagePreview: 'Page preview',
		pagePreviewDescription:
			'Tab or the arrow keys move between the parts of the page, Enter edits or goes into a block, Escape goes back out.',
		renderError:
			"This page didn't render normally, so it can't be edited visually. The template may have thrown an error; details are shown below.",
		saveFirst: 'You must first save your page to use the visual editor.',
		renderFailed: "The page couldn't be rendered ({0}).",
		resizeSidePanel: 'Resize side panel',
		resizeSidePanelHint: 'Drag to resize; double-click to reset',

		// Side panel
		selection: 'Selection',
		pageSettings: 'Page settings',
		block: 'Block',
		inBlock: 'In {0}',
		aBlock: 'a block',
		page: 'Page',
		blockSelected: 'Block · selected: {0}',
		selectHint: 'Click something on the page to select it.',
		richTextHint:
			"Editing on the page, with the toolbar above the text. Esc cancels; click elsewhere on the page when you're done.",
		showInStandardEditor: 'Show in standard editor',
		editableAreas: '{0} editable areas on this page',
		oneThingNeedsAttention: '1 thing needs attention',
		thingsNeedAttention: '{0} things need attention',
		content: 'Content',
		settings: 'Settings',
		noSettings: 'This block has no settings.',
		noProperties: 'This block has no properties to edit.',
		blockGone: "This block isn't in the document any more.",
		allOnPage: 'Every property of this page is on the page itself.',
		notOnPageHint: "Properties that aren't shown on the page, or are empty.",
		propertyGone: "This field isn't on the document type any more.",
		// Profile (#48)
		openDocumentsIn: 'Open documents in',
		openInStandard: 'The standard editor',
		openInVisual: "The Visual editor, where it's available",
		openDocumentsInHint:
			"Documents without a template, or of a type the Visual editor isn't used for, open in the standard editor. A link to a tab still opens that tab.",

		formatting: 'Formatting',
		sharedAcrossLanguages: 'Shared across languages',

		// Block actions
		deleteBlock: 'Delete block',
		deleteBlockConfirm: 'Delete this block, and any blocks inside it?',
		delete: 'Delete',
		cantGoThere: 'The block can’t go there',
		noRoom: 'There’s no room',
		allowsAtMost: 'It allows at most {0} blocks.',
		noBlocksCanGoThere: 'No blocks can go there',
		noBlockTypesAllowed: 'Its configuration doesn’t allow any block types there.',
		copiedToClipboard: 'Copied to the clipboard',
		listDisallows: 'That list doesn’t allow this type of block.',
		listFull: 'That list is full: it allows at most {0} blocks.',
		gridDisallows: 'This grid doesn’t allow this type of block.',
		areaOnly: 'This type of block can only go in an area.',
		gridFull: 'The grid is full: it allows at most {0} blocks.',
		areaDisallows: 'The {0} area doesn’t allow this type of block.',
		areaFull: 'The {0} area is full: it allows at most {1} blocks.',
		tooWide: 'This block is too wide to go there.',
	},
	/** Sent to the canvas (setStrings). */
	arjoVisualEditorCanvas: { ...DEFAULT_CANVAS_STRINGS },
};
