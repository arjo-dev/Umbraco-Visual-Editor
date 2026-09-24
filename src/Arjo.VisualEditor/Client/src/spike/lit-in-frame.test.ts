/**
 * Spike #21: node views such as RTE blocks (`umb-rte-block`) are Lit elements defined in the backoffice window. Do they
 * work when Tiptap puts them into the canvas frame's document?
 */
import { expect } from '@open-wc/testing';
import { LitElement, css, html } from 'lit';

class SpikeBlock extends LitElement {
	static override styles = css`
		:host {
			display: block;
			color: rgb(0, 128, 0);
		}
	`;
	override render() {
		return html`<span part="label">Block</span>`;
	}
}
customElements.define('spike-block', SpikeBlock);

describe('spike #21: backoffice Lit elements inside the canvas frame', () => {
	it("can't connect in another document: its constructed stylesheets aren't allowed there", async () => {
		const frame = document.createElement('iframe');
		const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
		frame.srcdoc = '<body></body>';
		document.body.append(frame);
		await loaded;
		const doc = frame.contentDocument!;

		const errors: unknown[] = [];
		// Exceptions in custom element callbacks are reported as global errors, not thrown to the caller.
		const previous = window.onerror;
		window.onerror = (message) => {
			errors.push(String(message));
			return true;
		};
		const block = document.createElement('spike-block') as SpikeBlock;
		doc.body.append(block); // Lit adopts its constructed stylesheets as the element connects.
		window.onerror = previous;

		expect(String(errors[0] ?? '')).to.contain('Sharing constructed stylesheets in multiple documents is not allowed');
		expect(block.shadowRoot?.querySelector('span')).to.equal(null);
		frame.remove();
	});
});
