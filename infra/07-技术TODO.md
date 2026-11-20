# 07 · 学习课表：L0~L8 九层阅读清单

> 🧭 **阅读顺序 07 / 14** ｜ ⬅️ [[06-启动与部署]] ｜ ➡️ [[08-日志治理]]
> 🌳 **框架知识体系（超越本项目）** → [[后端框架技能树TODO]]：Spring/MyBatis/事务/分布式/MQ/Redis 技能清单，本表是其「infra 阅读路径」

> 按 **L0 → L8** 顺序读，读完一项勾一个框，在「记录」区写三行。
> 阅读顺序的总原则：**从看得见的现象 → 看不见的原理；从单个服务 → 多服务协作；横切关注点放最后。**

---

> 📖 **术语看不懂？** → [[01-术语表]]（每个词都写了「前因 → 解决什么 → 项目里什么样 → 一句话」）

## 🎯 要点

1. **顺序是「先跑起来 → 读骨架 → 写小测试 → 读单测」**，反过来（先啃几百行代码）会很痛苦。
2. **41 个服务里 12 个已停更 ≥12 个月，直接跳过**——有 git 活跃度证据，不是凭感觉。
3. **L★「跟一条工单走」是性价比最高的一层**：12 步从 HTTP 进到落库，一次建立全局观。

---

## 零、先读这一节：先跑起来，再读代码

> 🔑 **原则：先跑起来，再读代码。** 本地环境已搭好并验证过，起一个新服务约 5 分钟——
> 对着真实日志读代码，比对着源码空想快得多。

### 本地现在能跑什么

| 组件 | 端口 | 说明 |
|---|---|---|
| MySQL | 13306 | 容器 `infra-mysql`，库 `stable`，**333 张表**（真实 schema） |
| Nacos | 8848 / 9848 | 容器 `infra-nacos`，26 份配置已脚本化导入 |
| Redis（替代 Codis） | 8003 | 容器 `infra-redis` |
| LVS + DSI mock | 8833 | 容器 `infra-lvs-mock` |
| 倚天工作流 mock | 8834 | 容器 `infra-yt-mock` |
| **dgw 服务** | 8053 | 已注册 Nacos，134 个接口可调 |
| **acl 服务** | 8074 | 已注册 Nacos，33 个接口可调，返回真实数据 |

```bash
# ① 环境（幂等，已在跑就跳过）
cd ~/Desktop/learn/podman/localnacos && bash stack-up.sh && bash verify.sh

# ② 编译（只做一次；改了代码才重做）
cd /Users/didi/Desktop/work/infra
mvn install -Dmaven.test.skip=true -pl S-ServicesNet/S-acl-service -am

# ③ 启动（必须带 Nacos 参数，见 [[06-启动与部署]] 方式 B）
cd ~/Desktop/learn/podman
NOPROXY=1 EXTRA_ARGS="$(cat localnacos/idea-args.txt)" bash svc.sh start acl

# ④ 点接口 & 看数据：http://127.0.0.1:8080
```

### 为什么"先跑"比"先读"快

**你没法通过读代码理解「一个 HTTP 请求进来发生了什么」。**但你可以点一下按钮，看它返回真实的 44 行数据、看日志里 SQL 打了什么、看 Redis 里多了什么 key。这个反馈回路比读 500 行代码快得多。

### 四层学习法（按投入产出比重排）

| 层 | 做法 | 需要启动吗 | 产出 |
|---|---|---|---|
| **① 跑起来** | 起一个服务，点几个接口，看响应 / 日志 / 数据库变化 | ✅ | 建立"活的"直觉 |
| **② 读骨架** | 用 [[00-总览与学习地图]]~[[11-数据存储与分层]] 当地图，**带着①的问题**读 | ❌ | 知道东西在哪 |
| **③ 写小测试** | 把要学的机制**单独拎出来**验证（见下） | ❌ | **真正的学习** |
| **④ 读单测** | 挑零依赖的测试直接跑 | ❌ | 见到活的代码 |

> **顺序反了会很痛苦**：先读 500 行 → 似懂非懂 → 忘了本来要学什么。
> **但也别指望"跑起来就懂了"**：① 给直觉，③ 才是把机制钉死的地方，两者都要。

### ③ 才是核心：把机制拎出来单独验证

不要试图把 42 个服务全拉起来，而是**在测试里搭一个只有你要学的那部分的小世界**：

```java
// 例：验证 MetricJson 的幂等地基（详见 [[10-指标上报链路]]）
// 5 分钟能写、1 秒能跑、零外部依赖，但验证的是整条链路的地基
@Test void canonical_is_order_independent() {
    JSONObject a = MetricJson.parseObject("{\"b\":1,\"a\":2}");
    JSONObject b = MetricJson.parseObject("{\"a\":2,\"b\":1}");
    assertEquals(MetricJson.canonical(a), MetricJson.canonical(b));  // key 排序后逐字节相同
    assertEquals(MetricJson.hash(a), MetricJson.hash(b));            // 因此摘要也相同
}
```

### 现成的"零依赖"落脚点

| 位置 | 内容 | 为什么推荐 |
|---|---|---|
| `S-ServicesCmdb/S-network-device-service/src/test/kotlin/` | **117 个测试文件 / 605 个 `@Test`**，全项目测试基建最好 | 有 H2、有 `data-h2.sql`、有 `@MybatisTest` 分层 |
| ↑ `.../config/NacosBeanExcludeConfig.kt` | **剥离 Nacos 的现成实现** | 证明"脱 Nacos 测试"是被支持的做法 |
| `S-WrokOrder/S-dns-order/src/test/java/` | 大量纯 Mockito 单测（`*GatewayImplTest`） | 不启 Spring，直接 `mvn test -Dtest=xxx` |
| `S-dubbo-starter` / `S-log-starter` 的测试 | 框架层单测 | 理解 Filter 链最直接 |

### 第一步动作（选一条，都能在 10 分钟内看到东西）

```bash
# 路线 A：要"活的"直觉 —— 起服务点接口（两条命令，缺一不可）
cd /Users/didi/Desktop/work/infra
mvn install -Dmaven.test.skip=true -pl S-ServicesNet/S-acl-service -am
cd ~/Desktop/learn/podman
NOPROXY=1 EXTRA_ARGS="$(cat localnacos/idea-args.txt)" bash svc.sh start acl
#   然后开 http://127.0.0.1:8080 ，点 acl 的 /risk/rule/select

# 路线 B：要"活的"代码 —— 跑单测
cd ~/Desktop/work/infra/S-ServicesCmdb/S-network-device-service && mvn test
```

### 补充：测试里打断点 = 启动调试的体验

很多人忽略了这一点——**在测试里打断点单步调试，体验和启动服务调试几乎一样**，但少了全部环境依赖。这是"不启动也能深度调试"的关键。

> 如果你**不想**用现成的本地环境，也可以自己连内网或从零搭一套——
> 但成本很高：`bootstrap-dev.properties` 里有 **72 个** `extension-configs` 要处理。
> 这条路的完整分析见 [[06-启动与部署]] §三。

---

## 进度总览

| 层 | 主题 | 难度 | 预计 | 状态 |
|---|---|---|---|---|
| L0 | 认路：项目结构与模块分类 | ⭐ | 2 小时 | ⬜ 未开始 |
| L1 | 入口：一个服务怎么起来（**真的起起来**） | ⭐ | 半天 | ⬜ 未开始 |
| **L★** | **跟一条工单走（动机层，新增）** | ⭐⭐ | 1 天 | ⬜ 未开始 |
| L2 | **自动装配（地基）** | ⭐⭐⭐ | 2-3 天 | ⬜ 未开始 |
| L3 | 配置中心：Nacos | ⭐⭐ | 1 天 | ⬜ 未开始 |
| L4 | **RPC：Dubbo** | ⭐⭐⭐ | 3-5 天 | ⬜ 未开始 |
| L5 | **日志治理（主线）** | ⭐⭐⭐ | 1-2 天 | ⬜ 未开始 |
| L6 | 数据访问：MyBatis 多数据源 | ⭐⭐ | 2 天 | ⬜ 未开始 |
| L7 | 稳定性与工程化（已压缩） | ⭐ | 0.5 天 | ⬜ 未开始 |
| L8 | 数据流转与存储分层 | ⭐⭐⭐ | 2-3 天 | ⬜ 未开始 |

> **★ 标记的三层是主菜**（L2 / L4 / L5），时间要舍得花；其余是配菜。
> **L8 是"综合题"**：前面几层都是单个机制，L8 把它们串成端到端的数据流。

### 记录格式（每项读完写这三行）

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的（动手实验）：
```

---

## L0 · 认路：项目结构与模块分类（2 小时）

> 目标：不看笔记能说清"这个项目有哪些模块、哪些能跑、怎么区分"。

### 读什么

- [ ] 根 `pom.xml` 的 `<module>` 列表 → 16 个顶层模块怎么分层
- [ ] `S-ServicesNet/`、`S-ServicesCmdb/` 目录 → 哪些有子模块、哪些是叶子
- [ ] `S-ServicesNet/S-acl-service/pom.xml` 的 `<packaging>` 和 `<finalName>`
- [ ] 全局搜 `*Application.*`（**含 Kotlin**）→ 数出 42 个可启动服务

### 验收标准

- [ ] 能说清**三类模块**怎么区分（可启动服务 42 / 库模块 61 / 聚合模块 11）
- [ ] 能说清判断法则：看 `<packaging>` + 有没有 `main`
- [ ] 能说出 6 个库模块都是什么（S-Core / S-Dao / S-Entity / S-DubboApi / S-starter / S-ServiceConfig）
- [ ] 能指出两个"陷阱模块"：`S-public-order`（无 main）、`S-network-device-service`（Kotlin 主类）


### 41 个服务的分级：哪些根本不用看

**这一节直接决定了你后面省下多少时间。** 按 git 最后提交时间分级（统计于 2026-11-10）：

**T1 · 已停更 ≥12 个月 —— 直接跳过（12 个）**

| 服务 | 端口 | 最后提交 | 总提交 | 建议 |
|---|---|---|---|---|
| `S-ServiceSentinel` | 9001 | 2024-07-09 | 2 | ⛔ 跳过 |
| `S-userate-producer-service` | 8043 | 2025-03-24 | 3 | ⛔ 跳过 |
| `S-budget-resource-order` | 8066 | 2025-04-14 | 2 | ⛔ 跳过 |
| `S-message-service` | 8082 | 2025-04-16 | 6 | ⛔ 跳过 |
| `S-new-network-order` | 8079 | 2025-04-14 | 15 | ⛔ 跳过 |
| `S-rds-service` | 8066 | 2025-04-14 | 4 | ⛔ 跳过 |
| `S-replace-order` | 8087 | 2025-04-14 | 4 | ⛔ 跳过 |
| `S-server-resource-order` | 8060 | 2025-04-23 | 16 | ⛔ 跳过 |
| `S-ServiceProxy` | 8093 | 2025-05-06 | 8 | ⛔ 跳过 |
| `S-access-service` | 8065 | 2025-08-07 | 11 | ⛔ 跳过 |
| `S-it-asset-base-service` | 8097 | 2025-09-01 | 8 | ⛔ 跳过 |
| `S-outside-service` | 8099 | 2025-10-21 | 10 | ⛔ 跳过 |

**T2 · 半年到一年没动 —— 优先级放低（5 个）**

| 服务 | 端口 | 最后提交 | 总提交 | 建议 |
|---|---|---|---|---|
| `S-qos-service` | 8073 | 2026-02-12 | 31 | ⚠️ 放低 |
| `S-workflow-service` | 8085 | 2026-02-27 | 29 | ⚠️ 放低 |
| `S-cvm-service` | 8063 | 2026-04-28 | 30 | ⚠️ 放低 |
| `S-storage-service` | 8064 | 2026-04-23 | 12 | ⚠️ 放低 |
| `S-parts-ops-service` | 8056 | 2026-05-28 | 186 | ⚠️ 放低 |

**T3 · 活跃 —— 值得看（24 个）**

| 服务 | 端口 | 最后提交 | 总提交 | 建议 |
|---|---|---|---|---|
| `S-server-ops-service` | 8095 | 2026-11-03 | 2328 | ✅ 最活跃 |
| `S-dns-order` | 8084 | 2026-11-02 | 640 | ✅ 工单主链 |
| `S-oms-ops-service` | 8091 | 2026-11-03 | 527 | ✅ |
| `S-device-assets-service` | 8055 | 2026-11-03 | 522 | ✅ |
| `S-idc-meta-data-service` | 8078 | 2026-11-02 | 327 | ✅ L8 主角 |
| `S-dgw-service` | 8053 | 2026-11-03 | 253 | ✅✅ **已跑通，首选** |
| `S-tree-service` | 8072 | 2026-09-10 | 224 | ○ |
| `S-agent-client-service` | 8089 | 2026-08-26 | 216 | ○ |
| `S-idc-ops-service` | 8098 | 2026-11-02 | 154 | ○ |
| `S-cmdb-service` | 8071 | 2026-10-23 | 155 | ○ |
| `S-acl-service` | 8074 | 2026-10-23 | 112 | ✅✅ **已跑通，最简样本** |
| `S-common-ops-service` | 8096 | 2026-11-03 | 106 | ○ |
| `S-ops-tool-service` | 8094 | 2026-09-24 | 106 | ○ |
| `S-cost-scale` | 8057 | 2026-11-03 | 103 | ○ |
| `S-report-service` | 8086 | 2026-10-23 | 85 | ○ |
| `S-nat-service` | 8052 | 2026-09-15 | 66 | ○ |
| `S-line-service` | 8077 | 2026-10-22 | 63 | ○ |
| `S-yt-workflow` | 8033 | 2026-08-08 | 63 | ○ |
| `S-auth-service` | 8070 | 2026-10-28 | 59 | ○ |
| `S-GatewayProxy` | 8093 | 2026-06-24 | 41 | ○ 网关 |
| `S-net-console-service` | 8075 | 2026-09-20 | 37 | ○ BFF |
| `S-cidr-service` | 8019 | 2026-08-11 | 11 | ○ |
| `S-idc-service` | 8061 | 2026-08-20 | 9 | ○ |
| `S-userate-service` | 8033 | 2026-10-23 | 4 | ✅ L8 主角（代码少≠没用） |

> ⚠️ **"老"不等于"可以跳过"**：`S-userate-service` 只提交过 4 次，但它是指标链的主角——
> **数据链路建好就不动了**。判死要三个信号交叉验证，缺一个都不够：
>
> | 信号 | 判死 | 判活 |
> |---|---|---|
> | git 最后提交 | > 18 个月 | < 6 个月 |
> | 表里还有没有新数据 | 最大时间戳 > 1 年 | 有近期数据 |
> | 有没有调用方 | 无任何 Dubbo 消费者 | 有消费者 |
>
> **三个都指向"死"才可以跳过。** 最确定的是 `S-ServiceSentinel`（28 个月 / 仅 2 次提交）。

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L1 · 入口：一个服务怎么起来（半天）

> 目标：能画出「main → 容器创建 → Bean 装配 → 监听端口」的启动时序。
> **注意**：本层**要真的把它起起来**——先读 20 行代码，然后看它跑起来（见「零」节）。

### 读什么

- [ ] `S-ServicesNet/S-acl-service/src/main/java/com/didi/AclApplication.java`（仅 20 行，是最好的样本）
- [ ] `S-ServicesNet/S-acl-service/src/main/resources/application.properties`
- [ ] 对比：`S-ServicesNet/S-acl-service/pom.xml` 只依赖 1 个数据源 starter（最简服务）

### 动手：真的起起来（10 分钟）

选 `acl` 当样本，因为它是全项目最简的服务（53 个 Java 文件、3 张表、1 个数据源）。

```bash
# ① 编译（这一步不能省，svc.sh 只启动已编译的 jar）
cd /Users/didi/Desktop/work/infra
mvn install -Dmaven.test.skip=true -pl S-ServicesNet/S-acl-service -am

# ② 启动（EXTRA_ARGS 把内网 Nacos 覆盖成本地，12 个参数）
cd ~/Desktop/learn/podman
NOPROXY=1 EXTRA_ARGS="$(cat localnacos/idea-args.txt)" bash svc.sh start acl
# 等约 20 秒，日志里会出现：
#   Tomcat started on port(s): 8074
#   com.didi.AclApplication : Started AclApplication in 18.8 seconds

curl -s -H 'username: local-console' http://127.0.0.1:8074/risk/rule/select
# → 真实的 6 条风险规则

# 看它注册进 Nacos 了吗
curl -s "http://127.0.0.1:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=200&namespaceId=74b75ca6-80d4-4313-8f49-409d4acefd06"
# → {"doms":["acl","dgw"]}
```

**观察三件事**（这就是本层的全部价值）：

1. 启动日志里，Nacos 拉配置发生在**哪一行**？在 Tomcat 起来之前还是之后？
2. 日志里有没有 `Failed to get app metadata ... dubbo://...`？那是 Dubbo 在找别的服务——`check=false` 所以不挡启动。
3. 把 `username` 头去掉再调一次，报什么错？（提示：`S-user-starter`）

### 带什么问题

- [ ] `@SpringBootApplication` 等价于哪三个注解？
- [ ] 为什么 `exclude = {DataSourceAutoConfiguration.class}`？不排除会怎样？
- [ ] `@EnableDiscoveryClient` 和 `@EnableDubbo(scanBasePackages=...)` 各开启什么？
- [ ] 端口、应用名分别从哪里读？为什么 `application.properties` 里**没有数据库地址**？

### 验收标准

- [ ] 能默写 `@SpringBootApplication` 拆成的三个注解及其作用
- [ ] 能解释为什么项目要**关掉官方的数据源自动配置**（因为用自研 starter 接管）
- [ ] 能说出**真实的启动顺序**：**先拉配置（bootstrap 阶段）→ 再建 Bean（主容器）→ 最后 Dubbo 暴露 + 服务注册（主容器收尾）**，并能解释为什么第三件**不是**独立阶段（详见 [[05-服务是怎么启动的]]）
- [ ] 能解释"为什么 Nacos 连接信息只能写 `bootstrap.*`、不能写 `application.*`"（因为读文件的先后）

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L★ · 跟一条工单走（1 天）

> 目标：**不看代码，先说清"一张工单从提交到执行完，中间发生了什么"。**
> 这一层不教新技术点，它解决的是**动机问题**：先看见整条链，后面每一层才有非学不可的理由。
> 🖼 本层配图如下（总索引 [[图廊 · archify 图集]]）：

![[gongdan-chain.png]]

👉 交互版：[[gongdan-chain.html]]

![[gongdan-state.png]]

👉 交互版：[[gongdan-state.html]]

### 为什么加这一层

原来的 L0~L8 是**技术维度**的切法（装配 → Nacos → Dubbo → 日志 → MyBatis → 存储）。按这个顺序学完，你可能仍然答不上来"一张工单发生了什么"——而这恰恰是这个项目最该学的东西。

技术机制是**零件**，工单链路是**整车**。先看整车怎么跑，再拆零件，才知道每个零件为什么存在。

### 走哪条链

`POST /domain/apply`（dgw，8053）——全项目最完整的一条：

```
① HTTP 进来
② 操作人上下文    S-user-starter 从 username 头取操作人
③ 参数校验        NlbDomainApplyDto.validate()（手写 if-else，不是注解）
④ 预检查          机房存在？端口一致？DSI 能查出实例？（查 3 张表）
⑤ 起流程          S-yt-starter → 倚天（本地 mock:8834）
⑥ Redis 域锁      防重复提交
⑦ 事务写 3 张表    workorder_nlb_domain / workorder_lvs_vip / workorder_lvs_vport
⑧ 提交后          工单进入 operating
⑨ 定时任务接管    每 15 秒扫 operating；S-local-task-starter + Redis tryLock
⑩ 查外部结果      LVS（本地 mock:8833 的 /lvs/get_status）
⑪ 回写            suc / fail，并调倚天推流程节点
⑫ 倚天回调        /v1/yt/callback 推进下一节点
```

### 怎么走（先跑，再读）

```bash
# 打开 http://127.0.0.1:8080 →「全部接口」→ 搜 domain/apply → 点「发送请求」
# 然后同时看三处：
#   中：响应体里的 msg（成功 / 保存工单失败）
#   左下：数据库实况 →「最近工单」（有没有新行）
#   右下：MOCK 收到什么 → 倚天那栏（有没有 POST）
```

### 带什么问题

- [ ] 这条链一共碰了几个外部系统？其中哪几个是 mock？
- [ ] `username` 头是在第几步被用掉的？没有它会怎样？
- [ ] 第 ⑦ 步为什么要加 Redis 锁？不加会被重复提交几次？
- [ ] 第 ⑨ 步的定时任务是哪个 starter 提供的？多实例部署时谁保证只有一个在跑？
- [ ] 第 ⑫ 步的回调接口**鉴权是怎么设计的**？为什么当年这样设计（内网信任边界）？✅ 规范：内网回调也要签名/token 鉴权；catch 至少打 warn 日志。

### 验收标准

- [ ] 能凭记忆画出上面 12 步的时序图，再和 [[10-指标上报链路]] 的图对比画法
- [ ] 能指出这条链上**哪一步最容易出问题**（提示：有一处 `catch` 没把异常打进日志）
- [ ] 能说出这条链里，哪些环节分别属于 L2（装配）/ L4（RPC）/ L5（日志）的范畴

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L2 · 自动装配 —— 全项目的地基（2-3 天）★★★

> 目标：自己写一个 starter 并生效。**不懂这层，后面 Nacos/Dubbo 全是雾里看花。**

### 读什么

- [ ] `S-starter/S-datasource-intra-starter/src/main/resources/META-INF/spring.factories`
- [ ] `S-starter/S-datasource-intra-starter/src/main/java/com/didi/IntraDruidMyBatisAutoConfig.java`
- [ ] 对照再挑 2 个：`S-redis-starter`、`S-kafka-starter`（注意各 starter 结构差异）
- [ ] 数一下 `S-starter/` 下有多少个 `spring.factories`

### 带什么问题

- [ ] **`spring.factories` 这个文件被谁读？** 读完怎么变成容器里的 Bean？
- [ ] `@ConditionalOnBean` / `@ConditionalOnMissingBean` 分别解决什么问题？没有它们会怎样？
- [ ] 31 个 starter 是不是同一套模式？只是"装配的东西不同"？
- [ ] Spring Boot **2.7 用 `spring.factories`，3.0 改成了什么**？（面试常考）

### 动手（不需要启动服务）

- [ ] **写个 `@Configuration` + `spring.factories`**，然后用 `ApplicationContextRunner` 写测试验证它生效
- [ ] **反向实验**：注释掉 `spring.factories`，跑同一个测试，解释为什么 Bean 不见了

### 验收标准

- [ ] 能画出"扫 classpath → 找 spring.factories → 读 EnableAutoConfiguration → 加载 @Configuration → 受 @Conditional 过滤"这条链

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L3 · 配置中心 —— Nacos（1-2 天）

> 目标：说清 bootstrap 与 application 的加载先后，以及 namespace/group/dataId 三级隔离。
> **本层是理解"为什么无法本地启动"的关键。**

### 读什么

- [ ] `S-ServiceConfig/src/main/resources/bootstrap.properties`
- [ ] `S-ServiceConfig/src/main/resources/bootstrap-dev.properties`
- [ ] `S-ServiceConfig/src/main/resources/bootstrap-test.properties`（与 dev 对比）
- [ ] 六份 bootstrap 的 **nacos 地址对照**（见下）

### 六环境 Nacos 地址（项目里明确写了）

| Profile | 地址 | 类型 | 隔离方式 |
|---|---|---|---|
| dev | `10.78.128.115:8848` | IP | namespace `d77878cb…` |
| test | `10.78.128.115:8848` | IP（**同一台**） | namespace `74b75ca6…` |
| canoe | `10.207.0.254:8051,8052,10.207.2.151:8053` | IP 集群 | namespace `612b7ee3…` |
| pretest | `smart-nacos01/02/03.intra.xiaojukeji.com:8000` | 域名集群 | namespace `4ceb8a8b…` |
| prod | `nacos.cmdb.intra.xiaojukeji.com:8848` | 域名 | namespace `c824ad69…` |
| prodhnd | `nacos.cmdb.intra.xiaojukeji.com:8848` | 域名 | namespace `1c58a3c9…` |

> **规律**：dev/test 用 IP 靠 namespace 隔离；预发/生产走内网域名。
> **关键**：dev 和 test **同一台 Nacos**，只靠 namespace 区分——这就是三级隔离的实证。

### 带什么问题

- [ ] **为什么 Nacos 连接信息必须写在 `bootstrap.*` 而不是 `application.*`？**
- [ ] `@activatedProperties@` 是什么？谁在打包时替换它？
- [ ] 一个服务为什么要读 **72 个** `extension-configs`？（`grep -c "extension-configs\[" bootstrap-dev.properties`）
- [ ] namespace / group / dataId 各隔离什么？（dev vs test 差异在哪）
- [ ] `refresh=true` 是干什么的？配合什么注解用？
- [ ] **连不上 Nacos 时，是在哪一阶段失败的？为什么没有本地兜底？**

### 验收标准

- [ ] 能说清 **bootstrap 上下文（父）与 application 上下文（子）** 的加载先后关系
- [ ] 能从两份 bootstrap 配置里指出：同批 dataId 换了不同 namespace 和 group
- [ ] 能解释"72 个 dataId 决定了本项目对配置中心是硬依赖"（所以本地必须先灌配置，见 [[06-启动与部署]] §三）

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L4 · RPC —— Dubbo（3-5 天）★★★

> 目标：画出一次远程调用的完整链路；读懂 Filter 链与 RpcContext。

### 4.1 暴露与引用（基本盘）

- [ ] `S-ServicesNet/S-nat-service/src/main/java/com/didi/service/dubbo/NatDubboServiceImpl.java`（`@DubboService`）
- [ ] `S-WrokOrder/S-dns-order/src/main/java/com/didi/outside/infrastructure/gatewayImpl/StarTreeGatewayImpl.java`（`@DubboReference`）
- [ ] `S-DubboApi/S-nat-dubbo` 的接口 `IDubboNatService`
- [ ] 对照 `S-dubbo-starter/pom.xml` 的 `dubbo.version` + 它引入的 `dubbo-registry-nacos`

> 带问题：提供方怎么暴露？消费方为什么**只依赖接口**、不依赖实现？`check = false` 解决什么？`S-DubboApi` 这个模块存在的意义是什么？

### 4.2 Dubbo SPI（项目最"高级"的用法）★

- [ ] `S-dubbo-starter/src/main/resources/META-INF/dubbo/com.alibaba.dubbo.rpc.Filter`
- [ ] `S-dubbo-starter/src/main/resources/META-INF/dubbo/com.alibaba.dubbo.registry.RegistryFactory`
- [ ] 对比 Java 原生 SPI（`META-INF/services/`）的差异

> 带问题：`名字=类名` 这格式是什么机制？Dubbo SPI 比 Java SPI 强在哪（按名加载 / AOP / IOC / `@Activate`）？

### 4.3 Filter 链 + 隐式传参 ★★★

- [ ] `S-dubbo-starter/src/main/java/com/didi/log/LogDubboTraceFilter.java` —— **逐行读**
- [ ] `S-dubbo-starter/src/main/java/com/didi/exception/DubboExceptionFilter.java`
- [ ] `S-dubbo-starter/src/main/java/com/didi/metrics/DubboMetricsFilter.java`

> 带问题：`@Activate(group=...)` 什么作用？`RpcContext.setAttachment()` 是什么？（这是 traceId 跨服务的载体）`invoker.invoke()` 前后各一段代码是什么结构（AOP 环绕）？

### 4.4 注册中心实现

- [ ] `S-dubbo-starter/src/main/java/com/didi/NacosRegistry.java` 的 `doRegister` / `doSubscribe`
- [ ] `S-dubbo-starter/src/main/java/com/didi/NacosRegistryFactory.java`（注意：整个被注释掉了，为什么？）

> 带问题：服务名 `category:interface:version:group` 怎么拼？订阅时 `subscribeEventListener` 做什么？为什么项目弃用了自研实现改用官方 `dubbo-registry-nacos`？

### 验收标准

- [ ] 能画出：消费方调用 → 代理对象 → 负载均衡 → 序列化 → 提供方 Filter 链 → 真实实现
- [ ] 能解释 `@Activate` 如何让 Filter 自动织入
- [ ] 能说清 RpcContext attachment 为什么是分布式追踪的底层原理

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L5 · 日志治理 —— 横切主线（1-2 天）★★★

> 📖 **散文部分不在这里**：MDC 是什么、7 个字段怎么设计、filebeat→logstash→ES 怎么采集，
> 全部在 **[[08-日志治理]]**（369 行，写得比清单好）。
> 本节只保留「**读哪几个文件 + 带什么问题**」的打卡清单——两者是互补的，不是重复。

> 目标：说清一次「HTTP → Dubbo A→B」的 traceId 完整流向。

### 5.1 基座：MDC + LogUtils

- [ ] `S-Core/src/main/java/com/didi/utils/log/LogUtils.java`
- [ ] `conf/log/logback.xml` 的 `logPattern`

> 带问题：**MDC 是什么？**（ThreadLocal 的 map）DL_TAG / traceid / spanid / cspanid 各是什么？`%X{TRACE_ID}` 怎么从 MDC 取值？

### 5.2 入口：HTTP 进来的 traceId

- [ ] `S-starter/S-log-starter/src/main/java/com/didi/filter/mvc/LogMvcTraceFilter.java`
- [ ] `S-starter/S-log-starter/src/main/resources/META-INF/spring.factories`

> 带问题：header `Didi-Header-Rid` / `Didi-Header-Cspanid` 从哪来？没有就怎么生成？为什么要在 `afterCompletion` 里 `MDC.clear()`？
> **动手**：这个 Filter 可以脱离 Spring 直接 `new` 出来测——`MockHttpServletRequest` + 断言 MDC 内容，无需启动服务。

### 5.3 跨服务：Dubbo 透传

- [ ] 回看 L4.3 的 `LogDubboTraceFilter.java`（这次带着日志视角读）

> 带问题：**消费端怎么把 traceId 传给提供端？** 为什么提供端打印的 spanid = 上游传来的 cspanid？

### 5.4 定时任务：无上游请求怎么办

- [ ] `S-starter/S-log-starter/src/main/java/com/didi/filter/xxljob/XxlJobAspect.java`

> 带问题：xxl-job 任务没有 HTTP 请求进来，traceId 从哪来？

### 5.5 落盘与采集

- [ ] `conf/log/logback.xml`（Appender / 滚动策略 / AsyncAppender）
- [ ] `conf/log/logstash.conf`（另有 `logstash_online.conf` / `logstash_pretest.conf`，对比差异）

> 带问题：为什么异步日志要不丢？`discardingThreshold=0` + `neverBlock=true` 何意？日志怎么进 ES？

### 5.6 数据审计（附带）

- [ ] `S-starter/S-datasource/src/main/java/com/didi/sql/DataChangeLogInterceptor.java`（MyBatis 插件，记数据变更）

### 验收标准

- [ ] 能画出 **HTTP → A 服务 → Dubbo → B 服务** 全程 traceId/spanid 的流向图
- [ ] 能解释"为什么 B 的 spanid 等于 A 的 cspanid"

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L6 · 数据访问 —— MyBatis 多数据源（2 天）

> 📖 **这一层的正文在 [[09-Dao 与 Entity 设计]]**——路由机制、两代 Mapper 风格、批量插入注入器、变更审计都在那里。
> L6 是**打卡清单**，09 是**解释**。先看 09 再回来勾这里。

> 目标：说清一个 `selectById` 到底连到哪个库、谁决定的、以及为什么仓库里同时有两套 Mapper 写法。

### 读什么（🔴 必读在前，加起来不到 100 行）

- [ ] 🔴 `S-starter/S-datasource/src/main/java/com/didi/DynamicDataSource.java`（**13 行**，路由落点）
- [ ] 🔴 `.../DataBaseContextHolder.java`（**37 行**，`ThreadLocal<Deque>` 栈，嵌套切库靠它）
- [ ] 🔴 `.../DataBaseType.java`（**8 个库**，注意 `STABLE` / `STABLE_R` 是主从，读写分离就靠它俩）
- [ ] 🔴 `S-datasource-stable-starter/.../StableDataBaseAspect.java`（注解 → 切面 → 压栈/弹栈 的标准套路）
- [ ] 🔴 任意服务的 `com/didi/config/DataSourceConfig.java`（`@Primary` 的 `DynamicDataSource` 怎么组装路由表）
- [ ] `S-datasource-intra-starter/.../IntraDruidMyBatisAutoConfig.java`（`@MapperScan` + `@ConditionalOnBean` 装配）
- [ ] `S-starter/S-datasource/.../ExtLogicSqlInjector.java` + `injector/MysqlInsertAllBatch.java`（自研 SQL 注入器）
- [ ] `S-Dao/S-common-dao/.../ExtBaseMapper.java`（MyBatis-Plus 基接口）与 3 个 `*TypeHandler`

### 带什么问题（答不上就回 09 查）

- [ ] 一次 `selectById` 在哪一刻决定走哪个库？（**拿连接那一刻**，不是注解那一刻）
- [ ] `DataBaseContextHolder` 为什么用 `Deque` 而不是 `String`？（嵌套调用要能回到外层）
- [ ] 方法上**没有任何注解**时会怎样？（不报错，静默走 `setDefaultTargetDataSource`）
- [ ] 服务启动类为什么要 `exclude = {DataSourceAutoConfiguration.class}`？
- [ ] `S-datasource` 没有 `spring.factories`、按域 starter 有——差别在哪？
- [ ] 165 个 Mapper 里为什么 51 个是 `selectByExample`、58 个是 `BaseMapper`？`*Example` 为什么在 `S-Entity` 里？
- [ ] `mysqlInsertAllBatch` 和 MyBatis-Plus 的 `saveBatch` 差在哪？
- [ ] `MysqlChangeContext` 和 `DataBaseContextHolder` 是两个独立 ThreadLocal，各管什么？为什么都会在异步线程里丢？

### 动手（不需要 MySQL）

- [ ] 跑现成测试：`cd S-ServicesIntra/S-agent-client-service && mvn test -Dtest=DataSourceRoutingDbTest`
      （同目录还有 `DataSourceConfigTest` / `StableDataSourceAspectTest`）
- [ ] 或照抄 `S-ServicesCmdb/S-network-device-service/src/test/kotlin/com/didi/config/DataConfig.kt`，
      用 **H2 + `MODE=MySQL`** 跑通一个 Mapper
- [ ] 挑一个 MySQL 专有函数（如 `GROUP_CONCAT`，全项目 **13 个文件**在用）看 H2 是否兼容

### 验收标准

- [ ] 能默画出这条链：`@StableDataBase → Aspect(@Before) → ThreadLocal 栈 → DynamicDataSource.determineCurrentLookupKey() → 路由表 → stableDataSource`
- [ ] 能说清 `dataSource`（`@Primary` 的路由器）和 `stableDataSource`（真实连接池）两个 bean 的区别
- [ ] 看到一个 Mapper 能立刻判断它是 MBG 老风格还是 MP 新风格，并知道去哪找 SQL（`S-Dao/**/*.xml` 还是 Wrapper）
- [ ] 能解释为什么**不能**用 H2 顶替 MySQL 启动整个服务（JSON 函数不兼容 + Nacos 硬依赖）

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L7 · 稳定性与工程化（0.5-1 天）

> 目标：说清"出错时怎么被兜住、怎么被看见"。
> **已压缩**：原版有 2 天，其中一半花在 tar.gz 部署流程上——那是运维动作，不是架构。
> 现在有 `svc.sh` 直接 `java -jar` 起服务，学习阶段不需要读打包脚本。

### 7.1 异常治理（核心）

- [ ] `S-starter/S-exception-reslove-starter/src/main/java/com/didi/exception/ExceptionManager.java`
- [ ] ↑ 同目录 `GlobalDefaultExceptionHandler.java`

> 带问题：一个业务异常从 Service 抛出，到变成前端看到的 JSON，中间经过几个类？
> `BusinessException` 和 `RuntimeException` 的处理路径有什么不同？

### 7.2 指标埋点（接 L8）

- [ ] `S-starter/S-metrics-starter/src/main/java/com/didi/metrics/MetricConfig.java`

> 带问题：埋点的数据最终去哪了？（答案在 [[10-指标上报链路]]——这里只要知道入口在哪）

### 附：部署流程（可选，1 小时，不影响主线）

<details> <summary>点开看（原 L7 的 tar.gz 部分）</summary>

- `build.sh` → `assembly.xml` → `control.sh` → `conf/bin/prod/docker_startup.sh`
- 带问题：tar.gz 包里有什么？`control.sh start` 做了哪几件事？
  `docker_startup.sh` 里 `-Dloader.path=${BASE_DIR}/libs` 是干什么的？

**为什么降级**：这套流程回答的是"运维怎么发版"，不是"架构为什么这样设计"。你现在的学习目标是后者。要跑服务，见 [[06-启动与部署]] 方式 B（`svc.sh` 只启动已编译的 jar，且**必须带 `EXTRA_ARGS` 的 Nacos 参数**，光一条 `svc.sh start` 是起不来的）。

</details>

### 验收标准

- [ ] 能说清一个异常从抛出到返回的完整路径
- [ ] 能指出埋点入口在哪个 starter，数据流向哪一层

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## L8 · 数据流转与存储分层（2-3 天）★★★

> 目标：**把前面几层的单个机制串成端到端的数据流。**这是本 TODO 的综合题。
> 方法：不启动项目，而是**画图 + 自我批改 + 写小测试验证**。

> **为什么这层最重要**：代码会变，数据流不会。一个 Service 可以被重写十次，
> 但"原始打点 → 时序库 → 聚合 → Kafka → 分析库"这条骨架几年不变。
> 抓住骨架，换任何实现都能快速定位。

### 8.1 先读两份文档

- [ ] [[10-指标上报链路]] —— outbox / 幂等键 / 租约+CAS / 发布前可见性断言
- [ ] [[11-数据存储与分层]] —— 四层存储边界 / 三条端到端数据流 / 选型判据

### 8.2 三条流（选一条吃透，再横向对比）

| 流 | 入口 | 落点 | 关键类 |
|---|---|---|---|
| **A. IDC 资源指标** | `idc-meta-data` 采集 | MySQL 状态 + ES 文档 | `DubboRackResourceReportServiceImpl` → `MetricPipelineService` |
| **B. 使用率** | 采集打点 | VictoriaMetrics → MySQL 报表 → Kafka → StarRocks | `UsageDataKeeperServiceImpl` → `UseRateCloudKfk2SrHandler` |
| **C. 日志与审计** | logback | 文件 → ES | `LogMvcTraceFilter` → logstash |

### 8.3 五步啃法（每条流按这个顺序）

```
① 找入口      谁产生这条数据？（xxl-job / HTTP / MQ 消费）
② 找落点      最终存在哪个库/索引/表？
③ 找中间态    中间经过哪些存储？为什么不能一步到位？
④ 找确保      丢了怎么办？重复怎么办？多久能查到？
⑤ 再读代码    只读第 ② 步定位到的那几个类
```

> **第 ⑤ 步才碰代码**，而且只读定位到的那几个——**编码是其次，梳理数据流转才是主线。**

### 8.4 自检问题（能答上来说明真懂了）

- [ ] 使用率的原始打点存在哪？为什么不存 MySQL？
- [ ] `report_userate_*` 是谁写的？数据从哪来？
- [ ] `Kfk2Sr` 里的 `Sr` 指什么？谁把数据装进 Sr？（答案在仓库外）
- [ ] 为什么指标链路要 outbox，而使用率链路直接发 Kafka 就行？
- [ ] 同一个"机柜利用率"，`idc_cabinet_utilization_snapshot` 和 ES 里的指标文档有什么区别？为什么要两份？

### 8.5 动手（不启动，写测试）

- [ ] 给 `MetricJson` 写一组测试：`canonical` 顺序无关性、`hash` 幂等性、`key` 的可复现性
- [ ] 给 `MetricOutboxService.checkSameContent` 写测试：**同 key 不同内容必须抛 `OUTPUT_CONFLICT`**
- [ ] 读 `MetricJobMapper` 的 `claim`（CAS 抢任务），写出"两个 token 抢同一行只有 1 个成功"的测试思路

### 验收标准

- [ ] 能画出流 A 的完整时序图（不看 [[10-指标上报链路]]，然后对照批改）
- [ ] 能说清"为什么明细不落 MySQL"这个决策背后的**查询形态**判据
- [ ] 能指出一个"看着有、其实没用"的组件（如 `S-hbase-starter`）

### 记录

```
- ✅ 我理解到的：
- ❓ 没搞懂的：
- 🔬 想验证的：
```

---

## 附：判断一个组件是否"真在用"的方法

🔑 学这个项目最重要的判断：**配置和工具类存在，不代表链路在跑。**

必须同时满足三件事，缺一个都可疑：

```
依赖声明（pom.xml） + 配置项（properties） + 有调用方（grep）
```

实例：`S-hbase-starter` 在 root pom 里声明了，但**模块目录不存在**、无任何客户端代码 → 死配置。

---

---

> 🎓 **走完 L0~L8 之后**，去 [[12-设计模式、最佳实践与设计缺陷]] 换个视角：
> 前八层教你「**它怎么做的**」，这一份教你「**它做得好不好**」——哪些值得抄、
> 哪些是当年取舍、以及每处对应哪个设计模式。面试和评审时，这部分比"能背流程"值钱。

## 相关笔记

- [[00-总览与学习地图]] · [[01-术语表]] · [[02-模块地图]] · [[03-POJO 与 DAO 层]] · [[04-starter 是什么]] · [[05-服务是怎么启动的]] · [[06-启动与部署]] · [[07-技术TODO]] · [[08-日志治理]] · [[09-Dao 与 Entity 设计]] · [[10-指标上报链路]] · [[11-数据存储与分层]] · [[12-设计模式、最佳实践与设计缺陷]] · [[13-Nacos 面试题设计与评分卡]] · [[14-系统生命周期全景]]
