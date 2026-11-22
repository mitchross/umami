'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/components/hooks';
import { getReplayPlayerEvents, getReplayViewport } from '@/lib/replay';

const WIDTH = 128;
const HEIGHT = 80;
// Enough of the recording to contain the first full page snapshot.
const PREVIEW_WINDOW_MS = 3000;
const MAX_CONCURRENT = 3;

let active = 0;
const waiting: (() => void)[] = [];

function acquire() {
  return new Promise<void>(resolve => {
    if (active < MAX_CONCURRENT) {
      active++;
      resolve();
    } else {
      waiting.push(() => {
        active++;
        resolve();
      });
    }
  });
}

function release() {
  active--;
  waiting.shift()?.();
}

/** A still frame from the start of a replay, loaded only when the row scrolls into view. */
export function ReplayThumbnail({
  websiteId,
  replayId,
  startedAt,
}: {
  websiteId: string;
  replayId: string;
  startedAt: Date | string;
}) {
  const { get } = useApi();
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const box = boxRef.current;

    if (!box || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(box);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let replayer: { destroy: () => void } | null = null;
    const start = new Date(startedAt).getTime();
    const until = Number.isFinite(start) ? start + PREVIEW_WINDOW_MS : undefined;

    (async () => {
      await acquire();

      try {
        if (cancelled) return;

        const data = await get(`/websites/${websiteId}/replays/${replayId}`, { until });
        const events = getReplayPlayerEvents(data?.events);
        const viewport = getReplayViewport(events);
        const stage = stageRef.current;

        if (cancelled || !stage || events.length < 2 || !viewport) {
          if (!cancelled) setFailed(true);
          return;
        }

        const { Replayer } = await import('rrweb');

        if (cancelled) return;

        const scale = Math.min(WIDTH / viewport.width, HEIGHT / viewport.height);

        stage.style.width = `${viewport.width}px`;
        stage.style.height = `${viewport.height}px`;
        stage.style.transform = `scale(${scale})`;
        stage.replaceChildren();

        const instance = new Replayer(events, {
          root: stage,
          mouseTail: false,
          triggerFocus: false,
          UNSAFE_replayCanvas: false,
          showWarning: false,
          showDebug: false,
        });

        replayer = instance;

        // rrweb-player's global stylesheet centers every .replayer-wrapper; pin this one to the corner.
        const wrapper = stage.querySelector<HTMLElement>('.replayer-wrapper');

        if (wrapper) {
          Object.assign(wrapper.style, { left: '0', top: '0', transform: 'none', float: 'none' });
        }
        instance.pause(Math.min(1000, events[events.length - 1].timestamp - events[0].timestamp));
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        release();
      }
    })();

    return () => {
      cancelled = true;

      try {
        replayer?.destroy();
      } catch {
        // rrweb can throw while tearing down a replayer that never finished building.
      }

      stageRef.current?.replaceChildren();
    };
  }, [visible, websiteId, replayId, startedAt, get]);

  return (
    <div
      ref={boxRef}
      style={{
        width: WIDTH,
        height: HEIGHT,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: '6px',
        border: '1px solid var(--zen-border)',
        background: 'var(--zen-surface-sunken)',
        pointerEvents: 'none',
      }}
    >
      {!failed && (
        <div
          ref={stageRef}
          style={{ position: 'absolute', top: 0, left: 0, transformOrigin: 'top left' }}
        />
      )}
    </div>
  );
}
