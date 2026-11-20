# 后端框架技能树 · TODO

定位：**框架知识体系**（知识维度，超越 infra 项目）。与 [[07-技术TODO]] 互补——07 是「怎么读 infra」的阅读课表（项目维度），本表是「后端框架要会什么」的技能清单，抓手列指向 07 对应层与真实代码。

**目标（2026-11-19 明确）**：成为 **Java 为主的开发，Spring Boot 是主轴**。其余各块不是并列学科，而是挂在 Boot 集成面上的能力：事务=spring-tx、Redis=RedisTemplate/Lua、MQ=spring-kafka、分布式=Spring Cloud Alibaba（Nacos/Dubbo，工作栈）。
**双轨策略**：工作读 infra（Boot 2.7.17 + Dubbo + Nacos），自读写 Boot 3.x + Java 17/21——两轨差异本身就是知识点（jakarta / AutoConfiguration.imports / 虚拟线程）。
**背景**：Node 全栈（NestJS + BullMQ + TypeORM + Redis，代表项目 audit-server）。存量不是零：见「Node 存量映射」，缺的是 Java 实现视角、语言手感与并发地基。
**主线实战**：audit-server → Spring Boot 3 移植（毕业项目，见下文 M1–M5）。从第 2 周开始写，**语言核心在写项目时按需补，不孤立学语言**。

**状态标准（从严）**：
- ✅ 掌握：能讲清原理 + 能动手写 + 能排查问题，三者齐全，**且附产出物**（可跑的测试 / 复现脚本 / EXPLAIN 前后记录 / 不看笔记的讲解记录，至少其一，路径写进抓手列）。没有产出物不得标 ✅。
- 🔶 已接触：在代码里见过 / 部署过 / 讨论过 / **Node 侧实现过但 Java 侧未验证**，未系统学
- ⬜ 未开始

**验收取向**：优先「复现 / 排查」，而非「默画」。默画是面试代理指标，容易变成背图；每条 ✅ 至少包含一个动手动作（断点观察、复现失效、EXPLAIN 验证），默画只作补充。

**维护规则**：每次学习后由 agent 更新——新接触 → 🔶（附证据）；通过验收 → ✅（附产出物路径）；发现新知识点 → 加条目。每次变更记入文末「更新日志」。

**表达纪律（2026-11-19 用户指令）**：减少文字，图先于文、数字先于形容。每个知识点的讲解 = 1 张 archify 图 + 一组可验证数字（端口/间隔/行数/表数）+ 1 个验证动作；聊天回复只留结论与链接，长内容进图的卡片。图按「先预测 → 对照图 → 代码/CLI 验证一点」三步循环使用。图产物已入库：`assets/archify/`（HTML 交互版 + PNG 预览）。**图文件收敛在 `assets/archify/` 单目录、[[图廊 · archify 图集]] 为总索引；各笔记在对应知识点就地内联嵌相关图（PNG + 交互版链接）**；再生成仍在 podman/.archify/，完成后按图廊维护三步同步。**立场（2026-11-19 用户指令）：学项目 ≠ 审项目，也不把历史约定当规范教**——三层标注：📌 项目事实（含历史约定，中性；符合官方默认的写明）/ ⚠️ 机制易误判点 / **✅ 最佳实践规范（重点：正确规范 + 现代替代，自己新项目该怎么写）**；无学习价值的挑毛病判词直接删（见修订五、六）。**白话标准（2026-11-20 用户指令）：解释句内不出现未解释的技术名词（private/final/哈希/构造器等须同句译白），每点配一个生活类比；压缩术语不算白话（见修订十一）。**语言升级（2026-11-20 用户指令）：类比只用生活场景，不再借其他框架（NestJS/Babel/prisma 等）解释；解释用完整自然句，不用 ≈/→/= 等符号速记（见修订十三）。**学习范围（2026-11-20 用户指令）：文档与例子围绕 2026 年仍在使用的服务（✅/○ 优先）；⚠️ 转冷服务只作机制示例并显式标注；⛔ 停更服务只在全量清单/历史对照中出现并标停更日期（见修订十四）。****讲解方法（2026-11-20 用户指令）：每个知识点用『不用它怎么做 / 用了之后怎么做』对照讲——先给手工版代码或流程，再给框架版，列差异表（谁做/成本/出错点）；首例见 03§9.4 不用vs用（见修订十五）。**对照以图为主：代码不单独成段、只作图旁佐证，避免无场景代码造成迷惑（见修订十六）。**

## 进度总览（2026-11-20 修订十八）

| 块 | 条目 | ✅ | 🔶 | ⬜ |
|---|---:|---:|---:|---:|
| 前置A：Java 语言核心 | 7 | 0 | 2 | 5 |
| 前置B：并发与 JVM | 7 | 0 | 0 | 7 |
| Spring 全家桶（主轴） | 12 | 0 | 7 | 5 |
| MyBatis | 8 | 0 | 5 | 3 |
| 事务与 MySQL 索引 | 11 | 0 | 5 | 6 |
| 分布式基础 | 9 | 0 | 6 | 3 |
| MQ | 9 | 0 | 5 | 4 |
| Redis | 9 | 0 | 3 | 6 |
| **合计** | **72** | **0** | **33** | **39** |

> 现状判断：接触面广（32 项 🔶），但没有任何一项达到「能讲+能写+能排查」。**下一步不是扩大接触面，是把 🔶 转 ✅，且全部围绕 Spring Boot 主轴转。**
> 二次修订：① 确立 Spring Boot 主轴 + 双轨策略（工作 2.7 / 自写 3.x）；② 新增前置A 语言核心（6 条）、虚拟线程、Boot 3 差异、Web 工程三件套；③ 新增毕业项目「audit-server → Boot 3 移植」M1–M5；④ 工作向条目改注「迁移价值低但工作必需」。

## Node 存量映射（audit-server → Java）

> 别从零学。以下概念在 Node 侧已有**跑着的实现**，学 Java 对应物时先回忆「我当时怎么做的」，再看差异。

| audit-server 已有 | Java / infra 对应物 | 对应技能树条目 |
|---|---|---|
| NestJS Module / @Injectable 依赖注入 | Spring IoC / 自动装配 | Spring 块 |
| reflect-metadata @PMeta/@Assertion（手搓 TS 版注解 + 迷你 DI） | Java 注解 + 反射 | 前置A 反射与注解、IoC/AOP 原理 |
| Middleware / Interceptor / Guard | AOP / Filter / HandlerInterceptor | AOP、MVC 请求链、Security |
| BullMQ 重试+退避 + failed 死信告警 | MQ 生产确认 / ack / 死信队列（spring-kafka） | MQ 消息可靠性、积压与死信 |
| RateLimitLock 滑动窗口限流 | Redis + Lua 限流 / Sentinel | Redis pipeline/Lua |
| axios 无 timeout → 事件循环挂满级联 | Dubbo 超时/重试/check=false、连接池 | RPC 原理、前置B 连接池 |
| SIGTERM 优雅关闭 + /health 探针 | Boot actuator / readiness / K8s 探针 | 毕业项目 M1 |
| TypeORM ds.query / 连接池 | MyBatis / Druid | MyBatis 块、前置B 连接池 |
| vm 沙箱 + Proxy 膜（执行不可信代码） | #{} 预编译 vs ${} 注入 | MyBatis #{} vs ${} |
| 两阶段惰性执行（build 收集 → execute 求值） | Wrapper 构建 SQL → Executor 执行 | MyBatis-Plus Wrapper、毕业项目 M5 |
| 结构化日志 + 请求上下文 | MDC（ThreadLocal）+ traceId 透传 | 分布式追踪、前置B ThreadLocal |
| Jest / supertest 单测 | JUnit5 + Mockito + @SpringBootTest | 前置A 测试、Spring 测试切片 |

> **最大的范式差**：Node 单线程事件循环 → JVM 多线程 + 线程池 + ThreadLocal。Node 里上下文由异步链天然携带（AsyncLocalStorage），Java 里上下文绑在线程上，**换线程就丢**——这是 infra 多处易误判现象的共同根源（MDC 丢、切库栈丢、事务失效）。Java 21 虚拟线程是两种范式的汇合点，见前置B。

## 前置A：Java 语言核心（写 Java 的手感，在毕业项目里按需补）

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| ⬜ | 集合与 HashMap 原理 | 讲清数组+链表+红黑树、扩容与 hash 冲突；ConcurrentHashMap 与 HashMap 差异 | 日常最高频、面试必问；JS Map 对照 |
| ⬜ | 泛型与类型擦除 | 讲清擦除、? extends/super 通配符；读懂 infra 的泛型 Result/Page | S-Core 的 Result/Page；TS 泛型对照（擦除是最大差异） |
| 🔶 | 反射与注解 | 用反射写一个迷你 @PMeta：注解定义 + 扫描 + 元数据导出 | 读过大量 Java 注解；audit-server 手搓 reflect-metadata 版（**迁移最快的一条**，毕业项目 M5 直接验收） |
| ⬜ | Stream / Lambda / Optional | 把一段 for 循环聚合改写成 Stream；说出 Optional 的误用 | JS 数组方法同构；注意并行流与副作用 |
| ⬜ | Maven 与工程规范 | 讲清依赖仲裁/scope/BOM；读懂 infra 16 模块 pom；过一遍阿里 Java 开发手册 | 07-L0 模块分类；pnpm workspace 对照 |
| ⬜ | JUnit5 + Mockito | 写参数化测试 + mock 掉一个 Dubbo 依赖 | network-device-service 605 个 @Test 现成基建；NestJS Jest 经验 |
| 🔶 | 三阶段生成模型（编译/启动/运行时） | 任一「看不见」现象答出谁生成/哪个阶段/证据在哪；复述代理链与行→对象四步 | 首轮自检 3❌ 簇纠正；图廊§6 + [[框架认知 — 三阶段生成模型]] |

> 学法纪律：**不孤立刷语言题**。每条都在毕业项目或 infra 单测里遇到时补，补完立刻用。

## 前置B：Java 并发与 JVM（Node 转 Java 的地基）

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| ⬜ | 线程池模型 | 讲清 Tomcat 线程池 vs Node 事件循环；写 ThreadPoolExecutor demo 触发一次拒绝策略 | Node 单线程直觉是对照基线 |
| ⬜ | ThreadLocal 与异步丢失 | 复现 @Async/线程池里 MDC/切库上下文丢失，说出修复方案（装饰器/TransmittableThreadLocal） | 07-L6「为什么异步线程里会丢」；Node AsyncLocalStorage 对照（**快赢批**） |
| ⬜ | 锁与 CAS | 写一个并发丢更新的计数器，分别用 synchronized/Lock/原子类修好 | Redis 域锁已 🔶，对比线程级 vs 进程级 |
| ⬜ | CompletableFuture 异步编排 | 把串行出站调用改写成并行聚合 + 超时控制 | audit-server Promise.all / 惰性求值 |
| ⬜ | 连接池（Druid/HikariCP） | 讲清 maxActive/等待队列，复现一次连接耗尽报错 | infra 用 Druid；TypeORM 连接池对照 |
| ⬜ | JVM 内存与 GC 概览 | 讲清堆/栈/元空间，认出常见 OOM 类型；**不深入调优** | — |
| ⬜ | 虚拟线程（Java 21） | 讲清载体线程/pinning；对比 Node async 与传统线程池 | Node async 直觉是最佳入口；Boot 3.2+ 一行配置开启 |

> 范围纪律：本块目标是「够看懂框架行为」，不是 JVM 调优专家。**线程池 + ThreadLocal 两条是后面所有块的前置**，其余按需补。

## 一、Spring 全家桶（主轴）

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| 🔶 | IoC 容器与 Bean 生命周期 | 默画生命周期图，指出 AOP 代理在哪一步生成；**断点停在 BeanPostProcessor 验证一次** | 读过大量 @Configuration/@Bean（DataSourceConfig 等）；audit-server 手搓过迷你 DI |
| ⬜ | 循环依赖与三级缓存 | 讲清为什么三级、构造器注入为何无解 | —（面试向：Boot 2.6+ 默认禁止循环引用，知道即可别重投入） |
| 🔶 | AOP 原理（JDK 代理 vs CGLIB） | 能写 @Around + 讲清自调用失效原因，**亲手复现一次失效** | **已手写 @Timed 切面**；读过 StableDataBaseAspect；NestJS Interceptor 同构 |
| 🔶 | 自动装配与 starter | 手写一个生效的 starter + 讲清 Boot 3 的变化 | 31 个 starter，[[04-starter 是什么]]，07-L2 |
| 🔶 | Spring MVC 请求链 | 默画 DispatcherServlet 全链 + SseEmitter 异步位置 | 追过 AI 助手 controller→SSE 全链（agent/01） |
| 🔶 | Boot 启动过程 | 讲清 bootstrap 父容器→主容器→注册暴露的顺序 | [[05-服务是怎么启动的]]，实跑过 acl/dgw |
| 🔶 | @ConfigurationProperties/@RefreshScope | 讲清配置刷新时 Bean 怎么重建 | LlmPlatformProperties + Nacos 动态配置 |
| 🔶 | 事件机制 ApplicationEvent | 写一个事件驱动解耦的小例子 | InfluxdbTemplate 的 @EventListener；audit-server @OnWorkerEvent 同构 |
| ⬜ | Spring 测试切片 | 不启服务写 ApplicationContextRunner 自动装配测试 | 07-L2 已布置未做 |
| ⬜ | Spring Security 过滤链 | 讲清认证授权过滤器顺序 | infra 用自研 S-user-starter，可对比；NestJS Guard 对照 |
| ⬜ | Boot 3 vs 2.7 差异 | 讲清 jakarta 命名空间 / AutoConfiguration.imports / Java 17 基线；同一个 starter 在两轨各跑一次 | infra 是 2.7.17（工作轨）；毕业项目用 Boot 3（自写轨） |
| ⬜ | Web 工程三件套：校验/异常/响应 | @Validated + @RestControllerAdvice + 统一 Result，写一个完整 CRUD | 07-L7 ExceptionManager；audit-server main.ts 异常兜底 / NestJS Pipe 对照（毕业项目 M1 验收） |

## 二、MyBatis

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| ⬜ | 核心执行链 | 默画 SqlSession→Executor→StatementHandler→ResultSetHandler | — |
| ⬜ | #{} vs ${} 与 SQL 注入 | 讲清预编译，**在 infra 代码里找出真实 ${} 风险点** | [[12-设计模式、最佳实践与设计缺陷]] 已列 ${} 注入面；audit-server 沙箱加固是同一安全思维（**快赢，第一批**） |
| 🔶 | MyBatis-Plus BaseMapper/Wrapper | 手写条件查询 + 讲清 Wrapper 怎么变 SQL | [[03-POJO 与 DAO 层]]、[[09-Dao 与 Entity 设计]]；audit-server 两阶段惰性执行同构 |
| 🔶 | 两代 Mapper 风格（MBG vs MP）·工作向 | 看到 Mapper 立刻判断风格、知道去哪找 SQL | infra 实测 51 个 Example + 58 个 BaseMapper（公司特有、迁移价值低，**但工作必需**） |
| 🔶 | 多数据源路由 | 默画切库链 + 讲清 ThreadLocal 嵌套栈 | DynamicDataSource（13 行）+ AI 助手接线，07-L6；**前置：前置B ThreadLocal** |
| 🔶 | 插件机制 Interceptor | 讲清四大可拦截对象，写一个简单插件 | DataChangeLogInterceptor（数据审计） |
| 🔶 | 自定义 SQL 注入器/批量插入 ·工作向 | 讲清 mysqlInsertAllBatch 与 saveBatch 差异 | ExtLogicSqlInjector，[[09-Dao 与 Entity 设计]]（公司特有，工作必需、课外优先级低） |
| ⬜ | 一级/二级缓存 | 讲清为什么生产几乎不开二级缓存 | — |

## 三、事务与 MySQL 索引

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| 🔶 | ACID 与实现原理 | 讲清 redo/undo/MVCC 各保证哪个特性 | MySQL vs Prometheus 选型讨论 |
| ⬜ | @Transactional 失效场景 | 列举自调用/非 public/异常吞掉/rollbackFor 四类 + 代理原因，**复现自调用失效一次** | —（**快赢，第一批**；与 AOP 自调用失效同根） |
| ⬜ | 传播行为 | 讲清 REQUIRES_NEW 与 NESTED 的区别 | — |
| ⬜ | 隔离级别与锁 | 讲清 RR 下间隙锁如何防幻读 | — |
| 🔶 | 编程式事务 | 写一个「原子写多表」的准入式事务 | WebChatTurnAdmissionService（PG 事务建会话+写两条消息）；TypeORM queryRunner 对照 |
| 🔶 | 事务的分布式边界 | 讲清 @Transactional 为什么跨不了服务/库 | 工单链第⑦步事务写 3 表（07-L★） |
| 🔶 | 分布式事务方案 | 讲清 outbox/本地消息表，对比 TCC/Saga | [[10-指标上报链路]] outbox+幂等键 |
| 🔶 | select for update | 讲清悲观锁在准入里的作用 | findOwnedActiveForUpdate（会话准入） |
| ⬜ | B+ 树与联合索引 | 为工单表一条真实查询设计联合索引，讲清最左前缀/覆盖索引 | 本地 MySQL 333 张真实表（infra-mysql:13306） |
| ⬜ | EXPLAIN 与慢查询定位 | 在 infra 里找一条全表扫描 SQL 并优化，记录 EXPLAIN 前后对比 | 同上，容器已在跑 |
| ⬜ | 索引失效场景 | 复现函数包列/隐式类型转换/like '%x' 三类失效 | 同上 |

## 四、分布式基础（工作栈：Spring Cloud Alibaba + Dubbo，跟 07 课表节奏）

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| 🔶 | 注册/配置中心 Nacos | 讲清三级隔离 + bootstrap 加载 + AP 模型 | 本地部署+26 份配置导入，[[13-Nacos 面试题设计与评分卡]] |
| 🔶 | RPC 原理（Dubbo） | 默画代理→负载均衡→序列化→Filter 链 | 读过 @DubboService/Reference/三个 Filter，07-L4 未打卡；audit-server axios 级联教训是超时/重试的反面案例 |
| 🔶 | 分布式锁 | 讲清 tryLock+释放判断+误删防护 | 工单 Redis 域锁 + SingleFlightGuard |
| 🔶 | 幂等设计 | 设计一个幂等提交接口（唯一键/token/CAS/状态机） | MetricJson hash + outbox；AI 助手 81 处幂等引用 |
| 🔶 | 分布式追踪 | 默画 HTTP→Dubbo 的 traceId/spanId 流向 | [[08-日志治理]]，MDC+RpcContext；Node 侧 AsyncLocalStorage↔MDC 对照 |
| ⬜ | CAP/BASE | 讲清 Nacos(AP) vs ZooKeeper(CP) 的取舍 | — |
| 🔶 | 负载均衡与网关 | 讲清四层/七层差异与网关职责 | LVS mock 部署 + dgw 网关实跑；audit-server VIP+nginx 架构对照 |
| ⬜ | 分布式 ID（雪花/时钟回拨） | 讲清 workerId 分配与时钟回拨处理 | — |
| ⬜ | 分片与一致性哈希 | 讲清 Codis 分片思路 | 公司用 Codis，本地 Redis 替代 |

## 五、MQ

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| 🔶 | MQ 三大用途与代价 | 讲清异步/解耦/削峰，以及何时**不该**用 MQ | AI 助手文档说 RabbitMQ 代码实为线程池（agent/04）；audit-server BullMQ 是正面案例 |
| 🔶 | 轮询 vs MQ 量化选型 | 用到达率算空转率/积压（λ×间隔）；说出延迟/速率/拓扑三个独立触发器 | [[异步选型 — 轮询 vs MQ]] + 选型决策图；audit-server 60/s 对照（2026-11-19 已讨论，待代码验证） |
| 🔶 | Kafka 架构 | 讲清 partition 为什么决定并行上限、offset 语义 | [[11-数据存储与分层]] 使用率 Kafka→StarRocks 流 |
| ⬜ | RabbitMQ vs Kafka 选型 | 讲清路由模型 vs 日志模型的差异 | — |
| 🔶 | 消息可靠性 | 设计不丢链路：生产确认+持久化+手动 ack | **audit-server BullMQ 重试+退避已实现（Node 侧）**；Java 侧 confirm/ack 未验证 |
| ⬜ | 顺序消息 | 讲清全局有序 vs 分区有序的代价 | — |
| 🔶 | 积压与死信 | 给出积压排查与死信处理方案 | **audit-server 死信告警方案 + worker 限速 max 60/s**（稳定性手册③，Node 侧） |
| ⬜ | 事务消息 vs 本地消息表 | 对比 RocketMQ 半消息与 outbox | 已有 outbox 基础（事务块） |
| ⬜ | 动手：本地 Kafka 收发 | Podman 起 Kafka，spring-kafka 跑通 producer/consumer | S-kafka-starter 现成代码；Podman 已熟练（毕业项目 M4） |

## 六、Redis

| 状态 | 知识点 | 验收标准 | 已有抓手 |
|---|---|---|---|
| 🔶 | 五大数据结构与选型 | 给场景选对结构（String/Hash/List/Set/ZSet） | 见过热状态/锁用法；audit-server Redis 限流/缓存在用；命令未系统学 |
| ⬜ | 持久化 RDB/AOF | 讲清两者取舍与混合持久化 | — |
| ⬜ | 过期与淘汰策略 | 讲清 allkeys-lru vs volatile-lru 等 | — |
| ⬜ | 单线程模型 | 讲清为什么快、6.0 多线程 IO 改了什么 | **Node 事件循环是现成直觉，这条应该学得最快** |
| ⬜ | 缓存穿透/击穿/雪崩 | 各给一个解法并讲清区别 | — |
| ⬜ | 缓存与 DB 一致性 | 讲清延迟双删/Canal，为什么做不到强一致 | — |
| ⬜ | pipeline/Lua/事务 | 讲清 Lua 的原子性边界，**用 Lua 重写一遍滑动窗口限流** | audit-server RateLimitLock（Node 侧实现；毕业项目 M3） |
| 🔶 | 主从/哨兵/Cluster | 讲清 slot 分片，对比 Codis | 公司 Codis，本地单机 infra-redis:8003 |
| 🔶 | 动手：redis-cli 排查 | 跟工单链观察 key 变化，会用 CLI 查问题 | infra-redis 在跑，命令未练 |

## 主线实战：audit-server → Spring Boot 3 移植（毕业项目）

> **为什么移植而不是新造项目**：领域你已吃透（规则引擎/稳定性/限流全在脑子里），认知负担可以 100% 留给 Java 和 Spring。这是 Node 转 Java 最快的路，也是「Java 为主」最硬的证据——一个能跑、有测试、能讲清每个注解为什么存在的 Java 作品。
> **范围纪律**：简化版移植，不是 1:1 重写。每个 M 的验收 = 可跑 + 测试 + 不看笔记讲清机制。

| 里程碑 | 内容 | 钉死的技能树条目 |
|---|---|---|
| M1 骨架（第 2 周） | Boot 3 + Java 17：actuator /health、优雅关闭、统一异常/响应/校验、logback+MDC | Web 三件套、Boot 启动、MDC；audit-server 稳定性方案直接迁移 |
| M2 数据层 | MyBatis-Plus + Druid + MySQL（工单表结构子集）；@Transactional 准入事务 + 失效复现 | MyBatis 块、事务块、连接池、索引（EXPLAIN 真实表） |
| M3 Redis | RedisTemplate + **Lua 重写 RateLimitLock 滑动窗口**；缓存三件套各写一个防御 | Redis Lua/数据结构/缓存三件套 |
| M4 异步 | Podman 起 Kafka，spring-kafka 移植 BullMQ worker（重试/退避/死信告警）；CompletableFuture 并行出站 | MQ 可靠性/死信、线程池、ThreadLocal 丢失复现 |
| M5 规则引擎（毕业验收） | Java 注解 + 反射移植简化版 @PMeta/@Assertion（3 个算子 + 一条惰性链），注册进 Spring 容器 | 反射与注解、IoC/AOP、两阶段执行——audit-server 含金量最高的部分变成 Java 作品 |

## 当前优先级（2026-11-19 二次修订，Spring Boot 主轴）

0. **快赢批（本周内，每条 ≤ 半天）**：`#{} vs ${}` 找注入点、`@Transactional` 自调用失效复现、ThreadLocal 异步丢失复现。三个实验全是 Spring 机制（代理+线程绑定），直接服务主轴。
1. **毕业项目 M1 骨架（第 2 周起）**：Boot 3 + Java 17 跑起来。前置A 语言核心（集合/泛型/Stream/Maven/JUnit）**在写 M1 时按需补**，不孤立学。
2. **Spring 主轴深化**：Bean 生命周期断点验证、AOP 失效复现、手写 starter（07-L2）、测试切片、Boot 3 vs 2.7 双轨对照——这是 Java 开发的核心身份。
3. **M2 事务 + 索引**：@Transactional/传播行为/MVCC + 333 张真实表练 EXPLAIN。
4. **M3 Redis**：Lua 移植 RateLimitLock（一个作品钉死三条知识点）。
5. **M4 MQ + 并发**：Kafka 收发 + CompletableFuture + 虚拟线程初体验。
6. **M5 规则引擎移植 = 毕业验收**。分布式块（Nacos/Dubbo）跟工作节奏走 07-L3/L4，不抢跑。

> 工作侧并行建议：在 infra 里找第一个 Java 产出——给 network-device-service 补一个单测（605 个 @Test 的现成基建，风险最低），或修一个小 bug。**「Java 为主」从第一个被合并的 Java PR 开始，不是从学完开始。**

## 六大块之外的进行中（不计入上表）

| 主题 | 状态 | 证据 |
|---|---|---|
| Podman/容器化 | 实操中 | MySQL/Nacos/Redis/Grafana 全栈部署，网络 DNS 坑已踩；毕业项目 M4 起 Kafka 复用 |
| 可观测性 | 入门 | Grafana 中文面板+MySQL 数据源；Prometheus/Micrometer 链路待建；M1 的 actuator 是起点 |
| AI 工程 | 深读中 | agent/00-06 代码考证系列；工单提交链路追踪待完成 |
| Node 项目 audit-server | 稳定性改进中 + 移植源 | timeout/health/死信三项（server/ 稳定性手册）；规则引擎 DSL 已读透，M5 移植蓝本 |

## 配图速览（总索引 [[图廊 · archify 图集]]）

**工单 12 步全链路**（[[gongdan-chain.html|交互版]]）
![[gongdan-chain.png]]

**工单状态机**（[[gongdan-state.html|交互版]]）
![[gongdan-state.png]]

**infra 异步方式光谱**（[[async-spectrum.html|交互版]]）
![[async-spectrum.png]]

**轮询 vs MQ 选型决策**（[[poll-vs-mq.html|交互版]]）
![[poll-vs-mq.png]]

**一条条件查询 ✅ 最佳实践**（[[bestpractice-query.html|交互版]]）
![[bestpractice-query.png]]

## 更新日志

| 日期 | 变更 |
|---|---|
| 2026-11-18 | 初版：6 块 52 条。28 条 🔶 均附代码/部署证据；✅ 为 0（从严标准）。依据：infra 本地化、AI 助手代码考证、Grafana 部署、@Timed 切面等学习记录 |
| 2026-11-19 | 修订一：新增块零（Java 并发/JVM，6 条）与 MySQL 索引（3 条）；MQ 消息可靠性/积压死信按 audit-server BullMQ 实践升 🔶；新增「Node 存量映射」表；✅ 须附产出物、验收取向改为复现/排查优先；标注工作向条目与快赢批 |
| 2026-11-19 | 修订二（目标明确：Java 为主、Spring Boot 主轴）：块零拆为前置A 语言核心（6 条，反射与注解按 audit-server 手搓经验升 🔶）+ 前置B 并发与 JVM（+虚拟线程）；Spring 块 +2（Boot 3 差异、Web 工程三件套）成主轴；确立双轨策略（工作 2.7 / 自写 3.x）；新增毕业项目 audit-server→Boot 3 移植 M1–M5；优先级按主轴重排。合计 70 条：31 🔶 / 39 ⬜ |
| 2026-11-19 | 修订三：确立表达纪律（图先于文、数字先于形容、减少文字）；产出首批 archify 图：工单 12 步时序图、工单状态机 lifecycle 图（存 podman/.archify/） |
| 2026-11-19 | 修订四：MQ 块 +1「轮询 vs MQ 量化选型」🔶（三独立触发器：延迟/速率/拓扑；λ×间隔判据；空转率泊松近似）；新增笔记 [[异步选型 — 轮询 vs MQ]]（server/）+ 异步方式光谱图、选型决策图。合计 71 条：32 🔶 / 39 ⬜ |
| 2026-11-19 | 修订五：立场收敛——学项目不审项目：infra 11 篇挑毛病表述改写（12 改「设计取舍与年代背景」）、03/07 点名处修正、工单链图卡片同步「两个当年设计」；⚠️ 语义改为机制易误判点。条目数不变 71 |
| 2026-11-19 | 修订六：三层标注体系——📌 项目事实 / ⚠️ 机制易误判点 / ✅ 最佳实践规范（重点标正确规范+现代替代）；历史约定不当规范教，符合官方默认的写明（如 MBG model/Example 同包）。条目数不变 71 |
| 2026-11-19 | 修订七：✅ 最佳实践具体实例图 +1：一条条件查询的现代规范实现（Query DTO→LambdaQueryWrapper→BaseMapper 分页→VO，12 步），与老 Example 同题对照；图廊§5、03✅行挂链接。条目数不变 71 |
| 2026-11-19 | 修订八：收敛语义澄清——图收敛 = 文件单目录 + 图廊总索引；**笔记在知识点就地内联嵌图**（03 嵌 bestpractice、07-L★ 嵌链+状态机、异步选型嵌决策+光谱、技能树配图速览恢复 5 图）。条目数不变 71 |
| 2026-11-19 | 修订九：思路级优化——前置A 新增「三阶段生成模型」🔶（编译/启动/运行时，统一 Lombok/代理/反射三错误簇）；新笔记 [[框架认知 — 三阶段生成模型]] + architecture 图图廊§6；03§八挂链接。合计 72 项：33 🔶 / 39 ⬜ |
| 2026-11-19 | 修订十：故事版图 +1（一行 selectById(1) 穿三阶段、三个「不可能」+ Node 类比表），认知笔记§0 置顶「懵先读故事」，全景图降为查阅；图廊§7。条目数不变 72 |
| 2026-11-20 | 修订十一：白话标准入纪律（句内无未解释名词 + 生活类比）；03§9.2 六注解表重写为白话+生活类比版。条目数不变 72 |
| 2026-11-20 | 修订十二：@Autowired 故事图 +1（仓库/装零件/排班表，实测 16 个 CvmEvent 实现 + @PostConstruct≈onModuleInit），03§9.4 白话版+嵌图；图廊§8。条目数不变 72 |
| 2026-11-20 | 修订十三：语言升级——类比只用生活场景（不再借 NestJS/Babel/prisma），完整自然句、禁符号速记；autowired 图与 selectbyid 故事图注释/卡片、03§9.2 表与§9.4、认知笔记按新标准重写。条目数不变 72 |
| 2026-11-20 | 修订十四：学习范围入纪律（围绕 2026 仍在使用的服务）；旧服务文档审计（07 新增审计表）：无 ⛔ 主例；02/00 加存活覆盖层、09 扫描例换 server-ops、01/09/12 mailsend 例加 📌、12§2.1 主例换 dns-order（cvm 降历史对照，用户确认）、03§9.4 加存活标注 + dns-order 活对照。条目数不变 72 |
| 2026-11-20 | 修订十五：讲解方法入纪律（不用它怎么做 / 用了之后怎么做 对照 + 差异表）；03§9.4 新增 @Autowired 手工版 vs 框架版对照（含 @Reference Dubbo 依赖实测）。条目数不变 72 |
| 2026-11-20 | 修订十六：对照改图为主——03§9.4 两段手工/框架代码换成对照图 autowired-contrast（左手工/右Spring）；图廊§9；纪律补「代码只作图旁佐证」。条目数不变 72 |
| 2026-11-20 | 修订十七：删教学笔记里的存活元说明与停更服务示例——03§9.4 存活交叉表/段、02 点名覆盖层、00 停更名、09/01/12 mailsend 停更包例、07 审计元表均删；存活分级只留 07 功能性跳过清单。条目数不变 72 |
| 2026-11-20 | 修订十八：全库耐用性+可读性审计 22 篇（04 亲修 9 处 + 四组约 330 处）——删笔记自身元信息/一次性链例/坏引用、prose 符号速记自然化、未解释名词同句译白、补生活类比、密集段拆短；三层标注/图/教学代码/机制计数全保留。条目数不变 72 |

## 相关笔记

- [[07-技术TODO]]（infra 阅读课表） · [[00-总览与学习地图]] · [[10-指标上报链路]] · [[11-数据存储与分层]]
- [[audit-server 稳定性改进手册]] · [[audit-server 规则引擎解读 — 自研 DSL 解释器]] · [[服务器稳定性 — 超时、水位、探针与流量调度]] · [[异步选型 — 轮询 vs MQ]] · [[图廊 · archify 图集]]