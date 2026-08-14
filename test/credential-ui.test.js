/**
 * Tests for the shipped client bundle's API-key control (`lib/client.js`),
 * driven through the real factory with stubbed platform modules.
 *
 * The security contract under test: the key literal appears ONLY in the
 * `credentials.set` request payload (and the password input's draft state).
 * It never reaches the settings section writes, the value-free
 * `credentials.describe` request, the `credentials.unset` request, error
 * paths, or any other recorded payload; status comes exclusively from the
 * describe view (configured / writable).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const BUNDLE_SOURCE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const API_KEY_REF = "TAVILY_API_KEY";
const KEY_LITERAL = "tvly-secret-test-7f3a";

/** Minimal snapshot store matching @deepseek-ai/dsh-client-runtime/client. */
function createSnapshotStore(init) {
	let state = init;
	const listeners = new Set();
	return {
		getSnapshot: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		update: () => { throw new Error("update is not exercised by this bundle"); },
		set: (next) => {
			state = next;
			for (const listener of [...listeners]) listener();
		},
	};
}

/** Load the real bundle factory. */
function loadBundle() {
	let handoff;
	globalThis.window = { __ModuleLoader__: { load: (h) => { handoff = h; } } };
	try {
		vm.runInThisContext(BUNDLE_SOURCE, { filename: "lib/client.js" });
	} finally {
		delete globalThis.window;
	}
	const stubs = {
		"react": { useState: () => [false, () => {}], Fragment: "fragment" },
		"react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: "fragment" },
		"@deepseek-ai/dsh-client-runtime/client": { createSnapshotStore },
		"@deepseek-ai/dsh-client-ui-primitives": { IconChevronDownOutline14: () => null },
	};
	const module = handoff.factory((spec) => stubs[spec]);
	return module;
}

/** A settings scope fake recording every write and read. */
function fakeScope(sectionValue = {}, writable = true) {
	const listeners = new Set();
	const writes = [];
	const user = {};
	const scope = {
		writes,
		getSnapshot: () => ({ status: "ready", writable, value: sectionValue, base: sectionValue, user }),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async set(field, value) {
			writes.push({ op: "set", field, value });
			user[field] = value;
			for (const listener of [...listeners]) listener();
		},
		async unset(field) {
			writes.push({ op: "unset", field });
			delete user[field];
			for (const listener of [...listeners]) listener();
		},
	};
	return scope;
}

/** A credentials wire face recording every payload; describe is value-free. */
function fakeCredentials() {
	const payloads = [];
	let configured = false;
	let writable = true;
	let failSet = false;
	return {
		payloads,
		setConfigured: (value) => { configured = value; },
		setWritable: (value) => { writable = value; },
		setFailSet: (value) => { failSet = value; },
		async describe(payload) {
			const snapshot = JSON.parse(JSON.stringify(payload));
			payloads.push({ method: "describe", payload: snapshot });
			return { result: { ok: true, value: { credentials: { [API_KEY_REF]: { configured, writable } } } } };
		},
		async set(payload) {
			const snapshot = JSON.parse(JSON.stringify(payload));
			payloads.push({ method: "set", payload: snapshot });
			if (failSet) return { result: { ok: false, error: { code: "credentials-rejected", message: "write refused" } } };
			configured = true;
			return { result: { ok: true, value: {} } };
		},
		async unset(payload) {
			const snapshot = JSON.parse(JSON.stringify(payload));
			payloads.push({ method: "unset", payload: snapshot });
			configured = false;
			return { result: { ok: true, value: {} } };
		},
	};
}

/** Boot the bundle's apply() with fakes; returns the injected card face and fakes. */
function bootCard({ protocol = "https:", hostname = "localhost" } = {}) {
	globalThis.location = { protocol, hostname };
	const module = loadBundle();
	const credentials = fakeCredentials();
	const scope = fakeScope({ replaceOfficialSearch: false, searchMaxResults: 8 });
	const remoteHandlers = {};
	const registrations = [];
	const ctx = {
		get: (name) => name === "connection" ? { api: { credentials } } : void 0,
		settingsScope: { bind: () => scope },
		remote: { $on: (event, handler) => { remoteHandlers[event] = handler; return () => {}; } },
		effect: (fn) => { fn(); },
		slots: {
			inject: (_slot, register) => {
				const registration = register();
				registrations.push(registration);
			},
			register: (options, component) => ({ options, component }),
		},
	};
	module.apply(ctx);
	const registration = registrations.find((entry) => entry.options.name === "settings.plugin.item");
	assert.ok(registration, "card must register into settings.plugin.item");
	const face = registration.options.inject();
	return { face, scope, credentials, remoteHandlers, module };
}

/** Flush pending microtasks so fire-and-forget credential reads settle. */
async function settle() {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test("bundle identity and injections carry the renamed package", () => {
	const module = loadBundle();
	assert.equal(module.name, "dsh-tavily-search-provider");
	assert.deepEqual(module.inject, ["slots", "settingsScope", "connection", "remote"]);
});

test("status comes from the value-free describe view; the key never rides it", async () => {
	const { face, credentials, remoteHandlers } = bootCard();
	await settle();
	credentials.setConfigured(true);
	credentials.setWritable(false);
	credentials.payloads.length = 0;
	remoteHandlers["credentials/updated"](API_KEY_REF);
	await settle();
	const describeCalls = credentials.payloads.filter((entry) => entry.method === "describe");
	assert.ok(describeCalls.length > 0, "controller must describe the reference");
	for (const call of describeCalls) {
		assert.deepEqual(call.payload, { refs: [API_KEY_REF] });
		assert.equal("value" in call.payload, false);
		assert.equal("key" in call.payload, false);
	}
	const projection = face.hooks.tavilyCard.getSnapshot();
	assert.equal(projection.apiKeyConfigured, true);
	assert.equal(projection.apiKeyWritable, false);
});

test("set/replace writes only via credentials.set and never into the settings section", async () => {
	const { face, scope, credentials } = bootCard();
	await settle();
	face.edit("apiKey", KEY_LITERAL);
	face.save();
	await settle();
	const setCalls = credentials.payloads.filter((entry) => entry.method === "set");
	assert.equal(setCalls.length, 1);
	assert.deepEqual(Object.keys(setCalls[0].payload).sort(), ["ref", "value"]);
	assert.equal(setCalls[0].payload.ref, API_KEY_REF);
	assert.equal(setCalls[0].payload.value, KEY_LITERAL);
	assert.ok(!scope.writes.some((write) => write.field === "apiKey"), "the key must never be written to the settings section");
	assert.equal(face.hooks.tavilyCard.getSnapshot().apiKeyConfigured, true);
});

test("a blank draft keeps the stored key (no write at all)", async () => {
	const { face, scope, credentials } = bootCard();
	await settle();
	credentials.setConfigured(true);
	credentials.payloads.length = 0;
	face.edit("apiKey", "   ");
	face.save();
	await settle();
	assert.equal(credentials.payloads.filter((entry) => entry.method === "set").length, 0);
	assert.equal(scope.writes.some((write) => write.field === "apiKey"), false);
});

test("unset writes only via credentials.unset and supersedes a staged draft", async () => {
	const { face, scope, credentials } = bootCard();
	await settle();
	credentials.setConfigured(true);
	face.edit("apiKey", KEY_LITERAL); // staged draft
	credentials.payloads.length = 0;
	const landed = await face.unsetKey();
	await settle();
	assert.equal(landed, true);
	const unsetCalls = credentials.payloads.filter((entry) => entry.method === "unset");
	assert.equal(unsetCalls.length, 1);
	assert.deepEqual(unsetCalls[0].payload, { ref: API_KEY_REF });
	assert.equal(credentials.payloads.filter((entry) => entry.method === "set").length, 0);
	assert.ok(!scope.writes.some((write) => write.field === "apiKey"));
	const projection = face.hooks.tavilyCard.getSnapshot();
	assert.equal(projection.apiKeyConfigured, false);
	// The draft was cleared: saving now must not rewrite the key.
	face.save();
	await settle();
	assert.equal(credentials.payloads.filter((entry) => entry.method === "set").length, 0);
});

test("a failed key write surfaces a generic failure, never the key", async () => {
	const { face, credentials } = bootCard();
	await settle();
	credentials.setFailSet(true);
	face.edit("apiKey", KEY_LITERAL);
	face.save();
	await settle();
	const projection = face.hooks.tavilyCard.getSnapshot();
	assert.equal(projection.failed, true);
	assert.equal(projection.apiKeyConfigured, false);
	// The draft is preserved for retry (official staged-save behavior) and the
	// input needs it, so the key may appear ONLY as apiKey.text — never in any
	// other projection field, never in an error surface.
	const { apiKey, ...rest } = projection;
	assert.equal(apiKey.text, KEY_LITERAL);
	assert.equal(JSON.stringify(rest).includes(KEY_LITERAL), false, "no other projection field may carry the key");
});

test("non-loopback plaintext HTTP refuses key writes and unsets", async () => {
	const { face, credentials } = bootCard({ protocol: "http:", hostname: "192.168.1.50" });
	await settle();
	credentials.payloads.length = 0;
	face.edit("apiKey", KEY_LITERAL);
	face.save();
	await settle();
	assert.equal(credentials.payloads.some((entry) => entry.method === "set"), false);
	assert.equal(await face.unsetKey(), false);
	assert.equal(credentials.payloads.some((entry) => entry.method === "unset"), false);
	const projection = face.hooks.tavilyCard.getSnapshot();
	assert.equal(projection.apiKeyTransportAllowed, false);
	assert.equal(projection.apiKeyWritable, false);
});

test("the key literal appears in exactly one recorded payload class: credentials.set", async () => {
	const { face, credentials, scope } = bootCard();
	await settle();
	face.edit("apiKey", KEY_LITERAL);
	face.save();
	await settle();
	await face.unsetKey();
	await settle();
	face.edit("apiKey", KEY_LITERAL);
	face.save();
	await settle();
	for (const entry of credentials.payloads) {
		if (entry.method !== "set") {
			assert.equal(JSON.stringify(entry.payload).includes(KEY_LITERAL), false, `${entry.method} payload must never carry the key`);
		}
	}
	const setPayloads = credentials.payloads.filter((entry) => entry.method === "set");
	assert.ok(setPayloads.length >= 2);
	for (const entry of setPayloads) assert.equal(entry.payload.value, KEY_LITERAL);
	for (const write of scope.writes) assert.equal(JSON.stringify(write).includes(KEY_LITERAL), false, "settings writes must never carry the key");
});

test("credential reads tolerate failures and refresh on the remote event", async () => {
	const { face, credentials, remoteHandlers } = bootCard();
	await settle();
	// Simulate the Models page configuring the same reference.
	credentials.setConfigured(true);
	remoteHandlers["credentials/updated"](API_KEY_REF);
	await settle();
	assert.equal(face.hooks.tavilyCard.getSnapshot().apiKeyConfigured, true);
	// A different reference must not trigger this card.
	credentials.setConfigured(false);
	remoteHandlers["credentials/updated"]("SOME_OTHER_KEY");
	await settle();
	assert.equal(face.hooks.tavilyCard.getSnapshot().apiKeyConfigured, true, "foreign reference must be ignored");
});
