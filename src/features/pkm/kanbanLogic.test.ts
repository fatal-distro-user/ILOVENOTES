import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, addColumn, checklistProgress, columnOf, deleteColumn, groupCards, moveColumn, moveInOrder, parseScope, renameColumn, scopeKey } from './kanbanLogic';

const cards = [
  { id: 'a', status: 'Doing', createdAt: 1 },
  { id: 'b', status: undefined, createdAt: 2 },
  { id: 'c', status: 'Gone', createdAt: 3 },
  { id: 'd', status: 'Doing', createdAt: 4 },
];

describe('scope', () => {
  it('round-trips', () => {
    expect(parseScope(scopeKey({ kind: 'tag', id: 'x:y' }))).toEqual({ kind: 'tag', id: 'x:y' });
    expect(parseScope('bogus')).toBeNull();
    expect(parseScope('notebook:')).toBeNull();
  });
});

describe('grouping', () => {
  it('unset/unknown status goes to first column', () => {
    expect(columnOf(undefined, DEFAULT_COLUMNS)).toBe('Backlog');
    expect(columnOf('Gone', DEFAULT_COLUMNS)).toBe('Backlog');
    const g = groupCards(cards, DEFAULT_COLUMNS, []);
    expect(g.Backlog.map((c) => c.id)).toEqual(['b', 'c']);
    expect(g.Doing.map((c) => c.id)).toEqual(['a', 'd']);
  });
  it('respects stored order', () => {
    const g = groupCards(cards, DEFAULT_COLUMNS, ['d', 'a']);
    expect(g.Doing.map((c) => c.id)).toEqual(['d', 'a']);
  });
});

describe('moveInOrder', () => {
  it('inserts before target', () => {
    expect(moveInOrder(['a', 'd'], ['a', 'd'], 'x', 'd')).toEqual(['a', 'x', 'd']);
  });
  it('appends after last of column when no target', () => {
    expect(moveInOrder(['a', 'b', 'd'], ['a', 'd'], 'b', null)).toEqual(['a', 'd', 'b']);
  });
  it('reorders within column', () => {
    expect(moveInOrder(['a', 'd'], ['a', 'd'], 'd', 'a')).toEqual(['d', 'a']);
  });
  it('includes unordered column cards', () => {
    expect(moveInOrder([], ['a', 'd'], 'x', 'a')).toEqual(['x', 'a', 'd']);
  });
});

describe('column edits', () => {
  it('rename/add/delete/move', () => {
    expect(renameColumn(['A', 'B'], 'A', 'C')).toEqual(['C', 'B']);
    expect(renameColumn(['A', 'B'], 'A', 'B')).toBeNull();
    expect(addColumn(['A'], ' B ')).toEqual(['A', 'B']);
    expect(addColumn(['A'], 'A')).toBeNull();
    expect(deleteColumn(['A'], 'A')).toBeNull();
    expect(deleteColumn(['A', 'B'], 'A')).toEqual(['B']);
    expect(moveColumn(['A', 'B', 'C'], 'C', -1)).toEqual(['A', 'C', 'B']);
    expect(moveColumn(['A', 'B'], 'A', -1)).toEqual(['A', 'B']);
  });
});

describe('checklistProgress', () => {
  it('counts nested task items', () => {
    const doc = { type: 'doc', content: [{ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false } }] }] },
      { type: 'taskItem', attrs: { checked: false } },
    ] }] };
    expect(checklistProgress(doc)).toEqual({ done: 1, total: 3 });
    expect(checklistProgress(null)).toEqual({ done: 0, total: 0 });
  });
});
