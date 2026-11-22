import { readFile } from 'node:fs/promises';
import { v5 } from 'uuid';
import type { RecorderConfig } from '@/lib/recorder';

/** Tracker value that asks the server to find the website by the page's hostname. */
export const AUTO_WEBSITE_ID = 'auto';

// Fixed namespace, so a domain maps to the same website ID on every install.
const WEBSITE_DOMAIN_NAMESPACE = 'b7c9f4f0-6a1d-5c4e-9a63-3f0d1e2a8b55';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const MASK_LEVELS = new Set(['strict', 'moderate']);
const DEFAULT_AUTO_MAX = 100;

export interface WebsiteReplayInput {
  enabled?: boolean;
  heatmap?: boolean;
  sampleRate?: number;
  heatmapSampleRate?: number;
  maskLevel?: 'strict' | 'moderate';
  maxDuration?: number;
  blockSelector?: string;
}

export interface WebsiteSettings {
  owner: string;
  team?: string;
  recorderEnabled: boolean;
  replayConfig: RecorderConfig | null;
}

export interface WebsiteEntry extends WebsiteSettings {
  id?: string;
  name: string;
  domain: string;
}

export interface WebsitesConfig {
  mode: 'create' | 'manage';
  defaults: WebsiteSettings;
  auto: { domains: string[]; max: number };
  websites: WebsiteEntry[];
}

/** Lower-case hostname without scheme, port, path or a trailing dot; null when invalid. */
export function normalizeHostname(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  let host = value.trim().toLowerCase();

  try {
    host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }

  host = host.replace(/\.$/, '');

  return HOSTNAME.test(host) ? host : null;
}

/** True when `hostname` is one of `domains` or a subdomain of one. */
export function hostnameMatches(hostname: string, domains: string[]) {
  return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** Stable website ID for a domain, the same on every install. */
export function websiteIdForDomain(domain: string) {
  return v5(domain, WEBSITE_DOMAIN_NAMESPACE);
}

export function toReplayConfig(replay: WebsiteReplayInput | undefined): RecorderConfig | null {
  if (!replay || typeof replay !== 'object') {
    return null;
  }

  const config: RecorderConfig = {};

  if (replay.enabled === true) config.replayEnabled = true;
  if (replay.heatmap === true) config.heatmapEnabled = true;
  if (typeof replay.sampleRate === 'number') config.sampleRate = replay.sampleRate;
  if (typeof replay.heatmapSampleRate === 'number') {
    config.heatmapSampleRate = replay.heatmapSampleRate;
  }
  if (replay.maskLevel && MASK_LEVELS.has(replay.maskLevel)) config.maskLevel = replay.maskLevel;
  if (Number.isFinite(replay.maxDuration)) config.maxDuration = Math.round(replay.maxDuration);
  if (typeof replay.blockSelector === 'string') config.blockSelector = replay.blockSelector;

  return config;
}

function settings(raw: any, fallback: WebsiteSettings | null, where: string): WebsiteSettings {
  if (raw?.team !== undefined && !UUID.test(raw.team)) {
    throw new Error(`${where}: "team" must be a team UUID.`);
  }

  const replayConfig = raw?.replay !== undefined ? toReplayConfig(raw.replay) : null;

  return {
    owner: raw?.owner ?? fallback?.owner ?? 'admin',
    team: raw?.team ?? fallback?.team,
    replayConfig: replayConfig ?? fallback?.replayConfig ?? null,
    recorderEnabled: replayConfig
      ? Boolean(replayConfig.replayEnabled || replayConfig.heatmapEnabled)
      : (fallback?.recorderEnabled ?? false),
  };
}

/** Validates a parsed config file; throws on the first invalid entry. */
export function normalizeWebsitesConfig(raw: any): WebsitesConfig {
  const mode = raw?.mode ?? 'create';

  if (mode !== 'create' && mode !== 'manage') {
    throw new Error(`"mode" must be "create" or "manage", got "${mode}".`);
  }

  const defaults = settings(raw?.defaults, null, 'defaults');

  const autoDomains = (raw?.auto?.domains ?? []).map((value: unknown, index: number) => {
    const domain = normalizeHostname(value);

    if (!domain) throw new Error(`auto.domains[${index}]: "${value}" is not a hostname.`);

    return domain;
  });
  const max = raw?.auto?.max ?? DEFAULT_AUTO_MAX;

  if (!Number.isInteger(max) || max < 0) {
    throw new Error('"auto.max" must be a whole number of 0 or more.');
  }

  if (raw?.websites !== undefined && !Array.isArray(raw.websites)) {
    throw new Error('"websites" must be a list.');
  }

  const seen = new Set<string>();

  const websites = (raw?.websites ?? []).map((site: any, index: number) => {
    const where = `websites[${index}]`;
    const domain = normalizeHostname(site?.domain);

    if (!domain) throw new Error(`${where}: "domain" must be a hostname.`);
    if (site.id !== undefined && !UUID.test(site.id)) {
      throw new Error(`${where}: "id" must be a UUID.`);
    }
    if (seen.has(domain)) throw new Error(`${where}: duplicate domain ${domain}.`);

    seen.add(domain);

    return {
      id: site.id?.toLowerCase(),
      name: String(site.name ?? domain).slice(0, 100),
      domain,
      ...settings(site, defaults, where),
    };
  });

  return { mode, defaults, auto: { domains: autoDomains, max }, websites };
}

export async function parseWebsitesConfig(text: string, path = '') {
  if (/\.ya?ml$/i.test(path)) {
    const { parse } = await import('yaml');
    return parse(text) ?? {};
  }

  return JSON.parse(text);
}

let cached: Promise<WebsitesConfig | null> | undefined;

/** The file named by WEBSITES_CONFIG, read once per process; null when the variable is unset. */
export function loadWebsitesConfig(): Promise<WebsitesConfig | null> {
  cached ??= (async () => {
    const path = process.env.WEBSITES_CONFIG;

    if (!path) return null;

    return normalizeWebsitesConfig(await parseWebsitesConfig(await readFile(path, 'utf8'), path));
  })();

  return cached;
}

export function resetWebsitesConfigCache() {
  cached = undefined;
}
