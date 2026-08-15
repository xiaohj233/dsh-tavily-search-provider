/**
 * Tool factories for the Tavily API suite beyond search. Each factory takes
 * the host `ctx` (for the credentials seam and abort signals) and returns a
 * `defineTool`-shaped registration, following the style of the plugin's
 * existing `tavily_search` tool: full parameter surface, per-field type
 * gating through the pure `lib/*.mjs` builders, structured error text, and a
 * text render bounded to keep the model's context in check.
 *
 * @module dsh-tavily-search-provider/tools
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import {
	TAVILY_CRAWL_ENDPOINT,
	TAVILY_EXTRACT_ENDPOINT,
	TAVILY_MAP_ENDPOINT,
	TAVILY_RESEARCH_ENDPOINT,
	TAVILY_RESEARCH_STATUS_ENDPOINT,
	requireApiKey,
	tavilyGet,
	tavilyPost,
} from "./api.mjs";
import { buildExtractBody, projectExtractResponse, EXTRACT_MAX_URLS } from "./extract.mjs";
import { buildMapBody, projectMapResponse } from "./map.mjs";
import { buildCrawlBody, projectCrawlResponse } from "./crawl.mjs";
import { buildResearchBody, projectResearchStart, projectResearchStatus } from "./research.mjs";

/** Cap one rendered page's content in crawl results (context guard). */
const CRAWL_RENDER_PAGE_CHARS = 4000;
/** Cap one research report's rendered characters (context guard). */
const RESEARCH_RENDER_CHARS = 40000;
/** Cap one extracted page's rendered characters. */
const EXTRACT_RENDER_CHARS = 20000;

/** Shared text helpers ---------------------------------------------------- */

function trimTail(text, cap) {
	if (text.length <= cap) return text;
	return `${text.slice(0, cap)}\n…(truncated, ${text.length - cap} more chars)`;
}

function summarizeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/** Generic render for "list of url + content" payloads. */
function renderUrlContents(label, items, contentField, cap) {
	const lines = [];
	if (!Array.isArray(items) || items.length === 0) {
		lines.push(`No ${label}.`);
		return lines.join("\n");
	}
	lines.push(`## ${label} (${items.length})`);
	for (const item of items) {
		lines.push(`### ${item.url ?? "(no url)"}`);
		const content = item[contentField];
		if (typeof content === "string" && content.length > 0) {
			lines.push(trimTail(content, cap));
		} else {
			lines.push("(no content)");
		}
	}
	return lines.join("\n");
}

function renderFailures(failures) {
	if (!Array.isArray(failures) || failures.length === 0) return "";
	const lines = [`## Failed (${failures.length})`];
	for (const failure of failures) {
		lines.push(`- ${failure.url ?? "?"}: ${failure.error ?? "unknown error"}`);
	}
	return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* tavily_extract                                                       */
/* ------------------------------------------------------------------ */

/** Register the `tavily_extract` tool (Tavily /extract). */
export function createExtractTool(ctx) {
	return defineTool({
		name: "tavily_extract",
		description:
			"Tavily extract: fetch the clean content of specific web pages (up to " + EXTRACT_MAX_URLS + " URLs per call, markdown or text). This is the deep-retrieval step: after web_search or tavily_search returns result URLs, use it to open the actual pages behind those links, read their content, spot sub-links inside, and extract those next. Pass query plus chunks_per_source (1-5) to retrieve only the chunks relevant to a question instead of full pages (prevents context explosion); extract_depth advanced handles JS-rendered/complex pages. Returns results with raw_content plus failed_results for URLs that could not be extracted.",
		parameters: {
			urls: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: `URLs to extract content from (max ${EXTRACT_MAX_URLS}).`,
			},
			extract_depth: {
				type: "string",
				enum: ["basic", "advanced"],
				description: "basic = simple text extraction (default); advanced = JS-rendered pages, tables, structured data.",
			},
			query: {
				type: "string",
				description: "Optional question used to rerank chunks by relevance; only the most relevant chunks are returned (with chunks_per_source).",
			},
			chunks_per_source: {
				type: "integer",
				description: "Chunks per source, 1-5, only used when query is provided (each chunk max 500 chars).",
			},
			format: {
				type: "string",
				enum: ["markdown", "text"],
				description: "Output format (default markdown).",
			},
			include_images: {
				type: "boolean",
				description: "Include image URLs found on the page.",
			},
			include_favicon: {
				type: "boolean",
				description: "Include the page favicon URL.",
			},
			include_usage: {
				type: "boolean",
				description: "Include credit usage info in the response.",
			},
			timeout: {
				type: "number",
				description: "Max wait in seconds, 1-60 (default varies; raise toward 60 for slow pages).",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true,
							properties: {
								url: { type: "string" },
								raw_content: { type: "string" },
								images: { type: "array", items: { type: "string" } },
								favicon: { type: "string" },
							},
						},
					},
					failed_results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true,
							properties: { url: { type: "string" }, error: { type: "string" } },
						},
					},
					response_time: { type: "number" },
					request_id: { type: "string" },
					usage: { type: "object", additionalProperties: true },
				},
			},
			render(_args, value) {
				const lines = [];
				if (Array.isArray(value.results) && value.results.length > 0) {
					lines.push(renderUrlContents("Extracted pages", value.results, "raw_content", EXTRACT_RENDER_CHARS));
				} else {
					lines.push("No pages extracted.");
				}
				const failures = renderFailures(value.failed_results);
				if (failures.length > 0) lines.push(failures);
				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		timeoutMs: 90000,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			try {
				const key = await requireApiKey(ctx);
				const data = await tavilyPost(TAVILY_EXTRACT_ENDPOINT, buildExtractBody(args, key), exec.signal);
				return projectExtractResponse(data);
			} catch (error) {
				throw new Error(`tavily_extract: ${summarizeError(error)}`);
			}
		},
	});
}

/* ------------------------------------------------------------------ */
/* tavily_map                                                           */
/* ------------------------------------------------------------------ */

/** Register the `tavily_map` tool (Tavily /map). */
export function createMapTool(ctx) {
	return defineTool({
		name: "tavily_map",
		description:
			"Tavily map: discover the URLs of a website (site structure only, no page content). Use it to find what pages and sub-links exist on a domain before crawling or extracting — the planning step of deep retrieval (map → extract/crawl). Returns the discovered URL list.",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "Root URL of the site to map (e.g. https://docs.example.com).",
			},
			max_depth: {
				type: "integer",
				description: "Levels deep to discover, 1-3 (default 1).",
			},
			limit: {
				type: "integer",
				description: "Maximum number of URLs to return (default 100).",
			},
			instructions: {
				type: "string",
				description: "Optional natural-language focus, e.g. 'find all API docs and guides'.",
			},
			select_paths: {
				type: "array",
				items: { type: "string" },
				description: "Regex path patterns to include, e.g. ['/docs/.*'].",
			},
			exclude_paths: {
				type: "array",
				items: { type: "string" },
				description: "Regex path patterns to exclude.",
			},
			select_domains: {
				type: "array",
				items: { type: "string" },
				description: "Regex domains to include, e.g. ['^docs.example.com$'].",
			},
			exclude_domains: {
				type: "array",
				items: { type: "string" },
				description: "Regex domains to exclude.",
			},
			allow_external: {
				type: "boolean",
				description: "Include external-domain links (map default false).",
			},
			timeout: {
				type: "number",
				description: "Max wait in seconds, 1-150.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					base_url: { type: "string" },
					results: { type: "array", items: { type: "string" } },
					response_time: { type: "number" },
					request_id: { type: "string" },
				},
			},
			render(_args, value) {
				const urls = Array.isArray(value.results) ? value.results : [];
				if (urls.length === 0) return [{ type: "text", text: "No URLs discovered." }];
				return [{ type: "text", text: `## Mapped URLs (${urls.length}) from ${value.base_url ?? "?"}\n${urls.join("\n")}` }];
			},
		},
		timeoutMs: 90000,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			try {
				const key = await requireApiKey(ctx);
				const data = await tavilyPost(TAVILY_MAP_ENDPOINT, buildMapBody(args, key), exec.signal);
				return projectMapResponse(data);
			} catch (error) {
				throw new Error(`tavily_map: ${summarizeError(error)}`);
			}
		},
	});
}

/* ------------------------------------------------------------------ */
/* tavily_crawl                                                         */
/* ------------------------------------------------------------------ */

/** Register the `tavily_crawl` tool (Tavily /crawl, synchronous). */
export function createCrawlTool(ctx) {
	return defineTool({
		name: "tavily_crawl",
		description:
			"Tavily crawl: crawl a whole website and return the content of the crawled pages (synchronous; can take minutes, up to 150s per call). Use it for documentation sites or whole-domain retrieval after web_search/tavily_map identified the target. ALWAYS set a conservative limit (start 20-50) and use instructions for semantic focus plus chunks_per_source to keep the output small; select_paths/exclude_paths narrow the crawl. Deeper than max_depth 2 grows exponentially — start with 1-2.",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "Root URL to begin the crawl.",
			},
			max_depth: {
				type: "integer",
				description: "Levels deep to crawl, 1-5 (default 1; exponential cost — start 1-2).",
			},
			max_breadth: {
				type: "integer",
				description: "Maximum links per page (default 20; 50-100 for focused crawls).",
			},
			limit: {
				type: "integer",
				description: "Total pages cap (default 50; always set a reasonable value to bound cost).",
			},
			instructions: {
				type: "string",
				description: "Natural-language semantic focus, e.g. 'Find all documentation about authentication'.",
			},
			chunks_per_source: {
				type: "integer",
				description: "Chunks per page, 1-5, only used with instructions (each chunk max 500 chars).",
			},
			extract_depth: {
				type: "string",
				enum: ["basic", "advanced"],
				description: "basic (default) or advanced for JS-rendered/structured pages.",
			},
			format: {
				type: "string",
				enum: ["markdown", "text"],
				description: "Output format (default markdown).",
			},
			select_paths: {
				type: "array",
				items: { type: "string" },
				description: "Regex path patterns to include, e.g. ['/docs/.*', '/api/.*'].",
			},
			exclude_paths: {
				type: "array",
				items: { type: "string" },
				description: "Regex path patterns to exclude, e.g. ['/blog/.*', '/private/.*'].",
			},
			select_domains: {
				type: "array",
				items: { type: "string" },
				description: "Regex domains to include.",
			},
			exclude_domains: {
				type: "array",
				items: { type: "string" },
				description: "Regex domains to exclude.",
			},
			allow_external: {
				type: "boolean",
				description: "Include external-domain links (crawl default true).",
			},
			include_images: {
				type: "boolean",
				description: "Include image URLs found on crawled pages.",
			},
			include_favicon: {
				type: "boolean",
				description: "Include page favicon URLs.",
			},
			include_usage: {
				type: "boolean",
				description: "Include credit usage info.",
			},
			timeout: {
				type: "number",
				description: "Max wait in seconds, 10-150 (default 150).",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					base_url: { type: "string" },
					results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true,
							properties: {
								url: { type: "string" },
								raw_content: { type: "string" },
								images: { type: "array", items: { type: "string" } },
								favicon: { type: "string" },
							},
						},
					},
					failed_results: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true,
							properties: { url: { type: "string" }, error: { type: "string" } },
						},
					},
					response_time: { type: "number" },
					request_id: { type: "string" },
					usage: { type: "object", additionalProperties: true },
				},
			},
			render(_args, value) {
				const lines = [];
				if (Array.isArray(value.results) && value.results.length > 0) {
					lines.push(renderUrlContents("Crawled pages", value.results, "raw_content", CRAWL_RENDER_PAGE_CHARS));
				} else {
					lines.push("No pages crawled.");
				}
				const failures = renderFailures(value.failed_results);
				if (failures.length > 0) lines.push(failures);
				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		timeoutMs: 180000,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			try {
				const key = await requireApiKey(ctx);
				const data = await tavilyPost(TAVILY_CRAWL_ENDPOINT, buildCrawlBody(args, key), exec.signal);
				return projectCrawlResponse(data);
			} catch (error) {
				throw new Error(`tavily_crawl: ${summarizeError(error)}`);
			}
		},
	});
}

/* ------------------------------------------------------------------ */
/* tavily_research (+ get)                                              */
/* ------------------------------------------------------------------ */

/** Register the `tavily_research` tool (Tavily /deep-research, submit). */
export function createResearchTool(ctx) {
	return defineTool({
		name: "tavily_research",
		description:
			"Tavily deep research: submit an end-to-end AI research task (automatic multi-source gathering, analysis, and a synthesized report with citations). Returns a request_id immediately — poll it with tavily_research_get until status is completed, then read content. model: mini (focused, narrow questions) / pro (comprehensive multi-domain research) / auto (default). Use output_schema for structured JSON output and citation_format to choose the citation style. Prefer this over chaining many web_search calls for research-heavy questions.",
		parameters: {
			input: {
				type: "string",
				required: true,
				description: "The research topic or question. Be specific: include known details, constraints, and the desired output focus.",
			},
			model: {
				type: "string",
				enum: ["mini", "pro", "auto"],
				description: "mini = targeted efficient research; pro = comprehensive multi-agent research; auto = decide by complexity (default).",
			},
			citation_format: {
				type: "string",
				enum: ["numbered", "mla", "apa", "chicago"],
				description: "Citation style for the report (default numbered).",
			},
			output_schema: {
				type: "object",
				additionalProperties: true,
				description: "Optional JSON Schema (object with properties/required) to receive the research as structured JSON instead of a markdown report.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					request_id: { type: "string" },
					status: { type: "string" },
					created_at: { type: "string" },
					input: { type: "string" },
					model: { type: "string" },
				},
			},
			render(_args, value) {
				if (typeof value.request_id !== "string") {
					return [{ type: "text", text: "Research task submission failed (no request_id returned)." }];
				}
				return [{
					type: "text",
					text: `Research task submitted: ${value.request_id}\nstatus=${value.status ?? "?"} model=${value.model ?? "?"}\nPoll with tavily_research_get(request_id="${value.request_id}") until status is "completed".`,
				}];
			},
		},
		timeoutMs: 60000,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			try {
				const key = await requireApiKey(ctx);
				const data = await tavilyPost(TAVILY_RESEARCH_ENDPOINT, buildResearchBody(args, key), exec.signal);
				return projectResearchStart(data);
			} catch (error) {
				throw new Error(`tavily_research: ${summarizeError(error)}`);
			}
		},
	});
}

/** Register the `tavily_research_get` tool (Tavily /deep-research/{id}, poll). */
export function createResearchGetTool(ctx) {
	return defineTool({
		name: "tavily_research_get",
		description:
			"Tavily deep research poll: check the status of a tavily_research task by its request_id. Status is pending/processing/completed/failed. When completed, returns the report (content) plus its sources; when failed, returns the failure state. Poll in intervals (e.g. 10-30s) until a terminal status.",
		parameters: {
			request_id: {
				type: "string",
				required: true,
				description: "The request_id returned by tavily_research.",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					status: { type: "string" },
					content: { type: "string" },
					sources: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true,
							properties: { url: { type: "string" }, title: { type: "string" }, citation: { type: "string" } },
						},
					},
					response_time: { type: "number" },
				},
			},
			render(_args, value) {
				const lines = [`status=${value.status ?? "?"}`];
				if (typeof value.content === "string" && value.content.length > 0) {
					lines.push("", trimTail(value.content, RESEARCH_RENDER_CHARS));
				}
				if (Array.isArray(value.sources) && value.sources.length > 0) {
					lines.push("", `## Sources (${value.sources.length})`);
					for (const source of value.sources) {
						lines.push(`- ${source.title ?? source.url ?? "?"} — ${source.url ?? ""}${source.citation ? ` (${source.citation})` : ""}`);
					}
				}
				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		timeoutMs: 60000,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			try {
				const key = await requireApiKey(ctx);
				const data = await tavilyGet(`${TAVILY_RESEARCH_STATUS_ENDPOINT}${encodeURIComponent(args.request_id)}`, key, exec.signal);
				return projectResearchStatus(data);
			} catch (error) {
				throw new Error(`tavily_research_get: ${summarizeError(error)}`);
			}
		},
	});
}
