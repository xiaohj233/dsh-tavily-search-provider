/**
 * Pure, dependency-free Tavily /map mapping helpers shared by the
 * `tavily_map` tool registration and its tests.
 *
 * @module dsh-tavily-search-provider/map
 */

/** Map depths Tavily accepts (1-3 in practice; the API caps it). */
export const MAP_MAX_DEPTH = 3;

/**
 * Map one map request onto the Tavily /map body with per-field type gating.
 * `max_depth` is clamped to 1-3, `limit` to 1-5000 (Tavily's documented cap
 * for map), and the regex lists are kept as given.
 *
 * @param args - the tool arguments.
 * @param apiKey - the resolved TAVILY_API_KEY.
 * @returns the request body.
 */
export function buildMapBody(args, apiKey) {
	const body = { api_key: apiKey, url: typeof args.url === "string" ? args.url : "" };
	if (Number.isInteger(args.max_depth) && args.max_depth >= 1 && args.max_depth <= MAP_MAX_DEPTH) {
		body.max_depth = args.max_depth;
	}
	if (Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 5000) body.limit = args.limit;
	if (typeof args.instructions === "string" && args.instructions.length > 0) body.instructions = args.instructions;
	if (Array.isArray(args.select_paths)) body.select_paths = args.select_paths.filter((p) => typeof p === "string");
	if (Array.isArray(args.exclude_paths)) body.exclude_paths = args.exclude_paths.filter((p) => typeof p === "string");
	if (Array.isArray(args.select_domains)) body.select_domains = args.select_domains.filter((p) => typeof p === "string");
	if (Array.isArray(args.exclude_domains)) body.exclude_domains = args.exclude_domains.filter((p) => typeof p === "string");
	if (typeof args.allow_external === "boolean") body.allow_external = args.allow_external;
	if (typeof args.timeout === "number" && Number.isFinite(args.timeout) && args.timeout >= 1 && args.timeout <= 150) {
		body.timeout = args.timeout;
	}
	return body;
}

/** Project a Tavily /map response onto the tool's output shape. */
export function projectMapResponse(data) {
	const out = {};
	if (typeof data.base_url === "string") out.base_url = data.base_url;
	if (Array.isArray(data.results)) out.results = data.results.filter((url) => typeof url === "string");
	if (typeof data.response_time === "number") out.response_time = data.response_time;
	if (typeof data.request_id === "string") out.request_id = data.request_id;
	return out;
}
