# 安全加固技术规格（Phase 1 选型产出）

> 本规格为前后端实现契约，依据 `docs/decisions/ADR-001~003`。规格未写明的实现细节以 ADR 为准；实现中若发现规格与现实冲突，先改本规格再改代码。

## 1. 范围

**做**：写操作认证、写接口限流、SQLite 定时备份。

**不做（out-of-scope）**：
- 不改读接口（`GET /api/data`、`GET /health`、静态资源、`GET /`）的匿名开放行为
- 不引入用户体系、角色、注册/登录端点
- 不重做输入校验（`validatePayload`/`sanitizeString`/`isValidUrl` 已存在，保持原样）
- 不更换 sql.js / Express / 部署形态
- 不做异地备份推送
- 不改 UI 图标、配色、文案风格

## 2. 版本锚定

| 项 | 版本 | 说明 |
|---|---|---|
| Node.js | >= 18（Docker 镜像 node:20-slim） | 现状不变 |
| express | ^4.21.0 | 现状不变 |
| express-rate-limit | **^8.6.2** | 唯一新增依赖；不得使用 <=8.2.x（CVE-2026-30827） |
| 其余 | 现状 | helmet ^8、sql.js ^1.12 不动 |

## 3. 认证规格（ADR-001）

### 环境变量
| 变量 | 必填 | 约束 | 默认 |
|---|---|---|---|
| `ADMIN_TOKEN` | 是 | 长度 >= 16；未设置或过短时进程启动即报错退出（fail closed） | 无 |

### API 变更
`POST /api/data` 请求必须携带 `x-admin-token` 请求头：
- 缺失或错误：`401`，响应体 `{"error":"Unauthorized"}`
- 正确：行为与现状完全一致（校验、写库、返回清洗后数据）
- 读接口无任何变化

### 新增/修改文件
| 文件 | 动作 | 内容 |
|---|---|---|
| `auth.js` | 新增 | 导出 `createAdminAuthMiddleware(adminToken)`：SHA-256 摘要 + `crypto.timingSafeEqual` 常数时间比较；启动时对 token 预摘要把 digests 常量化 |
| `server.js` | 修改 | `createApp(store, options)` 增加第二参数 `{ adminToken }`；未传时读 `process.env.ADMIN_TOKEN`；在 `POST /api/data` 上挂认证中间件（限流之后） |
| `docker-compose.yml` / `docker-compose.prod.yml` / `docker-compose.nginx.yml` | 修改 | environment 增加 `ADMIN_TOKEN=${ADMIN_TOKEN}` |
| `.env.example` | 新增 | 声明 ADMIN_TOKEN 及下述全部新变量 |
| `pages/js/*`（保存流程） | 修改 | 保存请求附加 `x-admin-token`；token 首次保存时 prompt 输入并存 localStorage；收到 401 时清除缓存并重新 prompt |

### 数据库 schema 变更
无。

## 4. 限流规格（ADR-002）

### 环境变量
| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `WRITE_RATE_LIMIT_MAX` | 否 | `50` | 单 IP 每 15 分钟窗口允许的写请求次数 |

窗口 `windowMs` 固定 15 分钟，不做环境变量（避免配置面膨胀）。

### API 变更
`POST /api/data` 超限时返回 `429`，响应体 `{"error":"Too many requests"}`，附带 `RateLimit` / `Retry-After` 标准头（`standardHeaders: 'draft-8'`）。

### 新增/修改文件
| 文件 | 动作 | 内容 |
|---|---|---|
| `server.js` | 修改 | ① `app.set('trust proxy', 1)`（**必须在限流中间件之前**）② 构建 `rateLimit` 实例并挂到 `POST /api/data`，顺序：限流 -> 认证 -> handler |
| `package.json` | 修改 | dependencies 增加 `express-rate-limit: ^8.6.2` |

### 已知坑（硬约束）
1. `trust proxy` 不设置 = 按 Nginx 容器内网 IP 计数 = 全站共享一个桶，限流反向误伤正常用户
2. 限流必须挂在认证**之前**，否则 401 暴力猜测不计数
3. 每个 `createApp` 实例的内存计数相互独立——测试用例间需新建 app 实例隔离计数

### 数据库 schema 变更
无。

## 5. 备份规格（ADR-003）

### 环境变量
| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `BACKUP_INTERVAL_HOURS` | 否 | `6` | 备份间隔（小时） |
| `BACKUP_KEEP` | 否 | `7` | 轮转保留份数 |

### 新增/修改文件
| 文件 | 动作 | 内容 |
|---|---|---|
| `db.js` | 修改 | ① `persistDb` 改为原子写：写 `<dbPath>.tmp` 后 `fs.renameSync` ② `DataStore` 新增 `async backup(backupDir)`：`db.export()` -> 原子写入 `backup-YYYYMMDD-HHmmss.db` -> 轮转删除超额旧备份 |
| `backup.js` | 新增 | 导出 `startBackupScheduler(store, options)`：`setInterval` 定时调 `store.backup()`；返回 `{ stop() }`；定时器 `.unref()` |
| `server.js` | 修改 | 仅在 `require.main === module` 分支启动调度器；SIGTERM/SIGINT 优雅停机时调用 `stop()` |
| `.gitignore` / `.dockerignore` | 确认 | `data/` 已整体忽略，`data/backups/` 随之覆盖，无需新增条目（实现时验证） |
| `README.md` | 修改 | 补充：新环境变量表、POST 需带 token 的说明、备份目录位置与恢复步骤（`cp data/backups/backup-xxx.db data/data.db` 且容器停止时操作） |

### API 变更
无（备份纯后台行为）。

### 数据库 schema 变更
无。备份文件为 `db.export()` 的逐字节副本，可直接作为 `data.db` 恢复。

### 已知坑（硬约束）
1. 备份必须走 `db.export()`（内存一致性快照），**禁止** `fs.copyFileSync(data.db)`（可能撞上写盘窗口拷到半个文件）
2. tmp 文件与目标文件必须在同一目录（同一文件系统），`rename` 才有原子性
3. 备份文件名时间戳必须补零（`YYYYMMDD-HHmmss`），否则字典序轮转会错乱

## 6. 测试点清单（QA/后端实现时必须覆盖）

认证：
- [ ] POST 无 token -> 401
- [ ] POST 错误 token -> 401，且响应体不区分缺失/错误
- [ ] POST 正确 token -> 200 且数据持久化
- [ ] GET /api/data、GET /health 无 token -> 200（读路径零回归）
- [ ] ADMIN_TOKEN 未设置时 `node server.js` 启动失败退出（非零退出码）
- [ ] token 长度 < 16 时启动失败退出

限流：
- [ ] 以 `WRITE_RATE_LIMIT_MAX=3` 构建 app，第 4 次 POST（无论 token 对错）-> 429 且带 `Retry-After` 头
- [ ] 429 只影响写接口，同 app 实例 GET 仍 200
- [ ] 现有全部测试在注入测试 token 后通过（无行为回归）

备份：
- [ ] 写入数据后调 `store.backup(dir)`：目标目录出现 `backup-*.db`，且新 DataStore 实例能以该文件为 dbPath 读出相同数据（**备份可用性的唯一可信证明**）
- [ ] 连续备份超过 BACKUP_KEEP 份后，旧文件被删除，目录内恰好保留 N 份最新的
- [ ] `persistDb` 原子写：写库后 `data.db` 无 `.tmp` 残留
- [ ] 调度器 `stop()` 后 interval 清除（用 fake timers 或注入短间隔验证）

## 7. 端到端验证步骤（Phase 2 验收时执行）

```bash
# 1. 安装依赖并跑全部测试
npm install && npm test

# 2. 启动（验证 fail closed）
node server.js                     # 预期：报错退出
ADMIN_TOKEN=shorttoken node server.js  # 预期：报错退出
ADMIN_TOKEN=this-is-a-16char-token npm start &
# 3. 读路径匿名可用
curl -s http://localhost:3000/api/data | head -c 100
# 4. 写路径认证生效
curl -s -X POST http://localhost:3000/api/data -H 'content-type: application/json' -d '{}'            # 401
curl -s -X POST http://localhost:3000/api/data -H 'content-type: application/json' -H 'x-admin-token: wrong-token-16chars!' -d '{}'  # 401
curl -s -X POST http://localhost:3000/api/data -H 'content-type: application/json' -H 'x-admin-token: this-is-a-16char-token' -d '{"categoryOrder":["国家机关"]}'  # 200
# 5. 限流触发（默认 50 次，脚本压满）
for i in $(seq 1 55); do curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:3000/api/data -H 'content-type: application/json' -H 'x-admin-token: this-is-a-16char-token' -d '{}'; done
# 预期：尾部出现 429
# 6. 备份产物核验
ls data/backups/   # 预期：backup-*.db 存在
# 7. 清理
kill %1
```
