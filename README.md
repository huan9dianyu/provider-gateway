# Provider Gateway

Provider Gateway 是一个独立的本地网关，用来转发 Codex 的 Responses API
请求。Codex 只需要配置一个本地 base URL，后面的多个 provider 地址和 key
由这个服务统一管理。

```text
Codex -> http://127.0.0.1:8787/v1 -> Provider Gateway -> 上游 provider
```

当前只支持 Codex 的一个接口：

```text
POST /v1/responses
```

这个服务刻意保持简单，转发链路尽量纯粹。它不解析、不改写 Responses API
的请求 body 和响应 body，只做网关必须做的事情：修改目标地址、替换 provider
鉴权、清理 hop-by-hop HTTP 头。

## 快速启动

前台启动：

```bash
npm start
```

后台启动：

```bash
npm run start:daemon
```

停止后台进程：

```bash
npm run stop
```

打开本地管理页面：

```text
http://127.0.0.1:8787/admin
```

Codex 中配置这个 base URL：

```text
http://127.0.0.1:8787/v1
```

## 核心功能

- 给 Codex 提供一个固定的本地入口，后面可以接多个上游 provider。
- provider 配置支持 `name`、`baseUrl`、`apiKey`、`enabled`、`priority` 和备注。
- 通过 `activeProvider` 指定主 provider。
- 可以在本地管理页面手动切换主 provider。
- 当前 provider 失败时，运行态自动切到备用 provider。
- 切到备用 provider 后，会启动 10 分钟冷却计时；计时结束后重新尝试主
  provider。
- macOS 下后台进程会在故障切换和冷却恢复时发送系统通知。
- 配置可以通过管理页面或 `/api/config` 热更新。
- provider 的流式响应会直接 pipe 回 Codex，不会在网关里完整缓存响应 body。

## 配置文件

第一次启动时，服务会自动复制：

```text
config/providers.example.json -> config/providers.local.json
```

`config/providers.local.json` 保存本地 provider API key，应只保留在本机。
这个文件已被 git 忽略。

示例配置：

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8787
  },
  "activeProvider": "primary",
  "requestTimeoutMs": 120000,
  "failoverStatusCodes": [429, 500, 502, 503, 504],
  "providers": [
    {
      "name": "primary",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "replace-with-api-key",
      "enabled": true,
      "priority": 1,
      "notes": "主 provider"
    },
    {
      "name": "backup",
      "baseUrl": "https://provider.example/v1",
      "apiKey": "replace-with-backup-key",
      "enabled": true,
      "priority": 2,
      "notes": "备用 provider"
    }
  ]
}
```

重要字段说明：

- `server.host`：本地监听地址，默认 `127.0.0.1`。
- `server.port`：本地监听端口，默认 `8787`。
- `activeProvider`：配置层面的主 provider 名称。
- `requestTimeoutMs`：请求上游 provider 的超时时间。
- `failoverStatusCodes`：命中这些 HTTP 状态码时，运行态会切到下一个 provider。
- `providers[].priority`：优先级，数字越小越靠前。
- `providers[].enabled`：是否启用，禁用的 provider 不参与转发和切换。

上游 `baseUrl` 遵循 Codex provider 的配置语义。本地 `/v1/responses` 会被转发到
`<baseUrl>/responses`。

示例：

```text
https://api.openai.com/v1       -> https://api.openai.com/v1/responses
https://new.sharedchat.cc/codex -> https://new.sharedchat.cc/codex/responses
```

## 请求转发流程

对于 `POST /v1/responses`：

1. Codex 把 Responses API 请求发到本地网关。
2. `server.js` 先把 Node.js 的请求 body 读成 `Buffer`。
3. 运行态选择本次要使用的 provider：
   - 正常情况下使用配置里的 `activeProvider`；
   - 如果当前处于故障切换状态，则使用临时固定的备用 provider。
4. `router.js` 根据 provider 的 `baseUrl` 构造上游 URL，把 `/v1/responses`
   映射成 `<provider.baseUrl>/responses`。
5. 网关把请求发给上游 provider，转发内容包括：
   - 原始请求 body 字节；
   - 原始请求中的非 hop-by-hop header；
   - 替换后的 `Authorization: Bearer <provider.apiKey>`。
6. provider 返回后，网关把响应状态码和响应 body 流式返回给 Codex。
7. 网关记录本次 provider 尝试结果，供 `/api/status` 查看。
8. 如果本次请求命中故障切换规则，只影响下一次请求；当前这次响应仍原样返回给
   Codex。

网关不会在同一次 Codex 请求里自动重试另一个 provider。这样可以保持转发路径可
预测：Codex 收到当前 provider 的真实响应或错误；如果 Codex 再重试，下一次请求
才会走已经切换好的 provider。

## Header 处理

请求 header 大部分会转发，但下面这些 hop-by-hop header 会被移除：

```text
connection
keep-alive
proxy-authenticate
proxy-authorization
te
trailer
transfer-encoding
upgrade
host
content-length
```

原因：

- `host` 必须变成上游 provider 的 host，不能继续使用 `127.0.0.1:8787`。
- `authorization` 必须替换成当前 provider 的 API key。
- `content-length` 应由 `fetch()` 根据实际转发 body 重新计算。
- 连接控制类 header 只对 Codex 到本地网关这一跳有效，不应该传给上游。

响应 header 大部分也会回传，但会移除：

```text
content-encoding
content-length
```

因为响应 body 是通过网关流式转发的，上游原始的长度或压缩标记不一定还能安全复用。

## 故障切换流程

自动故障切换只保存在运行态里，不会改写 `config/providers.local.json`，也不会
改变配置层面的主 provider。

出现下面情况时，网关会把运行态推进到下一个启用的 provider：

- 网络错误；
- 请求超时；
- HTTP 状态码命中 `failoverStatusCodes`，例如 429 或 5xx。

切换顺序：

1. 请求先发给当前运行态 provider。
2. 如果 provider 失败，当前这次 Codex 请求会收到这个 provider 的原始失败响应。
3. 网关把运行态固定到下一个启用的 provider，顺序由 `priority` 决定。
4. Codex 下一次重试时，会使用新的备用 provider。
5. 如果备用 provider 成功，运行态会继续固定在这个备用 provider。
6. 固定到备用 provider 后，会启动 10 分钟计时器。
7. 计时结束后，运行态固定会被清除；下一次请求重新从主 provider 开始尝试。

如果手动切换了配置层面的主 provider，运行态故障切换状态会立即重置。

运行态可以通过这个接口查看：

```text
GET /api/status
```

## macOS 系统通知

服务入口 `src/index.js` 会启用 macOS 系统通知。通知由后台 Node 进程触发，不依赖
浏览器或管理页面是否打开。

触发场景：

- `failover`：请求失败后，运行态切到备用 provider。
  - 示例文案：`primary -> backup，状态码 500`
  - 通知副标题：`Provider 故障切换`
- `recovered`：备用 provider 的 10 分钟冷却计时结束，运行态自动恢复主 provider。
  - 示例文案：`backup -> primary`
  - 通知副标题：`Provider 已恢复主路由`

手动执行 `POST /api/active-provider` 或在管理页面“立即切换”主 provider 只会重置
运行态，不会发送系统通知。

实现上使用 macOS 自带的 `/usr/bin/osascript`：

```text
osascript -e 'display notification ...'
```

调用时通过 Node.js `execFile()` 传参，不经过 shell。非 macOS 环境会自动跳过通知。
第一次收到通知时，macOS 可能会要求允许该进程发送通知。

## 请求目录诊断日志

如果需要判断 Codex 请求里是否携带了当前项目目录，可以临时打开请求诊断日志：

```bash
PROVIDER_GATEWAY_INSPECT_REQUESTS=1 npm run restart
```

开启后，每个 `POST /v1/responses` 会额外写一条 `responses.request_inspect` 日志到
`logs/provider-gateway.log`。这条日志用于排查路由依据，包含：

- 经过脱敏的请求 header；
- JSON body 的顶层字段名，例如 `model`、`input`；
- 从请求 body 字符串中抽取到的疑似绝对路径，例如 `/Users/...`。

不会记录完整 prompt/body，也不会记录 `Authorization`、`Cookie`、token、secret、API
key 等敏感 header 值。为了确认 Codex 传入的工作区信息，诊断日志会完整保留
`x-codex-turn-metadata` header。

查看方式：

```bash
tail -f logs/provider-gateway.log | grep responses.request_inspect
```

如果日志里能看到稳定的目录信号，后续可以基于这个字段做“按项目目录选择 provider”。
如果没有目录信号，则需要让 Codex 客户端显式传一个自定义 header，或在不同项目里
配置不同的本地 gateway 地址。

## 管理页面和本地 API

管理页面：

```text
GET /
GET /admin
```

配置 API：

```text
GET /api/config
PUT /api/config
POST /api/active-provider
GET /api/status
```

转发 API：

```text
POST /v1/responses
```

注意：

- `GET /api/config` 会返回本地可编辑配置，包括 provider key。除非明确需要对外暴露，
  否则服务应只绑定在 localhost。
- `PUT /api/config` 会校验、持久化并热应用完整配置。
- `POST /api/active-provider` 会修改配置层面的主 provider，并重置运行态故障切换状态。

## 文件结构

```text
provider-gateway/
  src/
    index.js             服务入口
    server.js            HTTP server、管理 API、响应流转发
    router.js            provider URL 映射和上游 fetch
    provider-state.js    运行态 fallback 固定和重试计时器
    macos-notifier.js    macOS 系统通知
    config.js            配置读取、校验、持久化
    process-control.js   daemon 模式 pid 文件辅助逻辑
  public/
    admin.html           本地管理页面
  scripts/
    start-daemon.mjs     后台启动脚本
    stop.mjs             后台停止脚本
  config/
    providers.example.json
    providers.local.json 本地 provider 配置，包含 key
  test/
    *.test.js            Node.js 测试用例
```

## 实现注意点

- `server.js` 会先把 `/v1/responses` 的请求 body 读成 `Buffer`，再传给
  `fetch()`。不要把 Node.js `IncomingMessage` 直接作为上游 `fetch()` 的 body；
  这种写法在 undici 下可能卡住，也和真实生产请求路径不一致。
- `sendWebResponse()` 会先写 provider 返回的状态码和 header，再把 provider 的响应流
  pipe 回 Codex。
- server 的 `catch` 块会先检查 `response.headersSent`，再决定是否返回 JSON 错误。
  这样可以避免响应头已经写出后再次写头导致 `ERR_HTTP_HEADERS_SENT`。
- 网关不会解析请求 body 里的 `stream: true`。provider 健康状态只根据网络错误、超时
  和配置的 HTTP 状态码判断。

## 测试

运行全部测试：

```bash
npm test
```

测试覆盖：

- 配置校验和持久化；
- provider 排序和运行态 fallback；
- 本地 `/v1/responses` 到 provider `/responses` 的 URL 映射；
- 每次请求只转发到一个 provider；
- 请求 body 以 `Buffer` 形式转发；
- 流式响应透传；
- provider 失败后推进运行态 provider。
