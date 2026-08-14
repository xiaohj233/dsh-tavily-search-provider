/**
 * Boot application for the installed compatibility patches.
 *
 * Runs from the plugin's `apply()` on every dsh start: it inspects the two
 * official target packages, applies any patch whose target is still clean
 * (guarded, atomic, idempotent — see `lib/installed-patches.mjs`), and reports
 * the resulting state through the plugin logger. Anything the guards refuse
 * (version mismatch, ambiguous anchors, legacy manual edits, foreign states)
 * is reported with instructions and left untouched — the plugin's own tools
 * keep working without the patches.
 *
 * The patches change files on disk, so a patch applied by a running dsh
 * process reaches the official modules on the NEXT start; the report says so.
 *
 * @module dsh-tavily-search-provider/boot
 */

import { applyTarget, describeState, inspectTarget, PATCH_TARGETS } from "./installed-patches.mjs";

/** One target's boot outcome. */
export function bootPatchStatus(targetId, env = {}) {
	const inspection = inspectTarget(targetId, env);
	if (inspection.state === "applied") return { targetId, state: "applied", inspection };
	if (inspection.state !== "clean") return { targetId, state: inspection.state, inspection };
	try {
		const applied = applyTarget(targetId, env);
		return { targetId, state: "applied-now", action: applied.action, inspection: applied.inspection };
	} catch (error) {
		return { targetId, state: "refused", error, inspection };
	}
}

/**
 * Apply missing patches at boot and summarize every target through `logger`.
 * Never throws: guard refusals and discovery failures become report entries
 * (logged as warnings), so a hostile or unpatched installation can never take
 * the plugin down.
 * @param logger - optional Cordis logger (`ctx.logger`) or `{ info, warn }`.
 * @param env - optional resolution override (tests).
 * @returns the per-target report; `report.some((entry) => entry.state === "refused")`
 *   tells the caller a manual step is needed.
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
			case "applied":
				log("info", `dsh-tavily-search-provider: ${target.packageName} patch already applied`);
				break;
			case "applied-now":
				log("info", `dsh-tavily-search-provider: applied ${target.packageName} patch (${outcome.inspection.filePath}); restart dsh for the running session to pick it up`);
				break;
			case "clean":
			case "missing":
				log("info", `dsh-tavily-search-provider: ${target.packageName} ${describeState(outcome.state)} (${outcome.inspection.detail})`);
				break;
			default:
				log("warn", `dsh-tavily-search-provider: ${target.packageName} patch not applied — ${outcome.inspection.detail}`);
				if (outcome.state === "refused" && outcome.error !== void 0) {
					log("warn", `dsh-tavily-search-provider: ${target.packageName}: ${String(outcome.error?.message ?? outcome.error)}`);
				}
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
