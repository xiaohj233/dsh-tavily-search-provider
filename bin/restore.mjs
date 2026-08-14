#!/usr/bin/env node
/**
 * Explicit CLI for the installed compatibility patches.
 *
 *   dsh-tavily-search-provider            restore every patch (default)
 *   dsh-tavily-search-provider apply      apply every missing patch
 *   dsh-tavily-search-provider status     report every target's state
 *   dsh-tavily-search-provider restore    restore every patch (explicit)
 *
 * v2 semantics: every operation decides each target independently and never
 * throws for an installation-state problem. `apply` patches version-mismatched
 * targets adaptively when every anchor still matches (recorded as adaptive);
 * `restore` is ALWAYS strict. A failure skip (version policy, unreadable
 * manifest, drifted/ambiguous/legacy/foreign layout, non-canonical inserted
 * text) prints to stderr and makes `apply`/`restore` exit nonzero — the
 * operator must resolve it manually. Restore removes only the exact text this
 * plugin inserted; run it before `dsh plugin remove`.
 *
 * @module dsh-tavily-search-provider/restore
 */

import { applyAll, describeState, inspectAll, restoreAll } from "../lib/installed-patches.mjs";

const USAGE = `usage: dsh-tavily-search-provider [apply|restore|status]

  (no verb)   restore every patch (removes only text this plugin inserted)
  apply       apply every missing patch (idempotent, guarded, adaptive)
  restore     same as the default verb, spelled out
  status      report every target's state without writing
`;

function printStatus(entries) {
	for (const entry of entries) {
		const location = entry.filePath ?? "not found";
		console.log(`${entry.id.padEnd(14)} ${describeState(entry.state).padEnd(38)} ${entry.packageName} @ ${entry.version ?? "?"} — ${location}`);
		if (entry.detail !== void 0 && entry.detail.length > 0) console.log(`  ${entry.detail}`);
	}
}

function run() {
	const verb = process.argv[2] ?? "restore";
	if (verb === "status") {
		printStatus(inspectAll());
		return 0;
	}
	if (verb !== "apply" && verb !== "restore") {
		process.stderr.write(USAGE);
		return 2;
	}
	try {
		const report = verb === "apply" ? applyAll() : restoreAll();
		const done = verb === "apply" ? report.applied : report.reverted;
		const doneWord = verb === "apply" ? "patched" : "restored";
		const idempotentReason = verb === "apply" ? "already-patched" : "already-restored";
		console.log(`dsh-tavily-search-provider: ${report.summary}`);
		for (const entry of done) {
			console.log(`  ${doneWord}: ${entry.id} (${entry.file})${entry.adaptive === true ? " [adaptive]" : ""}`);
		}
		for (const entry of report.skipped) {
			if (entry.reason === idempotentReason) {
				console.log(`  already ${doneWord}: ${entry.id} (${entry.file})`);
			} else {
				console.error(`  refused: ${entry.id} (${entry.reason})${entry.detail ? ` — ${entry.detail}` : ""}`);
			}
		}
		return report.ok ? 0 : 1;
	} catch (error) {
		process.stderr.write(`dsh-tavily-search-provider: ${String(error?.message ?? error)}\n`);
		process.stderr.write("No files were changed.\n");
		return 1;
	}
}

process.exit(run());
