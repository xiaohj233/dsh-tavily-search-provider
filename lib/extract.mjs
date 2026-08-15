/**
 * Pure, dependency-free Tavily /extract mapping helpers shared by the
 * `tavily_extract` tool registration and its tests. Nothing here touches the
 * network, the process environment, or credentials — callers supply the
 * resolved key.
 *
 * @module dsh-tavily-search-provider/extract
 */

/** Hard cap on URLs per extract call (Tavily's own limit). */
export const EXTRACT_MAX_URLS = 20;

/** Extract depths Tavily accepts. */
export const EXTRACT_DEPTHS = ["basic", "advanced"];

/** Output formats Tavily accepts. */
export const EXTRACT_FORMATS = ["markdown", "text"];

/**
 * Map one extract request onto the Tavily /extract body with per-field type
 * gating: only well-typed values travel. `chunks_per_source` (1-5) is only
 * meaningful with `query` — Tavily ignores it otherwise, so it is only sent
 * when both are present. `timeout` is clamped to Tavily's 1.0-60.0 window.
 *
 * @param args - the tool arguments (urls plus optional controls).
 * @param apiKey - the resolved TAVILY_API_KEY.
 * @returns the request body.
 */
export function buildExtractBody(args, apiKey) {
	const urls = Array.isArray(args.urls)
		? args.urls.filter((url) => typeof url === "string" && url.length > 0).slice(0, EXTRACT_MAX_URLS)
		: [];
	const body = { api_key: apiKey, urls };
	if (typeof args.extract_depth === "string" && EXTRACT_DEPTHS.includes(args.extract_depth)) {
		body.extract_depth = args.extract_depth;
	}
	const query = typeof args.query === "string" && args.query.length > 0 ? args.query : void 0;
	if (query !== void 0) {
		body.query = query;
		if (Number.isInteger(args.chunks_per_source) && args.chunks_per_source >= 1 && args.chunks_per_source <= 5) {
			body.chunks_per_source = args.chunks_per_source;
		}
	}
	if (typeof args.format === "string" && EXTRACT_FORMATS.includes(args.format)) body.format = args.format;
	if (args.include_images === true) body.include_images = true;
	if (args.include_favicon === true) body.include_favicon = true;
	if (args.include_usage === true) body.include_usage = true;
	if (typeof args.timeout === "number" && Number.isFinite(args.timeout) && args.timeout >= 1 && args.timeout <= 60) {
		body.timeout = args.timeout;
	}
	return body;
}

/**
 * Project a Tavily /extract response onto the tool's output shape, keeping
 * only present, well-typed fields (never `undefined`, which would be lossy
 * under JSON serialization and fail output validation).
 */
export function projectExtractResponse(data) {
	const out = {};
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
