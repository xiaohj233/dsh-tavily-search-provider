/**
 * Tests for the guarded installed-package patch engine
 * (`lib/installed-patches.mjs`) against byte-exact fixtures copied from the
 * clean `0.1.0-rc.6` npm tarballs and the tested installed files (see
 * `test/fixtures/README.md`).
 *
 * v2 patch semantics under test:
 * - adaptive by default: a version-mismatched target is patched when every
 *   hunk anchor still matches uniquely (`adaptive: true`); otherwise that
 *   target is skipped with a reason.
 * - strict option: only the exact tested version is patched.
 * - one drifted/foreign/legacy target never blocks the others; no
 *   installation-state problem ever throws.
 * - legacy/partial are content drift, not version problems: they skip under
 *   BOTH version match and version mismatch.
 * - restore is ALWAYS strict (untested versions, legacy/foreign layouts, and
 *   non-canonical `to` text refuse).
 * - idempotent apply/restore, byte-exact roundtrip, atomic writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	PATCH_TARGETS,
	PatchError,
	applyAll,
	applyTarget,
	inspectTarget,
	restoreAll,
	restoreTarget,
} from "../lib/installed-patches.mjs";
import { bootApplyPatches } from "../lib/boot.mjs";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/", import.meta.url)).replace(/[\\/]$/, "");

/** Copy one fixture into a fresh sandbox dir; returns the package root. */
function sandboxPackage(fixtureName, packageName) {
	const sandbox = mkdtempSync(join(tmpdir(), "dsh-tavily-patch-"));
	const packageRoot = join(sandbox, packageName);
	mkdirSync(packageRoot, { recursive: true });
	// Clean fixtures keep the npm tarball layout (a `package/` subtree); the
	// applied/legacy fixtures are flat package roots.
	const source = join(FIXTURE_ROOT, fixtureName);
	const packageTree = join(source, "package");
	cpSync(existsSync(packageTree) ? packageTree : source, packageRoot, { recursive: true });
	return { sandbox, packageRoot };
}

/** Build a resolution env over one or more sandboxed packages. */
function envOf(...entries) {
	const packageDirs = {};
	for (const [name, root] of entries) packageDirs[name] = root;
	return { packageDirs };
}

function cleanFile(fixtureName) {
	return readFileSync(join(FIXTURE_ROOT, fixtureName, "package/lib/index.js"), "utf8");
}

function fileOf(env, targetId) {
	return readFileSync(join(env.packageDirs[PATCH_TARGETS[targetId].packageName], PATCH_TARGETS[targetId].file), "utf8");
}

function writeVersion(packageRoot, version) {
	const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	manifest.version = version;
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

test("tool-web: apply matches the tested installed file byte-for-byte, restore is byte-exact", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		assert.equal(inspectTarget("tool-web", env).state, "clean");
		const applied = applyTarget("tool-web", env);
		assert.equal(applied.action, "applied");
		assert.equal(applied.adaptive, undefined, "an exact-version apply is not adaptive");
		const evidence = readFileSync(join(FIXTURE_ROOT, "dsh-tool-web-applied/lib/index.js"), "utf8");
		assert.equal(fileOf(env, "tool-web"), evidence, "applied file must equal the tested installed file");
		assert.equal(inspectTarget("tool-web", env).state, "applied");
		const restored = restoreTarget("tool-web", env);
		assert.equal(restored.action, "restored");
		assert.equal(fileOf(env, "tool-web"), cleanFile("dsh-tool-web-0.1.0-rc.6"), "restore must reproduce the pristine bytes");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("host-apiproxy: apply adds only this settings namespace; restore is byte-exact", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-host-apiproxy", packageRoot]);
		assert.equal(inspectTarget("host-apiproxy", env).state, "clean");
		const applied = applyTarget("host-apiproxy", env);
		assert.equal(applied.action, "applied");
		const appliedFile = fileOf(env, "host-apiproxy");
		assert.ok(appliedFile.includes('"dsh-tavily-search-provider"'), "allowlist carries the plugin namespace");
		assert.equal(appliedFile.includes("keepalive"), false, "no foreign namespace is added");
		assert.equal(appliedFile.includes("dsh-web-search-tavily"), false, "no legacy name is added");
		const restored = restoreTarget("host-apiproxy", env);
		assert.equal(restored.action, "restored");
		assert.equal(fileOf(env, "host-apiproxy"), cleanFile("dsh-host-apiproxy-0.1.0-rc.6"));
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("adaptive mode patches a version-mismatched target when every anchor matches", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		writeVersion(packageRoot, "0.1.0-rc.7");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		const outcome = applyTarget("tool-web", env);
		assert.equal(outcome.action, "applied");
		assert.equal(outcome.adaptive, true, "a version-mismatched apply must be flagged adaptive");
		assert.equal(outcome.version, "0.1.0-rc.7");
		const evidence = readFileSync(join(FIXTURE_ROOT, "dsh-tool-web-applied/lib/index.js"), "utf8");
		assert.equal(fileOf(env, "tool-web"), evidence, "adaptive apply on matching anchors produces the same bytes");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("adaptive mode skips a version-mismatched target whose anchors drifted; the other target still patches", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		writeVersion(tool.packageRoot, "0.2.0");
		writeFileSync(join(tool.packageRoot, "lib/index.js"), "// a rewritten upstream file\n");
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const report = applyAll(env);
		assert.equal(report.ok, false);
		const skipped = report.skipped.find((entry) => entry.id === "tool-web");
		assert.equal(skipped.reason, "version-anchor");
		assert.equal(fileOf(env, "tool-web"), "// a rewritten upstream file\n", "drifted copy must stay untouched");
		assert.ok(fileOf(env, "host-apiproxy").includes('"dsh-tavily-search-provider"'), "the other target still patches");
		assert.ok(report.applied.some((entry) => entry.id === "host-apiproxy"));
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("strict mode refuses every version-mismatched target even when anchors match", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		writeVersion(tool.packageRoot, "0.1.0-rc.7");
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const report = applyAll(env, { strict: true });
		assert.equal(report.ok, false);
		const skipped = report.skipped.find((entry) => entry.id === "tool-web");
		assert.equal(skipped.reason, "version");
		assert.equal(fileOf(env, "tool-web"), cleanFile("dsh-tool-web-0.1.0-rc.6"), "strict mode must not write");
		assert.ok(fileOf(env, "host-apiproxy").includes('"dsh-tavily-search-provider"'), "exact-version copies still patch in strict mode");
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("an unreadable manifest skips that target without throwing; the other target still patches", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		writeFileSync(join(tool.packageRoot, "package.json"), "{ not json");
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const report = applyAll(env);
		assert.equal(report.ok, false);
		const skipped = report.skipped.find((entry) => entry.id === "tool-web");
		assert.equal(skipped.reason, "unreadable-manifest");
		assert.ok(fileOf(env, "host-apiproxy").includes('"dsh-tavily-search-provider"'), "the other target still patches");
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("a drifted copy is skipped on its own (version match); the other target still patches", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		writeFileSync(join(tool.packageRoot, "lib/index.js"), "// not the real tool-web\n");
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const report = applyAll(env);
		assert.equal(report.ok, false);
		const skipped = report.skipped.find((entry) => entry.id === "tool-web");
		assert.equal(skipped.reason, "anchor");
		assert.equal(fileOf(env, "tool-web"), "// not the real tool-web\n");
		assert.ok(fileOf(env, "host-apiproxy").includes('"dsh-tavily-search-provider"'), "the other target still patches");
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("ambiguous anchors skip that target only, with the reason named", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const target = PATCH_TARGETS["tool-web"];
		const content = cleanFile("dsh-tool-web-0.1.0-rc.6");
		// Duplicate the first hunk's anchor so it occurs twice.
		const anchor = target.hunks[0].anchor;
		const doubled = content.replace(anchor, `${anchor}\n${anchor}`);
		writeFileSync(join(packageRoot, target.file), doubled, "utf8");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		const outcome = applyTarget("tool-web", env);
		assert.equal(outcome.action, "skipped");
		assert.equal(outcome.reason, "anchor");
		assert.ok(outcome.detail.includes("ambiguous-anchor"), "detail names the ambiguous hunk");
		assert.equal(fileOf(env, "tool-web"), doubled, "file must stay untouched");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("a partially applied file with a drifted hunk skips as partial, without writing", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const target = PATCH_TARGETS["tool-web"];
		const content = cleanFile("dsh-tool-web-0.1.0-rc.6");
		// First hunk applied, second hunk's anchor destroyed: the target is
		// partially patched and cannot be completed — nothing may be written.
		const corrupted = content.replace(target.hunks[0].anchor, target.hunks[0].replacement).replace(target.hunks[1].anchor, "		text: drifted");
		writeFileSync(join(packageRoot, target.file), corrupted, "utf8");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		const outcome = applyTarget("tool-web", env);
		assert.equal(outcome.action, "skipped");
		assert.equal(outcome.reason, "partial");
		assert.equal(fileOf(env, "tool-web"), corrupted, "no partial write may occur");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("a foreign state (other plugin's allowlist row, no legacy marker) skips as anchor drift", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const target = PATCH_TARGETS["host-apiproxy"];
		const content = cleanFile("dsh-host-apiproxy-0.1.0-rc.6");
		// Insert a foreign row between the last allowlist entry and the closing
		// bracket: our anchor no longer exists, but no legacy marker does either.
		const foreign = content.replace(target.hunks[0].anchor, '\t"web-search-deepseek",\n\t"keepalive" // some other plugin\n];');
		writeFileSync(join(packageRoot, target.file), foreign, "utf8");
		const env = envOf(["@deepseek-ai/dsh-host-apiproxy", packageRoot]);
		const outcome = applyTarget("host-apiproxy", env);
		assert.equal(outcome.action, "skipped");
		assert.equal(outcome.reason, "anchor");
		assert.equal(fileOf(env, "host-apiproxy"), foreign);
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("legacy manual edits (pre-rename dsh-web-search-tavily) skip under adaptive, in version match AND mismatch; restore refuses", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-host-apiproxy-applied", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-host-apiproxy", packageRoot]);
		const before = fileOf(env, "host-apiproxy");
		// Version matches (the fixture is 0.1.0-rc.6): legacy is content drift.
		const matched = applyTarget("host-apiproxy", env);
		assert.equal(matched.action, "skipped");
		assert.equal(matched.reason, "legacy");
		// Restore is always strict: at the matching version, the legacy layout
		// refuses with restore-blocked (restore never guesses on unknown layouts).
		const restoredAtVersion = restoreTarget("host-apiproxy", env);
		assert.equal(restoredAtVersion.action, "skipped");
		assert.equal(restoredAtVersion.reason, "restore-blocked");
		assert.ok(restoredAtVersion.detail.includes("legacy"));
		// Version mismatch does NOT unlock legacy content: still skipped as legacy.
		writeVersion(packageRoot, "0.2.0");
		const mismatched = applyTarget("host-apiproxy", env);
		assert.equal(mismatched.action, "skipped");
		assert.equal(mismatched.reason, "legacy", "legacy is content drift, not a version problem");
		// At an untested version, restore refuses on the version before anything else.
		const restoredAtVersionMismatch = restoreTarget("host-apiproxy", env);
		assert.equal(restoredAtVersionMismatch.action, "skipped");
		assert.equal(restoredAtVersionMismatch.reason, "version");
		assert.equal(fileOf(env, "host-apiproxy"), before, "legacy file must stay untouched");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("apply and restore are idempotent: second runs skip everything, ok stays true, bytes untouched", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const first = applyAll(env);
		assert.equal(first.ok, true);
		assert.equal(first.applied.length, 2);
		const afterFirst = [fileOf(env, "tool-web"), fileOf(env, "host-apiproxy")];
		const second = applyAll(env);
		assert.equal(second.ok, true);
		assert.equal(second.applied.length, 0);
		assert.ok(second.skipped.length === 2 && second.skipped.every((entry) => entry.reason === "already-patched"));
		assert.deepEqual([fileOf(env, "tool-web"), fileOf(env, "host-apiproxy")], afterFirst, "re-applying must not change the files");
		const restored = restoreAll(env);
		assert.equal(restored.ok, true);
		assert.equal(restored.reverted.length, 2);
		const pristine = [fileOf(env, "tool-web"), fileOf(env, "host-apiproxy")];
		const restoredAgain = restoreAll(env);
		assert.equal(restoredAgain.ok, true);
		assert.equal(restoredAgain.reverted.length, 0);
		assert.ok(restoredAgain.skipped.every((entry) => entry.reason === "already-restored"));
		assert.deepEqual([fileOf(env, "tool-web"), fileOf(env, "host-apiproxy")], pristine);
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("byte-exact roundtrip: applyAll then restoreAll reverts both targets to the original bytes", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const report = applyAll(env);
		assert.equal(report.ok, true);
		assert.match(report.summary, /patched/);
		const undo = restoreAll(env);
		assert.equal(undo.ok, true);
		assert.equal(undo.reverted.length, 2);
		assert.equal(fileOf(env, "tool-web"), cleanFile("dsh-tool-web-0.1.0-rc.6"), "tool-web must be restored byte-exactly");
		assert.equal(fileOf(env, "host-apiproxy"), cleanFile("dsh-host-apiproxy-0.1.0-rc.6"), "host-apiproxy must be restored byte-exactly");
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("restore is strict: a version-mismatched target is refused and left untouched", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		applyAll(env);
		const evidence = fileOf(env, "tool-web");
		writeVersion(tool.packageRoot, "0.1.0-rc.7");
		const report = restoreAll(env);
		assert.equal(report.ok, false);
		const skipped = report.skipped.find((entry) => entry.id === "tool-web");
		assert.equal(skipped.reason, "version");
		assert.equal(fileOf(env, "tool-web"), evidence, "the mismatched copy stays patched and untouched");
		assert.equal(fileOf(env, "host-apiproxy"), cleanFile("dsh-host-apiproxy-0.1.0-rc.6"), "the matched copy still restores");
		assert.ok(report.reverted.some((entry) => entry.id === "host-apiproxy"));
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("restore refuses when the inserted text occurs more than once (non-canonical layout)", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const target = PATCH_TARGETS["tool-web"];
		const doubled = `${target.hunks[0].replacement}\n\n${target.hunks[0].replacement}\n`;
		writeFileSync(join(packageRoot, target.file), doubled, "utf8");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		const outcome = restoreTarget("tool-web", env);
		assert.equal(outcome.action, "skipped");
		assert.equal(outcome.reason, "restore-blocked");
		assert.ok(outcome.detail.includes("ambiguous-to"));
		assert.equal(fileOf(env, "tool-web"), doubled, "restore must not guess on a non-canonical layout");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("restore refuses a foreign/drifted layout (neither our text nor the official anchor)", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const target = PATCH_TARGETS["host-apiproxy"];
		const foreign = cleanFile("dsh-host-apiproxy-0.1.0-rc.6").replace(target.hunks[0].anchor, '\t"web-search-deepseek",\n\t"keepalive" // some other plugin\n];');
		writeFileSync(join(packageRoot, target.file), foreign, "utf8");
		const env = envOf(["@deepseek-ai/dsh-host-apiproxy", packageRoot]);
		const outcome = restoreTarget("host-apiproxy", env);
		assert.equal(outcome.action, "skipped");
		assert.equal(outcome.reason, "restore-blocked");
		assert.equal(fileOf(env, "host-apiproxy"), foreign, "a foreign file must never be touched");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("a hunk whose inserted text is already present is skipped without checking its anchor", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const target = PATCH_TARGETS["tool-web"];
		// All replacements present (no official anchors): every hunk must skip
		// as already applied, even though the anchors do not exist here.
		const content = target.hunks.map((hunk) => hunk.replacement).join("\n");
		writeFileSync(join(packageRoot, target.file), content, "utf8");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		const outcome = applyTarget("tool-web", env);
		assert.equal(outcome.action, "already-applied");
		assert.equal(fileOf(env, "tool-web"), content);
		const undone = restoreTarget("tool-web", env);
		assert.equal(undone.action, "restored", "restore unwinds every present replacement");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("a missing target reports a skip without throwing (apply and restore)", () => {
	const env = { packageDirs: {} };
	const outcome = applyTarget("tool-web", env);
	assert.equal(outcome.action, "skipped");
	assert.equal(outcome.reason, "missing");
	const report = applyAll(env);
	assert.equal(report.ok, false);
	assert.ok(report.skipped.every((entry) => entry.reason === "missing"));
	const restored = restoreTarget("tool-web", env);
	assert.equal(restored.action, "skipped");
	assert.equal(restored.reason, "missing");
});

test("unknown target ids are rejected as programming errors", () => {
	assert.throws(() => inspectTarget("nope"), (error) => error instanceof PatchError && error.code === "invalid-target");
	assert.throws(() => applyTarget("nope"), (error) => error instanceof PatchError && error.code === "invalid-target");
	assert.throws(() => restoreTarget("nope"), (error) => error instanceof PatchError && error.code === "invalid-target");
});

test("bootApplyPatches records per-target applied/skipped outcomes and never throws", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const logs = [];
		const logger = { info: (m) => logs.push(`info: ${m}`), warn: (m) => logs.push(`warn: ${m}`) };
		const first = bootApplyPatches(logger, env);
		assert.equal(first.length, 2);
		assert.ok(first.every((entry) => entry.state === "applied-now" && entry.action === "applied"), `states: ${first.map((e) => e.state).join(", ")}`);
		// Second boot: already applied, still no throw.
		const second = bootApplyPatches(logger, env);
		assert.ok(second.every((entry) => entry.state === "applied"));
		// A drifted target records a skip (not a refusal crash), the other target keeps applying.
		writeFileSync(join(tool.packageRoot, "lib/index.js"), "// drifted\n");
		const third = bootApplyPatches(logger, env);
		const toolEntry = third.find((entry) => entry.targetId === "tool-web");
		assert.equal(toolEntry.state, "skipped");
		assert.equal(toolEntry.reason, "anchor");
		const proxyEntry = third.find((entry) => entry.targetId === "host-apiproxy");
		assert.equal(proxyEntry.state, "applied");
		assert.ok(logs.some((line) => line.startsWith("warn:")), "skips are logged as warnings, never thrown");
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});
