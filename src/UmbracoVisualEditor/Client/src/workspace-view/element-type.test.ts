import { expect } from '@open-wc/testing';
import { composedTypes } from './element-type.js';

interface Type {
	unique: string;
	compositions: Array<{ contentType: { unique: string } }>;
}

const type = (unique: string, ...composes: string[]): Type => ({
	unique,
	compositions: composes.map((u) => ({ contentType: { unique: u } })),
});

const loaderOf = (...types: Type[]) => {
	const requested: string[] = [];
	const byUnique = new Map(types.map((t) => [t.unique, t]));
	return {
		requested,
		load: async (unique: string) => {
			requested.push(unique);
			return byUnique.get(unique);
		},
	};
};

describe('composedTypes', () => {
	it('loads the type and the types it composes, recursively, that type first', async () => {
		const { load } = loaderOf(
			type('row', 'hideProperty', 'spacing'),
			type('hideProperty'),
			type('spacing', 'units'),
			type('units'),
		);
		const types = await composedTypes('row', load);
		expect(types.map((t) => t.unique)).to.deep.equal(['row', 'hideProperty', 'spacing', 'units']);
	});

	it('loads a shared composition once', async () => {
		const { load, requested } = loaderOf(
			type('row', 'left', 'right'),
			type('left', 'shared'),
			type('right', 'shared'),
			type('shared'),
		);
		const types = await composedTypes('row', load);
		expect(types.map((t) => t.unique)).to.deep.equal(['row', 'left', 'shared', 'right']);
		expect(requested.filter((u) => u === 'shared')).to.have.lengthOf(1);
	});

	it("doesn't go round a cycle", async () => {
		const { load } = loaderOf(type('a', 'b'), type('b', 'a'));
		expect((await composedTypes('a', load)).map((t) => t.unique)).to.deep.equal(['a', 'b']);
	});

	it('leaves out a type that does not load', async () => {
		const { load } = loaderOf(type('row', 'gone', 'spacing'), type('spacing'));
		expect((await composedTypes('row', load)).map((t) => t.unique)).to.deep.equal(['row', 'spacing']);
	});

	it('is empty when the type itself does not load', async () => {
		const { load } = loaderOf();
		expect(await composedTypes('gone', load)).to.deep.equal([]);
	});
});
