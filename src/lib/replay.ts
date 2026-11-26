export const RRWEB_EVENT_TYPE = {
  Meta: 4,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Custom: 5,
} as const;

// rrweb IncrementalSource values that only a person produces: MouseInteraction, Scroll, Input, TouchMove.
const HUMAN_INCREMENTAL_SOURCES = new Set([2, 3, 5, 6]);

// rrweb MouseInteraction types Focus and Blur can be fired by scripts, so they do not count.
const NON_HUMAN_MOUSE_INTERACTIONS = new Set([5, 6]);

export const REPLAY_HUMAN_INPUT_TAG = 'umami:human-input';

export const REPLAY_EVENT_FRAGMENT_TYPE = 'umami:rrweb-event-fragment';

interface ReplayEventFragment {
  type: typeof REPLAY_EVENT_FRAGMENT_TYPE;
  timestamp?: number;
  data: {
    id: string;
    index: number;
    total: number;
    value: string;
  };
}

export function isReplayEventFragment(event: any): event is ReplayEventFragment {
  const { data } = event || {};

  return (
    event?.type === REPLAY_EVENT_FRAGMENT_TYPE &&
    typeof data?.id === 'string' &&
    Number.isInteger(data?.index) &&
    Number.isInteger(data?.total) &&
    data.index >= 0 &&
    data.index < data.total &&
    typeof data?.value === 'string'
  );
}

export function hasReplayInteraction(events: any[] | null | undefined) {
  if (!Array.isArray(events)) {
    return false;
  }

  return events.some(event => {
    if (event?.type === RRWEB_EVENT_TYPE.Custom) {
      return event.data?.tag === REPLAY_HUMAN_INPUT_TAG;
    }

    if (event?.type !== RRWEB_EVENT_TYPE.IncrementalSnapshot) {
      return false;
    }

    const { source, type } = event.data || {};

    if (!HUMAN_INCREMENTAL_SOURCES.has(source)) {
      return false;
    }

    return !(source === 2 && NON_HUMAN_MOUSE_INTERACTIONS.has(type));
  });
}

export function getReplayEventCount(events: any[] | null | undefined) {
  if (!Array.isArray(events)) {
    return 0;
  }

  return events.reduce((count, event) => {
    if (isReplayEventFragment(event)) {
      return count + (event.data.index === 0 ? 1 : 0);
    }

    return count + 1;
  }, 0);
}

export function restoreReplayEventFragments(events: any[] | null | undefined) {
  if (!Array.isArray(events)) {
    return [];
  }

  const restored: any[] = [];
  const pending = new Map<
    string,
    {
      total: number;
      values: Map<number, string>;
      received: number;
    }
  >();

  for (const event of events) {
    if (!isReplayEventFragment(event)) {
      restored.push(event);
      continue;
    }

    const { id, index, total, value } = event.data;
    let fragment = pending.get(id);

    if (!fragment || fragment.total !== total) {
      fragment = {
        total,
        values: new Map(),
        received: 0,
      };
      pending.set(id, fragment);
    }

    if (!fragment.values.has(index)) {
      fragment.values.set(index, value);
      fragment.received += 1;
    }

    if (fragment.received === fragment.total) {
      pending.delete(id);

      try {
        let serialized = '';

        for (let i = 0; i < fragment.total; i++) {
          serialized += fragment.values.get(i) || '';
        }

        restored.push(JSON.parse(serialized));
      } catch {
        // Ignore malformed fragment groups. A partial replay is better than failing the whole response.
      }
    }
  }

  return restored;
}

export function hasReplayFullSnapshot(events: any[] | null | undefined) {
  return (
    Array.isArray(events) && events.some(event => event?.type === RRWEB_EVENT_TYPE.FullSnapshot)
  );
}

export function hasReplayableFullSnapshot(events: any[] | null | undefined) {
  return (
    Array.isArray(events) &&
    events.some(event => {
      const { data } = event || {};
      const { node } = data || {};

      return (
        event?.type === RRWEB_EVENT_TYPE.FullSnapshot &&
        Number.isInteger(node?.type) &&
        Array.isArray(node?.childNodes)
      );
    })
  );
}

export function hasReplayMeta(events: any[] | null | undefined) {
  return Array.isArray(events) && events.some(event => event?.type === RRWEB_EVENT_TYPE.Meta);
}

function getReplayDimension(value: any) {
  const dimension = Number(value);

  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

export function getReplayViewport(events: any[] | null | undefined) {
  if (!Array.isArray(events)) {
    return null;
  }

  const meta = events.find(event => {
    const width = getReplayDimension(event?.data?.width);
    const height = getReplayDimension(event?.data?.height);

    return event?.type === RRWEB_EVENT_TYPE.Meta && width && height;
  });

  if (!meta) {
    return null;
  }

  return {
    width: getReplayDimension(meta.data.width) as number,
    height: getReplayDimension(meta.data.height) as number,
  };
}

// rrweb IncrementalSource.ViewportResize.
const VIEWPORT_RESIZE_SOURCE = 4;

const MIN_FRAME_ASPECT_RATIO = 0.25;
const MAX_FRAME_ASPECT_RATIO = 2.5;
const DEFAULT_FRAME_ASPECT_RATIO = 9 / 16;

/**
 * The viewport the visitor spent the most time in. Phones flip between sizes as the browser
 * toolbar hides, so the first meta event is often not the size most of the replay is shown at.
 */
export function getReplayFrameViewport(events: any[] | null | undefined) {
  if (!Array.isArray(events)) {
    return null;
  }

  const durations = new Map<string, { width: number; height: number; ms: number }>();
  let current: { width: number; height: number } | null = null;
  let since = 0;
  let lastTimestamp = 0;

  const addTime = (viewport: { width: number; height: number }, ms: number) => {
    const key = `${viewport.width}x${viewport.height}`;
    const entry = durations.get(key) ?? { ...viewport, ms: 0 };

    entry.ms += Math.max(0, ms);
    durations.set(key, entry);
  };

  for (const event of events) {
    const timestamp = getReplayTimestamp(event);

    if (timestamp === null) {
      continue;
    }

    lastTimestamp = Math.max(lastTimestamp, timestamp);

    const isViewport =
      event?.type === RRWEB_EVENT_TYPE.Meta ||
      (event?.type === RRWEB_EVENT_TYPE.IncrementalSnapshot &&
        event?.data?.source === VIEWPORT_RESIZE_SOURCE);
    const width = isViewport ? getReplayDimension(event.data?.width) : null;
    const height = isViewport ? getReplayDimension(event.data?.height) : null;

    if (!width || !height) {
      continue;
    }

    if (current) {
      addTime(current, timestamp - since);
    }

    current = { width, height };
    since = timestamp;
  }

  if (!current) {
    return null;
  }

  addTime(current, lastTimestamp - since);

  let best: { width: number; height: number; ms: number } | null = null;

  for (const entry of durations.values()) {
    if (!best || entry.ms > best.ms) {
      best = entry;
    }
  }

  return best ? { width: best.width, height: best.height } : null;
}

/** Largest frame with the replay's aspect ratio that fits the space, so there are no letterbox bars. */
export function getReplayFrameSize(
  viewport: { width: number; height: number } | null | undefined,
  maxWidth: number,
  maxHeight: number,
) {
  const ratio = viewport
    ? Math.min(
        Math.max(viewport.height / viewport.width, MIN_FRAME_ASPECT_RATIO),
        MAX_FRAME_ASPECT_RATIO,
      )
    : DEFAULT_FRAME_ASPECT_RATIO;
  let width = Math.max(1, Math.round(maxWidth));
  let height = Math.round(width * ratio);

  if (height > maxHeight) {
    height = Math.max(1, Math.round(maxHeight));
    width = Math.max(1, Math.round(height / ratio));
  }

  return { width, height };
}

function getReplayTimestamp(event: any) {
  const timestamp = Number(event?.timestamp);

  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getReplayPlayerEvents(events: any[] | null | undefined) {
  if (!Array.isArray(events)) {
    return [];
  }

  const replayEvents = events.filter(
    event => event && typeof event === 'object' && event.type !== undefined && event.type !== null,
  );

  if (!hasReplayableFullSnapshot(replayEvents)) {
    return [];
  }

  const firstTimestamp =
    replayEvents.map(getReplayTimestamp).find(timestamp => timestamp !== null) ?? Date.now();
  let lastTimestamp = firstTimestamp - 1;

  const normalizedEvents = replayEvents.map(event => {
    const timestamp = getReplayTimestamp(event);

    if (timestamp !== null) {
      lastTimestamp = timestamp;

      return typeof event.timestamp === 'number' ? event : { ...event, timestamp };
    }

    lastTimestamp += 1;

    return { ...event, timestamp: lastTimestamp };
  });

  if (normalizedEvents.length === 1) {
    return [
      normalizedEvents[0],
      {
        ...normalizedEvents[0],
        timestamp: normalizedEvents[0].timestamp + 1,
      },
    ];
  }

  return normalizedEvents;
}

export function canReplayEvents(events: any[] | null | undefined) {
  return getReplayPlayerEvents(events).length >= 2;
}

export interface ReplayPageChange {
  url: string;
  timestamp: number;
}

/**
 * Page changes during a replay, oldest first. Umami pageviews catch client-side navigation;
 * rrweb meta events (full page loads) fill in when no pageview was recorded.
 */
export function getReplayPageChanges(
  events: any[] | null | undefined,
  pages: { url: string; createdAt: Date | string }[] | null | undefined,
): ReplayPageChange[] {
  const changes: ReplayPageChange[] = [];
  // Pageviews carry server time and rrweb events carry the visitor's clock; align them on the
  // first page load so a skewed client clock does not shift every URL.
  const firstMeta = Array.isArray(events)
    ? events.find(
        event => event?.type === RRWEB_EVENT_TYPE.Meta && getReplayTimestamp(event) !== null,
      )
    : null;
  const firstPageTime = pages?.length ? new Date(pages[0]?.createdAt).getTime() : NaN;
  const skew =
    firstMeta && Number.isFinite(firstPageTime)
      ? (getReplayTimestamp(firstMeta) as number) - firstPageTime
      : 0;

  for (const page of pages ?? []) {
    const timestamp = new Date(page?.createdAt).getTime() + skew;

    if (page?.url && Number.isFinite(timestamp)) {
      changes.push({ url: page.url, timestamp });
    }
  }

  if (!changes.length && Array.isArray(events)) {
    for (const event of events) {
      const timestamp = getReplayTimestamp(event);
      const href = event?.type === RRWEB_EVENT_TYPE.Meta ? event?.data?.href : null;

      if (typeof href === 'string' && href && timestamp !== null) {
        changes.push({ url: href.replace(/^https?:\/\//, ''), timestamp });
      }
    }
  }

  changes.sort((a, b) => a.timestamp - b.timestamp);

  return changes.filter((change, index) => index === 0 || change.url !== changes[index - 1].url);
}

/** Index of the page shown at `timestamp`: the last change at or before it, else the first page. */
export function getReplayPageIndexAt(changes: ReplayPageChange[], timestamp: number) {
  if (!changes.length) {
    return -1;
  }

  let index = 0;

  for (let i = 0; i < changes.length; i++) {
    if (changes[i].timestamp > timestamp) {
      break;
    }

    index = i;
  }

  return index;
}

/** The page shown at `timestamp`: the last change at or before it, else the first page. */
export function getReplayUrlAt(changes: ReplayPageChange[], timestamp: number) {
  return changes[getReplayPageIndexAt(changes, timestamp)]?.url ?? null;
}

/** Playback offset as m:ss, or h:mm:ss past an hour. */
export function formatReplayOffset(ms: number) {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export type ReplayShortcut = 'toggle' | 'back' | 'forward';

/** Keyboard shortcut for the player. Plain arrows stay free for switching replays. */
export function getReplayShortcut(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  target?: { closest?: (selector: string) => unknown } | null;
}): ReplayShortcut | null {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing
  ) {
    return null;
  }

  if (
    event.target?.closest?.(
      'input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], [role="slider"]',
    )
  ) {
    return null;
  }

  if (event.shiftKey) {
    if (event.key === 'ArrowLeft') return 'back';
    if (event.key === 'ArrowRight') return 'forward';

    return null;
  }

  // Space on a focused button already clicks it.
  if ((event.key === ' ' || event.key === 'k') && !event.target?.closest?.('button, a')) {
    return 'toggle';
  }

  return null;
}

/** A remembered playback speed, if it is still one of the offered options. */
export function parseReplaySpeed(value: unknown, options: number[]) {
  const speed = Number(value);

  return options.includes(speed) ? speed : null;
}
