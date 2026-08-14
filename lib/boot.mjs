/**
 * Boot application for the installed compatibility patches.
 *
 * Runs from the plugin's `apply()` on every dsh start: it classifies the two
 * official target packages with the v2 engine (`lib/installed-patches.mjs`),
 * applies any target that is patchable (guarded, atomic, idempotent), and
 * records each target's outcome — applied or skipped with a reason — through
 * the plugin logger. Installation-state problems (version policy, drifted or
 * ambiguous anchors, legacy/foreign content, unreadable manifests) are
 * skipped with a reason and never thrown: the plugin's own tools keep working
 * without the patches.
 *
 * The patches change files on disk, so a patch applied by a running dsh
 * process reaches the official modules on the NEXT start; the report says so.
 *
 * @module dsh-tavily-search-provider/boot
 */

import { applyTarget, describeState, inspectTarget, PATCH_TARGETS } from "./installed-patches.mjs";

/**
 * One target's boot outcome: `applied-now` (just written), `applied` (already
 * applied on a previous boot), `skipped` (v2 skip with `reason`/`detail`), or
 * `refused` (unexpected error — e.g. a failed atomic write). Never throws.
 */
export function bootPatchStatus(targetId, env = {}) {
	try {
		const outcome = applyTarget(targetId, env);
		const state = outcome.action === "applied" ? "applied-now" : outcome.action === "already-applied" ? "applied" : "skipped";
		return { targetId, state, ...outcome };
	} catch (error) {
		return { targetId, state: "refused", error };
	}
}

/**
 * Apply missing patches at boot and record every target's status through
 * `logger`. Never throws: guard refusals and discovery failures become
 * per-target skipped records (logged as warnings), so a hostile or unpatched
 * installation can never take the plugin down.
 * @param logger - optional Cordis logger (`ctx.logger`) or `{ info, warn }`.
 * @param env - optional resolution override (tests).
 * @returns the per-target report; entries carry `state` (`applied-now`,
 *   `applied`, `skipped`, or `refused`) plus the outcome fields.
 */
export function bootApplyPatches(logger = void 0, env = {}) {
	const log = (level, message) => {
		if (logger?.[level] !== void 0) logger[level](message);
	};
	const report = [];
	for (const target of Object.values(PATCH_TARGETS)) {
		const outcome = bootPatchStatus(target.id, env);
		report.push(outcome);
		switch (outcome.state) {
			case "applied-now":
				log("info", `dsh-tavily-search-provider: ${target.packageName} patch applied (${outcome.file}); restart dsh for the running session to pick it up`);
				break;
			case "applied":
				log("info", `dsh-tavily-search-provider: ${target.packageName} patch already applied (${outcome.file})`);
				break;
			case "skipped":
				if (outcome.reason === "missing") {
					log("info", `dsh-tavily-search-provider: ${target.packageName} patch not applied — ${outcome.detail}`);
				} else {
					log("warn", `dsh-tavily-search-provider: ${target.packageName} patch not applied — ${outcome.reason}${outcome.detail ? `: ${outcome.detail}` : ""}`);
				}
				break;
			default:
				log("warn", `dsh-tavily-search-provider: ${target.packageName} patch not applied — ${String(outcome.error?.message ?? outcome.error)}`);
				break;
		}
	}
	return report;
}

/**
 * Verify-only boot check: report every target's state without writing.
 * @param logger - optional logger.
 * @param env - optional resolution override (tests).
 * @returns the per-target report.
 */
export function bootVerifyPatches(logger = void 0, env = {}) {
	const log = (level, message) => {
		if (logger?.[level] !== void 0) logger[level](message);
	};
	const report = [];
	for (const target of Object.values(PATCH_TARGETS)) {
		const inspection = inspectTarget(target.id, env);
		report.push({ targetId: target.id, state: inspection.state, inspection });
		const level = inspection.state === "applied" || inspection.state === "clean" ? "info" : "warn";
		log(level, `dsh-tavily-search-provider: ${target.packageName} ${describeState(inspection.state)} — ${inspection.detail}`);
	}
	return report;
}
