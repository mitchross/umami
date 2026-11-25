import { expect, test } from 'vitest';
import {
  canReplayEvents,
  getReplayEventCount,
  getReplayPageChanges,
  getReplayPlayerEvents,
  getReplayUrlAt,
  getReplayViewport,
  hasReplayableFullSnapshot,
  hasReplayFullSnapshot,
  hasReplayInteraction,
  hasReplayMeta,
  REPLAY_EVENT_FRAGMENT_TYPE,
  REPLAY_HUMAN_INPUT_TAG,
  restoreReplayEventFragments,
} from './replay';

const fullSnapshot = {
  type: 2,
  timestamp: 1781553116151,
  data: {
    node: {
      type: 0,
      id: 1,
      childNodes: [{ type: 2, id: 2, tagName: 'html', attributes: {}, childNodes: [] }],
    },
    initialOffset: { left: 0, top: 0 },
  },
};

test('hasReplayFullSnapshot returns true when a full snapshot is present', () => {
  expect(hasReplayFullSnapshot([{ type: 4 }, { type: 2 }, { type: 3 }])).toBe(true);
});

test('hasReplayMeta returns true when a meta event is present', () => {
  expect(hasReplayMeta([{ type: 4 }, { type: 2 }, { type: 3 }])).toBe(true);
});

test('getReplayViewport returns the recorded viewport dimensions', () => {
  expect(getReplayViewport(null)).toBe(null);
  expect(getReplayViewport([{ type: 4, data: { width: 0, height: 768 } }])).toBe(null);
  expect(getReplayViewport([{ type: 4, data: { width: '1024', height: '1365' } }])).toEqual({
    width: 1024,
    height: 1365,
  });
});

test('hasReplayableFullSnapshot returns true when a usable full snapshot is present', () => {
  expect(hasReplayableFullSnapshot([{ type: 4 }, fullSnapshot, { type: 3 }])).toBe(true);
});

test('canReplayEvents requires events that can be normalized with a full snapshot', () => {
  expect(canReplayEvents([{ type: 4, timestamp: 1781553116150 }, fullSnapshot])).toBe(true);
  expect(canReplayEvents([fullSnapshot])).toBe(true);
  expect(canReplayEvents([{ type: 4, timestamp: 1781553116150 }, { type: 2 }])).toBe(false);
  expect(canReplayEvents([{ type: 4, timestamp: 1781553116150 }, { type: 3 }])).toBe(false);
  expect(canReplayEvents([{ ...fullSnapshot, timestamp: undefined }])).toBe(true);
});

test('getReplayPlayerEvents normalizes events for rrweb-player', () => {
  expect(getReplayPlayerEvents(null)).toEqual([]);
  expect(getReplayPlayerEvents([{ type: 3, timestamp: 1781553116160 }])).toEqual([]);

  expect(getReplayPlayerEvents([fullSnapshot])).toEqual([
    fullSnapshot,
    { ...fullSnapshot, timestamp: fullSnapshot.timestamp + 1 },
  ]);

  expect(
    getReplayPlayerEvents([
      { type: 0, timestamp: '1781553116149' },
      { ...fullSnapshot, timestamp: undefined },
    ]),
  ).toEqual([
    { type: 0, timestamp: 1781553116149 },
    { ...fullSnapshot, timestamp: 1781553116150 },
  ]);
});

test('hasReplayFullSnapshot returns false when only incremental events are present', () => {
  expect(hasReplayFullSnapshot([{ type: 4 }, { type: 3 }, { type: 3 }])).toBe(false);
});

test('hasReplayFullSnapshot handles missing events', () => {
  expect(hasReplayFullSnapshot(null)).toBe(false);
  expect(hasReplayFullSnapshot(undefined)).toBe(false);
});

test('restoreReplayEventFragments restores fragmented events', () => {
  const serialized = JSON.stringify(fullSnapshot);
  const splitAt = Math.floor(serialized.length / 2);

  const events = restoreReplayEventFragments([
    { type: 4, timestamp: 1781553116150 },
    {
      type: REPLAY_EVENT_FRAGMENT_TYPE,
      timestamp: fullSnapshot.timestamp,
      data: {
        id: 'snapshot-1',
        index: 0,
        total: 2,
        value: serialized.slice(0, splitAt),
      },
    },
    {
      type: REPLAY_EVENT_FRAGMENT_TYPE,
      timestamp: fullSnapshot.timestamp,
      data: {
        id: 'snapshot-1',
        index: 1,
        total: 2,
        value: serialized.slice(splitAt),
      },
    },
    { type: 3, timestamp: 1781553116160 },
  ]);

  expect(events).toEqual([
    { type: 4, timestamp: 1781553116150 },
    fullSnapshot,
    { type: 3, timestamp: 1781553116160 },
  ]);
  expect(hasReplayFullSnapshot(events)).toBe(true);
});

test('getReplayEventCount counts a fragment group as one event', () => {
  expect(
    getReplayEventCount([
      { type: 4 },
      {
        type: REPLAY_EVENT_FRAGMENT_TYPE,
        data: { id: 'snapshot-1', index: 0, total: 2, value: '{' },
      },
      {
        type: REPLAY_EVENT_FRAGMENT_TYPE,
        data: { id: 'snapshot-1', index: 1, total: 2, value: '}' },
      },
      { type: 3 },
    ]),
  ).toBe(3);
});

test('getReplayPageChanges aligns pageviews to the replay clock', () => {
  const events = [
    { type: 4, timestamp: 10_000, data: { href: 'https://a.test/x', width: 1, height: 1 } },
    { type: 2, timestamp: 10_010, data: {} },
  ];
  const pages = [
    { url: 'a.test/x', createdAt: new Date(70_000).toISOString() },
    { url: 'a.test/x', createdAt: new Date(71_000).toISOString() },
    { url: 'a.test/y', createdAt: new Date(75_000).toISOString() },
  ];
  const changes = getReplayPageChanges(events, pages);

  expect(changes).toEqual([
    { url: 'a.test/x', timestamp: 10_000 },
    { url: 'a.test/y', timestamp: 15_000 },
  ]);
  expect(getReplayUrlAt(changes, 9_000)).toBe('a.test/x');
  expect(getReplayUrlAt(changes, 14_999)).toBe('a.test/x');
  expect(getReplayUrlAt(changes, 15_000)).toBe('a.test/y');
});

test('getReplayPageChanges falls back to rrweb meta hrefs', () => {
  const events = [
    { type: 4, timestamp: 1_000, data: { href: 'https://a.test/one' } },
    { type: 4, timestamp: 5_000, data: { href: 'https://a.test/two' } },
  ];

  expect(getReplayPageChanges(events, [])).toEqual([
    { url: 'a.test/one', timestamp: 1_000 },
    { url: 'a.test/two', timestamp: 5_000 },
  ]);
  expect(getReplayUrlAt([], 1)).toBeNull();
});

test('hasReplayInteraction counts clicks, scrolls, input, touch and the recorder marker', () => {
  const incremental = (source: number, extra = {}) => ({
    type: 3,
    timestamp: 1,
    data: { source, ...extra },
  });

  expect(hasReplayInteraction([incremental(2, { type: 2 })])).toBe(true);
  expect(hasReplayInteraction([incremental(3)])).toBe(true);
  expect(hasReplayInteraction([incremental(5)])).toBe(true);
  expect(hasReplayInteraction([incremental(6)])).toBe(true);
  expect(
    hasReplayInteraction([{ type: 5, timestamp: 1, data: { tag: REPLAY_HUMAN_INPUT_TAG } }]),
  ).toBe(true);
});

test('hasReplayInteraction ignores snapshots, mutations, mouse moves and focus changes', () => {
  expect(hasReplayInteraction(undefined)).toBe(false);
  expect(
    hasReplayInteraction([
      { type: 4, timestamp: 1, data: { href: 'https://example.com', width: 1, height: 1 } },
      fullSnapshot,
      { type: 3, timestamp: 2, data: { source: 0 } },
      { type: 3, timestamp: 3, data: { source: 1, positions: [{ x: 956, y: 419 }] } },
      { type: 3, timestamp: 4, data: { source: 2, type: 5 } },
      { type: 3, timestamp: 5, data: { source: 2, type: 6 } },
      { type: 5, timestamp: 6, data: { tag: 'url-change' } },
    ]),
  ).toBe(false);
});
