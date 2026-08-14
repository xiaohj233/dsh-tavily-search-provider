import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { WebError } from "@deepseek-ai/dsh-web";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import {
	TAVILY_API_KEY_REF,
	TAVILY_SEARCH_ENDPOINT,
	buildSearchBody,
	projectOfficialSearchResponse,
	projectRawSearchResponse,
} from "./search.mjs";
import { bootApplyPatches, bootVerifyPatches } from "./boot.mjs";

/**
 * dsh-tavily-search-provider — full-parameter Tavily search as a first-party
 * harness tool, plus an optional drop-in replacement for the official
 * `web_search` backend.
 *
 * Registered tools/services:
 * - `tavily_search`: exposes the complete Tavily /search parameter surface to
 *   the model (search_depth, topic, time_range, domain filters, max_results,
 *   include_answer, include_raw_content).
 * - Tavily search provider (`id: "tavily"`): registered into `ctx.web` only
 *   while the settings switch `replaceOfficialSearch` is on. When on, the
 *   official `web_search` tool (owned by @deepseek-ai/dsh-tool-web) routes
 *   through this provider — the tool's schema, output shape, web card, and
 *   prompt guidance stay untouched; only the retrieval backend changes.
 *
 * The API key resolves through the credentials seam (`TAVILY_API_KEY`
 * reference), falling back to the process environment. Resolution happens per
 * call, so a changed key reaches the next search without a restart. The
 * Settings → Plugins card stores the key only through the credentials domain
 * (credentials.set/unset); it never lives in the settings section.
 *
 * Two guarded compatibility patches make the full parameter surface usable
 * through the OFFICIAL tool and make the settings card reachable from the Web
 * client; they are applied at boot (idempotently) or via
 * `bin/restore.mjs apply`, and removed via `bin/restore.mjs` — see
 * `lib/installed-patches.mjs`.
 */
const name = "dsh-tavily-search-provider";

export { name };

/** Provider id registered into `ctx.web` when the switch is on. */
export const TAVILY_PROVIDER_ID = "tavily";
/** Default cap on sources returned through the official web_search seam. */
export const DEFAULT_SEARCH_MAX_RESULTS = 8;
/** Settings namespace carrying the card-edited section. */
export const TAVILY_SETTINGS_NAMESPACE = settingsNamespace("dsh-tavily-search-provider");

export const Config = z.object({
	/** Route official `web_search` calls through the Tavily provider. */
	replaceOfficialSearch: z.boolean().default(false),
	/** Source cap for the official-seam path (tavily_search has its own max_results). */
	searchMaxResults: z.number().step(1).min(1).default(DEFAULT_SEARCH_MAX_RESULTS),
	/**
	 * Apply the guarded compatibility patches to the installed official
	 * packages at boot. Off means the plugin only verifies and reports; the
	 * official tool then lacks the advanced controls and the settings card
	 * stays hidden until `bin/restore.mjs apply` is run manually.
	 */
	autoApplyPatches: z.boolean().default(true),
});

async function resolveApiKey(ctx) {
	const resolved = await ctx.credentials?.resolve(credentialRef(TAVILY_API_KEY_REF));
	if (resolved?.value) return resolved.value;
	return process.env[TAVILY_API_KEY_REF] ?? undefined;
}

/**
 * Tavily-backed search provider for the `ctx.web` seam. One operation's
 * options are snapshotted at entry (thunk), so a settings change between
 * searches never mixes two sections; the provider is registered once and
 * resolves fresh options per call.
 */
export class TavilySearchProvider {
	id = TAVILY_PROVIDER_ID;
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	available() {
		return true;
	}
	async search(request, signal) {
		const options = this.resolveOptions();
		const key = await options.resolveApiKey();
		if (!key) {
			throw new WebError(
				`Tavily search has no API key for "${TAVILY_API_KEY_REF}"; store it through the credentials seam (Settings → Plugins → Tavily 搜索) or export it in the launching environment`,
				"WEB_PROVIDER_CREDENTIAL_MISSING",
			);
		}
		// Model-specified max_results wins over the deployment cap; the tool-web
		// extension forwards all optional Tavily controls on the seam request, and
		// providers that ignore them (e.g. DeepSeek) simply don't read them.
		const { body, maxResults } = buildSearchBody(request, {
			apiKey: key,
			defaultMaxResults: options.searchMaxResults,
			defaultIncludeAnswer: true,
		});
		let response;
		try {
			response = await fetch(TAVILY_SEARCH_ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {},
			});
		} catch (error) {
			if (signal?.aborted === true) throw new WebError("Tavily search aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`Tavily search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Tavily API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				const detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
				if (detail !== void 0 && detail.length > 0) message = detail;
			} catch { /* keep the status-based message */ }
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		let data;
		try {
			data = await response.json();
		} catch (error) {
			throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		return projectOfficialSearchResponse(data, maxResults);
	}
}

/** Resolve one operation's options: credential thunk plus the settings section. */
function resolveProviderOptions(ctx, current) {
	return {
		resolveApiKey: () => resolveApiKey(ctx),
		searchMaxResults: current().searchMaxResults,
	};
}

export function apply(ctx, config) {
	let current = () => config;

	// ---- boot application: guarded installed-package patches ----------------
	// Self-heals the two official-package patches (idempotent, exact-version
	// and unique-anchor guarded). A refusal is a warning, never a crash: the
	// plugin's own tools work without the patches.
	if (config.autoApplyPatches) {
		bootApplyPatches(ctx.logger);
	} else {
		bootVerifyPatches(ctx.logger);
	}

	// ---- official-search backend switch ---------------------------------------
	// The web seam resolves the provider at each call from `searchProviderId`.
	// While the switch is on we register the Tavily provider and point the seam
	// at it; off, we dispose it and restore the composed selection (deepseek).
	// Settings changes reach us through installSettingsSection's watch (the
	// onChange hook), so toggling the card switch takes effect on the next
	// search — no restart.
	const originalProviderId = ctx.web.searchProviderId;
	let providerDispose = undefined;
	function syncSwitch() {
		const on = Boolean(current().replaceOfficialSearch);
		if (on && providerDispose === undefined) {
			providerDispose = ctx.web.registerSearchProvider(
				new TavilySearchProvider(() => resolveProviderOptions(ctx, current)),
			);
			ctx.web.searchProviderId = TAVILY_PROVIDER_ID;
			ctx.logger?.info("dsh-tavily-search-provider: official web_search routed through Tavily");
		} else if (!on && providerDispose !== undefined) {
			providerDispose();
			providerDispose = undefined;
			ctx.web.searchProviderId = originalProviderId;
			ctx.logger?.info("dsh-tavily-search-provider: official web_search restored to composed provider");
		}
	}

	// ---- settings section (card edits land here; hot-updates via setSource) ----
	installSettingsSection(ctx, TAVILY_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {
			syncSwitch();
		},
	});
	syncSwitch();

	// ---- status endpoint (same extension pattern as dsh-keepalive) ------------
	// Lets the operator verify which backend official web_search currently uses.
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/tavily-search-provider/status",
		handler: async (_req, res) => {
			res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({
				replaceOfficialSearch: Boolean(current().replaceOfficialSearch),
				searchMaxResults: current().searchMaxResults,
				providerRegistered: providerDispose !== undefined,
				webSearchProviderId: ctx.web.searchProviderId
			}));
		}
	}), "dsh-tavily-search-provider: /api/tavily-search-provider/status");

	// ---- full-parameter tavily_search tool (independent of the switch) --------
	// Registration happens regardless of key presence; the tool reports a
	// clear error at execution time when the key is missing.
	ctx.tools.register(
		defineTool({
			name: "tavily_search",
			description:
				"Tavily web search (same backend as web_search): precise web retrieval with configurable depth, topic, recency, and domain filters. Note: web_search already supports the identical parameter surface (search_depth, topic, time_range, max_results, include_domains/exclude_domains, include_answer, include_raw_content) and renders the official web card — prefer web_search for all normal retrieval. Use tavily_search only when you explicitly need the raw Tavily result shape (per-result score field) or want a standalone search independent of the official seam.",
			parameters: {
				query: {
					type: "string",
					required: true,
					description: "Search query. Keep under 400 characters; think search query, not long-form prompt.",
				},
				search_depth: {
					type: "string",
					enum: ["basic", "advanced", "fast", "ultra-fast"],
					description:
						"Retrieval depth. basic = NLP summary of each page; advanced = reranked chunks with higher relevance (default basic).",
				},
				topic: {
					type: "string",
					enum: ["general", "news", "finance"],
					description: "Search topic; news and finance tune recency/quality for those verticals (default general).",
				},
				time_range: {
					type: "string",
					enum: ["day", "week", "month", "year"],
					description: "Only results published within this window (default none = no recency filter).",
				},
				max_results: {
					type: "integer",
					description: "Number of results to return, 0-20 (default 5).",
				},
				include_domains: {
					type: "array",
					items: { type: "string" },
					description: "Restrict results to these domains (max 300, wildcards like *.com allowed).",
				},
				exclude_domains: {
					type: "array",
					items: { type: "string" },
					description: "Exclude results from these domains (max 150).",
				},
				include_answer: {
					type: "boolean",
					description: "Include a Tavily-generated AI answer synthesized from the results (default false).",
				},
				include_raw_content: {
					type: "boolean",
					description: "Include the full page content for each result (default false; expensive).",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: true,
					properties: {
						answer: { type: "string" },
						results: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: true,
								properties: {
									title: { type: "string" },
									url: { type: "string" },
									content: { type: "string" },
									score: { type: "number" },
									published_date: { type: "string" },
								},
							},
						},
					},
				},
				render(args, value) {
					const lines = [];
					if (value.answer) {
						lines.push("## Answer", value.answer, "");
					}
					const results = value.results ?? [];
					if (results.length === 0) {
						lines.push("No results.");
					} else {
						lines.push(`## Sources (${results.length})`);
						for (const r of results) {
							const title = r.title ?? r.url;
							const date = r.published_date ? ` (${r.published_date})` : "";
							lines.push(`- **${title}**${date}\n  ${r.url}\n  ${r.content ?? ""}`);
						}
					}
					return [{ type: "text", text: lines.join("\n") }];
				},
			},
			timeoutMs: 60000,
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const key = await resolveApiKey(ctx);
				if (!key) {
					throw new Error(
						`tavily_search: ${TAVILY_API_KEY_REF} is not configured. Add it via Settings → Plugins → Tavily 搜索 (stored through the credentials seam), or export it in the launching shell.`,
					);
				}
				const { body } = buildSearchBody(args, {
					apiKey: key,
					defaultMaxResults: undefined,
					defaultIncludeAnswer: undefined,
				});
				const res = await fetch(TAVILY_SEARCH_ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: exec.signal,
				});
				if (!res.ok) {
					throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 500)}`);
				}
				const data = await res.json();
				// Tavily omits/null-fills `answer` unless include_answer is set, and
				// per-result fields can be null too. projectRawSearchResponse keeps
				// only present, well-typed fields (never undefined, which would be
				// lossy under JSON serialization and fail output validation).
				return projectRawSearchResponse(data);
			},
		}),
	);

	ctx.logger?.info("dsh-tavily-search-provider: tavily_search tool registered");
}
