import {
  hostnameMatches,
  loadWebsitesConfig,
  normalizeHostname,
  type WebsiteSettings,
  type WebsitesConfig,
  websiteIdForDomain,
} from '@/lib/website-config';

// The subset of the Prisma client this module uses, so tests can pass a fake.
export interface WebsiteDb {
  user: { findFirst(args: any): Promise<{ id: string } | null> };
  website: {
    findUnique(args: any): Promise<any>;
    findFirst(args: any): Promise<any>;
    count(args: any): Promise<number>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
}

const CACHE_TTL_MS = 60_000;
const lookups = new Map<string, { id: string | null; expires: number }>();

// Loaded on first use, so importing this module never opens a database client.
async function db(): Promise<WebsiteDb> {
  const { default: prisma } = await import('@/lib/prisma');
  return prisma.client as unknown as WebsiteDb;
}

function domainCandidates(domain: string) {
  const bare = domain.replace(/^www\./, '');

  return [bare, `www.${bare}`];
}

async function findByDomain(client: WebsiteDb, domain: string) {
  return client.website.findFirst({
    where: { deletedAt: null, domain: { in: domainCandidates(domain), mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });
}

async function ownerId(client: WebsiteDb, username: string, owners: Map<string, string>) {
  if (!owners.has(username)) {
    const user = await client.user.findFirst({ where: { username, deletedAt: null } });

    if (!user) throw new Error(`Owner "${username}" does not exist.`);

    owners.set(username, user.id);
  }

  return owners.get(username) as string;
}

function recorderFields(settings: WebsiteSettings) {
  return settings.replayConfig
    ? { recorderEnabled: settings.recorderEnabled, replayConfig: settings.replayConfig }
    : {};
}

async function createWebsite(
  client: WebsiteDb,
  site: { id: string; name: string; domain: string } & WebsiteSettings,
  owners: Map<string, string>,
) {
  const createdBy = await ownerId(client, site.owner, owners);

  try {
    return await client.website.create({
      data: {
        id: site.id,
        name: site.name,
        domain: site.domain,
        userId: site.team ? null : createdBy,
        teamId: site.team ?? null,
        createdBy,
        ...recorderFields(site),
      },
    });
  } catch (error: any) {
    // Two requests created the same deterministic ID at once; the other one won.
    if (error?.code === 'P2002') {
      return client.website.findUnique({ where: { id: site.id } });
    }

    throw error;
  }
}

/**
 * Creates the websites in the config that are missing. `manage` mode also updates the name,
 * domain and recorder settings of listed websites. Websites not in the file are never touched.
 */
export async function provisionWebsites(config: WebsitesConfig, dbClient?: WebsiteDb) {
  const client = dbClient ?? (await db());
  const owners = new Map<string, string>();
  const summary = { created: 0, updated: 0, unchanged: 0 };

  for (const site of config.websites) {
    const existing = site.id
      ? await client.website.findUnique({ where: { id: site.id } })
      : await findByDomain(client, site.domain);

    if (!existing) {
      await createWebsite(
        client,
        { ...site, id: site.id ?? websiteIdForDomain(site.domain) },
        owners,
      );
      summary.created++;
    } else if (existing.deletedAt || config.mode !== 'manage') {
      summary.unchanged++;
    } else {
      await client.website.update({
        where: { id: existing.id },
        data: { name: site.name, domain: site.domain, ...recorderFields(site) },
      });
      summary.updated++;
    }
  }

  return summary;
}

/**
 * Finds the website for a page hostname. When the config's `auto.domains` covers the hostname,
 * a missing website is created with the config defaults, up to `auto.max` websites.
 */
export async function resolveWebsiteByHostname(
  hostname: unknown,
  options: { client?: WebsiteDb; config?: WebsitesConfig | null } = {},
): Promise<string | null> {
  const domain = normalizeHostname(hostname);

  if (!domain) return null;

  const hit = lookups.get(domain);

  if (hit && hit.expires > Date.now()) return hit.id;

  const { config } = options;
  const client = options.client ?? (await db());

  const remember = (id: string | null) => {
    lookups.set(domain, { id, expires: Date.now() + CACHE_TTL_MS });
    return id;
  };

  const existing = await findByDomain(client, domain);

  if (existing) return remember(existing.id);

  const settings = config === undefined ? await loadWebsitesConfig() : config;

  if (!settings || !hostnameMatches(domain, settings.auto.domains)) return remember(null);

  const autoCount = await client.website.count({
    where: {
      deletedAt: null,
      OR: settings.auto.domains.flatMap(d => [{ domain: d }, { domain: { endsWith: `.${d}` } }]),
    },
  });

  if (autoCount >= settings.auto.max) return remember(null);

  const website = await createWebsite(
    client,
    { ...settings.defaults, id: websiteIdForDomain(domain), name: domain, domain },
    new Map(),
  );

  return remember(website?.id ?? null);
}

export function clearWebsiteLookups() {
  lookups.clear();
}
