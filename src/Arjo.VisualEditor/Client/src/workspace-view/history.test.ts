import { expect } from '@open-wc/testing';
import { changesBetween, snapshot, ValueHistory } from './history.js';

const values = (title: string, body = 'Body', extra: Array<{ alias: string; value: unknown }> = []) =>
	snapshot([
		{ alias: 'title', culture: null, segment: null, value: title },
		{ alias: 'body', culture: 'en-US', segment: null, value: body },
		...extra.map((e) => ({ ...e, culture: null, segment: null })),
	]);

describe('ValueHistory', () => {
	it('starts with nothing to undo', () => {
		const history = new ValueHistory();
		history.record(values('A'));
		expect(history.canUndo).to.equal(false);
		expect(history.canRedo).to.equal(false);
	});

	it('ignores values that did not change', () => {
		const history = new ValueHistory();
		history.record(values('A'), 0);
		expect(history.record(values('A'), 5000)).to.equal(false);
		expect(history.canUndo).to.equal(false);
	});

	it('undoes and redoes steps', () => {
		const history = new ValueHistory();
		history.record(values('A'), 0);
		history.record(values('B'), 5000);
		history.record(values('C'), 10000);
		expect(history.undo()?.json).to.equal(values('B').json);
		expect(history.undo()?.json).to.equal(values('A').json);
		expect(history.canUndo).to.equal(false);
		expect(history.redo()?.json).to.equal(values('B').json);
		expect(history.canRedo).to.equal(true);
	});

	it('merges quick changes to the same property (typing)', () => {
		const history = new ValueHistory(1000);
		history.record(values('A'), 0);
		history.record(values('Ab'), 5000);
		history.record(values('Abc'), 5300);
		history.record(values('Abcd'), 5600);
		expect(history.undo()?.json).to.equal(values('A').json);
		expect(history.canUndo).to.equal(false);
	});

	it('keeps changes to different properties as separate steps', () => {
		const history = new ValueHistory(1000);
		history.record(values('A'), 0);
		history.record(values('B'), 5000);
		history.record(values('B', 'Other'), 5100);
		expect(history.undo()?.json).to.equal(values('B').json);
	});

	it('keeps changes apart after a pause', () => {
		const history = new ValueHistory(1000);
		history.record(values('A'), 0);
		history.record(values('Ab'), 5000);
		history.record(values('Abc'), 7000);
		expect(history.undo()?.json).to.equal(values('Ab').json);
	});

	it('makes a group one step, whatever it changes and however long it takes', () => {
		const history = new ValueHistory(1000);
		history.record(values('A'), 0);
		history.beginGroup();
		history.record(values('Ab'), 5000);
		history.record(values('Ab', 'New'), 60000);
		history.endGroup();
		history.record(values('Ab', 'Newer'), 60100);
		expect(history.undo()?.json).to.equal(values('Ab', 'New').json);
		expect(history.undo()?.json).to.equal(values('A').json);
	});

	it('drops a step that changed things back (a cancelled edit)', () => {
		const history = new ValueHistory();
		history.record(values('A'), 0);
		history.beginGroup();
		history.record(values('Ab'), 5000);
		history.record(values('A'), 6000);
		history.endGroup();
		expect(history.canUndo).to.equal(false);
	});

	it('forgets what could be redone once something else changes', () => {
		const history = new ValueHistory();
		history.record(values('A'), 0);
		history.record(values('B'), 5000);
		history.undo();
		history.record(values('C'), 10000);
		expect(history.canRedo).to.equal(false);
		expect(history.undo()?.json).to.equal(values('A').json);
	});

	it('does not merge into a step that was undone to', () => {
		const history = new ValueHistory(1000);
		history.record(values('A'), 0);
		history.record(values('Ab'), 5000);
		history.record(values('B'), 5100); // title again, merged with Ab
		history.undo();
		history.record(values('A2'), 5200);
		expect(history.undo()?.json).to.equal(values('A').json);
	});

	it('keeps at most `limit` steps', () => {
		const history = new ValueHistory(1000, 2);
		['A', 'B', 'C', 'D'].forEach((t, i) => history.record(values(t), i * 5000));
		expect(history.undo()?.json).to.equal(values('C').json);
		expect(history.undo()?.json).to.equal(values('B').json);
		expect(history.canUndo).to.equal(false);
	});
});

describe('changesBetween', () => {
	it('lists the values to write back, clearing ones that were not there', () => {
		const from = values('B', 'Body', [{ alias: 'added', value: { x: 1 } }]);
		const to = values('A');
		const changes = changesBetween(from, to).sort((a, b) => a.alias.localeCompare(b.alias));
		expect(changes).to.deep.equal([
			{ alias: 'added', culture: null, segment: null, value: undefined },
			{ alias: 'title', culture: null, segment: null, value: 'A' },
		]);
	});

	it('keeps the culture and segment of each value', () => {
		const changes = changesBetween(values('A', 'Old'), values('A', 'New'));
		expect(changes).to.deep.equal([{ alias: 'body', culture: 'en-US', segment: null, value: 'New' }]);
	});
});
