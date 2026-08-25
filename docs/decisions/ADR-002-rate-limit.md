# ADR-002: 写接口限流采用 express-rate-limit 内存存储

## Status: Accepted (2026-08-30)

## Background

认证（ADR-001）解决"谁能写"，但无法防御持有合法 token 的脚本误刷、以及针对 token 的暴力猜测。写接口 `POST /api/data` 每次触发 `db.export()` 全量写盘（见 db.js `persistDb`），高频调用会放大磁盘 IO 并存在文件损坏窗口，因此需要对写操作做速率限制。

部署形态：单实例 Docker 容器，前面有 Nginx 反代（docker-compose.nginx.yml）或直连 3000 端口（docker-compose.yml / prod.yml）。

## Decision

采用 **方案 (a)：express-rate-limit `^8.6.2`，内置内存存储**，仅作用于写路由 `POST /api/data`。

依赖与版本（已做存在性核验）：
- `express-rate-limit@^8.6.2`（2026-08-04 发布的最新稳定版；peer 依赖 `express >= 4.11`，与现有 Express 4.21 兼容）
- 版本下限必须是 8.3.0 以上且推荐 8.6.2：其依赖 `ip-address` 已升级至 10.4.0，修复了影响 8.2.1 及更早版本的 CVE-2026-30827（SSRF/信任边界绕过）与 GHSA-v2v4-37r5-5v8g（XSS）。**禁止锁 8.2.x 及以下版本**

关键配置约定：
- `app.set('trust proxy', 1)`：**必须先于限流中间件设置**。Nginx 模板已传递 `X-Real-IP` / `X-Forwarded-For`，但 Express 默认不信任代理头，不设此项则 `req.ip` 恒为 Nginx 容器内网 IP，所有访客会被合并成同一个计数桶，限流形同虚设（这也会让限流把正常用户一起误伤）
- 中间件顺序：**限流在前，认证在后**（`rateLimiter -> requireAdminToken -> handler`）。这样 401 的暴力猜测请求同样被计数，兼具 token 暴力破解防护
- 默认阈值：`windowMs: 15 * 60 * 1000`，`limit: 50`（单管理员场景足够宽松，足以拦截脚本刷库）
- 响应头：`standardHeaders: 'draft-8'`，`legacyHeaders: false`
- 超限响应：`429 {"error":"Too many requests"}`，express-rate-limit 自动附带 `Retry-After`

## 候选方案对比

| 维度 | (a) express-rate-limit（内存） | (b) 基于 SQLite 的计数 | (c) Nginx 层 limit_req |
|---|---|---|---|
| 实现成本 | 极低：一个中间件，约 10 行 | 高：需自建表 + 滑动窗口 SQL + 清理任务，且每次计数都触发 sql.js 全量 export 写盘——**限流器本身成为磁盘放大器，与防护目标自相矛盾** | 中：改 nginx conf，但 docker-compose.yml/prod.yml 两种直连部署无 Nginx，形成防护盲区 |
| 多实例扩展 | 内存存储不跨进程（本项目单实例，不构成问题） | 可跨进程 | 在 Nginx 层天然集中 |
| 可测试性 | 好：每个 `createApp` 实例独立计数桶，supertest 可直接压触发 429 | 中：污染业务库 schema | 差：集成测试需起 Nginx |
| 防护位置 | 应用层，读接口与写接口可差异化配置 | 应用层 | 边缘层，但无法区分读写路径（limit_req 按 location 配置，需为 /api/data 单独 location） |

结论：方案 (a)。方案 (b) 的致命伤是 sql.js 的"每次写都全量导出"特性使限流开销倒挂；方案 (c) 在无 Nginx 的部署路径上失效且不可测试。单实例内存存储是最贴合的解。

## Consequences

**正面**：
- 写路径获得 429 防线，同时覆盖认证暴力猜测
- 应用层实现保证三种部署形态（直连/反代/prod）防护一致
- 内存计数随进程重启清零，无持久化噪声

**负面**：
- 进程重启后限流窗口清空（单实例自用场景可接受）
- 若未来扩展为多实例，需切换为 Redis 等外置 store（express-rate-limit 官方支持 store 插件，迁移路径平滑）
- `trust proxy` 设置后，Express 会采信代理头；若有人能直连 3000 端口伪造 X-Forwarded-For 可绕过按 IP 计数。缓解：3000 端口不应暴露公网（prod 部署仅 `expose`，符合现状；docker-compose.yml 本地开发场景风险可忽略）

## Related ADRs

- ADR-001（认证）：限流中间件位于认证中间件之前
