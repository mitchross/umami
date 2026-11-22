# Fork: Umami with replay and provisioning additions

This branch (`homelab`) is upstream Umami plus three changes. Each is meant to go upstream as
its own pull request against `dev`.

| Change | Where |
|---|---|
| Replay list: first-frame thumbnail, entry page, page count, search by path | `ReplaysTable.tsx`, `ReplayThumbnail.tsx`, `getSessionReplays.ts` |
| Replay player: URL bar that follows the page during playback | `ReplayPlayer.tsx`, `getReplayPages.ts`, `lib/replay.ts` |
| Websites by hostname (`data-website-id="auto"`) and `WEBSITES_CONFIG` | `lib/website-config.ts`, `lib/website-provision.ts`, `instrumentation.ts` |

## Websites config

Set `WEBSITES_CONFIG` to a YAML or JSON file. The server reads it at startup.

```yaml
mode: create          # create: add missing websites only. manage: also update listed ones.
defaults:
  owner: admin        # or team: <team UUID>
  replay: {enabled: true, sampleRate: 1, maskLevel: moderate}
auto:
  domains: [example.com]   # unknown hosts equal to or under these get a website on first visit
  max: 100
websites:
  - domain: docs.example.com
    name: Docs              # id is optional; the default is a UUIDv5 of the domain
```

Trackers then use `data-website-id="auto"`. Hosts outside `auto.domains` must be listed or
already exist. Nothing is ever deleted.

## Releases

Versions are `<upstream version>-homelab.<N>`, for example `3.5.0-homelab.1`.
`N` goes up with each fork release and resets to 1 after a rebase onto a new upstream release.

1. Run `pnpm test` and `pnpm lint`.
2. Run `git tag 3.5.0-homelab.2 && git push origin 3.5.0-homelab.2`.
3. The `homelab image` workflow publishes `ghcr.io/mitchross/umami:3.5.0-homelab.2`.

The tag must match `package.json`'s version, or the workflow fails. Tags have no `v` prefix,
so upstream's release workflow does not run.

To follow a new upstream release, rebase `homelab` onto its tag, then release `<new>-homelab.1`.
