/* eslint-disable no-console */
// Creates the websites listed in WEBSITES_CONFIG (a YAML or JSON file) at startup.
// Default mode only creates missing websites, so changes made in the UI are kept.
// `mode: manage` also updates name, domain and recorder settings of listed websites.
// Websites that are not in the file are never changed or deleted.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASK_LEVELS = new Set(['strict', 'moderate']);

export async function parseConfig(text, path = '') {
  if (/\.ya?ml$/i.test(path)) {
    const { parse } = await import('yaml');
    return parse(text) ?? {};
  }

  return JSON.parse(text);
}

function replayConfig(replay) {
  if (!replay || typeof replay !== 'object') return null;

  const config = {};

  if (replay.enabled === true) config.replayEnabled = true;
  if (replay.heatmap === true) config.heatmapEnabled = true;
  if (typeof replay.sampleRate === 'number') config.sampleRate = replay.sampleRate;
  if (typeof replay.heatmapSampleRate === 'number') {
    config.heatmapSampleRate = replay.heatmapSampleRate;
  }
  if (MASK_LEVELS.has(replay.maskLevel)) config.maskLevel = replay.maskLevel;
  if (Number.isFinite(replay.maxDuration)) config.maxDuration = Math.round(replay.maxDuration);
  if (typeof replay.blockSelector === 'string') config.blockSelector = replay.blockSelector;

  return config;
}

/** Validates the file and returns the plan; throws on the first invalid entry. */
export function normalizeConfig(config) {
  const mode = config?.mode ?? 'create';
  const websites = config?.websites;

  if (!['create', 'manage'].includes(mode)) {
    throw new Error(`mode must be "create" or "manage", got "${mode}".`);
  }

  if (!Array.isArray(websites)) {
    throw new Error('The config needs a "websites" list.');
  }

  const ids = new Set();

  return {
    mode,
    websites: websites.map((site, index) => {
      const where = `websites[${index}]`;

      if (!site?.name || typeof site.name !== 'string') {
        throw new Error(`${where}: "name" is required.`);
      }

      if (site.id !== undefined && !UUID.test(site.id)) {
        throw new Error(`${where}: "id" must be a UUID.`);
      }

      if (site.id) {
        if (ids.has(site.id.toLowerCase())) throw new Error(`${where}: duplicate id ${site.id}.`);
        ids.add(site.id.toLowerCase());
      }

      if (site.team !== undefined && !UUID.test(site.team)) {
        throw new Error(`${where}: "team" must be a team UUID.`);
      }

      const replay = replayConfig(site.replay);

      return {
        id: site.id?.toLowerCase(),
        name: site.name.slice(0, 100),
        domain: site.domain ?? null,
        owner: site.owner ?? 'admin',
        team: site.team,
        recorderEnabled: Boolean(replay?.replayEnabled || replay?.heatmapEnabled),
        replayConfig: replay,
      };
    }),
  };
}

export async function provision(prisma, { mode, websites }, log = console.log) {
  const owners = new Map();
  const summary = { created: 0, updated: 0, unchanged: 0 };

  async function ownerId(username) {
    if (!owners.has(username)) {
      const user = await prisma.user.findFirst({ where: { username, deletedAt: null } });

      if (!user) throw new Error(`Owner "${username}" does not exist.`);

      owners.set(username, user.id);
    }

    return owners.get(username);
  }

  for (const site of websites) {
    const existing = site.id
      ? await prisma.website.findUnique({ where: { id: site.id } })
      : await prisma.website.findFirst({
          where: { name: site.name, domain: site.domain, deletedAt: null },
        });

    const settings = {
      name: site.name,
      domain: site.domain,
      ...(site.replayConfig
        ? { recorderEnabled: site.recorderEnabled, replayConfig: site.replayConfig }
        : {}),
    };

    if (!existing) {
      const userId = site.team ? null : await ownerId(site.owner);
      const createdBy = await ownerId(site.owner);

      await prisma.website.create({
        data: {
          id: site.id ?? randomUUID(),
          ...settings,
          userId,
          teamId: site.team ?? null,
          createdBy,
        },
      });
      summary.created++;
      log(`created ${site.name}`);
    } else if (existing.deletedAt) {
      summary.unchanged++;
      log(`skipped ${site.name}: deleted in Umami`);
    } else if (mode === 'manage') {
      await prisma.website.update({ where: { id: existing.id }, data: settings });
      summary.updated++;
    } else {
      summary.unchanged++;
    }
  }

  return summary;
}

async function main() {
  const path = process.env.WEBSITES_CONFIG;

  if (!path) return;

  const plan = normalizeConfig(await parseConfig(await readFile(path, 'utf8'), path));
  const { PrismaPg } = await import('@prisma/adapter-pg');
  // A variable path keeps test bundlers from resolving the generated client.
  const clientPath = '../generated/prisma/client.js';
  const { PrismaClient } = await import(/* @vite-ignore */ clientPath);
  const url = new URL(process.env.DATABASE_URL);
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url.toString() },
      { schema: url.searchParams.get('schema') },
    ),
  });

  try {
    const { created, updated, unchanged } = await provision(prisma, plan);
    console.log(
      chalk.greenBright(
        `✓ Websites from ${path}: ${created} created, ${updated} updated, ${unchanged} unchanged.`,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.log(chalk.redBright(`✗ Website provisioning failed: ${e.message}`));
    process.exit(1);
  });
}
