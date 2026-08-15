/**
 * Pure, dependency-free Tavily /crawl mapping helpers shared by the
 * `tavily_crawl` tool registration and its tests.
 *
 * @module dsh-tavily-search-provider/crawl
 */

/** Crawl depths Tavily accepts (1-5). */
export const CRAWL_MAX_DEPTH = 5;

/**
 * Map one crawl request onto the Tavily /crawl body with per-field type
 * gating and hard clamps that protect the user's credits: `max_depth` 1-5,
 * `max_breadth` 1-500, `limit` 1-2000. `chunks_per_source` is only sent with
 * `instructions` (Tavily ignores it otherwise).
 *
 * @param args - the tool arguments.
 * @param apiKey - the resolved TAVILY_API_KEY.
 * @returns the request body.
 */
export function buildCrawlBody(args, apiKey) {
	const body = { api_key: apiKey, url: typeof args.url === "string" ? args.url : "" };
	if (Number.isInteger(args.max_depth) && args.max_depth >= 1 && args.max_depth <= CRAWL_MAX_DEPTH) {
		body.max_depth = args.max_depth;
	}
	if (Number.isInteger(args.max_breadth) && args.max_breadth >= 1 && args.max_breadth <= 500) {
		body.max_breadth = args.max_breadth;
	}
	if (Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 2000) body.limit = args.limit;
	const instructions = typeof args.instructions === "string" && args.instructions.length > 0 ? args.instructions : void 0;
	if (instructions !== void 0) {
		body.instructions = instructions;
		if (Number.isInteger(args.chunks_per_source) && args.chunks_per_source >= 1 && args.chunks_per_source <= 5) {
			body.chunks_per_source = args.chunks_per_source;
		}
	}
	if (typeof args.extract_depth === "string" && (args.extract_depth === "basic" || args.extract_depth === "advanced")) {
		body.extract_depth = args.extract_depth;
	}
	if (typeof args.format === "string" && (args.format === "markdown" || args.format === "text")) body.format = args.format;
	if (Array.isArray(args.select_paths)) body.select_paths = args.select_paths.filter((p) => typeof p === "string");
	if (Array.isArray(args.exclude_paths)) body.exclude_paths = args.exclude_paths.filter((p) => typeof p === "string");
	if (Array.isArray(args.select_domains)) body.select_domains = args.select_domains.filter((p) => typeof p === "string");
	if (Array.isArray(args.exclude_domains)) body.exclude_domains = args.exclude_domains.filter((p) => typeof p === "string");
	if (typeof args.allow_external === "boolean") body.allow_external = args.allow_external;
	if (args.include_images === true) body.include_images = true;
	if (args.include_favicon === true) body.include_favicon = true;
	if (args.include_usage === true) body.include_usage = true;
	if (typeof args.timeout === "number" && Number.isFinite(args.timeout) && args.timeout >= 10 && args.timeout <= 150) {
		body.timeout = args.timeout;
	}
	return body;
}

/** Project a Tavily /crawl response onto the tool's output shape. */
export function projectCrawlResponse(data) {
	const out = {};
	if (typeof data.base_url === "string") out.base_url = data.base_url;
	if (Array.isArray(data.results)) {
		out.results = data.results.map((result) => {
			const item = {};
			if (typeof result.url === "string") item.url = result.url;
			if (typeof result.raw_content === "string") item.raw_content = result.raw_content;
			if (Array.isArray(result.images)) item.images = result.images.filter((url) => typeof url === "string");
			if (typeof result.favicon === "string") item.favicon = result.favicon;
			return item;
		});
	}
	if (Array.isArray(data.failed_results)) {
		out.failed_results = data.failed_results.map((result) => {
			const item = {};
			if (typeof result.url === "string") item.url = result.url;
			if (typeof result.error === "string") item.error = result.error;
			return item;
		});
	}
	if (typeof data.response_time === "number") out.response_time = data.response_time;
	if (typeof data.request_id === "string") out.request_id = data.request_id;
	if (data.usage !== void 0) out.usage = data.usage;
	return out;
}
