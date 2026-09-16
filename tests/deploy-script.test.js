const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.join(__dirname, "..");
const DEPLOY_SCRIPT = path.join(PROJECT_ROOT, "scripts", "deploy.sh");

// deploy.sh 是对「服务器端本地构建」这条唯一上线路径的实现，
// 一旦分支逻辑写错（选错 compose、误判无 token、健康检查失效），
// 生产就会静默停留在旧版本。这里用假 docker 把它整体跑起来回归。
//
// 不使用真实 docker：测试必须离线、可在 CI 与本地一致复现。
function createSandbox({ nginx = false, healthOk = true, withToken = true, withDb = true } = {}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "nav-deploy-"));
  const binDir = path.join(sandbox, "bin");
  const appDir = path.join(sandbox, "authority-navigation");
  const logFile = path.join(sandbox, "docker.log");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, "data"), { recursive: true });

  // 假 docker：按参数决定关键分支的返回值，并把每次调用记入日志
  fs.writeFileSync(
    path.join(binDir, "docker"),
    `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then exit 1; fi
if [ "$1" = "ps" ]; then ${nginx ? 'echo "authority-navigation-nginx"' : ":"}; exit 0; fi
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then exit 1; fi
if [ "$1" = "exec" ]; then exit ${healthOk ? 0 : 1}; fi
exit 0
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(binDir, "docker-compose"),
    `#!/usr/bin/env bash
echo "docker-compose $*" >> "$FAKE_LOG"
exit 0
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(appDir, ".env"),
    withToken ? "ADMIN_TOKEN=test-token-1234567890\n" : "WRITE_RATE_LIMIT_MAX=50\n"
  );
  if (withDb) fs.writeFileSync(path.join(appDir, "data", "data.db"), "fake-db");

  fs.copyFileSync(DEPLOY_SCRIPT, path.join(appDir, "deploy.sh"));
  for (const f of ["docker-compose.yml", "docker-compose.prod.yml", "docker-compose.nginx.yml"]) {
    fs.copyFileSync(path.join(PROJECT_ROOT, f), path.join(appDir, f));
  }

  return { sandbox, binDir, appDir, logFile };
}

function runDeploy(box, extraEnv = {}) {
  const result = spawnSync("bash", [path.join(box.appDir, "deploy.sh")], {
    cwd: box.appDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: box.sandbox,
      PATH: `${box.binDir}:${process.env.PATH}`,
      FAKE_LOG: box.logFile,
      APP_DIR: box.appDir,
      HEALTH_RETRIES: "1",
      HEALTH_INTERVAL: "0",
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
    log: fs.existsSync(box.logFile) ? fs.readFileSync(box.logFile, "utf-8") : "",
  };
}

function deploySnapshotFiles(box) {
  const dir = path.join(box.appDir, "data", "backups", "deploy");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".db"));
}

describe("scripts/deploy.sh", () => {
  let boxes = [];

  function make(options) {
    const box = createSandbox(options);
    // 每次运行前清空调用日志，便于断言「本次做了什么」
    fs.writeFileSync(box.logFile, "");
    boxes.push(box);
    return box;
  }

  afterEach(() => {
    for (const box of boxes) {
      fs.rmSync(box.sandbox, { recursive: true, force: true });
    }
    boxes = [];
  });

  it("builds locally and starts the stack with prod compose", () => {
    const box = make();
    const res = runDeploy(box);

    expect(res.status).toBe(0);
    expect(res.log).toContain("docker-compose -f docker-compose.prod.yml up -d --build --remove-orphans");
    expect(res.log).toContain("docker image prune -f");
    expect(res.output).toContain("Health check OK");
  });

  // 曾经的 CD 依赖 `docker pull ghcr.io/...`，必须确认已彻底不再拉取远程镜像
  it("never pulls a remote image", () => {
    const box = make();
    const res = runDeploy(box);

    expect(res.status).toBe(0);
    expect(res.log).not.toContain("docker pull");
    expect(res.log).not.toContain("ghcr.io");
  });

  it("switches to the nginx compose file when the nginx container is running", () => {
    const box = make({ nginx: true });
    const res = runDeploy(box);

    expect(res.status).toBe(0);
    expect(res.log).toContain("docker-compose -f docker-compose.nginx.yml");
  });

  it("snapshots the database before deploying and keeps the newest 5", () => {
    const box = make();

    for (let i = 0; i < 8; i++) runDeploy(box);

    const files = deploySnapshotFiles(box);
    expect(files.length).toBe(5);
  });

  // 缺 ADMIN_TOKEN 时容器会 fail closed 退出，若照常替换容器会造成服务中断
  it("aborts before touching the container when ADMIN_TOKEN is missing", () => {
    const box = make({ withToken: false });
    const res = runDeploy(box);

    expect(res.status).not.toBe(0);
    expect(res.log).not.toContain("up -d");
    expect(res.output).toContain("ADMIN_TOKEN");
  });

  it("fails when neither docker compose nor docker-compose is available", () => {
    const box = make();
    fs.rmSync(path.join(box.binDir, "docker-compose"));
    // 假 docker 对 `compose version` 返回失败，因此两条路径都不可用
    const res = runDeploy(box, { PATH: `${box.binDir}:/usr/bin:/bin` });

    expect(res.status).not.toBe(0);
    expect(res.output).toContain("compose");
  });

  it("exits non-zero and dumps container logs when the health check fails", () => {
    const box = make({ healthOk: false });
    const res = runDeploy(box);

    expect(res.status).not.toBe(0);
    expect(res.output).toContain("健康检查失败");
    expect(res.log).toContain("docker logs --tail 50 authority-navigation");
  });

  it("does not snapshot when there is no database yet", () => {
    const box = make({ withDb: false });
    const res = runDeploy(box);

    expect(res.status).toBe(0);
    expect(deploySnapshotFiles(box)).toHaveLength(0);
  });
});
