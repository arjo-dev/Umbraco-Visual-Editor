import { expect, fixture, html } from '@open-wc/testing';
import type { TargetRef } from '../protocol/index.js';
import './visual-editor-side-panel.element.js';
import type { ArjoVisualEditorSidePanelElement } from './visual-editor-side-panel.element.js';

const title: TargetRef = { kind: 'Property', ownerKey: 'doc', ownerIsBlock: false, alias: 'title', culture: null };
const block: TargetRef = { kind: 'Block', ownerKey: 'b1', ownerIsBlock: true, alias: null, culture: null };

const activeTab = (panel: ArjoVisualEditorSidePanelElement) =>
	[...panel.shadowRoot!.querySelectorAll('uui-tab')].findIndex((tab) => tab.hasAttribute('active'));

describe('side panel tabs', () => {
	it('stays on Page settings when the same selection comes back after a re-render', async () => {
		const panel = await fixture<ArjoVisualEditorSidePanelElement>(
			html`<arjo-visual-editor-side-panel .selected=${title}></arjo-visual-editor-side-panel>`,
		);
		panel.showPageSettings();
		await panel.updateComplete;
		expect(activeTab(panel)).to.equal(1);

		// The page re-rendered: the same selection, a new object with its labels.
		panel.selected = { ...title, label: 'Title' };
		await panel.updateComplete;
		expect(activeTab(panel)).to.equal(1);
	});

	it("gives each property a new editor, so one property's editor never gets another's value", async () => {
		const panel = await fixture<ArjoVisualEditorSidePanelElement>(
			html`<arjo-visual-editor-side-panel .selected=${title}></arjo-visual-editor-side-panel>`,
		);
		const editor = () => panel.shadowRoot!.querySelector('arjo-visual-editor-property-editor');
		const before = editor();

		// The same property again (a re-render) keeps its editor.
		panel.selected = { ...title, label: 'Title' };
		await panel.updateComplete;
		expect(editor()).to.equal(before);

		// Rich text, then a text box: a reused rich text editor wrote `{ ...'Title', markup }` into the title.
		panel.selected = { ...title, alias: 'body' };
		await panel.updateComplete;
		expect(editor()).to.not.equal(before);
		expect(editor()?.alias).to.equal('body');
	});

	it('shows the selection when something else is selected', async () => {
		const panel = await fixture<ArjoVisualEditorSidePanelElement>(
			html`<arjo-visual-editor-side-panel .selected=${title}></arjo-visual-editor-side-panel>`,
		);
		panel.showPageSettings();
		await panel.updateComplete;

		panel.selected = block;
		await panel.updateComplete;
		expect(activeTab(panel)).to.equal(0);
	});
});
