/**
 * Unit tests for the DNS-resilient fetch layer (lib/net.mjs).
 *
 * Everything here is hermetic: DoH sources, the resolver, and the transport
 * are injected through the deps seam, and the pinned transport is exercised
 * against a local http server. No external network is touched.
 *
 * @module dsh-tavily-search-provider/net-test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
	isUsablePublicIp,
	pinnedRequest,
	resolveHostIps,
	tavilyFetch,
	tavilyNetworkHint,
} from "../lib/net.mjs";

test("isUsablePublicIp rejects fake-ip, private, reserved, and garbage", () => {
	// mihomo/Clash fake-ip range 198.18.0.0/15
	assert.equal(isUsablePublicIp("198.18.0.17"), false);
	assert.equal(isUsablePublicIp("198.19.255.255"), false);
	assert.equal(isUsablePublicIp("198.17.255.255"), true);
	assert.equal(isUsablePublicIp("198.20.0.1"), true);
	// private / loopback / CGNAT / reserved
	assert.equal(isUsablePublicIp("10.0.0.1"), false);
	assert.equal(isUsablePublicIp("172.16.0.1"), false);
	assert.equal(isUsablePublicIp("172.31.255.1"), false);
	assert.equal(isUsablePublicIp("172.32.0.1"), true);
	assert.equal(isUsablePublicIp("192.168.1.1"), false);
	assert.equal(isUsablePublicIp("100.64.0.1"), false);
	assert.equal(isUsablePublicIp("127.0.0.1"), false);
	assert.equal(isUsablePublicIp("0.0.0.0"), false);
	assert.equal(isUsablePublicIp("240.0.0.1"), false);
	// public literals
	assert.equal(isUsablePublicIp("8.8.8.8"), true);
	assert.equal(isUsablePublicIp("3.210.82.221"), true);
	assert.equal(isUsablePublicIp("1.1.1.1"), true);
	// malformed
	assert.equal(isUsablePublicIp("999.1.1.1"), false);
	assert.equal(isUsablePublicIp("1.2.3"), false);
	assert.equal(isUsablePublicIp("1.2.3.4.5"), false);
	assert.equal(isUsablePublicIp("example.com"), false);
	assert.equal(isUsablePublicIp(undefined), false);
	assert.equal(isUsablePublicIp("2001:db8::1"), false);
});

test("resolveHostIps uses DoH answers, filters unusable IPs, and caches", async () => {
	let calls = 0;
	const deps = {
		now: () => 1000,
		fetch: async () => {
			calls += 1;
			return {
				ok: true,
				json: async () => ({
					Answer: [
						{ type: 1, data: "198.18.0.17" }, // fake-ip -> filtered
						{ type: 1, data: "10.1.2.3" }, // private -> filtered
						{ type: 1, data: "32.197.140.187" },
						{ type: 1, data: "3.210.82.221" },
					],
				}),
			};
		},
	};
	const hostname = `cache-test-${Date.now()}.example`;
	const first = await resolveHostIps(hostname, deps);
	assert.deepEqual(first, ["32.197.140.187", "3.210.82.221"]);
	// cached: second call must not hit the DoH source again
	const second = await resolveHostIps(hostname, deps);
	assert.deepEqual(second, first);
	assert.equal(calls, 1);
	// expired entry re-resolves
	const expired = await resolveHostIps(hostname, { ...deps, now: () => 1000 + 5 * 60 * 1000 + 1 });
	assert.equal(expired.length, 2);
	assert.equal(calls, 2);
});

test("resolveHostIps returns stale entries after a resolution failure", async () => {
	const hostname = `stale-test-${Date.now()}.example`;
	const good = { now: () => 1000, fetch: async () => ({ ok: true, json: async () => ({ Answer: [{ type: 1, data: "8.8.8.8" }] }) }) };
	const first = await resolveHostIps(hostname, good);
	assert.deepEqual(first, ["8.8.8.8"]);
	// after expiry, every source fails (fetch throws, DoH-by-IP unreachable) -> stale is returned
	const failing = { now: () => 1000 + 5 * 60 * 1000 + 1, fetch: async () => { throw new Error("down"); } };
	const stale = await resolveHostIps(hostname, failing);
	assert.deepEqual(stale, ["8.8.8.8"]);
});

test("resolveHostIps returns null (and remembers the failure briefly) when nothing works", async () => {
	const hostname = `never-test-${Date.now()}.example`;
	const failing = {
		now: () => 2000,
		fetch: async () => { throw new Error("down"); },
	};
	const result = await resolveHostIps(hostname, failing);
	assert.equal(result, null);
	const again = await resolveHostIps(hostname, failing);
	assert.equal(again, null);
	// still null after the failure cache expires (all sources still fail)
	const later = await resolveHostIps(hostname, { ...failing, now: () => 2000 + 30 * 1000 + 1 });
	assert.equal(later, null);
});

test("tavilyFetch falls back to plain fetch when no usable IP resolves", async () => {
	let plainCalled = false;
	const deps = {
		resolveIps: async () => null,
		fetch: async () => {
			plainCalled = true;
			return { ok: true, status: 200, json: async () => ({ fallback: true }) };
		},
	};
	const response = await tavilyFetch("https://api.tavily.com/search", { method: "POST" }, deps);
	assert.equal(plainCalled, true);
	assert.equal(response.status, 200);
});

test("pinnedRequest POSTs to a local server with content-length and returns a Response-like object", async () => {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ method: req.method, contentLength: req.headers["content-length"], body }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const { port } = server.address();
		const response = await pinnedRequest(
			`http://127.0.0.1:${port}/search`,
			{ method: "POST", headers: { "content-type": "application/json" }, body: '{"api_key":"tvly-test"}' },
			["127.0.0.1"],
		);
		assert.equal(response.ok, true);
		assert.equal(response.status, 200);
		const parsed = await response.json();
		assert.equal(parsed.method, "POST");
		assert.equal(parsed.body, '{"api_key":"tvly-test"}');
		assert.equal(parsed.contentLength, '{"api_key":"tvly-test"}'.length.toString());
	} finally {
		server.close();
	}
});

test("pinnedRequest rejects on abort signal", async () => {
	const server = createServer(() => { /* never responds */ });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const { port } = server.address();
		const controller = new AbortController();
		const promise = pinnedRequest(
			`http://127.0.0.1:${port}/slow`,
			{ method: "GET", signal: controller.signal },
			["127.0.0.1"],
		);
		controller.abort();
		await assert.rejects(promise, /aborted/i);
	} finally {
		server.close();
	}
});

test("tavilyFetch routes through the pinned transport when IPs resolve", async () => {
	const server = createServer((req, res) => {
		res.end("pinned");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const { port } = server.address();
		const response = await tavilyFetch(
			`http://127.0.0.1:${port}/search`,
			{ method: "GET" },
			{ resolveIps: async () => ["127.0.0.1"], fetch: async () => { throw new Error("plain fetch must not be used"); } },
		);
		assert.equal(response.ok, true);
		assert.equal(await response.text(), "pinned");
	} finally {
		server.close();
	}
});

test("tavilyNetworkHint annotates connectivity errors only", () => {
	assert.match(tavilyNetworkHint(new Error("fetch failed")), /fake-IP/i);
	assert.match(tavilyNetworkHint(new Error("connect ETIMEDOUT 1.2.3.4")), /fake-IP/i);
	assert.equal(tavilyNetworkHint(new Error("Tavily API error (HTTP 401)")), "");
	assert.equal(tavilyNetworkHint(new Error("missing or invalid API key")), "");
	assert.equal(tavilyNetworkHint("plain string without network words"), "");
});
