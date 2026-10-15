# audit-server 稳定性改进手册

> 只回答"做什么"。为什么（LB/探针/readiness/优雅关闭的完整推导）见同目录《服务器稳定性》笔记。

## 家底：已有的防线

| 防线 | 位置 | 状态 |
|---|---|---|
| BullMQ 重试+退避 | `task-workers.module.ts` | ✅ 写路径自愈 |
| Worker 限速 | `auto-audit.worker.ts` `max: 60/s` | ✅ 有闸门（静态） |
| 出站限流 | `utils/rate-limit.ts` `RateLimitLock` | ✅ 仅 observable API |
| 优雅关闭 | `main.ts` SIGTERM → `app.close()` | ⚠️ 半成品，待改进点 2 配合 |
| 异常兜底 / 结构化日志 / Redis 断连日志 | `main.ts` / `utils/logger.ts` / `utils/redis.ts` | ✅ |

**结论：写路径防御完善；读路径与出站调用裸奔。**

## 改进清单

| # | 改什么 | 位置 | 成本 | 危险一句话 |
|---|---|---|---|---|
| 1 | axios 补 `timeout: 10_000` | order / main-data / sso / perm 四个 service | **10 分钟** | 唯一级联入口：下游挂起 → 事件循环挂满 → 全站挂 |
| 2 | `/health` 端点 + deploy.sh 轮询 | `app.controller.ts` + `deploy.sh` | 半天 | 发布必出 502/500 窗口；假死不可见；优雅关闭被 SIGKILL 腰斩 |
| 3 | 死信告警 | 各 worker `failed` 事件 | 一天 | 重试耗尽的任务静默丢失，第二天有人来问数据 |
| 4 | RateLimitLock 自适应（AIMD） | `utils/rate-limit.ts` | 缓做 | 不是风险，只是不够优；前三项完成前不动 |

### 改进点 1：出站 timeout

```ts
// 四处同样改法：axios.create 里加一行
private client: Axios = axios.create({
  baseURL: process.env.SSO_CHECK_HOST,
  timeout: 10_000,   // .claude/rules/request.md 本来就这么要求
});
```

### 改进点 2：健康检查

```ts
// app.controller.ts
@Get('health')
async health() {
  await Promise.all([
    this.ds.query('SELECT 1'),   // DB
    redisInstant.ping(),         // Redis
  ]);
  return { status: 'ok' };
}
```

```bash
# deploy.sh：重启后轮询到 200 才继续下一个实例（发布器自己当探针）
until curl -sf http://127.0.0.1:$PORT/api/v1/health > /dev/null; do sleep 1; done
```

### 改进点 3：死信告警（复用 mailer 队列）

```ts
@OnWorkerEvent('failed')
async onError(job: Job, err: Error) {
  this.logger.error(`job ${job.id} failed`, err.stack);
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await this.workerService.sendMailer({
      subject: `[audit-server] 任务最终失败: ${job.name}`,
      body: `jobId=${job.id} reason=${err.message}`,
    });
  }
}
```

## 不做清单

| 不做 | 原因 |
|---|---|
| K8s 双探针体系 | 单容器+VIP+nginx 架构，`/health`+发布脚本够用 |
| nginx 主动健康检查 | 要动基础设施，收益被改进点 2 覆盖 |
| Prometheus | 无看板运维诉求，日志已结构化 |
| 全局熔断 | 出站依赖仅 4 个，timeout+降级够；熔断是给几十个依赖的系统准备的 |

## 顺序

**第 1 周：①② → 第 2 周：③ → 观察一个月再说 ④。**
判断标准：先堵级联入口（会全站挂的），再做可观测（挂了能知道的），最后优化（不挂但浪费的）。
