#!/usr/bin/env node
/**
 * Explicit CLI for the installed compatibility patches.
 *
 *   dsh-tavily-search-provider            restore every patch (default)
 *   dsh-tavily-search-provider apply      apply every missing patch
 *   dsh-tavily-search-provider status     report every target's state
 *   dsh-tavily-search-provider restore    restore every patch (explicit)
 *
 * Every operation is guarded (exact target versions, unique anchors,
 * idempotent, atomic) and refuses — without writing anything — when the
 * installed official package is not the tested version, an anchor is
 * ambiguous, or a foreign/legacy edit is present. Restore removes only the
 * exact text this plugin inserted; run it before `dsh plugin remove`.
 *
 * @module dsh-tavily-search-provider/restore
 */

import { applyAll, describeState, inspectAll, restoreAll } from "../lib/installed-patches.mjs";

const USAGE = `usage: dsh-tavily-search-provider [apply|restore|status]

  (no verb)   restore every patch (removes only text this plugin inserted)
  apply       apply every missing patch (idempotent, guarded)
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
	const before = inspectAll();
	try {
		const results = verb === "apply" ? applyAll() : restoreAll();
		for (const result of results) {
			console.log(`${result.id}: ${result.action} (${result.inspection.filePath})`);
		}
		return 0;
	} catch (error) {
		process.stderr.write(`dsh-tavily-search-provider: ${String(error?.message ?? error)}\n`);
		process.stderr.write("No files were changed. See the status report below:\n");
		printStatus(before);
		return 1;
	}
}

process.exit(run());
