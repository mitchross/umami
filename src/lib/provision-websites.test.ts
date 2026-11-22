import { expect, test } from 'vitest';
import { normalizeConfig, parseConfig, provision } from '../../scripts/provision-websites.js';

const ID = '11111111-2222-4333-8444-555555555555';

function fakePrisma(rows: any[] = []) {
  const websites = new Map(rows.map(row => [row.id, row]));

  return {
    websites,
    user: {
      findFirst: async ({ where }: any) => (where.username === 'admin' ? { id: 'u-admin' } : null),
    },
    website: {
      findUnique: async ({ where }: any) => websites.get(where.id) ?? null,
      findFirst: async ({ where }: any) =>
        [...websites.values()].find(w => w.name === where.name && w.domain === where.domain) ??
        null,
      create: async ({ data }: any) => websites.set(data.id, data),
      update: async ({ where, data }: any) =>
        websites.set(where.id, { ...websites.get(where.id), ...data }),
    },
  };
}

test('parses YAML and JSON configs', async () => {
  expect(await parseConfig('websites: []\nmode: manage', 'sites.yaml')).toEqual({
    websites: [],
    mode: 'manage',
  });
  expect(await parseConfig('{"websites": []}', 'sites.json')).toEqual({ websites: [] });
});

test('normalizeConfig validates entries and maps replay settings', () => {
  const plan = normalizeConfig({
    websites: [
      {
        id: ID.toUpperCase(),
        name: 'Docs',
        domain: 'docs.example.com',
        replay: { enabled: true, sampleRate: 1, maskLevel: 'strict', maxDuration: 1800000 },
      },
    ],
  });

  expect(plan.mode).toBe('create');
  expect(plan.websites[0]).toMatchObject({
    id: ID,
    owner: 'admin',
    recorderEnabled: true,
    replayConfig: { replayEnabled: true, sampleRate: 1, maskLevel: 'strict', maxDuration: 1800000 },
  });
  expect(() => normalizeConfig({ websites: [{ name: 'x', id: 'nope' }] })).toThrow(/UUID/);
  expect(() => normalizeConfig({ websites: [{ id: ID }] })).toThrow(/name/);
  expect(() => normalizeConfig({ mode: 'sync', websites: [] })).toThrow(/mode/);
  expect(() =>
    normalizeConfig({
      websites: [
        { id: ID, name: 'a' },
        { id: ID, name: 'b' },
      ],
    }),
  ).toThrow(/duplicate/);
});

test('create mode adds missing websites and keeps existing ones', async () => {
  const prisma = fakePrisma([{ id: ID, name: 'Renamed in UI', domain: 'docs.example.com' }]);
  const plan = normalizeConfig({
    websites: [
      { id: ID, name: 'Docs', domain: 'docs.example.com', replay: { enabled: true } },
      { name: 'Blog', domain: 'blog.example.com' },
    ],
  });

  expect(await provision(prisma, plan, () => {})).toEqual({ created: 1, updated: 0, unchanged: 1 });
  expect(prisma.websites.get(ID).name).toBe('Renamed in UI');
  const blog = [...prisma.websites.values()].find((w: any) => w.name === 'Blog');
  expect(blog).toMatchObject({
    userId: 'u-admin',
    createdBy: 'u-admin',
    domain: 'blog.example.com',
  });

  // A second run finds the website created without an id by name and domain.
  expect(await provision(prisma, plan, () => {})).toEqual({ created: 0, updated: 0, unchanged: 2 });
});

test('manage mode updates listed websites; deleted websites stay deleted', async () => {
  const deleted = '22222222-2222-4333-8444-555555555555';
  const prisma = fakePrisma([
    { id: ID, name: 'Old', domain: 'old.example.com' },
    { id: deleted, name: 'Gone', deletedAt: new Date() },
  ]);
  const plan = normalizeConfig({
    mode: 'manage',
    websites: [
      {
        id: ID,
        name: 'Docs',
        domain: 'docs.example.com',
        replay: { enabled: true, sampleRate: 0.5 },
      },
      { id: deleted, name: 'Gone' },
    ],
  });

  expect(await provision(prisma, plan, () => {})).toEqual({ created: 0, updated: 1, unchanged: 1 });
  expect(prisma.websites.get(ID)).toMatchObject({
    name: 'Docs',
    recorderEnabled: true,
    replayConfig: { replayEnabled: true, sampleRate: 0.5 },
  });
  expect(prisma.websites.get(deleted).name).toBe('Gone');
});

test('unknown owners fail loudly', async () => {
  const plan = normalizeConfig({ websites: [{ name: 'x', owner: 'nobody' }] });
  await expect(provision(fakePrisma(), plan, () => {})).rejects.toThrow(/nobody/);
});
