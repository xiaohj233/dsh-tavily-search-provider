# dsh-tavily-search-provider（Tavily 搜索提供方）

**状态：** Feature Plugin with Compatibility Patch（特性插件 + 兼容补丁）。仅针对 DeepSeek Harness 0.1.0-rc.6 测试过。

`dsh-tavily-search-provider` 注册一个独立的 `tavily_search` 工具，并为 DSH 的官方 `web_search` 工具提供一个可选的 Tavily 后端。两条路径都完整映射了受支持的 Tavily 搜索参数面。Plugins 设置卡片中有一个由 DSH 凭据支撑的只写 `TAVILY_API_KEY` 控件。

## 问题

社区中的 Tavily 提供方通常只覆盖基本的查询与结果数量行为。本包的范围是保留其经过兼容补丁（compatibility patch）处理的 `web_search` 所期望的模型侧控件：深度、主题、时效性、域名过滤、答案包含与原始内容。

干净的 DSH rc.6 安装不会在 `dsh-tool-web` 中暴露这些字段，也不会通过 `dsh-host-apiproxy` 暴露本插件的设置命名空间，因此本包针对这两处缺口携带 guarded（守卫式）补丁。

## 行为

- `tavily_search`：始终注册，返回 Tavily 形态的结果集，并支持所有已声明的控件。
- 可选的 `web_search` provider（提供方）：将官方工具经由 Tavily 路由，同时保持官方的结果/卡片形态。
- 按调用解析凭据：对 `TAVILY_API_KEY` 的修改无需重启即可生效。
- 设置卡片：配置状态、密码输入、保存/替换、取消设置（unset）、后端切换，以及官方路径的结果上限。
- 状态路由：`/api/tavily-search-provider/status` 返回不含值的 provider/设置状态。

## 非目标

本包不是 DSH 的首个或唯一 Tavily 集成，不替换 DSH 的提供方注册表，不自行抓取页面，并且当其他后端忽略 Tavily 控件时，本包也不会让这些控件变得有意义。

## 兼容补丁

精确的目标：

- `@deepseek-ai/dsh-tool-web@0.1.0-rc.6`：声明并转发 `search_depth`、`topic`、`time_range`、`max_results`、`include_domains`、`exclude_domains`、`include_answer` 和 `include_raw_content`。
- `@deepseek-ai/dsh-host-apiproxy@0.1.0-rc.6`：仅将 `dsh-tavily-search-provider` 添加到 Web 设置命名空间的 allowlist（允许列表）。

版本策略默认是自适应（adaptive）的：当已安装副本的版本与 `0.1.0-rc.6` 不同，但每个锚点仍然唯一匹配时，仍会打补丁（记录为 adaptive 匹配）；锚点漂移时则以原因跳过；严格的编程模式可恢复旧的"仅精确版本"应用行为。单个漂移、外来或遗留目标永远不会阻塞另一个目标，补丁应用在启动期间也绝不会抛错。在所有模式下，还原都保持严格的版本守卫。apply 与 restore 都是幂等的；文件替换使用临时文件加重命名的方式。

## 兼容性

需要 DeepSeek Harness `0.1.0-rc.6`、Node.js `^22.19.0 || >=24`、pnpm `>=10` 以及一个 Tavily API 密钥。上游升级后，请运行一次 `dsh-tavily-search-provider status`，确认每个目标要么已应用、要么被有意跳过。

## 安装

```sh
dsh plugin --profile web add "github:xiaohj233/dsh-tavily-search-provider#v0.2.0"
```

重启一次，以便启动时的守卫式补丁应用能够对干净的 rc.6 目标打补丁。如果不相关/遗留的目标被拒绝，独立工具仍然可用，但在该文件被还原之前，官方 `web_search` 的控件或设置卡片可能不完整。

## API 密钥与配置

打开 Settings -> Plugins -> Tavily Search。密钥输入仅通过 `credentials.set` 为 `TAVILY_API_KEY` 写入；状态查询使用不含值的 `credentials.describe`，清除使用 `credentials.unset`。空白的密钥草稿会保留当前值。

在非 loopback（回环）的明文 HTTP 上，密钥的设置/取消设置会被禁用。请使用 `localhost`/loopback 或 HTTPS。这不会为更广泛的 DSH Web 控制面（control plane）添加认证。

卡片还控制 `replaceOfficialSearch` 与 `searchMaxResults`。如需仅检查（inspect-only）的启动方式，可以在 `dsh-tavily-search-provider` 设置部分将 `autoApplyPatches` 设为 `false`。

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

当 `$DSH_HOME` 未设置时，profile 位于主目录下（POSIX：`~/.dsh/profiles/web`；Windows PowerShell：`%USERPROFILE%\.dsh\profiles\web`）；在 Windows 上请将解析后的路径传给 `pnpm --dir`，而不是 `~`。

如果报告存在遗留或外部编辑，请重新安装官方 DSH 包，而不要强行进行模糊还原。

`dsh-keepalive` 使用不同的锚点修补同一 `dsh-host-apiproxy` 允许列表区域。当两个插件都安装时，后打补丁的那个会发现自己的锚点已被占用而拒绝执行，因此它的设置卡片在另一个插件的补丁被还原之前一直不可用。还原操作保持以标记为作用域（marker-scoped），且无论执行顺序如何都是安全的。

## 安全与隐私

Tavily API 会收到查询内容与已启用的搜索控件。`include_raw_content` 可能将明显更多的第三方页面内容返回到模型上下文中。域名过滤器是搜索约束，而不是内容安全边界。请审阅 Tavily 的数据处理方式与账户限额。

API 密钥只存在于浏览器草稿状态以及本包创建的 `credentials.set` 请求中；它不会被存储在插件设置部分、工具结果、常规日志或状态响应中。

## 测试

```sh
npm test
npm run check
npm pack --dry-run
```

测试覆盖：请求映射、结果投影、精确的补丁/还原/版本/遗留状态、包语法、凭据 RPC 负载、暂存密钥行为，以及对不安全传输的拒绝。

## 局限性与上游状态

官方的 DeepSeek 搜索提供方会忽略 Tavily 特有的控件。补丁只针对 rc.6，并且当它修改的模块已被加载时需要重启。对于更简单的提供方行为，现有的 Tavily 插件仍然是有效的替代方案；本包面向的是上文所述的完整控件映射与凭据/设置集成。

## License

MIT。补丁目标均为 MIT 许可；参见 `THIRD_PARTY_NOTICES.md`。
