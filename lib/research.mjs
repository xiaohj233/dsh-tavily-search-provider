/**
 * Pure, dependency-free Tavily /deep-research mapping helpers shared by the
 * `tavily_research` and `tavily_research_get` tool registrations and their
 * tests.
 *
 * Research is a two-step flow: submit a task (`/deep-research`, returns a
 * `request_id` immediately) then poll the status endpoint until it reaches
 * `completed` or `failed`.
 *
 * @module dsh-tavily-search-provider/research
 */

/** Research models Tavily accepts. */
export const RESEARCH_MODELS = ["mini", "pro", "auto"];

/** Citation formats Tavily accepts. */
export const RESEARCH_CITATIONS = ["numbered", "mla", "apa", "chicago"];

/** Statuses a polled research task can report. */
export const RESEARCH_TERMINAL_STATUSES = ["completed", "failed"];

/**
 * Map one research-submission request onto the Tavily /deep-research body.
 * `output_schema` passes through only when it is a plain object (the tool
 * schema already validates it as an object; this guards against a malformed
 * runtime value). `stream` is intentionally NOT exposed: a model tool call
 * is a poor fit for streaming, and polling gives the same report.
 *
 * @param args - the tool arguments.
 * @param apiKey - the resolved TAVILY_API_KEY.
 * @returns the request body.
 */
export function buildResearchBody(args, apiKey) {
	const body = {
		api_key: apiKey,
		input: typeof args.input === "string" ? args.input : "",
	};
	if (typeof args.model === "string" && RESEARCH_MODELS.includes(args.model)) body.model = args.model;
	if (typeof args.citation_format === "string" && RESEARCH_CITATIONS.includes(args.citation_format)) {
		body.citation_format = args.citation_format;
	}
	if (args.output_schema !== void 0 && typeof args.output_schema === "object" && !Array.isArray(args.output_schema)) {
		body.output_schema = args.output_schema;
	}
	return body;
}

/** Project a /deep-research submission response onto the tool's output shape. */
export function projectResearchStart(data) {
	const out = {};
	if (typeof data.request_id === "string") out.request_id = data.request_id;
	if (typeof data.status === "string") out.status = data.status;
	if (typeof data.created_at === "string") out.created_at = data.created_at;
	if (typeof data.input === "string") out.input = data.input;
	if (typeof data.model === "string") out.model = data.model;
	return out;
}

/** Project a polled /deep-research/{id} response onto the tool's output shape. */
export function projectResearchStatus(data) {
	const out = {};
	if (typeof data.status === "string") out.status = data.status;
	if (typeof data.content === "string") out.content = data.content;
	if (Array.isArray(data.sources)) {
		out.sources = data.sources.map((source) => {
			const item = {};
			if (typeof source.url === "string") item.url = source.url;
			if (typeof source.title === "string") item.title = source.title;
			if (typeof source.citation === "string") item.citation = source.citation;
			return item;
		});
	}
	if (typeof data.response_time === "number") out.response_time = data.response_time;
	return out;
}
