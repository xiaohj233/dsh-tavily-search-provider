# Test fixtures

Byte-exact copies of official package files used to test the guarded patch
engine (`lib/installed-patches.mjs`). Provenance:

- `dsh-tool-web-0.1.0-rc.6/` and `dsh-host-apiproxy-0.1.0-rc.6/` — the pristine
  `0.1.0-rc.6` npm tarballs (`@deepseek-ai/dsh-tool-web@0.1.0-rc.6`,
  `@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6`, MIT license).
- `dsh-tool-web-applied/` — the tested installed `lib/index.js` after the
  manual rc.6 edit this plugin automates (advanced Tavily controls).
- `dsh-host-apiproxy-applied/` — the local installed `lib/index.js`, which
  carries additional foreign edits (a `keepalive` allowlist row and the legacy
  `dsh-web-search-tavily` row); used to verify the engine refuses foreign and
  legacy states instead of touching them.

These files are test data only; the runtime patch engine never reads them.
