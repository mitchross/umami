'use client';
import {
  Button,
  Column,
  Icon,
  Loading,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from '@umami/react-zen';
import { ChevronDown, Globe } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Empty } from '@/components/common/Empty';
import { useMobile } from '@/components/hooks';
import {
  formatReplayOffset,
  getReplayFrameSize,
  getReplayFrameViewport,
  getReplayPageChanges,
  getReplayPageIndexAt,
  getReplayPlayerEvents,
  getReplayShortcut,
  parseReplaySpeed,
} from '@/lib/replay';
import 'rrweb-player/dist/style.css';
import styles from './ReplayPlayer.module.css';

const SPEED_OPTIONS = [1, 2, 4, 8];
const SPEED_STORAGE_KEY = 'umami.replay.speed';
const SEEK_STEP_MS = 5000;
const CONTROLLER_HEIGHT = 80;
// Room for the replay header, URL bar and controller so the frame fits on screen.
const RESERVED_HEIGHT = 320;
const MIN_FRAME_HEIGHT = 240;
const MIN_PLAYER_WIDTH = 340;

let playerModule: Promise<any> | null = null;

/** Starts downloading rrweb-player so it is ready by the time the replay data arrives. */
export function preloadReplayPlayer() {
  playerModule ??= import('rrweb-player').catch(error => {
    playerModule = null;
    throw error;
  });

  return playerModule;
}

function readStoredSpeed() {
  try {
    return parseReplaySpeed(window.localStorage.getItem(SPEED_STORAGE_KEY), SPEED_OPTIONS) ?? 1;
  } catch {
    return 1;
  }
}

function storeSpeed(speed: number) {
  try {
    window.localStorage.setItem(SPEED_STORAGE_KEY, String(speed));
  } catch {
    // Storage can be unavailable in private windows.
  }
}

function destroyReplayPlayer(player: { $destroy?: () => void } | null) {
  if (!player) {
    return;
  }

  try {
    player.$destroy?.();
  } catch (error) {
    // rrweb-player alpha teardown can throw after it loses its inner replayer instance.
    if (!(error instanceof TypeError) || !error.message.includes('pause is not a function')) {
      throw error;
    }
  }
}

export function ReplayPlayer({
  events,
  pages,
}: {
  events: any[];
  pages?: { url: string; createdAt: Date | string }[];
}) {
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const playerRootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const isPlayingRef = useRef(false);
  const [playerError, setPlayerError] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 0,
  );
  const { isMobile, isPhone } = useMobile();
  const replayEvents = useMemo(() => getReplayPlayerEvents(events), [events]);
  const replayViewport = useMemo(() => getReplayFrameViewport(replayEvents), [replayEvents]);
  const canReplay = replayEvents.length >= 2;
  const pageChanges = useMemo(() => getReplayPageChanges(events, pages), [events, pages]);
  const pageChangesRef = useRef(pageChanges);
  const replayStart = replayEvents[0]?.timestamp ?? 0;
  const [pageIndex, setPageIndex] = useState(0);
  const currentUrl = pageChanges[pageIndex]?.url ?? pageChanges[0]?.url ?? null;
  const showUnavailable = !events?.length || !canReplay || playerError;

  const preferredPlayerWidth = isPhone ? 360 : isMobile ? 640 : 1024;
  const maxPlayerWidth = Math.min(preferredPlayerWidth, availableWidth || preferredPlayerWidth);
  const frameSize = getReplayFrameSize(
    replayViewport,
    maxPlayerWidth,
    Math.max(MIN_FRAME_HEIGHT, (viewportHeight || 900) - RESERVED_HEIGHT),
  );
  // Tall phone replays get narrow; keep enough width for every player control.
  const playerWidth = Math.max(frameSize.width, Math.min(MIN_PLAYER_WIDTH, maxPlayerWidth));
  const playerHeight = frameSize.height;
  const playerOuterHeight = playerHeight + CONTROLLER_HEIGHT;
  const sizeRef = useRef({ width: playerWidth, height: playerHeight });
  sizeRef.current = { width: playerWidth, height: playerHeight };
  pageChangesRef.current = pageChanges;

  useEffect(() => {
    preloadReplayPlayer().catch(() => null);

    const updateAvailableSize = () => {
      const width = playerWrapperRef.current?.clientWidth ?? 0;

      setAvailableWidth(current => (current === width ? current : width));
      setViewportHeight(current => (current === window.innerHeight ? current : window.innerHeight));
    };

    updateAvailableSize();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateAvailableSize) : null;

    if (playerWrapperRef.current && resizeObserver) {
      resizeObserver.observe(playerWrapperRef.current);
    }

    window.addEventListener('resize', updateAvailableSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateAvailableSize);
    };
  }, []);

  // Build the player once per replay; size changes are applied in place below.
  useEffect(() => {
    let cancelled = false;
    const playerRoot = playerRootRef.current;

    setPlayerError(false);
    setPlayerReady(false);
    setPageIndex(0);
    isPlayingRef.current = false;

    if (playerRef.current) {
      destroyReplayPlayer(playerRef.current);
      playerRef.current = null;
    }

    playerRoot?.replaceChildren();

    if (!playerRoot || !canReplay) return;

    preloadReplayPlayer()
      .then(mod => {
        if (cancelled) return;

        const RRWebPlayer = mod.default;

        playerRoot.replaceChildren();

        try {
          const player = new RRWebPlayer({
            target: playerRoot,
            props: {
              events: replayEvents,
              width: sizeRef.current.width,
              height: sizeRef.current.height,
              maxScale: 0,
              autoPlay: false,
              showController: true,
              skipInactive: true,
              speedOption: SPEED_OPTIONS,
              useVirtualDom: false,
              showWarning: false,
            },
          });

          if (cancelled) {
            destroyReplayPlayer(player);
            return;
          }

          const speed = readStoredSpeed();

          // Set through the controller so its speed buttons match.
          if (speed !== 1) {
            player.setSpeed(speed);
          }

          const start = replayEvents[0]?.timestamp ?? 0;

          // Fires every frame while playing, so only re-render when the page changes.
          player.addEventListener('ui-update-current-time', (event: any) => {
            const time = Number(event?.payload);

            if (Number.isFinite(time)) {
              const index = getReplayPageIndexAt(pageChangesRef.current, start + time);

              setPageIndex(current => (current === index || index < 0 ? current : index));
            }
          });

          player.addEventListener('ui-update-player-state', (event: any) => {
            isPlayingRef.current = event?.payload === 'playing';
          });

          playerRef.current = player;
          setPlayerReady(true);
        } catch {
          playerRoot.replaceChildren();

          if (!cancelled) {
            setPlayerError(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerError(true);
        }
      });

    return () => {
      cancelled = true;

      if (playerRef.current) {
        destroyReplayPlayer(playerRef.current);
        playerRef.current = null;
      }

      playerRoot.replaceChildren();
    };
  }, [canReplay, replayEvents]);

  useEffect(() => {
    const player = playerRef.current;

    if (!playerReady || !player) return;

    player.$set({ width: playerWidth, height: playerHeight });
    player.triggerResize?.();
  }, [playerReady, playerWidth, playerHeight]);

  useEffect(() => {
    if (!playerReady) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcut = getReplayShortcut({
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
        defaultPrevented: e.defaultPrevented,
        target: e.target instanceof Element ? e.target : null,
      });
      const player = playerRef.current;
      const replayer = player?.getReplayer?.();

      if (!shortcut || !replayer) return;

      e.preventDefault();

      if (shortcut === 'toggle') {
        player.toggle();
        return;
      }

      const total = replayer.getMetaData?.().totalTime ?? 0;
      const step = shortcut === 'back' ? -SEEK_STEP_MS : SEEK_STEP_MS;
      const time = Math.min(Math.max(0, replayer.getCurrentTime() + step), Math.max(0, total));

      player.goto(time, isPlayingRef.current);
    };

    const handleSpeedClick = (e: MouseEvent) => {
      const button = (e.target as Element | null)?.closest?.('.rr-controller__btns button');
      const speed = parseReplaySpeed(button?.textContent?.trim().replace(/x$/, ''), SPEED_OPTIONS);

      if (speed) {
        storeSpeed(speed);
      }
    };

    const playerRoot = playerRootRef.current;

    window.addEventListener('keydown', handleKeyDown);
    playerRoot?.addEventListener('click', handleSpeedClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      playerRoot?.removeEventListener('click', handleSpeedClick);
    };
  }, [playerReady]);

  const jumpToPage = (index: number) => {
    const player = playerRef.current;
    const change = pageChanges[index];

    if (!player || !change) return;

    player.goto(Math.max(0, change.timestamp - replayStart), isPlayingRef.current);
    setPageIndex(index);
  };

  return (
    <Column alignItems="center" width="100%">
      {currentUrl && !showUnavailable && (
        <div className={styles.urlBar} style={{ width: playerWidth }} title={currentUrl}>
          <Icon size="sm">
            <Globe />
          </Icon>
          <span className={styles.url}>{currentUrl}</span>
          {pageChanges.length > 1 && (
            <MenuTrigger>
              <Button variant="quiet" size="sm" isDisabled={!playerReady}>
                <span className={styles.pageCount}>
                  {pageIndex + 1}/{pageChanges.length}
                </span>
                <Icon size="sm">
                  <ChevronDown />
                </Icon>
              </Button>
              <Popover side="bottom" align="end">
                <Menu className={styles.pageMenu}>
                  {pageChanges.map((change, index) => (
                    <MenuItem key={index} id={String(index)} onAction={() => jumpToPage(index)}>
                      <span className={styles.pageTime}>
                        {formatReplayOffset(change.timestamp - replayStart)}
                      </span>
                      <span className={styles.pageUrl}>{change.url}</span>
                    </MenuItem>
                  ))}
                </Menu>
              </Popover>
            </MenuTrigger>
          )}
        </div>
      )}
      <div ref={playerWrapperRef} className={styles.wrapper}>
        <div
          className={styles.frame}
          style={{
            width: playerWidth,
            height: showUnavailable ? playerHeight : playerOuterHeight,
          }}
        >
          <div
            ref={playerRootRef}
            style={{
              display: showUnavailable ? 'none' : 'block',
              width: playerWidth,
              height: playerOuterHeight,
            }}
          />
          {!showUnavailable && !playerReady && <Loading icon="spinner" placement="absolute" />}
          {showUnavailable && <Empty message="Replay unavailable." />}
        </div>
      </div>
      {playerReady && !isPhone && (
        <div className={styles.hint}>Space play/pause · Shift ←/→ skip 5s</div>
      )}
    </Column>
  );
}
