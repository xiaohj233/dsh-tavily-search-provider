/*!
 * dsh-tavily-search-provider — client bundle.
 *
 * Renders the "Tavily 搜索" configuration card inside the official
 * Settings → Plugins page (the "插件配置" tab), registering into the same
 * `settings.plugin.item` slot the official bash / agent-loop / web-search
 * cards use. Visual language is the official plugin-card language: the CSS
 * class names of `@deepseek-ai/dsh-client-ui-settings-plugins` (whose bundle
 * is always loaded with the web app) are reused, and the card form model is
 * the same staged-save CardForm those cards use, bound to the
 * `dsh-tavily-search-provider:` settings namespace.
 *
 * Fields (settings.yaml `dsh-tavily-search-provider:` section):
 *   replaceOfficialSearch — when on, the official web_search tool uses the
 *                           Tavily provider (args, result shape, web card,
 *                           and prompt guidance stay official — only the
 *                           retrieval backend switches)
 *   searchMaxResults      — source cap for the official-seam path
 *
 * The API key control is a write-only credential control exactly like the
 * official web-search card's: the typed value lives only in the staged draft
 * and the `credentials.set` request payload, never in the settings section,
 * never in a response, and never in an error message. Status comes from the
 * value-free `credentials.describe` view (configured / writable); unsetting
 * goes through `credentials.unset`. The privileged credential methods are
 * loopback-only on the host (`dsh-client-connection` PRIVILEGED_METHODS), so
 * this card only ever runs against the local dsh.
 *
 * The Host half subscribes through dsh-settings, so saving takes effect on
 * the next search without a restart.
 *
 * Bundle contract: classic script registering via `window.__ModuleLoader__`
 * with the factory-form CJS shape used by the framework's own client bundles.
 */
window.__ModuleLoader__.load({
	id: "dsh-tavily-search-provider",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var jsxRuntime = require("react/jsx-runtime");
		var clientRuntime = require("@deepseek-ai/dsh-client-runtime/client");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		/* Official settings-plugins CSS hashes — those bundles are always
		 * loaded, so these class names are guaranteed to be styled. */
		var F = {
			field: "At1oFq_field",
			head: "At1oFq_head",
			label: "At1oFq_label",
			badges: "At1oFq_badges",
			badge: "At1oFq_badge",
			badgeMuted: "At1oFq_badgeMuted",
			reset: "At1oFq_reset",
			input: "At1oFq_input",
			inputInvalid: "At1oFq_inputInvalid",
			invalid: "At1oFq_invalid",
			hint: "At1oFq_hint"
		};
		var C = {
			card: "YyYd_a_card",
			cardOpen: "YyYd_a_cardOpen",
			header: "YyYd_a_header",
			headText: "YyYd_a_headText",
			name: "YyYd_a_name",
			description: "YyYd_a_description",
			chevron: "YyYd_a_chevron",
			chevronOpen: "YyYd_a_chevronOpen",
			body: "YyYd_a_body",
			readOnly: "YyYd_a_readOnly",
			pending: "YyYd_a_pending",
			footer: "YyYd_a_footer",
			failed: "YyYd_a_failed",
			discard: "YyYd_a_discard",
			save: "YyYd_a_save"
		};
		var TOKENS = {
			labelPrimary: "var(--dsw-alias-label-primary)",
			labelSecondary: "var(--dsw-alias-label-secondary)",
			labelTertiary: "var(--dsw-alias-label-tertiary)",
			bgLayer3: "var(--dsw-alias-bg-layer-3)",
			bgPlatform: "var(--dsw-alias-bg-module-platform)",
			borderL2: "var(--dsw-alias-border-l2)",
			success: "var(--dsw-alias-state-success-primary)",
			error: "var(--dsw-alias-label-error)",
			knob: "var(--dsw-alias-button-contrast-fill)",
			font: "var(--dsw-font-family, system-ui, sans-serif)",
			ease: "var(--ds-ease-in-out, cubic-bezier(0.4,0,0.2,1))",
			duration: "var(--ds-transition-duration, 0.2s)"
		};

		/* ---------------------------------------------------------- fields */
		/**
		 * Official-style staged value field (same markup as the settings-plugins
		 * ValueField): label, overridden badge + reset, input, hint.
		 */
		function ValueField(props) {
			return jsxRuntime.jsxs("div", {
				className: F.field,
				children: [
					jsxRuntime.jsxs("div", {
						className: F.head,
						children: [
							jsxRuntime.jsx("label", { className: F.label, htmlFor: props.id, children: props.label }),
							props.overridden
								? jsxRuntime.jsxs("span", {
									className: F.badges,
									children: [
										jsxRuntime.jsx("span", { className: F.badge, children: props.overriddenLabel }),
										jsxRuntime.jsx("button", {
											type: "button",
											className: F.reset,
											disabled: props.disabled,
											onClick: props.onReset,
											children: props.resetLabel
										})
									]
								})
								: null
						]
					}),
					jsxRuntime.jsx("input", {
						id: props.id,
						className: props.invalid ? F.inputInvalid : F.input,
						type: "text",
						...(props.numeric === true ? { inputMode: "numeric" } : {}),
						...(props.invalid ? { "aria-invalid": true } : {}),
						value: props.text,
						placeholder: props.placeholder ?? "",
						disabled: props.disabled,
						onChange: function (event) { props.onEdit(event.target.value); }
					}),
					jsxRuntime.jsx("p", {
						className: props.invalid ? F.invalid : F.hint,
						children: props.invalid ? props.invalidLabel : props.hint
					})
				]
			});
		}

		/**
		 * Official-style boolean toggle field. The switch itself is drawn with
		 * DSH alias tokens to match the platform's native switches.
		 */
		function ToggleField(props) {
			var on = props.text === "true";
			return jsxRuntime.jsxs("div", {
				className: F.field,
				children: [
					jsxRuntime.jsxs("div", {
						className: F.head,
						children: [
							jsxRuntime.jsx("label", { className: F.label, htmlFor: props.id, children: props.label }),
							props.overridden
								? jsxRuntime.jsxs("span", {
									className: F.badges,
									children: [
										jsxRuntime.jsx("span", { className: F.badge, children: props.overriddenLabel }),
										jsxRuntime.jsx("button", {
											type: "button",
											className: F.reset,
											disabled: props.disabled,
											onClick: props.onReset,
											children: props.resetLabel
										})
									]
								})
								: null
						]
					}),
					jsxRuntime.jsx("button", {
						type: "button",
						role: "switch",
						id: props.id,
						"aria-checked": on ? "true" : "false",
						disabled: props.disabled,
						onClick: function () { props.onEdit(on ? "false" : "true"); },
						style: {
							position: "relative",
							display: "inline-block",
							width: 36,
							height: 20,
							borderRadius: 999,
							border: 0,
							cursor: props.disabled ? "default" : "pointer",
							background: on ? TOKENS.success : TOKENS.bgPlatform,
							boxShadow: "inset 0 0 0 1px " + TOKENS.borderL2,
							transition: "background " + TOKENS.duration + " " + TOKENS.ease
						},
						children: jsxRuntime.jsx("span", {
							style: {
								position: "absolute",
								top: 2,
								left: 2,
								width: 16,
								height: 16,
								borderRadius: "50%",
								background: TOKENS.knob,
								boxShadow: "0 1px 2px rgba(0,0,0,.3)",
								transform: on ? "translateX(16px)" : "translateX(0)",
								transition: "transform " + TOKENS.duration + " " + TOKENS.ease
							}
						})
					}),
					jsxRuntime.jsx("p", { className: F.hint, children: props.hint })
				]
			});
		}

		/**
		 * Official-style write-only credential control (same as the settings-plugins
		 * SecretField): a status badge fed by the value-free credentials.describe
		 * view, a password input whose draft never rides a response, and — unlike
		 * the official control — an explicit unset button routed through
		 * credentials.unset. A blank draft writes nothing, keeping the stored key.
		 */
		function SecretField(props) {
			return jsxRuntime.jsxs("div", {
				className: F.field,
				children: [
					jsxRuntime.jsxs("div", {
						className: F.head,
						children: [
							jsxRuntime.jsx("label", { className: F.label, htmlFor: props.id, children: props.label }),
							jsxRuntime.jsx("span", {
								className: F.badges,
								children: jsxRuntime.jsx("span", {
									className: props.configured ? F.badge : F.badgeMuted,
									children: props.stateLabel
								})
							})
						]
					}),
					jsxRuntime.jsx("input", {
						id: props.id,
						className: F.input,
						type: "password",
						autoComplete: "off",
						spellCheck: false,
						value: props.text,
						placeholder: props.placeholder ?? "",
						disabled: props.disabled,
						onChange: function (event) { props.onEdit(event.target.value); }
					}),
					jsxRuntime.jsx("p", { className: F.hint, children: props.hint }),
					props.failed
						? jsxRuntime.jsx("p", { className: F.invalid, role: "status", children: props.failedLabel })
						: null,
					jsxRuntime.jsx("button", {
						type: "button",
						className: C.discard,
						disabled: !props.configured || props.disabled,
						onClick: props.onUnset,
						children: props.unsetLabel
					})
				]
			});
		}

		/* ------------------------------------------------------ card form */
		/* The staged form model, identical to the official plugin cards:
		 * nothing writes until save; a field shows its effective value and
		 * whether the user layer carries it. Write-only controls (the API key)
		 * are staged the same way but written through their own sink on save,
		 * never through the settings scope. */
		function numberField(field) {
			return {
				field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					const parsed = Number(trimmed);
					return Number.isInteger(parsed) && parsed >= 1 ? { kind: "set", value: parsed } : void 0;
				}
			};
		}

		function booleanField(field) {
			return {
				field,
				format: (value) => value === true ? "true" : "false",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "true") return { kind: "set", value: true };
					if (trimmed === "false") return { kind: "set", value: false };
					return void 0;
				}
			};
		}

		var CardForm = class {
			constructor(scope, specs, secrets) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.secretSpecs = new Map((secrets ?? []).map((spec) => [spec.field, spec]));
				this.staged = new Map();
				this.listeners = new Set();
				this.saving = false;
				this.failed = false;
				scope.subscribe(() => { this.publish(); });
			}
			bind(project) {
				const store = clientRuntime.createSnapshotStore(project());
				this.listeners.add(() => { store.set(project()); });
				return store;
			}
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			field(field) {
				const staged = this.staged.get(field);
				if (this.secretSpecs.has(field)) return {
					text: staged?.text ?? "",
					overridden: false,
					invalid: false
				};
				const spec = this.spec(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			actions() {
				return {
					edit: (field, text) => { this.stage(field, { text, clear: false }); },
					resetField: (field) => { this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true }); },
					save: () => { this.save(); },
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const secret = this.secretSpecs.get(field);
					if (secret !== void 0) {
						const value = staged.text.trim();
						if (value !== "") plan.push({ field, run: () => secret.write(value) });
						continue;
					}
					const spec = this.spec(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({ field, run: void 0 });
					else if (write.kind === "clear") plan.push({ field, run: () => this.clear(field) });
					else plan.push({ field, run: () => this.store(field, write.value) });
				}
				return plan;
			}
			async clear(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				return this.userLayer()?.[field] === value;
			}
			/** Drop one staged draft (used when an unset supersedes a key draft). */
			clearStaged(field) {
				if (!this.staged.delete(field)) return;
				this.publish();
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
			}
			spec(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`tavily card has no field ${field}`);
				return spec;
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return this.snapshotOf().value?.[field];
			}
			baseValue(field) {
				return this.snapshotOf().base?.[field];
			}
			userLayer() {
				return this.snapshotOf().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};

		/* ------------------------------------------------------ the card */
		/** Official-style collapsible plugin card (same chrome as the
		 * settings-plugins PluginCard; an unavailable namespace renders
		 * nothing, exactly like the official cards). */
		function PluginCard(props) {
			var openState = react.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			if (!props.state.available) return null;
			return jsxRuntime.jsxs("li", {
				className: C.card + (open ? " " + C.cardOpen : ""),
				children: [
					jsxRuntime.jsx("button", {
						type: "button",
						className: C.header,
						"aria-expanded": open ? "true" : "false",
						onClick: function () { setOpen(!open); },
						children: [
							jsxRuntime.jsxs("span", {
								className: C.headText,
								children: [
									jsxRuntime.jsx("span", { className: C.name, children: props.title }),
									jsxRuntime.jsx("span", { className: C.description, children: props.description })
								]
							}),
							props.state.dirty
								? jsxRuntime.jsx("span", { className: C.pending, children: "未保存的更改" })
								: null,
							jsxRuntime.jsx(primitives.IconChevronDownOutline14, {
								className: C.chevron + (open ? " " + C.chevronOpen : "")
							})
						]
					}),
					open
						? jsxRuntime.jsxs(react.Fragment, {
							children: [
								props.state.writable === false
									? jsxRuntime.jsx("p", { className: C.readOnly, children: "配置只读，无法修改" })
									: null,
								jsxRuntime.jsx("div", { className: C.body, children: props.children }),
								jsxRuntime.jsxs("div", {
									className: C.footer,
									children: [
										props.state.failed
											? jsxRuntime.jsx("p", { className: C.failed, children: "保存失败，请重试" })
											: null,
										jsxRuntime.jsx("button", {
											type: "button",
											className: C.discard,
											disabled: !props.state.dirty,
											onClick: props.onDiscard,
											children: "放弃"
										}),
										jsxRuntime.jsx("button", {
											type: "button",
											className: C.save,
											disabled: !props.state.dirty || props.state.invalid || props.state.saving,
											onClick: props.onSave,
											children: props.state.saving ? "保存中…" : "保存"
										})
									]
								})
							]
						})
						: null
				]
			});
		}

		/** The Tavily search configuration card. */
		function TavilyCard(props) {
			var state = props.useTavilyCard(function (snapshot) { return snapshot; });
			var disabled = !state.writable;
			var keyDisabled = disabled || !state.apiKeyWritable;
			var keyHint = state.apiKeyTransportAllowed
				? "不写入设置文件，仅通过凭据域保存（TAVILY_API_KEY）。留空表示保持当前密钥。"
				: "当前页面使用非本机明文 HTTP，已禁止密钥写入。请使用 localhost 或 HTTPS。";
			return jsxRuntime.jsx(PluginCard, {
				title: "Tavily 搜索",
				description: "Tavily 提供方（官方 web_search 可选后端）",
				state: state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					jsxRuntime.jsx(SecretField, {
						id: "tavily-api-key",
						label: "API Key",
						hint: keyHint,
						stateLabel: state.apiKeyConfigured ? "已配置密钥" : "未配置密钥",
						unsetLabel: "清除密钥",
						failedLabel: "密钥操作失败，请重试",
						disabled: keyDisabled,
						failed: state.apiKeyFailed,
						configured: state.apiKeyConfigured,
						text: state.apiKey.text,
						onEdit: function (text) { props.edit("apiKey", text); },
						onUnset: props.unsetKey
					}),
					jsxRuntime.jsx(ToggleField, {
						id: "tavily-replace-official",
						label: "替代官方搜索",
						hint: "开启后，官方 web_search 工具改用 Tavily 搜索；工具参数、返回结构、网页卡片与提示词保持不变，仅切换检索后端",
						overriddenLabel: "已覆盖",
						resetLabel: "重置",
						disabled: disabled,
						...state.replaceOfficialSearch,
						onEdit: function (text) { props.edit("replaceOfficialSearch", text); },
						onReset: function () { props.resetField("replaceOfficialSearch"); }
					}),
					jsxRuntime.jsx(ValueField, {
						id: "tavily-search-max-results",
						label: "官方搜索最大结果数",
						hint: "替代官方搜索时，每次搜索最多返回的源数量",
						overriddenLabel: "已覆盖",
						resetLabel: "重置",
						invalidLabel: "需要正整数",
						numeric: true,
						disabled: disabled,
						placeholder: "8",
						...state.searchMaxResults,
						onEdit: function (text) { props.edit("searchMaxResults", text); },
						onReset: function () { props.resetField("searchMaxResults"); }
					})
				]
			});
		}

		/* ---------------------------------------------------- controller */
		/** Credential reference the provider resolves for the API key. */
		var API_KEY_REF = "TAVILY_API_KEY";
		/** Form field the credential control stages under. */
		var API_KEY_FIELD = "apiKey";

		function credentialTransportAllowed() {
			var location = globalThis.location;
			if (location === void 0) return false;
			var protocol = String(location.protocol ?? "").toLowerCase();
			var hostname = String(location.hostname ?? "").toLowerCase();
			if (protocol === "https:") return true;
			if (protocol !== "http:") return false;
			return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "0:0:0:0:0:0:0:1";
		}

		var TavilyCardController = class {
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.credential = { ref: API_KEY_REF, configured: false, writable: true };
				this.credentialTransportAllowed = credentialTransportAllowed();
				this.apiKeyFailed = false;
				this.form = new CardForm(scope, [
					booleanField("replaceOfficialSearch"),
					numberField("searchMaxResults")
				], [{
					field: API_KEY_FIELD,
					write: (value) => this.writeKey(value)
				}]);
				this.store = this.form.bind(() => this.projection());
				scope.subscribe(() => { this.readCredential(); });
				this.readCredential();
			}
			projection() {
				return {
					...this.form.shell(),
					replaceOfficialSearch: this.form.field("replaceOfficialSearch"),
					searchMaxResults: this.form.field("searchMaxResults"),
					apiKey: this.form.field(API_KEY_FIELD),
					apiKeyConfigured: this.credential.configured,
					apiKeyWritable: this.credential.writable && this.credentialTransportAllowed,
					apiKeyTransportAllowed: this.credentialTransportAllowed,
					apiKeyFailed: this.apiKeyFailed
				};
			}
			/**
			 * Ask the credentials domain about the reference this card manages.
			 * The describe view is value-free (configured/source/writable), so
			 * the key never enters the card state; a response is published only
			 * while it still answers for the reference in force.
			 */
			async readCredential() {
				const ref = API_KEY_REF;
				if (ref !== this.credential.ref) {
					this.credential = { ref, configured: false, writable: true };
					this.store.set(this.projection());
				}
				let response;
				try {
					response = await this.api.credentials.describe({ refs: [ref] });
				} catch (_credentialReadFailure) {
					return;
				}
				if (!response.result.ok) return;
				const view = response.result.value.credentials[ref];
				const next = {
					ref,
					configured: view?.configured ?? false,
					writable: view?.writable ?? true
				};
				if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
				this.credential = next;
				this.store.set(this.projection());
			}
			/**
			 * Re-read after the Host reports a change to the reference this card
			 * watches (the key can be written from the Models page too).
			 * @param ref - the reference the Host reports as changed.
			 */
			refreshCredential(ref) {
				if (ref !== API_KEY_REF) return;
				this.readCredential();
			}
			/**
			 * Write the staged key through the credentials domain, then re-read
			 * whether the Host now holds one. The literal never rides a response
			 * and no error message carries it.
			 * @param value - the staged credential literal.
			 * @returns whether the Host reports a configured credential afterwards.
			 */
			async writeKey(value) {
				if (!this.credentialTransportAllowed) {
					this.apiKeyFailed = true;
					this.store.set(this.projection());
					return false;
				}
				let landed = false;
				try {
					const response = await this.api.credentials.set({ ref: API_KEY_REF, value });
					landed = response.result.ok;
				} catch (_credentialWriteFailure) {}
				this.apiKeyFailed = !landed;
				await this.readCredential();
				return landed && this.credential.configured;
			}
			/**
			 * Unset the stored key through the credentials domain. An unset
			 * supersedes any staged key draft, so a later save cannot rewrite it.
			 * @returns whether the Host accepted the unset.
			 */
			async unsetKey() {
				if (!this.credentialTransportAllowed) {
					this.apiKeyFailed = true;
					this.store.set(this.projection());
					return false;
				}
				let landed = false;
				try {
					const response = await this.api.credentials.unset({ ref: API_KEY_REF });
					landed = response.result.ok;
				} catch (_credentialWriteFailure) {}
				this.apiKeyFailed = !landed;
				if (landed) this.form.clearStaged(API_KEY_FIELD);
				await this.readCredential();
				return landed;
			}
			/** Build the face the card's slot registration injects. */
			inject() {
				const actions = this.form.actions();
				return {
					hooks: { tavilyCard: this.store },
					edit: (field, text) => {
						if (field === API_KEY_FIELD) this.apiKeyFailed = false;
						actions.edit(field, text);
					},
					resetField: actions.resetField,
					save: actions.save,
					discard: actions.discard,
					unsetKey: () => this.unsetKey()
				};
			}
		};

		/** Mount the card into the official Settings → Plugins page. */
		function apply(ctx) {
			var connection = ctx.get("connection");
			var controller = new TavilyCardController(ctx.settingsScope.bind({ namespace: "dsh-tavily-search-provider" }), connection.api);
			ctx.effect(function () {
				return ctx.remote.$on("credentials/updated", function (ref) { controller.refreshCredential(ref); });
			}, "dsh-tavily-search-provider: credential invalidations");
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-tavily-search-provider",
				id: "tavily-search-provider",
				order: 25,
				inject: () => controller.inject()
			}, TavilyCard));
		}

		exports.name = "dsh-tavily-search-provider";
		exports.inject = ["slots", "settingsScope", "connection", "remote"];
		exports.apply = apply;
		return module.exports;
	}
});
