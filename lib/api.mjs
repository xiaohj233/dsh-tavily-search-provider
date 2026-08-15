/**
 * Shared Tavily REST helpers for the plugin's tool suite: one POST/GET
 * wrapper with uniform credential and HTTP error reporting, plus the
 * credential resolver every tool uses.
 *
 * @module dsh-tavily-search-provider/api
 */

import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { TAVILY_API_KEY_REF } from "./search.mjs";
import { tavilyFetch, tavilyNetworkHint } from "./net.mjs";

/** Tavily REST endpoints the plugin's tools talk to. */
export const TAVILY_EXTRACT_ENDPOINT = "https://api.tavily.com/extract";
export const TAVILY_MAP_ENDPOINT = "https://api.tavily.com/map";
export const TAVILY_CRAWL_ENDPOINT = "https://api.tavily.com/crawl";
export const TAVILY_RESEARCH_ENDPOINT = "https://api.tavily.com/deep-research";
export const TAVILY_RESEARCH_STATUS_ENDPOINT = "https://api.tavily.com/deep-research/";

/** Structured error for a Tavily REST failure (credential, network, or HTTP). */
export class TavilyApiError extends Error {
	constructor(message, code, status = void 0) {
		super(message);
		this.name = "TavilyApiError";
		this.code = code;
		this.status = status;
	}
}

/** Resolve the API key through the credentials seam, falling back to env. */
export async function resolveApiKey(ctx) {
	const resolved = await ctx.credentials?.resolve(credentialRef(TAVILY_API_KEY_REF));
	if (resolved?.value) return resolved.value;
	return process.env[TAVILY_API_KEY_REF] ?? undefined;
}

/**
 * Resolve the API key or throw the same clear error the search tool uses,
 * so a missing credential never reaches Tavily as a 401.
 */
export async function requireApiKey(ctx) {
	const key = await resolveApiKey(ctx);
	if (!key) {
		throw new TavilyApiError(
			`tavily: ${TAVILY_API_KEY_REF} is not configured. Add it via Settings → Plugins → Tavily 搜索 (stored through the credentials seam), or export it in the launching shell.`,
			"TAVILY_CREDENTIAL_MISSING",
		);
	}
	return key;
}

/** POST a JSON body (api_key injected) to a Tavily endpoint and parse the response. */
export async function tavilyPost(endpoint, body, signal) {
	const headers = { "content-type": "application/json" };
	// /search and /extract accept api_key in the body; /map (and the newer
	// endpoints) require the Authorization header — send both so every
	// endpoint works with the same helper.
	if (typeof body.api_key === "string") headers.authorization = `Bearer ${body.api_key}`;
	let response;
	try {
		response = await tavilyFetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			...(signal !== void 0 ? { signal } : {}),
		});
	} catch (error) {
		if (signal?.aborted === true) throw new TavilyApiError("Tavily request aborted", "TAVILY_ABORTED");
		throw new TavilyApiError(`Tavily request failed: ${String(error)}${tavilyNetworkHint(error)}`, "TAVILY_NETWORK_ERROR");
	}
	return parseTavilyResponse(response);
}

/** GET a Tavily resource (api_key as query param plus bearer header) and parse the response. */
export async function tavilyGet(endpoint, apiKey, signal) {
	const url = `${endpoint}?api_key=${encodeURIComponent(apiKey)}`;
	let response;
	try {
		response = await tavilyFetch(url, {
			headers: { authorization: `Bearer ${apiKey}` },
			...(signal !== void 0 ? { signal } : {}),
		});
	} catch (error) {
		if (signal?.aborted === true) throw new TavilyApiError("Tavily request aborted", "TAVILY_ABORTED");
		throw new TavilyApiError(`Tavily request failed: ${String(error)}${tavilyNetworkHint(error)}`, "TAVILY_NETWORK_ERROR");
	}
	return parseTavilyResponse(response);
}

/** Parse a Tavily response: non-2xx becomes a structured error with the API's own message when available. */
async function parseTavilyResponse(response) {
	if (!response.ok) {
		let message = `Tavily API error (HTTP ${response.status})`;
		try {
			const parsed = await response.json();
			const detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
			if (typeof detail === "string" && detail.length > 0) message = detail;
		} catch { /* keep the status-based message */ }
		throw new TavilyApiError(message, "TAVILY_HTTP_ERROR", response.status);
	}
	try {
		return await response.json();
	} catch (error) {
		throw new TavilyApiError(`Tavily returned an unprocessable response body: ${String(error)}`, "TAVILY_BAD_RESPONSE");
	}
}
