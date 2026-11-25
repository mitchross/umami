import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const rrweb = vi.hoisted(() => {
  const state: { emit: ((event: any) => void) | null } = { emit: null };
  const record: any = vi.fn((options: any) => {
    state.emit = options.emit;
    return vi.fn();
  });
  record.takeFullSnapshot = vi.fn();
  const addCustomEvent = vi.fn((tag: string, payload: unknown) =>
    state.emit?.({ type: 5, timestamp: Date.now(), data: { tag, payload } }),
  );

  return { state, record, addCustomEvent };
});

vi.mock('rrweb', () => ({ record: rrweb.record, addCustomEvent: rrweb.addCustomEvent }));

const meta = { type: 4, timestamp: 1, data: { href: 'https://example.com/', width: 1, height: 1 } };
const snapshot = { type: 2, timestamp: 2, data: { node: { id: 1 } } };
const mouseMove = { type: 3, timestamp: 3, data: { source: 1, positions: [{ x: 956, y: 419 }] } };

let listeners: Record<string, ((event: any) => void)[]>;
let uploads: any[][];

function emit(event: any) {
  rrweb.state.emit?.({ ...event });
}

function fire(type: string, isTrusted = true) {
  for (const listener of listeners[type] ?? []) {
    listener({ type, isTrusted });
  }
}

async function startRecorder() {
  vi.resetModules();
  await import('./index.js');
  await vi.waitFor(() => expect(rrweb.record).toHaveBeenCalled());
}

describe('recorder human input gate', () => {
  beforeEach(() => {
    listeners = {};
    uploads = [];
    rrweb.state.emit = null;
    rrweb.record.mockClear();
    rrweb.record.takeFullSnapshot.mockClear();
    rrweb.addCustomEvent.mockClear();

    const capture = (type: string, listener: any) => {
      listeners[type] = [...(listeners[type] ?? []), listener];
    };
    vi.spyOn(document, 'addEventListener').mockImplementation(capture as any);
    vi.spyOn(document, 'removeEventListener').mockImplementation((type: string, listener: any) => {
      listeners[type] = (listeners[type] ?? []).filter(fn => fn !== listener);
    });
    vi.spyOn(window, 'addEventListener').mockImplementation(capture as any);

    (window as any).umamiConfig = { websiteId: 'website-1', hostUrl: 'https://umami.test' };
    (window as any).umami = { getSession: () => ({ cache: 'token' }) };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/recorder')) {
          return new Response(
            JSON.stringify({ enabled: true, replayEnabled: true, sampleRate: 1 }),
          );
        }

        uploads.push(JSON.parse(String(init?.body)).payload.events);
        return new Response('{}');
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).umamiConfig;
    delete (window as any).umami;
  });

  test('uploads nothing while the only activity is a fixed-pixel mouse move', async () => {
    await startRecorder();

    emit(meta);
    emit(snapshot);
    emit(mouseMove);
    emit(mouseMove);
    fire('pagehide');
    fire('beforeunload');

    expect(uploads).toEqual([]);
  });

  test('ignores untrusted input events', async () => {
    await startRecorder();

    emit(meta);
    emit(snapshot);
    fire('scroll', false);
    fire('click', false);
    fire('keydown', false);
    fire('pagehide');

    expect(uploads).toEqual([]);
  });

  test('flushes the held snapshot on the first real scroll, then records normally', async () => {
    await startRecorder();

    emit(meta);
    emit(snapshot);
    emit(mouseMove);
    fire('scroll');

    const sent = uploads.flat();
    expect(sent.map(event => event.type)).toEqual([4, 2, 3, 5]);
    expect(sent[3].data).toEqual({ tag: 'umami:human-input', payload: { type: 'scroll' } });

    emit({ type: 3, timestamp: 4, data: { source: 3, id: 1, x: 0, y: 300 } });
    fire('pagehide');

    expect(uploads.flat().at(-1).data.source).toBe(3);
    expect(listeners.scroll ?? []).toHaveLength(0);
  });

  test.each(['pointerdown', 'keydown', 'touchstart'])(
    'a trusted %s also starts upload',
    async type => {
      await startRecorder();

      emit(meta);
      emit(snapshot);
      fire(type);

      expect(uploads.flat().map(event => event.type)).toEqual([4, 2, 5]);
    },
  );

  test('keeps only events since the latest checkout while waiting', async () => {
    await startRecorder();

    emit(meta);
    emit(snapshot);
    emit(mouseMove);
    emit({ ...meta, timestamp: 30_001 });
    emit({ ...snapshot, timestamp: 30_002 });
    emit(mouseMove);
    fire('mousedown');

    const sent = uploads.flat();
    expect(sent.map(event => event.timestamp)).toEqual([30_001, 30_002, 3, expect.any(Number)]);
  });

  test('takes a fresh snapshot instead of growing the held buffer without bound', async () => {
    await startRecorder();

    emit(meta);
    emit(snapshot);
    for (let i = 0; i < 2001; i++) emit(mouseMove);

    expect(rrweb.record.takeFullSnapshot).toHaveBeenCalledWith(true);
  });

  test('splits a large held buffer into chunks the record API accepts', async () => {
    await startRecorder();

    emit(meta);
    emit(snapshot);
    for (let i = 0; i < 450; i++) emit(mouseMove);
    fire('scroll');

    expect(uploads.every(chunk => chunk.length <= 200)).toBe(true);
    expect(uploads.flat()).toHaveLength(453);
  });
});
