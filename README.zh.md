# dsh-tavily-search-provider

[English](README.md) | 中文

**状态：功能插件（含兼容补丁），仅在 DeepSeek Harness 0.1.0-rc.6 上测试过。**

`dsh-tavily-search-provider` 注册一个独立的 `tavily_search` 工具，并为 DSH 官方的 `web_search` 工具提供可选的 Tavily 后端：两条路径都完整覆盖了 Tavily 支持的搜索参数。Plugins 设置卡片里还有一个只写的 `TAVILY_API_KEY` 控件，凭据写入 DSH 的凭据机制。

## 问题

社区里的 Tavily provider 大多只覆盖基本的查询与结果条数行为。本包的范围是保住兼容补丁后的 `web_search` 在模型侧依赖的那些控件：深度、主题、时效、域名过滤、答案包含与原始内容。

干净的 rc.6 安装里，`dsh-tool-web` 不暴露这些字段，`dsh-host-apiproxy` 也不放行本插件的设置命名空间，因此本包针对这两处缺口各带一个守卫式补丁。

## 行为

- `tavily_search`：始终注册，返回 Tavily 形态的结果集，支持全部已声明控件。
- 可选的 `web_search` provider：把官方工具路由到 Tavily，同时保持官方的结果/卡片形态。
- 凭据按调用解析：修改 `TAVILY_API_KEY` 无需重启即可生效。
- 设置卡片：配置状态、密码输入、保存/替换、清除、后端开关，以及官方路径的结果上限。
- 状态路由：`/api/tavily-search-provider/status` 返回不含凭据值的 provider/设置状态。

## 非目标

本包不是 DSH 第一个或唯一的 Tavily 集成，不会替换 DSH 的 provider 注册表，也不自行抓取页面；当其他后端忽略 Tavily 控件时，本包也无法让这些控件生效。

## 兼容补丁

精确目标：

- `@deepseek-ai/dsh-tool-web@0.1.0-rc.6`：声明并转发 `search_depth`、`topic`、`time_range`、`max_results`、`include_domains`、`exclude_domains`、`include_answer` 和 `include_raw_content`。
- `@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6`：只把 `dsh-tavily-search-provider` 加进 Web 设置命名空间的 allowlist。

版本策略默认自适应：已安装副本的版本不是 `0.1.0-rc.6`，但只要每个锚点仍唯一匹配，就照常打补丁（记为 adaptive 匹配）；锚点漂移则跳过并说明原因。编程选项 `strict` 可恢复"只打精确版本"的旧行为。单个漂移、外来或遗留目标不会阻塞其他目标，补丁应用在启动期间也绝不会抛错。所有模式下还原都严格校验版本；apply 与 restore 均幂等，文件替换使用临时文件加 rename。

## 兼容性

需要 DeepSeek Harness `0.1.0-rc.6`、Node.js `^22.19.0 || >=24`、pnpm `>=10`，以及一个 Tavily API 密钥。上游升级后，运行一次 `dsh-tavily-search-provider status`，确认每个目标要么已应用、要么是有意跳过。

## 安装

```sh
dsh plugin --profile web add "github:xiaohj233/dsh-tavily-search-provider#v0.2.0"
```

重启一次，让启动时的守卫式补丁应用到干净的 rc.6 目标上。即使某个无关或遗留目标被拒绝，独立工具依然可用；但在该文件被还原之前，官方 `web_search` 的控件或设置卡片可能不完整。

## API 密钥与配置

打开 Settings -> Plugins -> Tavily Search。密钥输入框只通过 `credentials.set` 写入 `TAVILY_API_KEY`；状态查询用不带值的 `credentials.describe`，清除用 `credentials.unset`。密钥草稿留空会保留当前值。

在非回环地址的明文 HTTP 上，密钥的设置与清除会被禁用。请使用 `localhost`/loopback 或 HTTPS。这并不会给 DSH Web 控制面整体加上认证。

卡片还控制 `replaceOfficialSearch` 与 `searchMaxResults`。把 `dsh-tavily-search-provider` 设置区里的 `autoApplyPatches` 设为 `false`，即可让启动时只检查、不应用补丁。

## 补丁状态、应用与还原

在 profile 中运行已安装的 CLI：

```sh
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider status
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider apply
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider restore
```

卸载前先还原：

```sh
pnpm --dir "$DSH_HOME/profiles/web" exec dsh-tavily-search-provider restore
dsh plugin --profile web remove dsh-tavily-search-provider
```

未设置 `$DSH_HOME` 时，profile 位于用户主目录下（POSIX 为 `~/.dsh/profiles/web`，Windows PowerShell 为 `%USERPROFILE%\.dsh\profiles\web`）；Windows 上请把解析后的路径传给 `pnpm --dir`，不要用 `~`。

如果提示存在遗留或外来改动，请重新安装官方 DSH 包，而不要强行做模糊还原。

`dsh-keepalive` 会把它的 allowlist 行插到同一数组的顶部，因此两个补丁不再共享锚点：两个插件可以按任意顺序安装，各自的还原都会保留对方的行。

## 安全与隐私

Tavily API 会收到查询内容与已启用的搜索控件。开启 `include_raw_content` 后，可能把大量第三方页面内容带进模型上下文。域名过滤只是搜索约束，不是内容安全边界。请自行了解 Tavily 的数据处理方式与账户限额。

API 密钥只存在于浏览器草稿状态和本包创建的 `credentials.set` 请求中；它不会被写进插件设置区、工具结果、常规日志或状态响应。

## 网络韧性（DNS 污染 / fake-IP）

在 Clash/mihomo 这类以 fake-IP 模式接管 DNS 的机器上，系统解析器可能把 `api.tavily.com` 间歇性解析到 `198.18.x.x` 假地址（或上游投毒结果），导致裸 `fetch` 连接黑洞、请求超时——而真实 IP 本身始终可达。

本包 v0.3.5 起对 Tavily 全部端点（search/extract/map/crawl/deep-research）使用自带的韧性网络层：

1. 优先通过明文 HTTPS DoH（AliDNS、DNSPod、Google）解析真实 A 记录，过滤掉 fake-IP/私网/保留地址；
2. DoH 不可达时按 IP 字面量（8.8.8.8 / 223.5.5.5）直查，完全绕开系统 DNS；
3. 仍失败才回退系统解析器；全部失败时回退普通 `fetch`（行为与旧版一致）。

请求把 TCP 连接钉在验证过的真实 IP 上，同时保留 TLS SNI 与 Host 头，因此 DNS 被污染时搜索依然可用。解析结果缓存 5 分钟（失败 30 秒退避，过期后 1 小时内保留为兜底）。若连 DoH 都不可用（整网断连），网络错误消息会附带 fake-IP 排查提示。

## 测试

```sh
npm test
npm run check
npm pack --dry-run
```

测试覆盖：请求映射、结果投影、补丁/还原/版本/遗留状态的精确匹配、包语法、凭据 RPC 载荷、暂存密钥行为，以及对不安全传输的拒绝。

## 局限性与上游现状

官方的 DeepSeek 搜索 provider 会忽略 Tavily 特有的控件。补丁只针对 rc.6，且修改已加载的模块时需要重启。如果只需要更简单的 provider 行为，现有 Tavily 插件依然是合格的替代方案；本包面向的是上文所述的完整控件映射与凭据/设置集成。

## License

MIT。补丁目标均为 MIT 许可，详见 `THIRD_PARTY_NOTICES.md`。
