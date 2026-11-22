import { beforeEach, expect, test } from 'vitest';

import { normalizeWebsitesConfig, websiteIdForDomain } from './website-config';
import {
  clearWebsiteLookups,
  provisionWebsites,
  resolveWebsiteByHostname,
} from './website-provision';

function fakeDb(rows: any[] = []) {
  const websites = new Map<string, any>(rows.map(row => [row.id, { deletedAt: null, ...row }]));
  const domainOf = (w: any) => (w.domain ?? '').toLowerCase();

  return {
    websites,
    user: {
      findFirst: async ({ where }: any) => (where.username === 'admin' ? { id: 'u-admin' } : null),
    },
    website: {
      findUnique: async ({ where }: any) => websites.get(where.id) ?? null,
      findFirst: async ({ where }: any) =>
        [...websites.values()].find(w => !w.deletedAt && where.domain.in.includes(domainOf(w))) ??
        null,
      count: async ({ where }: any) =>
        [...websites.values()].filter(
          w =>
            !w.deletedAt &&
            where.OR.some((c: any) =>
              typeof c.domain === 'string'
                ? domainOf(w) === c.domain
                : domainOf(w).endsWith(c.domain.endsWith),
            ),
        ).length,
      create: async ({ data }: any) => {
        if (websites.has(data.id)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        websites.set(data.id, { deletedAt: null, ...data });
        return websites.get(data.id);
      },
      update: async ({ where, data }: any) =>
        websites.set(where.id, { ...websites.get(where.id), ...data }),
    },
  };
}

beforeEach(() => clearWebsiteLookups());

test('create mode adds missing websites with stable IDs and keeps existing ones', async () => {
  const db = fakeDb([{ id: 'old-id', name: 'Renamed in UI', domain: 'docs.example.com' }]);
  const config = normalizeWebsitesConfig({
    defaults: { replay: { enabled: true } },
    websites: [{ domain: 'docs.example.com', name: 'Docs' }, { domain: 'blog.example.com' }],
  });

  expect(await provisionWebsites(config, db)).toEqual({ created: 1, updated: 0, unchanged: 1 });
  expect(db.websites.get('old-id').name).toBe('Renamed in UI');
  expect(db.websites.get(websiteIdForDomain('blog.example.com'))).toMatchObject({
    name: 'blog.example.com',
    userId: 'u-admin',
    recorderEnabled: true,
  });
  expect(await provisionWebsites(config, db)).toEqual({ created: 0, updated: 0, unchanged: 2 });
});

test('manage mode updates listed websites; deleted ones stay deleted', async () => {
  const db = fakeDb([
    { id: 'a', name: 'Old', domain: 'docs.example.com' },
    { id: '22222222-2222-4333-8444-555555555555', name: 'Gone', deletedAt: new Date() },
  ]);
  const config = normalizeWebsitesConfig({
    mode: 'manage',
    websites: [
      { domain: 'docs.example.com', name: 'Docs', replay: { enabled: true, sampleRate: 0.5 } },
      { id: '22222222-2222-4333-8444-555555555555', domain: 'gone.example.com' },
    ],
  });

  expect(await provisionWebsites(config, db)).toEqual({ created: 0, updated: 1, unchanged: 1 });
  expect(db.websites.get('a')).toMatchObject({
    name: 'Docs',
    replayConfig: { replayEnabled: true, sampleRate: 0.5 },
  });
});

test('auto resolution finds existing websites by domain, also with or without www', async () => {
  const db = fakeDb([
    { id: 'docs', domain: 'Docs.Example.com' },
    { id: 'www', domain: 'www.shop.com' },
  ]);

  expect(await resolveWebsiteByHostname('docs.example.com', { client: db, config: null })).toBe(
    'docs',
  );
  expect(await resolveWebsiteByHostname('shop.com', { client: db, config: null })).toBe('www');
  expect(await resolveWebsiteByHostname('nope.com', { client: db, config: null })).toBeNull();
  expect(await resolveWebsiteByHostname('bad host', { client: db, config: null })).toBeNull();
});

test('auto resolution creates websites only under auto.domains and up to auto.max', async () => {
  const db = fakeDb();
  const config = normalizeWebsitesConfig({
    defaults: { replay: { enabled: true, maskLevel: 'strict' } },
    auto: { domains: ['example.com'], max: 2 },
  });
  const resolve = (host: string) => resolveWebsiteByHostname(host, { client: db, config });

  expect(await resolve('a.example.com')).toBe(websiteIdForDomain('a.example.com'));
  expect(db.websites.get(websiteIdForDomain('a.example.com'))).toMatchObject({
    name: 'a.example.com',
    domain: 'a.example.com',
    recorderEnabled: true,
    replayConfig: { replayEnabled: true, maskLevel: 'strict' },
  });
  expect(await resolve('evil.net')).toBeNull();
  expect(await resolve('b.example.com')).toBe(websiteIdForDomain('b.example.com'));
  expect(await resolve('c.example.com')).toBeNull();
  expect(db.websites.size).toBe(2);
});

test('a deleted auto website is not recreated', async () => {
  const id = websiteIdForDomain('a.example.com');
  const db = fakeDb([{ id, domain: 'a.example.com', deletedAt: new Date() }]);
  const config = normalizeWebsitesConfig({ auto: { domains: ['example.com'] } });

  expect(await resolveWebsiteByHostname('a.example.com', { client: db, config })).toBe(id);
  expect(db.websites.get(id).deletedAt).toBeTruthy();
});
