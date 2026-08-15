/**
 * DNS-resilient HTTPS fetch for Tavily endpoints.
 *
 * Problem this module solves: on machines behind Clash/mihomo-style proxies
 * running in fake-ip DNS mode (with or without TUN), the system resolver can
 * intermittently return a poisoned or fake address (198.18.0.0/15) for
 * `api.tavily.com`, so a plain `fetch()` — which resolves through the system
 * DNS and then connects to whatever it returned — hangs until connect
 * timeout while the real IPs stay perfectly reachable.
 *
 * Strategy, in order:
 * 1. Resolve the host's real A records through plain-HTTPS DoH (AliDNS,
 *    DNSPod, Google), filtering out fake/private/reserved addresses.
 * 2. If plain DoH is unreachable (e.g. the local DNS itself is down), query
 *    DoH servers by their well-known IP literals (8.8.8.8 / 223.5.5.5) so
 *    resolution does not depend on the system resolver at all.
 * 3. Fall back to the system resolver, again filtering fake/private IPs.
 * 4. Only if every source fails, fall back to the caller's plain `fetch`
 *    (status-quo behavior).
 *
 * The chosen address is then used with node's http/https request through a
 * custom `lookup`, so TLS SNI and the Host header still carry the real
 * hostname while the TCP connection is pinned to a verified public IP.
 * Resolutions are cached (5 min fresh, 1 h stale-fallback, 30 s failure
 * backoff) and round-robined across the address set.
 *
 * Nothing here touches credentials, the process environment, or any DSH
 * service; it is plain Node built-ins so it runs identically in the harness
 * process and standalone.
 *
 * @module dsh-tavily-search-provider/net
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as systemLookup } from "node:dns/promises";

/** Fresh-resolution cache TTL. */
const RESOLVE_TTL_MS = 5 * 60 * 1000;
/** Stale resolution stays usable as a fallback this long after expiry. */
const STALE_TTL_MS = 60 * 60 * 1000;
/** A failed resolution is remembered briefly so repeated calls do not hammer DNS. */
const FAILURE_TTL_MS = 30 * 1000;
/** Socket inactivity timeout for pinned requests. */
const REQUEST_TIMEOUT_MS = 60 * 1000;
/** Per-query timeout for one DoH lookup. */
const DOH_TIMEOUT_MS = 4000;

/** hostname -> { ips: string[], expiresAt, staleUntil } */
const resolutionCache = new Map();
/** Round-robin cursor across pinned addresses. */
let pinnedCallCount = 0;

/** Plain-HTTPS DoH query builders (first match wins). */
const DOH_PLAIN_BUILDERS = [
	(hostname) => `https://dns.alidns.com/resolve?name=${encodeURIComponent(hostname)}&type=A`,
	(hostname) => `https://doh.pub/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
	(hostname) => `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
];

/** IP-literal DoH fallbacks: [ip, tls servername] — no system DNS involved. */
const DOH_IP_ENDPOINTS = [
	["8.8.8.8", "dns.google"],
	["223.5.5.5", "dns.alidns.com"],
];

/**
 * Whether an IPv4 literal is a usable public address for pinning. Rejects the
 * mihomo/Clash fake-ip range (198.18.0.0/15), private, loopback, CGNAT, and
 * reserved ranges — connecting to any of those would black-hole.
 */
export function isUsablePublicIp(ip) {
	if (typeof ip !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
	const parts = ip.split(".").map(Number);
	if (parts.some((part) => Number.isNaN(part) || part > 255)) return false;
	const [a, b] = parts;
	if (a === 0 || a === 10 || a === 127) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 198 && (b === 18 || b === 19)) return false;
	if (a >= 240) return false;
	return true;
}

/** Extract usable A records from a DoH JSON answer. */
function usableIpsFromAnswer(answer) {
	return (Array.isArray(answer) ? answer : [])
		.filter((record) => record?.type === 1 && isUsablePublicIp(record.data))
		.map((record) => record.data);
}

/** Plain-HTTPS DoH: resolve through the caller's fetch (system DNS still fine for these hosts). */
async function dohPlain(hostname, fetchImpl) {
	for (const build of DOH_PLAIN_BUILDERS) {
		try {
			const response = await fetchImpl(build(hostname), {
				signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
				headers: { accept: "application/dns-json" },
			});
			if (!response.ok) continue;
			const parsed = await response.json();
			const ips = usableIpsFromAnswer(parsed.Answer);
			if (ips.length > 0) return ips;
		} catch { /* try the next source */ }
	}
	return null;
}

/** IP-literal DoH: query by the DoH server's well-known address; no resolution needed. */
function dohByIp(hostname, ip, servername) {
	return new Promise((resolve) => {
		const req = httpsRequest(
			{
				host: ip,
				servername,
				path: `/resolve?name=${encodeURIComponent(hostname)}&type=A`,
				method: "GET",
				headers: { host: servername, accept: "application/dns-json" },
				timeout: DOH_TIMEOUT_MS,
			},
			(response) => {
				let buffer = "";
				response.on("data", (chunk) => (buffer += chunk));
				response.on("end", () => {
					try {
						const parsed = JSON.parse(buffer);
						resolve(usableIpsFromAnswer(parsed.Answer));
					} catch {
						resolve(null);
					}
				});
			},
		);
		req.on("error", () => resolve(null));
		req.on("timeout", () => {
			req.destroy();
			resolve(null);
		});
		req.end();
	});
}

/** System resolver as a last resort (filtered the same way). */
async function systemLookupIps(hostname) {
	try {
		const records = await systemLookup(hostname, { all: true, verbatim: true });
		return records.map((record) => record.address).filter(isUsablePublicIp);
	} catch {
		return [];
	}
}

/**
 * Resolve a hostname to usable public IPv4 literals, with cache and fallbacks.
 * Returns `null` when every source fails and no stale entry exists.
 *
 * @param hostname - the host to resolve.
 * @param deps - test seam: `now()`, `fetch` (DoH transport).
 */
export async function resolveHostIps(hostname, deps = {}) {
	const now = deps.now?.() ?? Date.now();
	const cached = resolutionCache.get(hostname);
	if (cached !== undefined && cached.expiresAt > now) return cached.ips.length > 0 ? cached.ips : null;
	const sources = [
		() => dohPlain(hostname, deps.fetch ?? fetch),
		() => dohByIp(hostname, DOH_IP_ENDPOINTS[0][0], DOH_IP_ENDPOINTS[0][1]),
		() => dohByIp(hostname, DOH_IP_ENDPOINTS[1][0], DOH_IP_ENDPOINTS[1][1]),
		() => systemLookupIps(hostname),
	];
	let ips = null;
	for (const source of sources) {
		try {
			ips = await source();
		} catch {
			ips = null;
		}
		if (Array.isArray(ips) && ips.length > 0) break;
	}
	if (Array.isArray(ips) && ips.length > 0) {
		resolutionCache.set(hostname, {
			ips,
			expiresAt: now + RESOLVE_TTL_MS,
			staleUntil: now + RESOLVE_TTL_MS + STALE_TTL_MS,
		});
		return ips;
	}
	if (cached !== undefined && cached.ips.length > 0 && cached.staleUntil > now) {
		resolutionCache.set(hostname, { ...cached, expiresAt: now + FAILURE_TTL_MS });
		return cached.ips;
	}
	resolutionCache.set(hostname, { ips: [], expiresAt: now + FAILURE_TTL_MS, staleUntil: 0 });
	return null;
}

/** Round-robin address pick for one pinned request. */
function pickAddress(ips) {
	const index = pinnedCallCount++ % ips.length;
	return ips[index];
}

/**
 * Perform the request with the TCP connection pinned to a verified IP while
 * TLS SNI and the Host header keep the real hostname. Returns a minimal
 * Response-like object (`ok`, `status`, `statusText`, `headers`, `json()`,
 * `text()`) so callers need no changes.
 */
export function pinnedRequest(url, init, ips) {
	const u = new URL(url);
	const method = init.method ?? "GET";
	const headers = {};
	for (const [key, value] of new Headers(init.headers ?? {})) headers[key] = value;
	let body = init.body;
	if (body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
		body = String(body);
	}
	if (body !== undefined && headers["content-length"] === undefined) {
		headers["content-length"] = String(Buffer.byteLength(body));
	}
	const transport = u.protocol === "http:" ? httpRequest : httpsRequest;
	const address = pickAddress(ips);
	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = (error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		};
		const req = transport(
			{
				hostname: u.hostname,
				...(u.port !== "" ? { port: Number(u.port) } : {}),
				lookup: (host, options, callback) => {
					if (options.all) callback(null, ips.map((ip) => ({ address: ip, family: 4 })));
					else callback(null, address, 4);
				},
				method,
				path: `${u.pathname}${u.search}`,
				headers,
				...(u.protocol === "https:" ? { servername: u.hostname } : {}),
				timeout: REQUEST_TIMEOUT_MS,
			},
			(response) => {
				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					if (settled) return;
					settled = true;
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({
						ok: response.statusCode >= 200 && response.statusCode < 300,
						status: response.statusCode,
						statusText: response.statusMessage ?? "",
						headers: new Headers(response.headers),
						json: async () => JSON.parse(text),
						text: async () => text,
					});
				});
			},
		);
		req.on("error", (error) => fail(error));
		req.on("timeout", () => {
			req.destroy();
			fail(new Error(`Tavily connection timed out after ${REQUEST_TIMEOUT_MS / 1000}s of inactivity`));
		});
		if (init.signal !== undefined) {
			if (init.signal.aborted) {
				req.destroy();
				fail(new Error("Tavily request aborted"));
				return;
			}
			init.signal.addEventListener(
				"abort",
				() => {
					req.destroy();
					fail(new Error("Tavily request aborted"));
				},
				{ once: true },
			);
		}
		if (body !== undefined) req.write(body);
		req.end();
	});
}

/**
 * DNS-resilient fetch for Tavily endpoints. Non-http(s) URLs and the
 * no-usable-IP case fall back to the caller's plain fetch.
 *
 * @param url - the Tavily endpoint URL.
 * @param init - fetch-compatible init (`method`, `headers`, `body`, `signal`).
 * @param deps - test seam: `resolveIps`, `fetch`.
 */
export async function tavilyFetch(url, init = {}, deps = {}) {
	const u = new URL(url);
	if (u.protocol !== "https:" && u.protocol !== "http:") return (deps.fetch ?? fetch)(url, init);
	const ips = await (deps.resolveIps ?? ((hostname) => resolveHostIps(hostname, deps)))(u.hostname);
	if (!Array.isArray(ips) || ips.length === 0) return (deps.fetch ?? fetch)(url, init);
	return pinnedRequest(url, init, ips);
}

const NETWORK_ERROR_PATTERN = /(timeout|timed out|ETIMEDOUT|ENETUNREACH|ENOTFOUND|ECONNREFUSED|ECONNRESET|socket hang up|fetch failed|UND_ERR)/i;

/**
 * A short, actionable hint appended to network-failure messages so users
 * behind fake-IP DNS know what happened and what to check. Empty string when
 * the error does not look like a connectivity failure.
 */
export function tavilyNetworkHint(error) {
	const message = String(error instanceof Error ? error.message : error);
	if (!NETWORK_ERROR_PATTERN.test(message)) return "";
	return (
		" If you use a Clash/proxy fake-IP DNS, api.tavily.com may be poisoned to a 198.18.x.x address; " +
		"this plugin already resolves real IPs via DoH automatically, so a remaining failure means the proxy node or network itself cannot reach Tavily."
	);
}
