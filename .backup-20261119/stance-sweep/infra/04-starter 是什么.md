# 04 · starter 是什么：拆开一个真的给你看

> 🧭 **阅读顺序 04 / 14** ｜ ⬅️ [[03-POJO 与 DAO 层]] ｜ ➡️ [[05-服务是怎么启动的]]

> `S-starter/` 下 31 个模块，名字都长成 `S-xxx-starter`。这个词在 [[01-术语表]] 里解释过一句
> "库自带的安装说明书"，但不够——**这个东西不拆开看是理解不了的**。
>
> 本文把本仓库**最小的一个 starter（`S-job-starter`，3 个 java 文件 96 行）完整拆开**，
> 逐文件给你看。看完你就知道它为什么存在。

## 🎯 要点

1. **starter 不是新框架，就是一个普通的 jar**，只不过它里面多了两样东西：
   **一个 `spring.factories` 声明** + **一个 `@Configuration` 类**。有了这两样，Spring Boot 启动时会**自动**读它、执行它。
2. **它的价值在"让别人少写代码"**：`S-job-starter` 被 **20+ 个服务**依赖，
   每个服务只在 pom 里写一行，就获得了 xxl-job 执行器的完整装配——**这行配置没人再抄第二遍**。
3. **starter 只提供"能力"，不提供"业务"**：starter 建**执行器**（连调度中心），
   服务写**任务本身**（`@JobHandler`）。⚠️ 本项目 `JobAutoConfig` 上写着`@Profile({"test","prod","prodhnd","canoe","pretest"})`——**没有 dev**，这是个坑。

> 📖 术语见 [[01-术语表]] · 启动时序见 [[05-服务是怎么启动的]] · 入门概念见 [[03-POJO 与 DAO 层]]

---

## 一、先用一个反例说清它解决什么问题

### 假设没有 starter，你要在每个服务里这么干

要在 20 个服务里接入 xxl-job（一个分布式任务调度框架），每个服务都得：

```java
// ❌ 没有 starter 的世界：这段代码要在 20 个服务里各写一遍
@Configuration
public class XxlJobConfig {
    @Value("${xxl.job.adminAddresses}") private String adminAddresses;
    @Value("${xxl.job.accessToken}")    private String accessToken;
    @Value("${xxl.job.executor.appName}") private String appName;
    // ... 还有 5 个 @Value

    @Bean(initMethod = "start", destroyMethod = "destroy")
    public XxlJobSpringExecutor xxlJobExecutor() {
        XxlJobSpringExecutor e = new XxlJobSpringExecutor();
        e.setAdminAddresses(adminAddresses);
        e.setAccessToken(accessToken);
        e.setIp(IpUtil.getIp());
        e.setPort(PortUtil.checkPort(port, 9000, 9100));   // 还要自己找空闲端口
        // ... 还有 4 行 setter
        return e;
    }
}
```

**后果**：
- 20 个服务 = 20 份几乎相同的代码，**升级 xxl-job 版本要改 20 处**
- 有人漏了 `e.setLogPath(...)`，只有他的服务任务日志不落盘，**排查半天**
- 新人接手，得先把这 50 行读懂才能改业务

### 有 starter 之后

```xml
<!-- ✅ 有 starter 的世界：服务侧只写这一行 -->
<dependency>
    <groupId>com.didi</groupId>
    <artifactId>S-job-starter</artifactId>
</dependency>
```

**那 50 行代码还在，但它只存在于一个地方**——`S-job-starter` 里。想改端口范围？改 starter 一处，20 个服务下次构建全部生效。

🔑 **这就是 starter 的全部意义：把「所有服务都要写的那段装配代码」收进一个 jar，让使用者只写一行依赖。**

---

## 二、starter 的"三个零件"

任何一个 starter 都由三部分组成（记住这个结构，你就能自己写）：

```
┌──────────────────────────────────────────────────────┐
│  零件①  pom.xml                                      │
│    把「这个能力依赖哪些库」写进来                      │
│    例：S-job-starter 依赖 xxl-job-core               │
│    → 使用者不用自己加 xxl-job 依赖                    │
├──────────────────────────────────────────────────────┤
│  零件②  META-INF/spring.factories                    │
│    一行声明：「我的装配类叫 XXX」                      │
│    → Spring Boot 启动时会读所有 jar 的这个文件         │
├──────────────────────────────────────────────────────┤
│  零件③  XxxAutoConfig.java（@Configuration）         │
│    真正 new 对象、建 bean 的地方                       │
│    + XxxProperties.java（@ConfigurationProperties）  │
│      把 application.properties 里的配置项变成 Java 字段│
└──────────────────────────────────────────────────────┘
```

⚠️ **零件②是关键**：没有 `spring.factories`，Spring Boot **根本不知道**你 jar 里有个装配类，零件③永远不会被执行。这就是"普通 jar"和"starter"的**唯一区别**。

---

## 三、完整拆开 `S-job-starter`（就 5 个文件）

### 3.0 文件清单——一个 starter 的全部家当

```
S-starter/S-job-starter/
├── pom.xml                                        ← 零件①（带依赖）
└── src/main/
    ├── resources/META-INF/spring.factories        ← 零件②（1 行声明）
    └── java/com/didi/
        ├── JobAutoConfig.java            50 行    ← 零件③（建 executor bean）
        ├── JobConfigProperties.java      28 行    ← 配置映射
        └── JobExecutorProperties.java    18 行    ← 嵌套配置
```

📌 **总共 96 行 java**。starter 通常就这么小——它不写业务，只写装配。

### 3.1 零件① `pom.xml`：帮使用者"带依赖"

```xml
<parent>
    <artifactId>S-starter</artifactId>       <!-- 挂在 S-starter 下 -->
    <groupId>com.didi</groupId>
</parent>

<artifactId>S-job-starter</artifactId>

<dependencies>
    <dependency>
        <groupId>com.xuxueli</groupId>
        <artifactId>xxl-job-core</artifactId>     <!-- ★ 关键：它把依赖也带上了 -->
        <version>${xxl-job-core.version}</version>
    </dependency>
</dependencies>
```

🔑 **注意那个 `xxl-job-core`**：这是 starter 的"隐藏价值"—— **使用者不用知道 xxl-job 的存在，也不用关心它是什么版本**。版本从父 pom 的 `${xxl-job-core.version}` 来，全项目统一。

> 这也是为什么 starter 项目里 `<dependencies>` 通常写成"这个能力需要的一切"，
> 而不是"我自己需要什么"。**它是给使用者的菜单，不是给自己用的。**

### 3.2 零件② `spring.factories`：就一行

```
org.springframework.boot.autoconfigure.EnableAutoConfiguration=com.didi.JobAutoConfig
```

拆开读这句话：

| 部分 | 意思 |
|---|---|
| `org.springframework.boot.autoconfigure.EnableAutoConfiguration` | 固定的"键"——告诉 Spring Boot："我是**自动配置**类" |
| `=` | 分隔 |
| `com.didi.JobAutoConfig` | "值"——我那个装配类的**全限定名** |

🔑 **Spring Boot 启动时会做这件事**：把所有 jar 里的 `spring.factories` 都读一遍，把 `EnableAutoConfiguration=` 后面的类**收集起来，逐个注册成 bean 定义**。

⚠️ 这个文件**路径和文件名都不能变**（必须是 `src/main/resources/META-INF/spring.factories`），改了就等于不存在。

> 📌 Spring Boot 2.7 还支持新写法 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
> （一行一个类名）。本项目用的是老写法。

### 3.3 零件③-a `JobConfigProperties`：把配置项变成 Java 字段

```java
@Component
@Setter @Getter
@ConditionalOnProperty(value = JobConfigProperties.enable, matchIfMissing = true)   // ①
@ConfigurationProperties(prefix = "xxl.job")                                        // ②
public class JobConfigProperties {
    public static final String enable = "task.enable";

    private String adminAddresses;        // ↔ xxl.job.admin-addresses
    private String accessToken;           // ↔ xxl.job.access-token

    @NestedConfigurationProperty
    private JobExecutorProperties executor;   // ③ 嵌套：xxl.job.executor.*
}
```

| 标注 | 意思 |
|---|---|
| ② `@ConfigurationProperties(prefix="xxl.job")` | **这就是魔法所在**：配置文件里 `xxl.job.` 开头的项，**自动**映射到本类字段。驼峰对连字符：`adminAddresses` ↔ `admin-addresses` |
| ① `@ConditionalOnProperty("task.enable", matchIfMissing=true)` | 开关：配了 `task.enable=false` 就不生效；**没配也算生效**（`matchIfMissing`） |
| ③ `@NestedConfigurationProperty` | 支持嵌套前缀，`JobExecutorProperties` 里的 `port` 对应 `xxl.job.executor.port` |

对照 Nacos 里的真实配置（`tasktimer.properties`）：

```properties
xxl.job.adminAddresses=http://10.78.128.115:8087/xxl-job-admin         → adminAddresses
xxl.job.executor.appName=xxx                                          → executor.appName
```

🔑 **所以 `@ConfigurationProperties` 的作用是：省掉 7 个 `@Value`，并且让配置项有类型、可校验。**

### 3.4 零件③-b `JobExecutorProperties`：纯 POJO（18 行）

```java
@Setter @Getter
public class JobExecutorProperties {
    private String appName;
    private String ip;
    private int port;
    private String logPath;
    private int logRetentionDays;
}
```

**这就是个 POJO**（见 [[03-POJO 与 DAO 层]] §二）——只有字段和 getter/setter，它的职责是"**装 `xxl.job.executor.*` 这几项配置**"。

### 3.5 零件③-c `JobAutoConfig`：真正干活的地方（50 行）

```java
@Component
@Slf4j
@ConditionalOnBean({IJobHandler.class, JobConfigProperties.class})          // ★ 见 §六
@Profile({"test", "prod", "prodhnd", "canoe", "pretest"})                   // ★ 没有 dev！
public class JobAutoConfig {

    @Bean(initMethod = "start", destroyMethod = "destroy")                  // ★ 生命周期
    public XxlJobSpringExecutor xxlJobExecutor(JobConfigProperties props) {
        log.info(">>>>>>>>>>> xxl-job config init.");
        XxlJobSpringExecutor e = new XxlJobSpringExecutor();
        e.setAdminAddresses(props.getAdminAddresses());                     // 调度中心地址
        e.setAppName(props.getExecutor().getAppName());                     // 我是谁
        e.setIp(IpUtil.getIp());                                           // 自动取本机 IP
        e.setPort(PortUtil.checkPort(props.getExecutor().getPort(), 9000, 9100));  // 自动找空闲端口
        e.setAccessToken(props.getAccessToken());
        e.setLogPath(checkFileDir(props.getExecutor().getLogPath()));       // 目录不存在就建
        e.setLogRetentionDays(props.getExecutor().getLogRetentionDays());
        return e;
    }
}
```

这一小段里藏了四个"值得学"的设计：

| 设计 | 好处 |
|---|---|
| `IpUtil.getIp()` | **不让使用者手填 IP**——填错是必然的 |
| `PortUtil.checkPort(port, 9000, 9100)` | 在指定区间**自动找一个空闲端口**——避免端口冲突 |
| `checkFileDir(...)` 里 `mkdirs()` | **自动建日志目录**——省一次"线上发现目录不存在"的事故 |
| `@Bean(initMethod="start", destroyMethod="destroy")` | 让 Spring 在**启动时调 start()、关闭时调 destroy()**——不用写 `@PostConstruct` |

🔑 **一句话总结这段代码**：它把"接入一个调度框架"需要的 7 个步骤，**固化成了一段没人能写错的代码**。

---

## 四、启动时 Spring Boot 到底怎么"发现"它

把 [[05-服务是怎么启动的]] 的时序放大到 starter 这一层：

```
服务启动
  │
  ├─ ① 扫描 classpath 上所有 jar
  │     找出每个 jar 里的 META-INF/spring.factories
  │     → 对 S-job-starter 来说，读到：
  │        EnableAutoConfiguration = com.didi.JobAutoConfig
  │
  ├─ ② 把这些类收集成"自动配置候选清单"
  │     （本项目 31 个 starter 都会往里贡献）
  │
  ├─ ③ 逐个评估条件注解（@Conditional*）
  │     JobAutoConfig 要过三关：
  │       @ConditionalOnBean(IJobHandler)  → 这个服务有任务类吗？
  │       @ConditionalOnProperty(task.enable, matchIfMissing=true) → 开关开了吗？
  │       @Profile({test,prod,...})       → 当前环境在名单里吗？
  │     三关都过 → 注册 JobAutoConfig 这个 bean
  │
  └─ ④ 实例化它，执行 xxlJobExecutor() 方法
        → new XxlJobSpringExecutor(...)  → 连调度中心
        → 这个 bean 被放进容器，其他代码可以 @Autowired 它
```

🔑 **注意第 ③ 步**：**条件不满足就静默跳过，不报错**。所以"引了依赖但什么也没发生"是**正常现象**，不是 bug。

---

## 五、服务侧怎么用：责任分得很清楚

### 5.1 服务只写一行

```xml
<!-- S-ServicesNet/S-dgw-service/pom.xml -->
<dependency>
    <groupId>com.didi</groupId>
    <artifactId>S-job-starter</artifactId>
</dependency>
```

### 5.2 服务写自己的任务

✅ 实测 `dgw` 里有 5 个任务类，长这样：

```java
@JobHandler(value = "loadBalanceDsiSyncJobHandler")       // ← 调度中心按这个名字触发
public class LoadBalanceDsiSyncJobHandler extends IJobHandler {
    @Override
    public ReturnT<String> execute(String param) throws Exception {
        // 真正的业务逻辑：同步 DSI 数据
    }
}
```

### 5.3 责任分工表（这是理解 starter 的关键）

| | starter 提供 | 服务提供 |
|---|---|---|
| **是什么** | 执行器（executor）：连调度中心、上报心跳、找端口、管日志目录 | 任务（handler）：`@JobHandler` 标的那段业务 |
| **代码在哪** | `S-starter/S-job-starter`（96 行，**全项目一份**） | 各服务的 `*JobHandler.java` |
| **改它影响谁** | 所有依赖它的 20+ 个服务 | 只有这个服务 |
| **谁负责** | 基础架构/中间件团队 | 业务团队 |

🔑 **判断一个 starter 好不好，就看这张表**：如果 starter 里出现了"某个服务的业务逻辑"，那是**放错地方了**。

---

## 六、三个条件注解逐个拆（这里有个真坑）

`JobAutoConfig` 头上的三行注解，每一行都在回答一个"要不要启用"的问题：

### 6.1 `@ConditionalOnBean({IJobHandler.class, JobConfigProperties.class})`

**意思**：容器里**存在** `IJobHandler` 的实现类 + 配置类，才注册我。

**为什么这么设计**：🔑 **这是整个 starter 最聪明的一处**—— 有些服务引了 `S-job-starter` 但**一个任务都没写**（只是别的公共模块带了它）。如果没有这个条件，那些服务也会启动执行器、去连调度中心、**然后因为连不上而报错**。

有了它：**没写任务 → 不建执行器 → 不会有任何副作用**。

### 6.2 `@ConditionalOnProperty(value = "task.enable", matchIfMissing = true)`

**意思**：`task.enable=false` 就整体关掉；**没配置时默认开启**（`matchIfMissing`）。

**为什么这么设计**：给一个**不用改代码的开关**——线上出问题，改配置就能停掉整个调度接入。

### 6.3 ⚠️ `@Profile({"test", "prod", "prodhnd", "canoe", "pretest"})` —— **名单里没有 dev**

**意思**：当前 profile 不在这个名单里，`JobAutoConfig` **完全不会生效**。

📌 本项目 6 个 profile 是 `dev / test / prod / prodhnd / clouddnsprod / clouddnsdev`。**`dev` 不在名单里**，所以如果用 `-P dev` 编译，xxl-job 执行器**永远不会创建**。

**这条直接影响你本地调试**——本地编译默认走 `test` profile（`activeByDefault=true`，见 [[05-服务是怎么启动的]] §三），而 `test` **在** `@Profile` 名单里 ✓，`acl` 里又确实有 1 个 `IJobHandler` ✓，所以**那个执行器在本地会被真的创建出来**。

### 一个常见担心：这会"启动报错"吗？实测证明**不会**

以下是本机 `acl` 的真实启动日志（`target/logs/start.out`，✅ 原文摘录）：

```log
11:10:01.823  com.didi.JobAutoConfig   : >>>>>>>>>>> xxl-job config init.        ← starter 生效了
11:10:02.193  XxlJobExecutor           : register jobhandler success, name:aclExpireHandler
11:10:03.051  xxl-rpc remoting server  : start success, port = 9094               ← 执行器自己占了 9094
11:10:05.602  TomcatWebServer          : Tomcat started on port(s): 8074
11:10:11.217  AclApplication           : Started AclApplication in 18.809 seconds  ← ★ 启动成功！
11:10:33.186  XxlRpcReferenceBean      : xxl-rpc, invoke error, address:http://10.78.128.115:8087/...
11:11:33.195  XxlRpcReferenceBean      : xxl-rpc, invoke error, ...               ← 60 秒后又来一次
```

📌 **实测数据**（跑了 6 小时）：

| 项 | 实测值 |
|---|---|
| 启动结果 | ✅ **成功**，`Started AclApplication in 18.809 seconds` |
| 执行器端口 | `9094`（`PortUtil.checkPort(port, 9000, 9100)` 自动找的空闲端口） |
| 任务注册 | ✅ `aclExpireHandler` 注册成功 |
| 连调度中心 | ❌ 超时（`10.78.128.115:8087` 是内网地址） |
| 重试行为 | **每约 60 秒一次，永不停止** |
| 重试次数 | **337 次**（6 小时内） |
| 日志体积 | **25 MB** —— 全是这个重试的堆栈 |

🔑 **所以准确的说法是**：`xxl-job` 地址不可达**不会让服务启动失败**，它表现为**每 60 秒一条错误日志，把日志文件撑到几十 MB**。这比"启动失败"更隐蔽——服务看着一切正常，只是日志在无声地膨胀。

⚠️ 顺带一个容易被误判的细节：日志里 `xxl.job.executor.logpath=/home/data/logs/jobhandler`是**Linux 路径**，在 macOS 上创建会失败，但 `mkdirs()` 只是返回 `false` 不抛异常，所以**也不会报错**——安静地按原样用。

**想让它安静**（三种正解，按推荐度）：
1. 本地 Nacos 里把 `task.enable` 设为 `false` ← 不用改代码，最干净
2. 把 `xxl.job.adminAddresses` 指向一个本地 mock
3. 用 `-P dev` 编译（`dev` 不在 `@Profile` 名单里，执行器根本不会创建）

> ⚠️ 顺便记一个反直觉点：**"内网地址硬编码在配置里"和"starter 的设计"是两件事**。
> starter 没问题，硬编码地址是配置管理的问题（见 [[12-设计模式、最佳实践与设计缺陷]] §4.11）。

---

## 七、starter vs 普通 jar vs 复制粘贴

| | 普通 jar（如 `S-Entity`） | **starter** | 复制粘贴 |
|---|---|---|---|
| 有没有 `spring.factories` | 无 | **有** | — |
| 引入了要做什么 | 用它提供的类（`new`、`@Autowired`） | **什么都不用做，自动装配好** | — |
| 使用者要写的代码 | 调用代码 | **一行 pom** | 50 行配置 ×20 处 |
| 升级时改几处 | 一处 | **一处** | 20 处 |
| 命名习惯 | `S-Entity` | **`S-xxx-starter`** | — |

🔑 **判别法**：
- `S-Entity`、`S-Dao`、`S-Core` → **普通库**，你要主动用它（`import` 它的类）
- `S-job-starter`、`S-datasource-stable-starter` → **starter**，它主动装配好一切，你只写业务

---

## 八、本项目 31 个 starter 的分类

📌 实测 `S-starter/` 下 31 个模块，按用途分四类：

| 类别 | starter | 干什么 |
|---|---|---|
| **数据源**（6） | `S-datasource`、`-intra-`、`-stable-`、`-stable-r-`、`-base-`、`-it-` | 按域装配 Druid + MyBatis（见 [[09-Dao 与 Entity 设计]]） |
| **中间件**（10） | `S-kafka-`、`S-redis-`、`S-ddmq-`、`S-ddmq-starter-v2`、`S-elasticsearch-`、`S-influxdb-`、`S-job-`、`S-local-task-`、`S-metrics-`、`S-vm-` | 各种外部依赖的接入 |
| **框架能力**（9） | `S-dubbo-`、`S-http-`、`S-log-`、`S-pii-`、`S-exception-reslove-`、`S-process-`、`S-message-channel-`、`S-operation-view-`、`S-out-` | 日志/加密/RPC/异常处理等横切能力 |
| **业务集成**（6） | `S-cmp-`、`S-cmp-api-`、`S-user-`、`S-gift-`、`S-melos-`、`S-yt-` | 对内部平台（CMP/用户/礼品/YT）的封装 |

> 📌 注意 `S-exception-reslove-starter` 是项目自带的拼写错误（应 `resolve`），
> 同类的还有 `insetCount`（应 `insertCount`）——**看代码时别以为是自己眼花**。

---

## 九、为什么 `S-datasource` 故意**没有** `spring.factories`

这是个绝好的反例，能验证你上面学的：

| | 骨架 `S-datasource` | 按域 `S-datasource-stable-starter` 等 5 个 |
|---|---|---|
| 有没有 `spring.factories` | **❌ 没有** | ✅ 有 |
| 结果 | **不会**被自动装配，靠主应用的**组件扫描**生效 | **会**被自动装配 |
| 为什么这么设计 | 它里面是**路由骨架/注入器/审计**——属于"基础设施"，应由主应用显式控制何时生效 | 每个域要独立开关，必须能被 `@ConditionalOnBean` 单独判断 |

🔑 **这个对比证明了一件事**：`spring.factories` 不是"starter 必须有"的装饰，而是**一个明确的设计选择**——**要不要让 Spring Boot 自动执行我**。

⚠️ 而"同一类东西有的有、有的没有"就是 [[12-设计模式、最佳实践与设计缺陷]] §4.7 记的那个缺陷：**装配方式不统一，导致"为什么没生效"很难查**。

---

## 十、自己动手：写一个 10 行的最小 starter

照着 `S-job-starter` 的骨架，一个能用的 starter 只要这些：

```
my-starter/
├── pom.xml                                  ← 依赖：spring-boot-autoconfigure
└── src/main/
    ├── resources/META-INF/spring.factories   ← 一行
    └── java/com/demo/
        ├── DemoProperties.java
        └── DemoAutoConfig.java
```

`spring.factories`：
```
org.springframework.boot.autoconfigure.EnableAutoConfiguration=com.demo.DemoAutoConfig
```

`DemoProperties.java`：
```java
@Getter @Setter
@ConfigurationProperties(prefix = "demo")
public class DemoProperties {
    private String greeting = "hello";     // ↔ demo.greeting
}
```

`DemoAutoConfig.java`：
```java
@Configuration
@EnableConfigurationProperties(DemoProperties.class)   // 让 Properties 生效
@ConditionalOnProperty("demo.enabled")                 // 开关
public class DemoAutoConfig {
    @Bean
    public String demoBean(DemoProperties props) {
        return props.getGreeting();
    }
}
```

**验证**：在任意 Spring Boot 项目里加这个依赖，配置文件写 `demo.enabled=true` / `demo.greeting=你好`，启动后容器里就有个值为"你好"的 String bean —— **你没在那个项目里写任何配置类**。

🔑 **这就是 starter 的全部魔法**。它不神秘，就三样东西：**带依赖的 pom + 一行声明 + 一个装配类**。

---

## 十一、自检题

- [ ] starter 和普通 jar 的**唯一**结构性区别是什么？（§二零件②）
- [ ] `spring.factories` 里那一行，`=` 左边和右边分别是什么？（§3.2）
- [ ] starter 的 `pom.xml` 里为什么要写 `xxl-job-core` 依赖？（§3.1）
- [ ] `@ConfigurationProperties(prefix="xxl.job")` 帮你省掉了什么？（§3.3）
- [ ] 一个服务引了 `S-job-starter` 但一个任务都没写，会发生什么？（§6.1）
- [ ] 为什么用 `-P dev` 编译时 xxl-job 执行器不会启动？（§6.3）
- [ ] 本地启动时那个 xxl-job 报错，是"环境没配好"还是"设计如此"？（§6.3）
- [ ] 为什么 `S-datasource` 没有 `spring.factories`？（§九）
- [ ] 说出 starter 提供什么、服务提供什么，各举一例。（§5.3）
- [ ] 不看笔记，说出写一个 starter 需要的三个零件。（§二）

---

## 相关笔记

- [[00-总览与学习地图]] · [[01-术语表]] · [[02-模块地图]] · [[03-POJO 与 DAO 层]] · [[04-starter 是什么]] · [[05-服务是怎么启动的]] · [[06-启动与部署]] · [[07-技术TODO]] · [[08-日志治理]] · [[09-Dao 与 Entity 设计]] · [[10-指标上报链路]] · [[11-数据存储与分层]] · [[12-设计模式、最佳实践与设计缺陷]] · [[13-Nacos 面试题设计与评分卡]] · [[14-系统生命周期全景]]
