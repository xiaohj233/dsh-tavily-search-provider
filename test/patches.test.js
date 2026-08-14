/**
 * Tests for the guarded installed-package patch engine
 * (`lib/installed-patches.mjs`) against byte-exact fixtures copied from the
 * clean `0.1.0-rc.6` npm tarballs and the tested installed files (see
 * `test/fixtures/README.md`).
 *
 * Covered: exact-version enforcement, unique-anchor refusal, idempotent
 * apply/restore, atomic all-or-nothing targets, exact restore to the pristine
 * bytes, legacy-edit refusal, and missing-target discovery.
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
		applyTarget("host-apiproxy", env);
		const applied = fileOf(env, "host-apiproxy");
		assert.ok(applied.includes('"dsh-tavily-search-provider"'), "allowlist carries the plugin namespace");
		assert.equal(applied.includes("keepalive"), false, "no foreign namespace is added");
		assert.equal(applied.includes("dsh-web-search-tavily"), false, "no legacy name is added");
		restoreTarget("host-apiproxy", env);
		assert.equal(fileOf(env, "host-apiproxy"), cleanFile("dsh-host-apiproxy-0.1.0-rc.6"));
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("apply and restore are idempotent", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		applyTarget("tool-web", env);
		const once = fileOf(env, "tool-web");
		const again = applyTarget("tool-web", env);
		assert.equal(again.action, "already-applied");
		assert.equal(fileOf(env, "tool-web"), once, "re-applying must not change the file");
		restoreTarget("tool-web", env);
		const cleanAgain = restoreTarget("tool-web", env);
		assert.equal(cleanAgain.action, "already-clean");
		assert.equal(fileOf(env, "tool-web"), cleanFile("dsh-tool-web-0.1.0-rc.6"));
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("exact target version is enforced: any other version refuses without writing", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		for (const version of ["0.1.0-rc.7", "0.1.0", "0.2.0-rc.6", "0.1.0-rc.6.1"]) {
			writeVersion(packageRoot, version);
			const inspection = inspectTarget("tool-web", envOf(["@deepseek-ai/dsh-tool-web", packageRoot]));
			assert.equal(inspection.state, "version-mismatch");
			assert.throws(() => applyTarget("tool-web", envOf(["@deepseek-ai/dsh-tool-web", packageRoot])), (error) => {
				assert.ok(error instanceof PatchError);
				assert.equal(error.code, "state-version-mismatch");
				return true;
			});
			assert.equal(fileOf(envOf(["@deepseek-ai/dsh-tool-web", packageRoot]), "tool-web"), cleanFile("dsh-tool-web-0.1.0-rc.6"), "file must stay pristine");
		}
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("ambiguous anchors refuse with a specific code and no write", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const target = PATCH_TARGETS["tool-web"];
		const content = cleanFile("dsh-tool-web-0.1.0-rc.6");
		// Duplicate the first hunk's anchor so it occurs twice.
		const anchor = target.hunks[0].anchor;
		writeFileSync(join(packageRoot, target.file), content.replace(anchor, `${anchor}\n${anchor}`), "utf8");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		assert.equal(inspectTarget("tool-web", env).state, "ambiguous");
		assert.throws(() => applyTarget("tool-web", env), (error) => {
			assert.ok(error instanceof PatchError);
			assert.equal(error.code, "state-ambiguous");
			return true;
		});
		assert.equal(fileOf(env, "tool-web"), content.replace(anchor, `${anchor}\n${anchor}`), "file must stay untouched");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("a partially drifted file refuses as a whole (atomic all-or-nothing)", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	try {
		const target = PATCH_TARGETS["tool-web"];
		const content = cleanFile("dsh-tool-web-0.1.0-rc.6");
		// First hunk clean, second hunk's anchor destroyed: the target is neither
		// clean nor applied, so nothing may be written.
		const corrupted = content.replace(target.hunks[0].anchor, target.hunks[0].replacement).replace(target.hunks[1].anchor, "		text: drifted");
		writeFileSync(join(packageRoot, target.file), corrupted, "utf8");
		const env = envOf(["@deepseek-ai/dsh-tool-web", packageRoot]);
		assert.equal(inspectTarget("tool-web", env).state, "partial");
		assert.throws(() => applyTarget("tool-web", env), (error) => {
			assert.ok(error instanceof PatchError);
			assert.equal(error.code, "state-partial");
			return true;
		});
		assert.equal(fileOf(env, "tool-web"), corrupted, "no partial write may occur");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("legacy manual edits (pre-rename dsh-web-search-tavily) refuse apply and restore", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-host-apiproxy-applied", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-host-apiproxy", packageRoot]);
		const inspection = inspectTarget("host-apiproxy", env);
		assert.equal(inspection.state, "legacy");
		assert.ok(inspection.detail.includes("legacy"), "detail names the legacy state");
		const before = fileOf(env, "host-apiproxy");
		assert.throws(() => applyTarget("host-apiproxy", env), (error) => {
			assert.ok(error instanceof PatchError);
			assert.equal(error.code, "state-legacy");
			return true;
		});
		assert.throws(() => restoreTarget("host-apiproxy", env), (error) => error instanceof PatchError);
		assert.equal(fileOf(env, "host-apiproxy"), before, "legacy file must stay untouched");
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("a foreign state (other plugin's allowlist row, no legacy marker) refuses as partial", () => {
	const { sandbox, packageRoot } = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const target = PATCH_TARGETS["host-apiproxy"];
		const content = cleanFile("dsh-host-apiproxy-0.1.0-rc.6");
		// Insert a foreign row between the last allowlist entry and the closing
		// bracket: our anchor no longer exists, but no legacy marker does either.
		const foreign = content.replace(target.hunks[0].anchor, '\t"web-search-deepseek",\n\t"keepalive" // some other plugin\n];');
		writeFileSync(join(packageRoot, target.file), foreign, "utf8");
		const env = envOf(["@deepseek-ai/dsh-host-apiproxy", packageRoot]);
		assert.equal(inspectTarget("host-apiproxy", env).state, "partial");
		assert.throws(() => applyTarget("host-apiproxy", env), (error) => {
			assert.ok(error instanceof PatchError);
			assert.equal(error.code, "state-partial");
			return true;
		});
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("applyAll/restoreAll cover both targets in one pass", () => {
	const tool = sandboxPackage("dsh-tool-web-0.1.0-rc.6", "@deepseek-ai/dsh-tool-web");
	const proxy = sandboxPackage("dsh-host-apiproxy-0.1.0-rc.6", "@deepseek-ai/dsh-host-apiproxy");
	try {
		const env = envOf(["@deepseek-ai/dsh-tool-web", tool.packageRoot], ["@deepseek-ai/dsh-host-apiproxy", proxy.packageRoot]);
		const applied = applyAll(env);
		assert.deepEqual(applied.map((entry) => entry.action), ["applied", "applied"]);
		const restored = restoreAll(env);
		assert.deepEqual(restored.map((entry) => entry.action), ["restored", "restored"]);
		assert.equal(fileOf(env, "tool-web"), cleanFile("dsh-tool-web-0.1.0-rc.6"));
		assert.equal(fileOf(env, "host-apiproxy"), cleanFile("dsh-host-apiproxy-0.1.0-rc.6"));
	} finally {
		rmSync(tool.sandbox, { recursive: true, force: true });
		rmSync(proxy.sandbox, { recursive: true, force: true });
	}
});

test("a missing target reports discovery state without throwing", () => {
	const env = { packageDirs: {} };
	const inspection = inspectTarget("tool-web", env);
	assert.equal(inspection.state, "missing");
	assert.throws(() => applyTarget("tool-web", env), (error) => error instanceof PatchError && error.code === "state-missing");
});

test("unknown target ids are rejected", () => {
	assert.throws(() => inspectTarget("nope"), (error) => error instanceof PatchError && error.code === "invalid-target");
	assert.throws(() => applyTarget("nope"), (error) => error instanceof PatchError && error.code === "invalid-target");
});
