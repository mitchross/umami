export const RRWEB_EVENT_TYPE = {
  Meta: 4,
  FullSnapshot: 2,
} as const;

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

/** The page shown at `timestamp`: the last change at or before it, else the first page. */
export function getReplayUrlAt(changes: ReplayPageChange[], timestamp: number) {
  let current = changes[0]?.url ?? null;

  for (const change of changes) {
    if (change.timestamp > timestamp) {
      break;
    }

    current = change.url;
  }

  return current;
}
