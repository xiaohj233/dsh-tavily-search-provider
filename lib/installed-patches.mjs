/**
 * Guarded compatibility-patch engine for the installed official packages this
 * plugin depends on. The plugin publishes two small patches into the DSH
 * installation:
 *
 * - `@deepseek-ai/dsh-tool-web@0.1.0-rc.6` (`lib/index.js`): extend the
 *   official `web_search` tool with the model-facing advanced Tavily controls
 *   (`search_depth`, `topic`, `time_range`, `max_results`, `include_domains` /
 *   `exclude_domains`, `include_answer`, `include_raw_content`) and forward
 *   them onto the `ctx.web.search` seam request. The official tool's schema,
 *   result shape, web card, and prompt guidance stay official; the extended
 *   fields are marked "Tavily backend only".
 * - `@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6` (`lib/index.js`): add exactly
 *   this plugin's settings namespace (`dsh-tavily-search-provider`) to the
 *   `WEB_SETTINGS_NAMESPACES` allowlist so the Web client's Settings → Plugins
 *   card can read and edit the section. Nothing else is added.
 *
 * v2 patch policy (see the publication design's patch policy):
 * - Per-target independent decisions: one drifted/foreign/legacy/version-
 *   mismatched target never blocks the others, and no installation-state
 *   problem ever throws — a boot-time apply can never crash the plugin.
 * - Version policy: `adaptive` by default — an untested version is patched
 *   when every hunk anchor still matches uniquely (recorded as
 *   `adaptive: true`), otherwise that target is skipped with a reason.
 *   `strict` refuses every version-mismatched target.
 * - Legacy/partial states are content drift, not version problems: a legacy
 *   marker or a partially applied file skips under BOTH version match and
 *   version mismatch.
 * - Exactly one structural anchor per hunk at apply time, or that target is
 *   skipped (ambiguous anchors are never guessed).
 * - Idempotent apply and restore (an applied hunk whose inserted text is
 *   already present is a no-op; restoring a pristine hunk is a no-op).
 * - Atomic per-file writes (temp file + rename); only successfully classified
 *   targets are written.
 * - Restore removes only the exact text this plugin inserted and is ALWAYS
 *   strict: untested versions, legacy markers, foreign layouts, and
 *   non-canonical inserted text refuse with `restore-blocked`.
 *
 * Target locations are discovered dynamically (Node's own node_modules walk
 * from the running `dsh` CLI entry, then from this module), never from
 * hardcoded paths. `env.packageDirs` may override discovery for tests.
 *
 * @module dsh-tavily-search-provider/installed-patches
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Structured failure of one guarded patch operation (programming/IO errors only). */
export class PatchError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "PatchError";
		this.code = code;
		this.details = details;
	}
}

/** The exact official versions these patches are tested against. */
export const PATCHED_TARGET_VERSIONS = {
	"@deepseek-ai/dsh-tool-web": "0.1.0-rc.6",
	"@deepseek-ai/dsh-host-apiproxy": "0.1.0-rc.6",
};

/**
 * The two patch targets. Hunk anchors and replacements are byte-exact strings
 * verified against the clean npm tarballs and the tested installed files under
 * `scripts/audit-verify.mjs`; keep them in sync with the evidence there. The
 * replacement text doubles as the per-hunk "already applied" marker.
 */
export const PATCH_TARGETS = {
	"tool-web": {
		id: "tool-web",
		packageName: "@deepseek-ai/dsh-tool-web",
		version: PATCHED_TARGET_VERSIONS["@deepseek-ai/dsh-tool-web"],
		file: "lib/index.js",
		description:
			"web_search tool: advanced Tavily retrieval controls forwarded to ctx.web.search (model-facing schema, prompt guidance, and execute seam)",
		hunks: [
			{
				id: "parse-search-args",
				anchor:
					"\treturn { query: args.query };",
				replacement:
					"\treturn {\n" +
					"\t\tquery: args.query,\n" +
					"\t\t...args.search_depth !== void 0 ? { search_depth: args.search_depth } : {},\n" +
					"\t\t...args.topic !== void 0 ? { topic: args.topic } : {},\n" +
					"\t\t...args.time_range !== void 0 ? { time_range: args.time_range } : {},\n" +
					"\t\t...args.max_results !== void 0 ? { max_results: args.max_results } : {},\n" +
					"\t\t...args.include_domains !== void 0 ? { include_domains: args.include_domains } : {},\n" +
					"\t\t...args.exclude_domains !== void 0 ? { exclude_domains: args.exclude_domains } : {},\n" +
					"\t\t...args.include_answer !== void 0 ? { include_answer: args.include_answer } : {},\n" +
					"\t\t...args.include_raw_content !== void 0 ? { include_raw_content: args.include_raw_content } : {}\n" +
					"\t};",
			},
			{
				id: "prompt-guidance",
				anchor:
					"\t\ttext: fetchEnabled ? \"Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.\" : \"Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Use the returned source snippets when available, and cite the relevant URLs as markdown links.\"",
				replacement:
					"\t\ttext: (fetchEnabled ? \"Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.\" : \"Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Use the returned source snippets when available, and cite the relevant URLs as markdown links.\") + `\n" +
					"\n" +
					"The tool supports Tavily's retrieval controls when the Tavily backend is active (they are ignored otherwise):\n" +
					"- search_depth: \"basic\" (fast summaries) | \"advanced\" (reranked chunks, higher relevance) | \"fast\" | \"ultra-fast\".\n" +
					"- topic: \"general\" | \"news\" (recent news) | \"finance\".\n" +
					"- time_range: \"day\" | \"week\" | \"month\" | \"year\" — only results published in this window.\n" +
					"- max_results: number of sources to return (1-20; the deployment default applies when omitted).\n" +
					"- include_domains / exclude_domains: restrict or exclude domains (wildcards like *.com allowed).\n" +
					"- include_answer: request an AI-generated answer synthesized from the results (default true).\n" +
					"- include_raw_content: include full page content for each result (expensive; off by default).\n" +
					"\n" +
					"Usage guidance: use topic/time_range for recency-sensitive queries, include_domains to scope to authoritative sources, and advanced depth for research-heavy questions. API reference: https://docs.tavily.com/documentation/api-reference/endpoint/search`",
			},
			{
				id: "tool-description",
				anchor:
					"\t\tdescription: \"Search the web for current information. Returns an optional summary answer and a list of source URLs.\",",
				replacement:
					"\t\tdescription: \"Search the web for current information. Returns an optional summary answer and a list of source URLs. When the Tavily backend is enabled, supports retrieval controls: search_depth, topic (general/news/finance), time_range (day/week/month/year), max_results, include_domains/exclude_domains, include_answer, include_raw_content.\",",
			},
			{
				id: "parameters-schema",
				anchor:
					"\t\tparameters: { query: {\n" +
					"\t\t\ttype: \"string\",\n" +
					"\t\t\trequired: true,\n" +
					"\t\t\tdescription: \"The search query.\"\n" +
					"\t\t} },",
				replacement:
					"\t\tparameters: {\n" +
					"\t\t\tquery: {\n" +
					"\t\t\t\ttype: \"string\",\n" +
					"\t\t\t\trequired: true,\n" +
					"\t\t\t\tdescription: \"The search query.\"\n" +
					"\t\t\t},\n" +
					"\t\t\tsearch_depth: {\n" +
					"\t\t\t\ttype: \"string\",\n" +
					"\t\t\t\tenum: [\"basic\", \"advanced\", \"fast\", \"ultra-fast\"],\n" +
					"\t\t\t\tdescription: \"Retrieval depth: basic = NLP summary of each page; advanced = reranked chunks with higher relevance (default basic). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\ttopic: {\n" +
					"\t\t\t\ttype: \"string\",\n" +
					"\t\t\t\tenum: [\"general\", \"news\", \"finance\"],\n" +
					"\t\t\t\tdescription: \"Search topic; news and finance tune recency/quality for those verticals (default general). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\ttime_range: {\n" +
					"\t\t\t\ttype: \"string\",\n" +
					"\t\t\t\tenum: [\"day\", \"week\", \"month\", \"year\"],\n" +
					"\t\t\t\tdescription: \"Only results published within this window (default none = no recency filter). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\tmax_results: {\n" +
					"\t\t\t\ttype: \"integer\",\n" +
					"\t\t\t\tdescription: \"Number of results to return, 1-20 (default: the deployment's configured cap). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\tinclude_domains: {\n" +
					"\t\t\t\ttype: \"array\",\n" +
					"\t\t\t\titems: { type: \"string\" },\n" +
					"\t\t\t\tdescription: \"Restrict results to these domains (max 300, wildcards like *.com allowed). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\texclude_domains: {\n" +
					"\t\t\t\ttype: \"array\",\n" +
					"\t\t\t\titems: { type: \"string\" },\n" +
					"\t\t\t\tdescription: \"Exclude results from these domains (max 150). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\tinclude_answer: {\n" +
					"\t\t\t\ttype: \"boolean\",\n" +
					"\t\t\t\tdescription: \"Include an AI-generated answer synthesized from the results (default true). Tavily backend only.\"\n" +
					"\t\t\t},\n" +
					"\t\t\tinclude_raw_content: {\n" +
					"\t\t\t\ttype: \"boolean\",\n" +
					"\t\t\t\tdescription: \"Include the full page content for each result (default false; expensive). Tavily backend only.\"\n" +
					"\t\t\t}\n" +
					"\t\t},",
			},
			{
				id: "execute-forward",
				anchor:
					"\t\t\tconst result = await ctx.web.search({\n" +
					"\t\t\t\tquery: input.query,\n" +
					"\t\t\t\tmaxResults\n" +
					"\t\t\t}, exec.signal);",
				replacement:
					"\t\t\tconst result = await ctx.web.search({\n" +
					"\t\t\t\tquery: input.query,\n" +
					"\t\t\t\tmaxResults,\n" +
					"\t\t\t\t...input.search_depth !== void 0 ? { search_depth: input.search_depth } : {},\n" +
					"\t\t\t\t...input.topic !== void 0 ? { topic: input.topic } : {},\n" +
					"\t\t\t\t...input.time_range !== void 0 ? { time_range: input.time_range } : {},\n" +
					"\t\t\t\t...input.max_results !== void 0 ? { max_results: input.max_results } : {},\n" +
					"\t\t\t\t...input.include_domains !== void 0 ? { include_domains: input.include_domains } : {},\n" +
					"\t\t\t\t...input.exclude_domains !== void 0 ? { exclude_domains: input.exclude_domains } : {},\n" +
					"\t\t\t\t...input.include_answer !== void 0 ? { include_answer: input.include_answer } : {},\n" +
					"\t\t\t\t...input.include_raw_content !== void 0 ? { include_raw_content: input.include_raw_content } : {}\n" +
					"\t\t\t}, exec.signal);",
			},
		],
	},
	"host-apiproxy": {
		id: "host-apiproxy",
		packageName: "@deepseek-ai/dsh-host-apiproxy",
		version: PATCHED_TARGET_VERSIONS["@deepseek-ai/dsh-host-apiproxy"],
		file: "lib/index.js",
		description:
			"settings.describe allowlist: expose only this plugin's settings namespace (dsh-tavily-search-provider) to the Web client",
		/** Stale text a previous manual edit or an older plugin name left behind; presence refuses patching until cleaned. */
		legacyMarkers: ["dsh-web-search-tavily"],
		hunks: [
			{
				id: "settings-namespace-allowlist",
				anchor: "\t\"web-search-deepseek\"\n];",
				replacement:
					"\t\"web-search-deepseek\",\n" +
					"\t\"dsh-tavily-search-provider\" // dsh-tavily-search-provider: Tavily settings card (official web_search backend switch)\n" +
					"];",
			},
		],
	},
};

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
	if (needle.length === 0) return 0;
	let count = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) return count;
		count += 1;
		from = at + needle.length;
	}
}

/**
 * Resolve one target package's root directory using Node's own node_modules
 * walk from each anchor. Production anchors: the running `dsh` CLI entry
 * (`process.argv[1]`) and this module's own location — both are dynamic and
 * machine-independent, matching how `dsh-app-boot` resolves installation
 * bundles. `env.packageDirs` overrides discovery entirely (tests).
 * @param packageName - the official package name.
 * @param env - optional `{ anchors?, packageDirs? }`.
 * @returns the absolute package directory, or `undefined`.
 */
export function resolvePackageDir(packageName, env = {}) {
	if (env.packageDirs?.[packageName] !== void 0) return env.packageDirs[packageName];
	const anchors = [];
	if (env.anchors !== void 0) anchors.push(...env.anchors);
	const argvEntry = process.argv[1];
	if (typeof argvEntry === "string" && existsSync(argvEntry)) anchors.push(argvEntry);
	anchors.push(fileURLToPath(import.meta.url));
	for (const anchor of anchors) {
		for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
			const candidate = join(searchPath, packageName);
			if (existsSync(join(candidate, "package.json"))) return candidate;
		}
	}
	return void 0;
}

/**
 * Read a target's installed manifest. Never throws: an unreadable or
 * non-JSON manifest resolves to `{ manifestError }` so the caller can skip the
 * target instead of crashing (v2: parsing never fails the run).
 */
function readInstalledManifest(packageDir) {
	const manifestPath = join(packageDir, "package.json");
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		return { version: typeof manifest.version === "string" ? manifest.version : void 0 };
	} catch (error) {
		return { manifestError: error instanceof Error ? error.message : String(error) };
	}
}

/** Atomic file replace: write a sibling temp file, then rename over the target. */
function atomicReplace(filePath, content) {
	const tmpPath = `${filePath}.dsh-tavily-patch.tmp`;
	try {
		writeFileSync(tmpPath, content, "utf8");
		renameSync(tmpPath, filePath);
	} catch (error) {
		try {
			rmSync(tmpPath, { force: true });
		} catch { /* best-effort temp cleanup */ }
		throw new PatchError("write-failed", `failed to write ${filePath}: ${String(error?.message ?? error)} — run as the user that owns the dsh installation, or restore the official package`, { file: filePath });
	}
}

/** A per-target skip outcome with its failure reason. */
function skipOutcome(target, file, version, reason, detail) {
	return {
		id: target.id,
		packageName: target.packageName,
		file,
		version,
		action: "skipped",
		reason,
		detail,
		hunks: [],
	};
}

/**
 * Classify one target for apply WITHOUT writing (v2 decision tree):
 * 1. package not found → `missing`; unreadable manifest → `unreadable-manifest`;
 *    unreadable target file → `unreadable-file` — all skipped, never thrown.
 * 2. legacy markers present → `legacy` (content drift, checked BEFORE version:
 *    a legacy file skips under version match AND mismatch).
 * 3. strict mode + version mismatch → `version`.
 * 4. adaptive (default) + version mismatch: every hunk anchor unique → patch
 *    (`adaptive: true`); any missing/ambiguous anchor → `version-anchor`.
 * 5. version match: missing/ambiguous anchors → `anchor` when nothing is
 *    applied yet, `partial` when some hunks are already applied and others are
 *    blocked; every hunk already applied → `already-patched`; otherwise patch.
 *
 * A hunk whose inserted text is already present in the ORIGINAL source is a
 * no-op (idempotency, checked before its anchor); remaining hunks are applied
 * in declaration order against the evolving content, each anchor required to
 * occur exactly once.
 * @returns the per-target outcome; `content` is present only for `applied`.
 */
function classifyApplyTarget(target, env, options = {}) {
	const packageDir = resolvePackageDir(target.packageName, env);
	if (packageDir === void 0) {
		return skipOutcome(target, void 0, void 0, "missing", `package ${target.packageName} not found in the dsh installation; run this command from the installed plugin location (its node_modules under the dsh profile) with dsh installed`);
	}
	const filePath = join(packageDir, target.file);
	const { manifestError, version } = readInstalledManifest(packageDir);
	if (manifestError !== void 0) {
		return skipOutcome(target, filePath, void 0, "unreadable-manifest", `${join(packageDir, "package.json")} is unreadable: ${manifestError}`);
	}
	let source;
	try {
		source = readFileSync(filePath, "utf8");
	} catch (error) {
		return skipOutcome(target, filePath, version, "unreadable-file", `cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (target.legacyMarkers !== void 0 && target.legacyMarkers.some((marker) => source.includes(marker))) {
		return skipOutcome(target, filePath, version, "legacy", `${target.file} carries a legacy manual edit (${target.legacyMarkers.join(", ")}); restore the official package (or remove that edit) before applying this plugin's patch`);
	}
	const versionOk = version === target.version;
	if (!versionOk && options.strict === true) {
		return skipOutcome(target, filePath, version, "version", `installed "${version}", supported "${target.version}" (strict mode)`);
	}
	const results = [];
	const blockers = [];
	let anyAlready = false;
	let next = source;
	for (const hunk of target.hunks) {
		if (source.includes(hunk.replacement)) {
			results.push({ id: hunk.id, status: "already" });
			anyAlready = true;
			continue;
		}
		const count = countOccurrences(next, hunk.anchor);
		if (count === 0) {
			blockers.push({ hunk: hunk.id, reason: "missing-anchor" });
			results.push({ id: hunk.id, status: "skip", reason: "missing-anchor" });
			continue;
		}
		if (count > 1) {
			blockers.push({ hunk: hunk.id, reason: "ambiguous-anchor" });
			results.push({ id: hunk.id, status: "skip", reason: "ambiguous-anchor" });
			continue;
		}
		const at = next.indexOf(hunk.anchor);
		next = next.slice(0, at) + hunk.replacement + next.slice(at + hunk.anchor.length);
		results.push({ id: hunk.id, status: "patched" });
	}
	if (blockers.length > 0) {
		const reason = !versionOk ? "version-anchor" : anyAlready ? "partial" : "anchor";
		const detail = blockers.map((blocker) => `${blocker.hunk}: ${blocker.reason}`).join("; ") +
			(!versionOk ? ` (installed "${version}", supported "${target.version}")` : "");
		return skipOutcome(target, filePath, version, reason, detail);
	}
	if (next === source) {
		return { id: target.id, packageName: target.packageName, file: filePath, version, action: "already-applied", reason: "already-patched", hunks: results };
	}
	return { id: target.id, packageName: target.packageName, file: filePath, version, action: "applied", ...(versionOk ? {} : { adaptive: true }), hunks: results, content: next };
}

/**
 * Classify one target for restore WITHOUT writing (v2 restore, ALWAYS strict):
 * 1. package not found → `missing`; unreadable manifest → `unreadable-manifest`;
 *    unreadable target file → `unreadable-file`.
 * 2. version mismatch → `version`.
 * 3. legacy markers present → `restore-blocked`.
 * 4. hunks unwind in REVERSE declaration order: a hunk whose inserted text is
 *    present must occur exactly once (more → `ambiguous-to` blocker); a hunk
 *    with no inserted text is `already` when its official anchor is present,
 *    and a `foreign-layout` blocker when the anchor is gone too (foreign
 *    edits / upstream rewrite — restoring never guesses on unknown layouts).
 * 5. any blocker → `restore-blocked`; nothing to unwind → `already-restored`;
 *    otherwise restore the exact inserted text.
 * @returns the per-target outcome; `content` is present only for `restored`.
 */
function classifyRestoreTarget(target, env) {
	const packageDir = resolvePackageDir(target.packageName, env);
	if (packageDir === void 0) {
		return skipOutcome(target, void 0, void 0, "missing", `package ${target.packageName} not found in the dsh installation`);
	}
	const filePath = join(packageDir, target.file);
	const { manifestError, version } = readInstalledManifest(packageDir);
	if (manifestError !== void 0) {
		return skipOutcome(target, filePath, void 0, "unreadable-manifest", `${join(packageDir, "package.json")} is unreadable: ${manifestError}`);
	}
	if (version !== target.version) {
		return skipOutcome(target, filePath, version, "version", `installed "${version}", supported "${target.version}" — restoring an untested version is refused`);
	}
	let source;
	try {
		source = readFileSync(filePath, "utf8");
	} catch (error) {
		return skipOutcome(target, filePath, version, "unreadable-file", `cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (target.legacyMarkers !== void 0 && target.legacyMarkers.some((marker) => source.includes(marker))) {
		return skipOutcome(target, filePath, version, "restore-blocked", `${target.file} carries a legacy manual edit (${target.legacyMarkers.join(", ")}); restore the official package manually before removing this plugin's patch`);
	}
	const results = [];
	const blockers = [];
	let next = source;
	for (const hunk of [...target.hunks].reverse()) {
		if (next.includes(hunk.replacement)) {
			const count = countOccurrences(next, hunk.replacement);
			if (count > 1) {
				blockers.push({ hunk: hunk.id, reason: "ambiguous-to" });
				results.push({ id: hunk.id, status: "skip", reason: "ambiguous-to" });
				continue;
			}
			const at = next.indexOf(hunk.replacement);
			next = next.slice(0, at) + hunk.anchor + next.slice(at + hunk.replacement.length);
			results.push({ id: hunk.id, status: "unpatched" });
			continue;
		}
		if (next.includes(hunk.anchor)) {
			results.push({ id: hunk.id, status: "already" });
			continue;
		}
		blockers.push({ hunk: hunk.id, reason: "foreign-layout" });
		results.push({ id: hunk.id, status: "skip", reason: "foreign-layout" });
	}
	if (blockers.length > 0) {
		return skipOutcome(target, filePath, version, "restore-blocked", blockers.map((blocker) => `${blocker.hunk}: ${blocker.reason}`).join("; "));
	}
	if (next === source) {
		return { id: target.id, packageName: target.packageName, file: filePath, version, action: "already-restored", reason: "already-restored", hunks: results };
	}
	return { id: target.id, packageName: target.packageName, file: filePath, version, action: "restored", hunks: results, content: next };
}

/**
 * Apply one target's patch. v2 semantics: never throws for installation-state
 * reasons (missing package, unreadable manifest/file, version policy, anchor
 * drift, legacy/foreign content, already applied) — each of those resolves to
 * a `skipped` outcome with a reason. Only an `applied` outcome writes, through
 * a temp file + rename. Throws {@link PatchError} only for an unknown target
 * id (programming error) or a write failure.
 * @param id - target id (`tool-web` or `host-apiproxy`).
 * @param env - optional resolution override (tests).
 * @param options - `{ strict }`: strict version policy (see module docs).
 * @returns `{ id, packageName, file, version, action, adaptive?, reason?,
 *   detail?, hunks }` with action `applied`, `already-applied`, or `skipped`.
 */
export function applyTarget(id, env = {}, options = {}) {
	const target = PATCH_TARGETS[id];
	if (target === void 0) throw new PatchError("invalid-target", `unknown patch target ${JSON.stringify(id)}`);
	const outcome = classifyApplyTarget(target, env, options);
	if (outcome.content !== void 0) {
		atomicReplace(outcome.file, outcome.content);
		delete outcome.content;
	}
	return outcome;
}

/**
 * Restore one target: remove exactly the text this plugin inserted. Restore
 * is ALWAYS strict and never throws for installation-state reasons — each
 * refusal resolves to a `skipped` outcome with a reason. Only a `restored`
 * outcome writes (temp file + rename). Throws {@link PatchError} only for an
 * unknown target id (programming error) or a write failure.
 * @param id - target id.
 * @param env - optional resolution override (tests).
 * @returns `{ id, packageName, file, version, action, reason?, detail?, hunks }`
 *   with action `restored`, `already-restored`, or `skipped`.
 */
export function restoreTarget(id, env = {}) {
	const target = PATCH_TARGETS[id];
	if (target === void 0) throw new PatchError("invalid-target", `unknown patch target ${JSON.stringify(id)}`);
	const outcome = classifyRestoreTarget(target, env);
	if (outcome.content !== void 0) {
		atomicReplace(outcome.file, outcome.content);
		delete outcome.content;
	}
	return outcome;
}

/** Failure skips (ok=false) are every reason except the idempotent no-op ones. */
const NON_FAILURE_REASONS = new Set(["already-patched", "already-restored"]);

/**
 * Aggregate per-target apply outcomes into the v2 report.
 * @returns `{ ok, summary, applied, skipped }` — `applied` carries every
 *   `applied` outcome (`adaptive` set on version-mismatched writes), `skipped`
 *   carries every other outcome with its reason, and `ok` is false when any
 *   failure skip exists (anything but `already-patched`).
 */
function aggregateApply(outcomes) {
	const applied = outcomes.filter((outcome) => outcome.action === "applied").map((outcome) => ({
		id: outcome.id,
		packageName: outcome.packageName,
		file: outcome.file,
		...(outcome.adaptive === true ? { adaptive: true } : {}),
	}));
	const skipped = outcomes.filter((outcome) => outcome.action !== "applied").map((outcome) => ({
		id: outcome.id,
		packageName: outcome.packageName,
		file: outcome.file,
		reason: outcome.reason,
		detail: outcome.detail,
	}));
	const failureSkipped = skipped.filter((entry) => !NON_FAILURE_REASONS.has(entry.reason));
	const summary = applied.length === 0 && failureSkipped.length === 0
		? `all ${skipped.length} target(s) already carry the patch`
		: [
			applied.length > 0 ? `patched ${applied.map((entry) => entry.id + (entry.adaptive === true ? " (adaptive version match)" : "")).join(", ")}` : "",
			failureSkipped.length > 0 ? `skipped ${failureSkipped.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}` : "",
			skipped.filter((entry) => entry.reason === "already-patched").length > 0 ? `already patched: ${skipped.filter((entry) => entry.reason === "already-patched").length} target(s)` : "",
		].filter(Boolean).join("; ");
	return { ok: failureSkipped.length === 0, summary, applied, skipped };
}

/**
 * Aggregate per-target restore outcomes into the v2 report.
 * @returns `{ ok, summary, reverted, skipped }` — `reverted` carries every
 *   `restored` outcome, `skipped` every other outcome with its reason, and
 *   `ok` is false when any failure skip exists (anything but
 *   `already-restored`).
 */
function aggregateRestore(outcomes) {
	const reverted = outcomes.filter((outcome) => outcome.action === "restored").map((outcome) => ({
		id: outcome.id,
		packageName: outcome.packageName,
		file: outcome.file,
	}));
	const skipped = outcomes.filter((outcome) => outcome.action !== "restored").map((outcome) => ({
		id: outcome.id,
		packageName: outcome.packageName,
		file: outcome.file,
		reason: outcome.reason,
		detail: outcome.detail,
	}));
	const failureSkipped = skipped.filter((entry) => !NON_FAILURE_REASONS.has(entry.reason));
	const summary = reverted.length === 0 && failureSkipped.length === 0
		? `all ${skipped.length} target(s) already carry the original sources`
		: [
			reverted.length > 0 ? `restored ${reverted.map((entry) => entry.id).join(", ")}` : "",
			failureSkipped.length > 0 ? `refused ${failureSkipped.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}` : "",
			skipped.filter((entry) => entry.reason === "already-restored").length > 0 ? `already original: ${skipped.filter((entry) => entry.reason === "already-restored").length} target(s)` : "",
		].filter(Boolean).join("; ");
	return { ok: failureSkipped.length === 0, summary, reverted, skipped };
}

/**
 * Apply every target, each decided independently (see {@link applyTarget}).
 * @param env - optional resolution override (tests).
 * @param options - `{ strict }`: strict version policy (see module docs).
 * @returns `{ ok, summary, applied, skipped }`; `ok` is false when any target
 *   was skipped for a failure reason.
 */
export function applyAll(env = {}, options = {}) {
	return aggregateApply(Object.keys(PATCH_TARGETS).map((id) => applyTarget(id, env, options)));
}

/**
 * Restore every target, each decided independently (see {@link restoreTarget}).
 * @param env - optional resolution override (tests).
 * @returns `{ ok, summary, reverted, skipped }`; `ok` is false when any target
 *   was skipped for a failure reason.
 */
export function restoreAll(env = {}) {
	return aggregateRestore(Object.keys(PATCH_TARGETS).map((id) => restoreTarget(id, env)));
}

/** Inspect-state mapping for the apply skip reasons. */
const SKIP_STATES = {
	missing: "missing",
	"unreadable-manifest": "unreadable-manifest",
	"unreadable-file": "unreadable-file",
	legacy: "legacy",
	version: "version-mismatch",
	"version-anchor": "version-mismatch",
	anchor: "drifted",
	partial: "partial",
	"already-patched": "applied",
};

/**
 * Inspect one target without modifying anything: resolves the package
 * dynamically and classifies the current file state through the SAME v2
 * decision tree apply uses (adaptive view), so status output never contradicts
 * what apply would do. Never throws for a state the operator can act on;
 * throws {@link PatchError} only for an unknown target id.
 * @param id - target id (`tool-web` or `host-apiproxy`).
 * @param env - optional resolution override.
 * @returns the inspection record (`state`, `hunks`, `detail`, ...).
 */
export function inspectTarget(id, env = {}) {
	const target = PATCH_TARGETS[id];
	if (target === void 0) throw new PatchError("invalid-target", `unknown patch target ${JSON.stringify(id)}`);
	const classified = classifyApplyTarget(target, env, { strict: false });
	const state = classified.action === "skipped"
		? (SKIP_STATES[classified.reason] ?? "drifted")
		: classified.version !== target.version
			? "version-mismatch"
			: classified.action === "applied" ? "clean" : "applied";
	const detail = state === "version-mismatch"
		? (classified.detail ?? `installed ${classified.version}, supported ${target.version} — adaptive apply would succeed, strict apply refuses`)
		: (classified.detail ?? (state === "clean" ? "official file, patch not yet applied" : state === "applied" ? "patch already applied" : ""));
	return {
		id,
		packageName: target.packageName,
		version: classified.version,
		filePath: classified.file,
		state,
		hunks: classified.hunks,
		detail,
	};
}

/** Inspect every target. */
export function inspectAll(env = {}) {
	return Object.keys(PATCH_TARGETS).map((id) => inspectTarget(id, env));
}

/** Human-readable one-line status for a target's state. */
export function describeState(state) {
	switch (state) {
		case "clean": return "not applied (official file intact)";
		case "applied": return "applied";
		case "missing": return "not found";
		case "version-mismatch": return "version mismatch — refusing";
		case "drifted": return "drifted anchors — refusing";
		case "partial": return "partially applied — refusing";
		case "legacy": return "legacy manual edit present — refusing";
		case "unreadable-manifest": return "unreadable package.json — refusing";
		case "unreadable-file": return "target file unreadable — refusing";
		default: return state;
	}
}
