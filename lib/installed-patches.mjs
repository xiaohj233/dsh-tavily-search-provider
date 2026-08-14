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
 * Guards (see the publication design's patch policy):
 * - exact target package version (`0.1.0-rc.6`) — anything else refuses;
 * - exactly one structural anchor per hunk, or the whole target refuses
 *   (ambiguous anchors are never guessed);
 * - idempotent apply and restore (re-applying an applied patch and restoring
 *   a clean file are no-ops);
 * - atomic per-file writes (temp file + rename; a target is all-or-nothing);
 * - restore removes only the exact text this plugin inserted;
 * - foreign or legacy states (e.g. the pre-rename `dsh-web-search-tavily`
 *   manual edit) refuse with a specific message instead of being touched.
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

/** Structured failure of one guarded patch operation. */
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
 * `scripts/audit-verify.mjs`; keep them in sync with the evidence there.
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

/** Read a target's installed version from its package.json. */
function installedVersion(packageDir) {
	const manifestPath = join(packageDir, "package.json");
	if (!existsSync(manifestPath)) return void 0;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		return typeof manifest.version === "string" ? manifest.version : void 0;
	} catch {
		return void 0;
	}
}

/** Per-hunk state: `clean`, `applied`, `ambiguous`, `absent`, or `mixed`. */
function hunkState(content, hunk) {
	const anchors = countOccurrences(content, hunk.anchor);
	const replacements = countOccurrences(content, hunk.replacement);
	if (anchors > 1 || replacements > 1) return "ambiguous";
	if (anchors === 1 && replacements === 0) return "clean";
	if (anchors === 0 && replacements === 1) return "applied";
	if (anchors === 0 && replacements === 0) return "absent";
	return "mixed";
}

/**
 * Inspect one target without modifying anything: resolves the package
 * dynamically, enforces the exact version, and classifies the current file
 * state. Never throws for a state the operator can act on; throws
 * {@link PatchError} only for discovery-level failures (no package, no file).
 * @param id - target id (`tool-web` or `host-apiproxy`).
 * @param env - optional resolution override.
 * @returns the inspection record.
 */
export function inspectTarget(id, env = {}) {
	const target = PATCH_TARGETS[id];
	if (target === void 0) throw new PatchError("invalid-target", `unknown patch target ${JSON.stringify(id)}`);
	const packageDir = resolvePackageDir(target.packageName, env);
	if (packageDir === void 0) {
		return {
			id,
			packageName: target.packageName,
			version: void 0,
			filePath: void 0,
			state: "missing",
			hunks: target.hunks.map((hunk) => ({ id: hunk.id, state: "absent" })),
			detail: `package ${target.packageName} not found in the dsh installation; run this command from the installed plugin location (its node_modules under the dsh profile) with dsh installed`,
		};
	}
	const version = installedVersion(packageDir);
	if (version !== target.version) {
		return {
			id,
			packageName: target.packageName,
			version,
			filePath: join(packageDir, target.file),
			state: "version-mismatch",
			hunks: target.hunks.map((hunk) => ({ id: hunk.id, state: "absent" })),
			detail: `installed version ${version ?? "(none)"} != tested version ${target.version}; refusing to patch an untested official package`,
		};
	}
	const filePath = join(packageDir, target.file);
	if (!existsSync(filePath)) {
		return {
			id,
			packageName: target.packageName,
			version,
			filePath,
			state: "missing",
			hunks: target.hunks.map((hunk) => ({ id: hunk.id, state: "absent" })),
			detail: `${target.packageName} has no ${target.file}`,
		};
	}
	const content = readFileSync(filePath, "utf8");
	if (target.legacyMarkers !== void 0 && target.legacyMarkers.some((marker) => content.includes(marker))) {
		return {
			id,
			packageName: target.packageName,
			version,
			filePath,
			state: "legacy",
			hunks: target.hunks.map((hunk) => ({ id: hunk.id, state: hunkState(content, hunk) })),
			detail: `${target.file} carries a legacy manual edit (${target.legacyMarkers.join(", ")}); restore the official package (or remove that edit) before applying this plugin's patch`,
		};
	}
	const hunks = target.hunks.map((hunk) => ({ id: hunk.id, state: hunkState(content, hunk) }));
	const states = new Set(hunks.map((hunk) => hunk.state));
	if (states.has("ambiguous")) {
		return { id, packageName: target.packageName, version, filePath, state: "ambiguous", hunks, detail: "an anchor or inserted text occurs more than once; refusing to guess which one to patch" };
	}
	if (states.has("mixed")) {
		return { id, packageName: target.packageName, version, filePath, state: "mixed", hunks, detail: "some hunks are applied and others are not; restore the official package before re-applying" };
	}
	if (states.size === 1 && states.has("clean")) {
		return { id, packageName: target.packageName, version, filePath, state: "clean", hunks, detail: "official file, patch not yet applied" };
	}
	if (states.size === 1 && states.has("applied")) {
		return { id, packageName: target.packageName, version, filePath, state: "applied", hunks, detail: "patch already applied" };
	}
	return { id, packageName: target.packageName, version, filePath, state: "partial", hunks, detail: "patch state is neither clean nor applied; restore the official package first" };
}

/** Build the patched content for a clean target file, or throw a guarded PatchError. */
function planApply(target, content) {
	let next = content;
	for (const hunk of target.hunks) {
		const count = countOccurrences(next, hunk.anchor);
		if (count === 0) throw new PatchError("anchor-not-found", `${target.packageName} ${target.file}: anchor for hunk "${hunk.id}" not found — the official file drifted; refusing`, { hunk: hunk.id });
		if (count > 1) throw new PatchError("anchor-ambiguous", `${target.packageName} ${target.file}: anchor for hunk "${hunk.id}" occurs ${String(count)} times — refusing to guess`, { hunk: hunk.id });
		next = next.replace(hunk.anchor, hunk.replacement);
	}
	return next;
}

/** Build the restored content for an applied target file, or throw a guarded PatchError. */
function planRestore(target, content) {
	let next = content;
	for (const hunk of target.hunks) {
		const count = countOccurrences(next, hunk.replacement);
		if (count === 0) throw new PatchError("replacement-not-found", `${target.packageName} ${target.file}: inserted text for hunk "${hunk.id}" not found — nothing to restore`, { hunk: hunk.id });
		if (count > 1) throw new PatchError("replacement-ambiguous", `${target.packageName} ${target.file}: inserted text for hunk "${hunk.id}" occurs ${String(count)} times — refusing to guess`, { hunk: hunk.id });
		next = next.replace(hunk.replacement, hunk.anchor);
	}
	return next;
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

/**
 * Apply one target's patch. Idempotent: an already-applied target is a
 * successful no-op. Any guard failure throws {@link PatchError} without
 * writing anything.
 * @param id - target id.
 * @param env - optional resolution override.
 * @returns `{ id, action }` where action is `applied` or `already-applied`.
 */
export function applyTarget(id, env = {}) {
	const target = PATCH_TARGETS[id];
	if (target === void 0) throw new PatchError("invalid-target", `unknown patch target ${JSON.stringify(id)}`);
	const inspection = inspectTarget(id, env);
	if (inspection.state === "applied") return { id, action: "already-applied", inspection };
	if (inspection.state !== "clean") {
		throw new PatchError(`state-${inspection.state}`, `${target.packageName}: ${inspection.detail}`);
	}
	const content = readFileSync(inspection.filePath, "utf8");
	const patched = planApply(target, content);
	atomicReplace(inspection.filePath, patched);
	return { id, action: "applied", inspection: inspectTarget(id, env) };
}

/**
 * Restore one target: remove exactly the text this plugin inserted. Idempotent:
 * a clean target is a successful no-op. Any guard failure throws
 * {@link PatchError} without writing anything.
 * @param id - target id.
 * @param env - optional resolution override.
 * @returns `{ id, action }` where action is `restored` or `already-clean`.
 */
export function restoreTarget(id, env = {}) {
	const target = PATCH_TARGETS[id];
	if (target === void 0) throw new PatchError("invalid-target", `unknown patch target ${JSON.stringify(id)}`);
	const inspection = inspectTarget(id, env);
	if (inspection.state === "clean") return { id, action: "already-clean", inspection };
	if (inspection.state !== "applied") {
		throw new PatchError(`state-${inspection.state}`, `${target.packageName}: ${inspection.detail}`);
	}
	const content = readFileSync(inspection.filePath, "utf8");
	const restored = planRestore(target, content);
	atomicReplace(inspection.filePath, restored);
	return { id, action: "restored", inspection: inspectTarget(id, env) };
}

/** Apply every target; stops at the first guarded failure. */
export function applyAll(env = {}) {
	return Object.keys(PATCH_TARGETS).map((id) => applyTarget(id, env));
}

/** Restore every target; stops at the first guarded failure. */
export function restoreAll(env = {}) {
	return Object.keys(PATCH_TARGETS).map((id) => restoreTarget(id, env));
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
		case "ambiguous": return "ambiguous anchor — refusing";
		case "mixed": return "partially applied — refusing";
		case "partial": return "neither clean nor applied — refusing";
		case "legacy": return "legacy manual edit present — refusing";
		default: return state;
	}
}
