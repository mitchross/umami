import { expect, test } from 'vitest';
import {
  hostnameMatches,
  normalizeHostname,
  normalizeWebsitesConfig,
  parseWebsitesConfig,
  websiteIdForDomain,
} from './website-config';

test('normalizeHostname accepts hosts and URLs and rejects junk', () => {
  expect(normalizeHostname('Docs.Example.com')).toBe('docs.example.com');
  expect(normalizeHostname('https://docs.example.com:8443/path?q=1')).toBe('docs.example.com');
  expect(normalizeHostname('docs.example.com.')).toBe('docs.example.com');
  expect(normalizeHostname('')).toBeNull();
  expect(normalizeHostname('not a host')).toBeNull();
  expect(normalizeHostname(42)).toBeNull();
});

test('hostnameMatches covers the domain and its subdomains only', () => {
  expect(hostnameMatches('example.com', ['example.com'])).toBe(true);
  expect(hostnameMatches('a.b.example.com', ['example.com'])).toBe(true);
  expect(hostnameMatches('badexample.com', ['example.com'])).toBe(false);
  expect(hostnameMatches('example.com.evil.net', ['example.com'])).toBe(false);
});

test('websiteIdForDomain is a stable UUID', () => {
  expect(websiteIdForDomain('docs.example.com')).toBe(websiteIdForDomain('docs.example.com'));
  expect(websiteIdForDomain('docs.example.com')).not.toBe(websiteIdForDomain('blog.example.com'));
  expect(websiteIdForDomain('docs.example.com')).toMatch(/^[0-9a-f-]{36}$/);
});

test('parses YAML and JSON', async () => {
  expect(await parseWebsitesConfig('mode: manage', 'a.yaml')).toEqual({ mode: 'manage' });
  expect(await parseWebsitesConfig('{"mode":"create"}', 'a.json')).toEqual({ mode: 'create' });
  expect(await parseWebsitesConfig('', 'a.yml')).toEqual({});
});

test('defaults flow into websites; per-site settings win', () => {
  const config = normalizeWebsitesConfig({
    defaults: { owner: 'ops', replay: { enabled: true, sampleRate: 1 } },
    auto: { domains: ['Example.com'] },
    websites: [
      { domain: 'docs.example.com', name: 'Docs' },
      { domain: 'https://shop.example.com/', replay: { enabled: true, maskLevel: 'strict' } },
    ],
  });

  expect(config.mode).toBe('create');
  expect(config.auto).toEqual({ domains: ['example.com'], max: 100 });
  expect(config.websites[0]).toMatchObject({
    name: 'Docs',
    domain: 'docs.example.com',
    owner: 'ops',
    recorderEnabled: true,
    replayConfig: { replayEnabled: true, sampleRate: 1 },
  });
  expect(config.websites[1]).toMatchObject({
    name: 'shop.example.com',
    replayConfig: { replayEnabled: true, maskLevel: 'strict' },
  });
});

test('rejects invalid config', () => {
  expect(() => normalizeWebsitesConfig({ mode: 'sync' })).toThrow(/mode/);
  expect(() => normalizeWebsitesConfig({ websites: [{ name: 'x' }] })).toThrow(/domain/);
  expect(() => normalizeWebsitesConfig({ websites: [{ domain: 'a.com', id: 'x' }] })).toThrow(
    /UUID/,
  );
  expect(() =>
    normalizeWebsitesConfig({ websites: [{ domain: 'a.com' }, { domain: 'A.com' }] }),
  ).toThrow(/duplicate/);
  expect(() => normalizeWebsitesConfig({ auto: { domains: ['not a host'] } })).toThrow(/hostname/);
  expect(() => normalizeWebsitesConfig({ auto: { max: -1 } })).toThrow(/max/);
  expect(() => normalizeWebsitesConfig({ defaults: { team: 'nope' } })).toThrow(/team/);
});
