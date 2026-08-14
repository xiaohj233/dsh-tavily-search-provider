/**
 * Tests for the pure Tavily body mapping and response projection helpers
 * (`lib/search.mjs`): full advanced-parameter forwarding with type gating,
 * `max_results` precedence, and both result shapes (official seam shape for
 * the drop-in backend, raw Tavily shape for the standalone tool).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	TAVILY_ADVANCED_CONTROLS,
	buildSearchBody,
	projectOfficialSearchResponse,
	projectRawSearchResponse,
} from "../lib/search.mjs";

const KEY = "tvly-test-key";

test("buildSearchBody forwards every advanced control with correct types", () => {
	const { body, maxResults } = buildSearchBody({
		query: "deepseek harness",
		search_depth: "advanced",
		topic: "news",
		time_range: "week",
		max_results: 12,
		include_domains: ["deepseek.com", "github.com"],
		exclude_domains: ["example.com"],
		include_answer: true,
		include_raw_content: true,
	}, { apiKey: KEY, defaultMaxResults: 8, defaultIncludeAnswer: true });

	assert.equal(body.api_key, KEY);
	assert.equal(body.query, "deepseek harness");
	assert.equal(body.max_results, 12);
	assert.equal(body.search_depth, "advanced");
	assert.equal(body.topic, "news");
	assert.equal(body.time_range, "week");
	assert.deepEqual(body.include_domains, ["deepseek.com", "github.com"]);
	assert.deepEqual(body.exclude_domains, ["example.com"]);
	assert.equal(body.include_answer, true);
	assert.equal(body.include_raw_content, true);
	assert.equal(maxResults, 12);
});

test("buildSearchBody applies defaults and omits absent controls entirely", () => {
	const { body, maxResults } = buildSearchBody({ query: "q" }, {
		apiKey: KEY,
		defaultMaxResults: 8,
		defaultIncludeAnswer: true,
	});
	assert.equal(body.max_results, 8);
	assert.equal(body.include_answer, true);
	assert.equal("search_depth" in body, false);
	assert.equal("topic" in body, false);
	assert.equal("time_range" in body, false);
	assert.equal("include_domains" in body, false);
	assert.equal("exclude_domains" in body, false);
	assert.equal("include_raw_content" in body, false);
	assert.equal(maxResults, 8);
});

test("buildSearchBody: model max_results wins over the seam cap; seam spelling used otherwise", () => {
	const fromSnake = buildSearchBody({ query: "q", max_results: 3 }, { apiKey: KEY, defaultMaxResults: 8 });
	assert.equal(fromSnake.body.max_results, 3);
	const fromCamel = buildSearchBody({ query: "q", maxResults: 5 }, { apiKey: KEY, defaultMaxResults: 8 });
	assert.equal(fromCamel.body.max_results, 5);
	const fromDefault = buildSearchBody({ query: "q" }, { apiKey: KEY, defaultMaxResults: 8 });
	assert.equal(fromDefault.body.max_results, 8);
});

test("buildSearchBody type-gates malformed arguments (never forwarded)", () => {
	const { body } = buildSearchBody({
		query: "q",
		search_depth: 42,
		topic: ["general"],
		time_range: { day: true },
		include_domains: "deepseek.com",
		exclude_domains: "x.com",
		include_raw_content: 1,
	}, { apiKey: KEY, defaultMaxResults: 8, defaultIncludeAnswer: true });
	assert.equal("search_depth" in body, false);
	assert.equal("topic" in body, false);
	assert.equal("time_range" in body, false);
	assert.equal("include_domains" in body, false);
	assert.equal("exclude_domains" in body, false);
	assert.equal("include_raw_content" in body, false);
	assert.equal(body.include_answer, true);
});

test("buildSearchBody forwards include_answer faithfully (no silent boolean gate)", () => {
	// The original provider/tool forward the value as-is; the tool schema already
	// constrains it to a boolean, so the body builder must not over-filter.
	const { body } = buildSearchBody({ query: "q", include_answer: "yes" }, { apiKey: KEY, defaultMaxResults: 8 });
	assert.equal(body.include_answer, "yes");
	const explicitFalse = buildSearchBody({ query: "q", include_answer: false }, { apiKey: KEY, defaultMaxResults: 8, defaultIncludeAnswer: true });
	assert.equal(explicitFalse.body.include_answer, false);
});

test("buildSearchBody: standalone tool path leaves optional defaults to the API", () => {
	const { body } = buildSearchBody({ query: "q" }, { apiKey: KEY });
	assert.equal("max_results" in body, false);
	assert.equal("include_answer" in body, false);
	const explicit = buildSearchBody({ query: "q", include_answer: false, max_results: 1 }, { apiKey: KEY });
	assert.equal(explicit.body.include_answer, false);
	assert.equal(explicit.body.max_results, 1);
});

test("projectOfficialSearchResponse keeps the official seam shape and omits absent fields", () => {
	const projected = projectOfficialSearchResponse({
		answer: "A synthesized answer.",
		results: [
			{ url: "https://a.example/1", title: "A", content: "snippet A", published_date: "2026-01-02" },
			{ url: "https://b.example/2", title: null, content: null, published_date: null },
			{ url: "", title: "", content: "", published_date: "" },
		],
	}, 8);
	assert.equal(projected.content, "A synthesized answer.");
	assert.deepEqual(projected.sources, [
		{ url: "https://a.example/1", title: "A", snippet: "snippet A", publishedAt: "2026-01-02" },
		{ url: "https://b.example/2" },
		{ url: "" },
	]);
	assert.equal(projected.truncated, false);
});

test("projectOfficialSearchResponse flags truncation against the effective cap and tolerates junk", () => {
	const projected = projectOfficialSearchResponse({ results: [1, 2, 3], answer: 42 }, 2);
	assert.deepEqual(projected.sources, [{ url: "" }, { url: "" }, { url: "" }]);
	assert.equal(projected.truncated, true);
	assert.equal("content" in projected, false);
	const empty = projectOfficialSearchResponse({}, 8);
	assert.deepEqual(empty.sources, []);
	assert.equal(empty.truncated, false);
	assert.equal("content" in empty, false);
});

test("projectRawSearchResponse keeps the raw Tavily shape with present well-typed fields only", () => {
	const projected = projectRawSearchResponse({
		answer: "raw answer",
		results: [
			{ title: "T", url: "https://x", content: "C", score: 0.9, published_date: "2026-01-02" },
			{ title: null, url: null, content: null, score: null, published_date: null },
			{ title: "", url: "", content: "", score: 0, published_date: "" },
		],
	});
	assert.equal(projected.answer, "raw answer");
	assert.deepEqual(projected.results, [
		{ title: "T", url: "https://x", content: "C", score: 0.9, published_date: "2026-01-02" },
		{},
		{ title: "", url: "", content: "", score: 0, published_date: "" },
	]);
	assert.equal(projected.results[0].title, "T");
	assert.equal(projected.results[1].url, void 0);
});

test("TAVILY_ADVANCED_CONTROLS documents the full patched surface", () => {
	assert.deepEqual(TAVILY_ADVANCED_CONTROLS, [
		"search_depth",
		"topic",
		"time_range",
		"max_results",
		"include_domains",
		"exclude_domains",
		"include_answer",
		"include_raw_content",
	]);
});
