/**
 * Pure, dependency-free Tavily search mapping helpers shared by the host
 * plugin (`lib/index.js`) and its tests. Nothing here touches the network,
 * the process environment, or credentials — callers supply the resolved key.
 *
 * Two result shapes are produced:
 * - `projectOfficialSearchResponse`: the `ctx.web` seam shape
 *   (`{ content?, sources: [{ url, title?, snippet?, publishedAt? }], truncated }`)
 *   the official `web_search` tool's execute/render consume unchanged, so the
 *   official result compatibility of the drop-in backend is a property of this
 *   projection.
 * - `projectRawSearchResponse`: the raw Tavily /search shape
 *   (`{ answer?, results: [{ title?, url?, content?, score?, published_date? }] }`)
 *   exposed by the standalone `tavily_search` tool (per-result score included).
 *
 * @module dsh-tavily-search-provider/search
 */

/** Tavily /search endpoint. */
export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";

/** Credential reference the provider resolves for the API key. */
export const TAVILY_API_KEY_REF = "TAVILY_API_KEY";

/**
 * The advanced retrieval controls the installed `@deepseek-ai/dsh-tool-web`
 * patch forwards on the `ctx.web.search` seam request (and this plugin's own
 * `tavily_search` tool accepts). Providers that do not read them (the official
 * DeepSeek provider) simply ignore them, so the official behavior is
 * unchanged while the switch is off.
 */
export const TAVILY_ADVANCED_CONTROLS = [
	"search_depth",
	"topic",
	"time_range",
	"max_results",
	"include_domains",
	"exclude_domains",
	"include_answer",
	"include_raw_content",
	"chunks_per_source",
	"start_date",
	"end_date",
	"country",
	"include_images",
	"include_image_descriptions",
	"include_favicon",
	"auto_parameters",
	"include_usage",
];

/**
 * Map one search request onto the Tavily /search body with full parameter
 * forwarding and per-field type gating: only well-typed values travel, so a
 * malformed model argument can never produce a nonsense request body.
 *
 * `max_results` precedence (matches the installed tool-web patch): the
 * model-specified `request.max_results` (snake_case, the patched tool's
 * schema) wins, then `request.maxResults` (the seam's own cap spelling), then
 * the deployment default.
 *
 * @param request - the seam request (query plus any advanced controls).
 * @param options - `apiKey` (resolved by the caller), `defaultMaxResults`
 *   (deployment cap), and `defaultIncludeAnswer` (provider path defaults the
 *   AI answer on; the standalone tool leaves it to the caller).
 * @returns the request body plus the effective result cap used by
 *   {@link projectOfficialSearchResponse}.
 */
export function buildSearchBody(request, options) {
	const maxResults = request.max_results ?? request.maxResults ?? options.defaultMaxResults;
	const includeAnswer = request.include_answer ?? options.defaultIncludeAnswer;
	const body = {
		api_key: options.apiKey,
		query: request.query,
	};
	if (maxResults !== void 0) body.max_results = maxResults;
	if (includeAnswer !== void 0) body.include_answer = includeAnswer;
	if (typeof request.search_depth === "string") body.search_depth = request.search_depth;
	if (typeof request.topic === "string") body.topic = request.topic;
	if (typeof request.time_range === "string") body.time_range = request.time_range;
	if (Array.isArray(request.include_domains) && request.include_domains.length > 0) body.include_domains = request.include_domains;
	if (Array.isArray(request.exclude_domains) && request.exclude_domains.length > 0) body.exclude_domains = request.exclude_domains;
	if (request.include_raw_content === true) body.include_raw_content = true;
	if (Number.isInteger(request.chunks_per_source) && request.chunks_per_source >= 1 && request.chunks_per_source <= 5) body.chunks_per_source = request.chunks_per_source;
	if (typeof request.start_date === "string" && request.start_date.length > 0) body.start_date = request.start_date;
	if (typeof request.end_date === "string" && request.end_date.length > 0) body.end_date = request.end_date;
	if (typeof request.country === "string" && request.country.length > 0) body.country = request.country;
	if (request.include_images === true) body.include_images = true;
	if (request.include_image_descriptions === true) body.include_image_descriptions = true;
	if (request.include_favicon === true) body.include_favicon = true;
	if (request.auto_parameters === true) body.auto_parameters = true;
	if (request.include_usage === true) body.include_usage = true;
	return { body, maxResults };
}

/**
 * Project a Tavily /search response onto the official `ctx.web` seam result
 * shape. `answer` becomes `content`, per-result `content` becomes `snippet`,
 * `published_date` becomes `publishedAt`, and only present, well-typed values
 * are kept (a property is never set to `undefined`, which would be lossy
 * under JSON serialization and fail the official output schema's
 * `additionalProperties: false`).
 *
 * @param data - the parsed Tavily /search response.
 * @param maxResults - the effective cap {@link buildSearchBody} returned.
 * @returns the official seam result shape.
 */
export function projectOfficialSearchResponse(data, maxResults) {
	const results = Array.isArray(data.results) ? data.results : [];
	return {
		...typeof data.answer === "string" && data.answer.length > 0 ? { content: data.answer } : {},
		sources: results.map((result) => ({
			url: typeof result.url === "string" ? result.url : "",
			...typeof result.title === "string" && result.title.length > 0 ? { title: result.title } : {},
			...typeof result.content === "string" && result.content.length > 0 ? { snippet: result.content } : {},
			...typeof result.published_date === "string" && result.published_date.length > 0 ? { publishedAt: result.published_date } : {},
		})),
		truncated: results.length > maxResults,
	};
}

/**
 * Project a Tavily /search response onto the standalone tool's raw shape,
 * keeping only present, well-typed fields (Tavily omits or null-fills
 * `answer` and per-result fields).
 *
 * @param data - the parsed Tavily /search response.
 * @returns `{ answer?, results }` with per-result `title`/`url`/`content`/`score`/`published_date`.
 */
export function projectRawSearchResponse(data) {
	const out = {};
	if (typeof data.answer === "string") out.answer = data.answer;
	if (Array.isArray(data.results)) {
		out.results = data.results.map((result) => {
			const item = {};
			if (typeof result.title === "string") item.title = result.title;
			if (typeof result.url === "string") item.url = result.url;
			if (typeof result.content === "string") item.content = result.content;
			if (typeof result.score === "number") item.score = result.score;
			if (typeof result.published_date === "string") item.published_date = result.published_date;
			return item;
		});
	}
	return out;
}
