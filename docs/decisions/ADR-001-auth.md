## Update (2026-09-16): 口令改为「登录一次」，写操作凭会话 Cookie

### 背景

原方案下前端每次写入都要带上 `x-admin-token`，首次写入会弹口令输入框、收到 401 还会再弹一次。但实际使用中最频繁的写入是「拖拽网址修改分类」这类轻量操作，每次都被口令打断体验很差。诉求：口令只在登录时校验一次，登录后不再校验。

### 决策

保留 `x-admin-token` 作为脚本 / CI 的兼容入口，浏览器端改为**一次性登录 + 会话 Cookie**：

1. 新增 `POST /api/login`：校验口令（仍用 SHA-256 摘要 + `timingSafeEqual`），成功则下发 `nav_session` Cookie
2. Cookie 内容为 `过期时间戳.HMAC-SHA256 签名`，密钥由 `ADMIN_TOKEN` 派生（可用 `SESSION_SECRET` 覆盖），因此**无需会话表、无需新增依赖**，重启后已有会话依然有效
3. Cookie 属性：`HttpOnly`（JS 读不到）、`SameSite=Strict`（跨站请求不携带，天然免疫 CSRF）、`Path=/`、`Max-Age` 12 小时，HTTPS 下追加 `Secure`
4. 写接口认证顺序：**有效会话 Cookie 优先 → 否则回落 `x-admin-token`**，两条路径的 401 语义完全一致
5. `POST /api/logout` 清除 Cookie；`GET /api/session` 供前端查询登录态
6. 前端移除 localStorage 中的口令缓存（模块加载时清理历史 key），会话过期时由 `nav:unauthorized` 事件统一弹出登录弹窗

### 影响

**正面**：
- 登录一次后可连续修改分类 / 增删链接 / 排序 / 导入，不再被口令打断
- 口令不再落盘（原先明文存 localStorage 的风险消除），改为浏览器托管 HttpOnly Cookie
- 脚本与 CI 的 `x-admin-token` 调用方式零改动

**负面**：
- 会话有效期内持有浏览器即等同持有写权限；单管理员自用场景可接受，`Max-Age` 到期或主动退出即失效
- 多一台设备登录需各自登录一次（不再共享口令明文）

---

# ADR-001（原始版本）: 写操作认证采用环境变量口令 + `x-admin-token` 自定义 Header

## Status: Accepted (2026-08-30)，2026-09-16 由上述更新部分取代

## Background

`POST /api/data` 当前完全无认证，任何能访问服务的匿名者都可覆盖全部导航数据（`store.write` 是全量替换语义，破坏力等同删库）。本轮安全加固要求：写操作必须认证，读操作（`GET /api/data`、`GET /health`、静态资源）保持匿名开放。

项目背景约束：
- 前端为原生 JS（ES Modules）+ 无构建工具，任何认证方案都不能引入构建链改动
- 单管理员（个人/小团队自用），无多用户、无角色区分需求
- 技术栈已锁定 Express 4.21，不可推翻

## Decision

采用 **方案 (a)：环境变量口令 + 自定义 Header `x-admin-token`**，配合 Node.js 内置 `crypto.timingSafeEqual` 做常数时间比较。不新增任何第三方依赖。

口令校验实现要点（防时序攻击的标准做法）：
1. 启动时对 `ADMIN_TOKEN` 做 SHA-256 摘要，得到固定长度 Buffer
2. 每次请求对请求头值同样做 SHA-256，再 `timingSafeEqual` 比较两个等长摘要
3. 直接比较原文会有长度短路泄漏，摘要后比较可规避

失败语义（fail closed）：
- 未配置 `ADMIN_TOKEN`：进程启动时打印明确错误并 `process.exit(1)`，宁可拒绝启动也不裸奔写接口
- 缺失/错误 token：统一返回 `401 {"error":"Unauthorized"}`，不区分"缺失"与"错误"，不给攻击者探针信息
- 不设置 `WWW-Authenticate` 头（不触发浏览器原生弹窗，避免与自定义前端交互冲突）

## 候选方案对比

| 维度 | (a) 环境变量口令 + x-admin-token | (b) HTTP Basic Auth | (c) JWT（15min access + 7d refresh） |
|---|---|---|---|
| 与原生 JS 前端适配度 | 好：fetch 加一个 header，token 可 prompt 一次存 localStorage | 差：`fetch()` 不会触发浏览器原生弹窗，仍需前端手工处理 401 与凭据注入，所谓"零前端改动"对 XHR 场景是伪命题 | 差：需要登录页、token 刷新逻辑、过期重试，前端改动最大 |
| 新增依赖 | 无（Node 内置 crypto） | 无 | 需引入 jsonwebtoken 类库 + 密钥管理 |
| 侵入性 | 一个 ~30 行的 Express 中间件 | 同量级中间件，但 Basic 凭据会随每个请求明文（Base64）往返，且浏览器会主动缓存弹出窗凭据，登出困难 | 需要新增 /api/v1/auth/login、refresh 端点、token 存储与刷新，改动面大 |
| 安全性 | 高：HTTPS 下等价于 Bearer token；单管理员场景无会话劫持面 | 中：HTTPS 下也可用，但凭据每请求携带、无过期概念、登出体验差 | 高，但对单管理员是过度设计 |
| 适用规模 | 单管理员/小团队 | 单管理员 | 多用户/多角色 |

结论：方案 (a) 在"原生 JS + 无构建 + 单管理员"约束下侵入性最小、安全性充分。JWT 为本场景典型的过度设计，否决。

## Consequences

**正面**：
- 零新增依赖，零构建链改动
- 认证边界清晰：中间件只挂在写路由上，读路径完全不受影响
- fail closed 语义消除"忘了配 token 就裸奔上线"的运营风险

**负面**：
- 前端保存流程需要小幅改动：首次保存时提示输入管理口令，存 localStorage，请求附带 `x-admin-token`；收到 401 时重新提示
- token 无过期机制，轮换需手动改环境变量并重启容器（单管理员场景可接受）
- 若管理员在公共设备上使用，localStorage 中的 token 有被读取的风险（自用场景风险可控）

## Related ADRs

- ADR-002（写接口限流）：认证中间件与限流中间件的执行顺序在该 ADR 中约定
