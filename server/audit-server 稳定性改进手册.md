# audit-server 稳定性改进手册

> 只回答"做什么"。为什么（LB/探针/readiness/优雅关闭的完整推导）见 [[服务器稳定性 — 超时、水位、探针与流量调度]]。

## 📌 家底：已有的防线

| 防线 | 位置 | 状态 |
|---|---|---|
| BullMQ 重试+退避（越失败等越久再重试） | `task-workers.module.ts` | ✅ 写路径自愈 |
| Worker 限速（每秒处理任务数上限） | `auto-audit.worker.ts` `max: 60/s` | ✅ 有闸门（静态，阈值写死） |
| 出站限流（发给下游的请求设上限） | `utils/rate-limit.ts` `RateLimitLock`（限流锁） | ✅ 仅 observable API（指标上报接口） |
| 优雅关闭 | `main.ts`：收到 SIGTERM（请退出信号）后调 `app.close()` | ⚠️ 半成品，待改进点 2 配合 |
| 异常兜底 / 结构化日志 / Redis 断连日志 | `main.ts` / `utils/logger.ts` / `utils/redis.ts` | ✅ |

**结论：写路径防御完善；读路径与出站调用裸奔（没有任何保护）。**

📌 生活类比：稳定性改进像给老店铺做消防改造——先修可能起火的电路（出站超时），再装烟雾报警器、门口挂「装修中」牌子（健康检查），然后给「丢件」设提醒（死信告警）；至于换台更智能的空调（自适应限流），最后再说。

## 改进清单

| # | 改什么 | 位置 | 成本 | 危险一句话 |
|---|---|---|---|---|
| 1 | axios（HTTP 客户端）补 `timeout: 10_000` | order / main-data / sso / perm 四个 service | **10 分钟** | 唯一级联入口：下游挂起，等待的请求占满事件循环（进程里排队干活的主循环），全站挂 |
| 2 | `/health` 端点 + deploy.sh 轮询 | `app.controller.ts` + `deploy.sh` | 半天 | 发布必出 502（网关找不到实例）/500（服务内部错误）窗口；假死不可见；优雅关闭被 SIGKILL（强制击杀信号）腰斩 |
| 3 | 死信（重试耗尽仍失败的任务）告警 | 各 worker `failed` 事件 | 一天 | 重试耗尽的任务静默丢失，第二天有人来问数据 |
| 4 | RateLimitLock 自适应（AIMD：成功加一、失败减半） | `utils/rate-limit.ts` | 缓做 | 不是风险，只是不够优；前三项完成前不动 |

### 改进点 1：出站 timeout

给四个出站 HTTP 客户端都设 10 秒超时：下游超过时间不回应就快速失败，别把全站拖下水。

```ts
// 四处同样改法：axios.create 里加一行
private client: Axios = axios.create({
  baseURL: process.env.SSO_CHECK_HOST,
  timeout: 10_000,   // .claude/rules/request.md 本来就这么要求
});
```

### 改进点 2：健康检查

端点要真实查一次数据库和 Redis，都通过才返回 ok——这样假死实例（进程活着但干不了活）才会被探针暴露。

```ts
// app.controller.ts
@Get('health')
async health() {
  await Promise.all([
    this.ds.query('SELECT 1'),   // 真实查一次数据库
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

监听 worker 的「任务失败」事件：只在重试耗尽（attemptsMade 达到 attempts 上限）时才发告警邮件，避免每次失败都轰炸邮箱。

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
| K8s 双探针体系（liveness 加 readiness 两种探针） | 单容器+VIP（虚拟 IP）+nginx 架构，`/health`+发布脚本够用 |
| nginx 主动健康检查 | 要动基础设施，收益被改进点 2 覆盖 |
| Prometheus（指标监控系统） | 无看板运维诉求，日志已结构化 |
| 全局熔断（连续失败后暂停调用一段时间） | 出站依赖仅 4 个，timeout+降级够；熔断是给几十个依赖的系统准备的 |

## 顺序

**✅ 第 1 周做①和②，第 2 周做③，观察一个月再说④。**
判断标准：先堵级联入口（会全站挂的），再做可观测（挂了能知道的），最后优化（不挂但浪费的）。
