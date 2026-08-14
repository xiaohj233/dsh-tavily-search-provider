# dsh-tavily-search-provider

**Status: Feature Plugin with Compatibility Patch. Tested only with DeepSeek Harness 0.1.0-rc.6.**

`dsh-tavily-search-provider` registers a standalone `tavily_search` tool and an optional Tavily backend for DSH's official `web_search` tool. Both paths map the full supported Tavily search parameter surface. The Plugins settings card includes a write-only `TAVILY_API_KEY` control backed by DSH credentials.

## Problem

Community Tavily providers generally cover basic query and result-count behavior. This package is scoped to preserving the model-side controls expected by its compatibility-patched `web_search`: depth, topic, recency, domain filters, answer inclusion, and raw content.

A clean DSH rc.6 install does not expose those fields in `dsh-tool-web` and does not expose this plugin's settings namespace through `dsh-host-apiproxy`, so the package carries guarded patches for both gaps.

## Behavior

- `tavily_search`: always registered, returns the Tavily-shaped result set and supports all declared controls.
- Optional `web_search` provider: routes the official tool through Tavily while keeping the official result/card shape.
- Per-call credential resolution: changes to `TAVILY_API_KEY` apply without a restart.
- Settings card: configured status, password input, save/replace, unset, backend switch, and official-path result cap.
- Status route: `/api/tavily-search-provider/status` returns value-free provider/settings state.

## Non-goals

This package is not the first or only Tavily integration for DSH, does not replace the DSH provider registry, does not scrape pages itself, and does not make Tavily controls meaningful when a different backend ignores them.

## Compatibility patches

Exact targets:

- `@deepseek-ai/dsh-tool-web@0.1.0-rc.6`: declares and forwards `search_depth`, `topic`, `time_range`, `max_results`, `include_domains`, `exclude_domains`, `include_answer`, and `include_raw_content`.
- `@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6`: adds only `dsh-tavily-search-provider` to the Web settings namespace allowlist.

Version policy is adaptive by default: a copy whose installed version differs from `0.1.0-rc.6` is still patched when every anchor matches uniquely (recorded as an adaptive match), and skipped with a reason when anchors drifted; a strict programmatic mode restores the old exact-version-only apply behavior. One drifted, foreign, or legacy target never blocks the other, and patch application never throws during boot. Restore remains strictly version-guarded in every mode. Apply and restore are idempotent; file replacements use temporary files and rename.

## Compatibility

Requires DeepSeek Harness `0.1.0-rc.6`, Node.js `^22.19.0 || >=24`, pnpm `>=10`, and a Tavily API key. After an upstream upgrade, run `dsh-tavily-search-provider status` once to confirm every target is either applied or intentionally skipped.

## Install

```sh
dsh plugin --profile web add "github:xiaohj233/dsh-tavily-search-provider#v0.2.0"
```

Restart once so guarded boot application can patch the clean rc.6 targets. The standalone tool remains usable if an unrelated/legacy target is refused, but the official `web_search` controls or settings card may be incomplete until that file is restored.

## API key and configuration

Open Settings -> Plugins -> Tavily Search. The key input writes only through `credentials.set` for `TAVILY_API_KEY`; status uses value-free `credentials.describe`, and clear uses `credentials.unset`. A blank key draft keeps the current value.

Key set/unset is disabled on non-loopback plaintext HTTP. Use `localhost`/loopback or HTTPS. This does not add authentication to the wider DSH Web control plane.

The card also controls `replaceOfficialSearch` and `searchMaxResults`. `autoApplyPatches` can be set to `false` in the `dsh-tavily-search-provider` settings section for inspect-only startup.

## Patch status, apply, and restore

Run the installed CLI from the profile:

```sh
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider status
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider apply
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider restore
```

Restore before uninstalling:

```sh
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider restore
dsh plugin --profile web remove dsh-tavily-search-provider
```

When `$DSH_HOME` is unset the profile lives under the home directory (POSIX: `~/.dsh/profiles/web`; Windows PowerShell: `%USERPROFILE%\.dsh\profiles\web`); on Windows pass the resolved path to `pnpm --dir` instead of `~`.

If a legacy or foreign edit is reported, reinstall the official DSH package rather than forcing a fuzzy restoration.

`dsh-keepalive` patches the same `dsh-host-apiproxy` allowlist region with a different anchor. When both plugins are installed, whichever one patches second finds its anchor already consumed and refuses, so its settings card stays unavailable until the other plugin's patch is restored. Restores remain marker-scoped and safe in either order.

## Safety and privacy

The Tavily API receives the query and enabled search controls. `include_raw_content` can return substantially more third-party page content into model context. Domain filters are search constraints, not a content-safety boundary. Review Tavily's data handling and account limits.

The API key is present only in browser draft state and the `credentials.set` request created by this package; it is not stored in the plugin settings section, tool results, normal logs, or status responses.

## Tests

```sh
npm test
npm run check
npm pack --dry-run
```

Tests cover request mapping, result projection, exact patch/restore/version/legacy states, package syntax, credential RPC payloads, staged key behavior, and insecure-transport refusal.

## Limitations and upstream status

The official DeepSeek search provider ignores Tavily-specific controls. The patch targets only rc.6 and requires a restart when it changes a module that is already loaded. Existing Tavily plugins remain valid alternatives for simpler provider behavior; this package is for the full control mapping and credential/settings integration described above.

## License

MIT. Patch targets are MIT-licensed; see `THIRD_PARTY_NOTICES.md`.
