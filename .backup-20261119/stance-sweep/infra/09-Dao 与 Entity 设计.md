# 09 · Dao 与 Entity 设计：一个"手写路由 + 两代风格并存"的持久化层

> 🧭 **阅读顺序 09 / 14** ｜ ⬅️ [[08-日志治理]] ｜ ➡️ [[10-指标上报链路]]

> 配套 [[07-技术TODO]] 的 **L2**。读完应能回答：一个 `mapper.selectById()` 到底连到了哪个库、
> 是谁决定的路由、以及为什么仓库里同时存在 `selectByExample` 和 `BaseMapper` 两套写法。

> 📖 **术语看不懂？** → [[01-术语表]]（每个词都写了「前因 → 解决什么 → 项目里什么样 → 一句话」）

## 🎯 三句话抓住这一层

1. **路由是手写的，不是框架给的**——服务主动 `exclude` 掉 Spring Boot 的 `DataSourceAutoConfiguration`，
   换上自研的 `DynamicDataSource`，用 **注解 + AOP + ThreadLocal 栈** 决定这次 SQL 去哪个库。
2. **starter 分两层**：`S-datasource` 是**骨架**（路由/注入器/审计，没有 `spring.factories`），
   按域拆的 5 个 `S-datasource-*-starter` 才是**装配**（各自注册 `XxxDruidMyBatisAutoConfig`）。
3. **Mapper 有两代（这是历史包袱，也是面试点）**：165 个 Mapper 里，
   **51 个**是 MyBatis Generator 的 `selectByExample` 风格，**58 个**是 MyBatis-Plus 的 `BaseMapper` 风格。

---

## 一、三层职责：谁依赖谁

```
┌─ S-Entity（634 个 java 文件）─────────────────────────────┐
│  S-cmp-entity 132  S-intra-entity 412                    │
│  S-it-asset-entity 72   S-outside-entity 18              │
│  纯 POJO：字段 + getter/setter，implements Serializable   │
│  还有 117 个 *Example.java（查询条件对象，见 §五）        │
│  ⚠️ 不依赖任何 dao 模块 —— 依赖方向永远是从 dao 指向它    │
└──────────────────────┬───────────────────────────────────┘
                       │ 被依赖
┌──────────────────────▼───────────────────────────────────┐
│ S-Dao（175 java / 139 xml）                              │
│  S-cmp-dao 35/33   S-common-dao 11/1                     │
│  S-intra-dao 110/85   S-it-asset-dao 19/20               │
│  Mapper 接口 + Mapper XML（SQL 写在 XML 里）             │
│  依赖同域的 entity：S-intra-dao → S-intra-entity         │
│  ⚠️ S-common-dao 不依赖任何 entity（放的是基类/TypeHandler）│
└──────────────────────┬───────────────────────────────────┘
                       │ 被依赖
┌──────────────────────▼───────────────────────────────────┐
│ S-starter/S-datasource（骨架，13~374 行的小类为主）       │
│  路由：DynamicDataSource / DataBaseContextHolder          │
│  注入器：ExtLogicSqlInjector / MysqlInsertAllBatch        │
│  审计：DataChangeLogInterceptor(374 行) / MysqlChangeContext│
│  观测：DruidCollector / DruidMetricsConfiguration         │
└──────────────────────┬───────────────────────────────────┘
                       │ 被按域 starter 依赖
┌──────────────────────▼───────────────────────────────────┐
│ 5 个按域 starter：stable / stable-r / base / intra / it   │
│  每个都有：XxxDataBase 注解 + XxxDataBaseAspect 切面      │
│           + XxxDruidMyBatisAutoConfig + spring.factories  │
└──────────────────────┬───────────────────────────────────┘
                       │ 被服务依赖
┌──────────────────────▼───────────────────────────────────┐
│ 每个服务自己的 com/didi/config/DataSourceConfig.java      │
│  ✅ 实测 37 个服务都有，且都带 @Primary                   │
│  作用：把该服务用到的数据源塞进 map，注册成唯一的 dataSource│
└──────────────────────────────────────────────────────────┘
```

📌 **一句话记依赖方向**：`服务 → 域 starter → S-datasource`，`域 dao → 同域 entity`。**不会反向**。

---

## 二、🔑 核心机制 1：动态数据源怎么路由

这是这一层最值得学的东西。全链路只有 4 个角色：

### 2.1 角色一：一个 8 值的枚举（有哪些库）

`S-starter/S-datasource/src/main/java/com/didi/DataBaseType.java`

```java
public enum DataBaseType {
    INTRA, MDS, BASE, IT, OPS, METRIC, STABLE, STABLE_R;
}
```

📌 `STABLE` / `STABLE_R` 是**同一个库的主从**：`STABLE` 走主库（写），`STABLE_R` 走只读副本。这是这套设计里最实用的一招——**读写分离没有靠框架，靠的是"再加一个枚举值"**。

### 2.2 角色二：ThreadLocal 里的一个**栈**（当前该走哪个库）

`DataBaseContextHolder.java`（37 行，全文值得读）：

```java
private static final ThreadLocal<Deque<String>> contextHolder = new ThreadLocal<>();

public static String getDatabaseType() {          // 取栈顶
    Deque<String> q = contextHolder.get();
    return q != null ? q.getFirst() : null;
}
public static void setDatabaseType(String type) { // 压栈
    Deque<String> q = contextHolder.get();
    if (q == null) { q = new ArrayDeque<>(); contextHolder.set(q); }
    q.addFirst(type);
}
public static void clearDatabaseType() {          // 弹栈，空了就 remove 防泄漏
    Deque<String> q = contextHolder.get();
    q.removeFirst();
    if (q.isEmpty()) contextHolder.remove();
}
```

🔑 **为什么是 `Deque` 而不是一个普通变量？** 因为**嵌套调用**。服务 A 的方法标了 `@StableDataBase`，它内部调用的方法标了 `@IntraDataBase`—— 栈能保证内层退出后**自动回到外层的数据源**，而不是被内层覆盖掉。 👉 这是"看似多余、实则必需"的典型：改成单值 `ThreadLocal<String>`，嵌套场景就会走错库。

⚠️ 它同时是**线程池场景的经典坑**：`removeFirst` 少了、或异步线程没继承上下文，就会出现"偶发连错库"。所以 `clearDatabaseType()` 写在切面的 `@After` 里（见下）。

### 2.3 角色三：5 个注解 + 5 个切面（声明"这段代码用哪个库"）

每个按域 starter 里都是同一个套路，以 stable 为例：

```java
// StableDataBase.java —— 一个空注解，纯标记
public @interface StableDataBase { }

// StableDataBaseAspect.java —— @Order(-9) 保证优先级足够高
@Aspect @Order(-9) @Component
public class StableDataBaseAspect {
    @Pointcut("@within(com.didi.StableDataBase) || @annotation(com.didi.StableDataBase)")
    public void dbPointCut() { }

    @Before("dbPointCut()")   // 进方法前：压栈
    public void beforeSwitchDS(JoinPoint p) {
        DataBaseContextHolder.setDatabaseType(DataBaseType.STABLE.name());
    }
    @After("dbPointCut()")    // 出方法后：弹栈
    public void afterSwitchDS(JoinPoint p) {
        DataBaseContextHolder.clearDatabaseType();
    }
}
```

🔑 **注意 `@Pointcut` 支持两个位置**：`@within` 打在**类**上、`@annotation` 打在**方法**上。所以既可以整个 Service 走 stable，也可以只让某一个方法走 stable。

📌 5 个注解 / 切面对应关系（全部实测存在）：

| 注解 | 切面 | 目标数据源 |
|---|---|---|
| `@StableDataBase` | `StableDataBaseAspect` | `STABLE`（主库） |
| `@StableReadDataBase` | `StableReadDataBaseAspect` | `STABLE_R`（只读副本） |
| `@BaseDataBase` | `BaseDataBaseAspect` | `BASE` |
| `@IntraDataBase` | `IntraDataBaseAspect` | `INTRA` |
| `@ItDataBase` | `ItDataBaseAspect` | `IT` |

> ⚠️ `S-pii-starter` 的 `PiiHandler` 也会调 `setDatabaseType`——它参与路由但不属于这 5 个注解体系。
> 另外全仓库有 **114 处**直接调 `setDatabaseType`（手工切换，绕开注解），读代码时会撞见。

### 2.4 角色四：13 行的路由器（真正把 SQL 分出去）

`DynamicDataSource.java`——整个路由的落点，全部代码就这些：

```java
public class DynamicDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return DataBaseContextHolder.getDatabaseType();   // 就这一行
    }
}
```

🔑 `AbstractRoutingDataSource` 是 Spring 自带的：它在每次取连接时回调 `determineCurrentLookupKey()`，拿到的 key 去 `targetDataSources` 这个 map 里找对应连接池。**所以"切库"发生在拿连接的那一刻**，不是注解那一刻。

### 2.5 串起来：一次 `selectById` 的完整旅程

```
① Service 方法上有 @StableDataBase
      ↓
② Aspect 的 @Before 触发 → DataBaseContextHolder 压入 "STABLE"
      ↓
③ MyBatis 执行 SQL，向 DataSource 要连接
      ↓
④ DynamicDataSource.determineCurrentLookupKey() 返回 "STABLE"
      ↓
⑤ 从 targetDataSources map 里取出 stableDataSource（Druid 连接池）
      ↓
⑥ 方法返回 → Aspect 的 @After 触发 → 弹栈
```

✅ **为什么必须手写？** 因为服务的启动类上写了：

```java
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})
```

Spring Boot 自动配数据源的能力被**主动关掉**了。取而代之的是每个服务的 `DataSourceConfig`：（下面 acl 的，已核实）

```java
@Configuration
public class DataSourceConfig {
    final Map<Object, Object> targetDataSources = new HashMap<>(1);

    @Bean("targetDataSources")
    public Map<Object, Object> targetDataSources() { return targetDataSources; }

    @Bean("dataSource") @Primary                                   // ← 唯一的 @Primary
    public DynamicDataSource dataSource(
            @Qualifier("stableDataSource") DataSource stableDataSource) {
        targetDataSources.put(DataBaseType.STABLE.name(), stableDataSource);
        DynamicDataSource ds = new DynamicDataSource();
        ds.setTargetDataSources(targetDataSources);                // ← 路由表
        ds.setDefaultTargetDataSource(stableDataSource);           // ← 兜底：没注解时走 stable
        return ds;
    }
}
```

🔑 **两个 bean 名字要记住**：`dataSource`（动态路由，`@Primary`，业务无感知）和`xxxDataSource`（真实连接池，如 `stableDataSource`）。要绕过路由直接连某个库，就 `@Qualifier` 后者。

---

## 三、🔑 核心机制 2：按域 starter 怎么装配

`S-datasource` 里**没有** `META-INF/spring.factories`（它只是骨架）；装配由 5 个按域 starter 完成，每个都有自己的 `spring.factories`：

```
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
    com.didi.StableDruidMyBatisAutoConfig
```

每个 `XxxDruidMyBatisAutoConfig` 干四件事（以 stable 为例，已核实）：

```java
@Configuration
@EnableTransactionManagement
@MapperScan({"com.didi.dao", "com.didi.**.dao", "com.didi.message.mailsend"})
@ConditionalOnBean(DruidDataSourceProperties.class)     // ← 没配 spring.datasource 就不生效
public class StableDruidMyBatisAutoConfig implements EnvironmentAware {

    @Bean("stableDataSource")                            // ① 真实连接池
    public DataSource stDataSource(DruidDataSourceProperties p) {
        // 从 spring.datasource.stable.{url,username,password} 读地址
        // 其余池参数（initialSize/maxActive/validationQuery…）来自 DruidDataSourceProperties
    }

    @Bean
    public ExtLogicSqlInjector myLogicSqlInjector() {     // ② 自定义 SQL 注入器（见 §四）
        return new ExtLogicSqlInjector();
    }

    @Bean("stableJdbcTemplate")                          // ③ 给这个库单独的 JdbcTemplate
    public JdbcTemplate itJdbcTemplate(@Qualifier("stableDataSource") DataSource ds) {
        return new JdbcTemplate(ds);
    }
}
```

🔑 **第 ④ 件事是 `@MapperScan` 的包名约定**——这是这一层最好记也最该记的规则：

| 扫描路径 | 含义 |
|---|---|
| `com.didi.dao` | 根 dao 包 |
| `com.didi.**.dao` | **任何层级下的 dao 包**（所以 `com.didi.subdomain.infrastructure.mapper` 那种也另有配置） |
| `com.didi.message.mailsend` | 硬编码的例外 |

> ⚠️ **注意 `@MapperScan` 在各 starter 之间是不一致的**（实测）：
> `S-out-starter/MyBatisConfig` 扫 `com.didi.dao` + `com.didi.base.dao` + `com.didi.sys.common.dao`；
> `S-GatewayProxyApplication` 只扫 `com.didi.dao`；`S-qos-service` 扫 `com.didi.*.infrastructure.mapper`。
> **结论：找 Mapper 时不能只认一个包名，要以具体服务的配置为准。**

### 3.1 配置怎么读（`spring.datasource.*` 的两套前缀）

```properties
# ① 每个库三个必需项，前缀 = spring.datasource.<枚举小写>
spring.datasource.stable.url=jdbc:mysql://...
spring.datasource.stable.username=...
spring.datasource.stable.password=...

# ② 池参数 + 计数器，全部挂在 spring.datasource 根下（无二级前缀）
spring.datasource.max-active=...
```

两个属性类都生效，都是 `@RefreshScope`（Nacos 改完**不用重启**）：

| 类 | 前缀 | 装什么 |
|---|---|---|
| `DataSourceProperties` | `spring.datasource` | 计数器：`insetCount` / `selectCount` / `insetSourceCount` / `selectSrCount` / `updateCount` / `deleteCount` |
| `DruidDataSourceProperties` | `spring.datasource` | Druid 池参数：`driverClassName` / `initialSize` / `minIdle` / `maxActive` / `maxWait` / `validationQuery` … |

> ⚠️ 拼写坑：`insetCount`（不是 `insertCount`）、`insetSourceCount`。别当成 typo 改掉——
> 它是代码里的真实字段名，改了配置就对不上。

---

## 四、🔑 核心机制 3：自定义 SQL 注入器（批量插入）

MyBatis-Plus 允许往 Mapper 里"注入"新方法。这里注入的是一个批量插入：

```java
// ExtLogicSqlInjector.java（28 行）
public class ExtLogicSqlInjector extends DefaultSqlInjector {
    @Override
    public List<AbstractMethod> getMethodList(Class<?> mapperClass) {
        List<AbstractMethod> list = super.getMethodList(mapperClass);   // 保留原生方法
        list.add(new MysqlInsertAllBatch());                            // 追加一个
        return list;
    }
}
```

```java
// MysqlInsertAllBatch.java（50 行）—— 生成一条多值 INSERT
final String sql = "<script>insert into %s %s values %s</script>";
//          字段来自 TableInfo 反射，值用 <foreach> 展开成 (..),(..),(..)
//          注册成方法名：mysqlInsertAllBatch
```

🔑 **它解决什么**：MyBatis-Plus 自带的 `saveBatch` 是**循环单条插入 + 批处理攒包**，而这个是**一条 SQL 多组 values**（`insert into t (a,b) values (1,2),(3,4)`）。后者少一次 SQL 解析、少反复网络往返，代价是 SQL 长度要自己控（太大可能超 `max_allowed_packet`）。

📌 调用形态：`mapper.mysqlInsertAllBatch(list)`。看到 `MysqlInsertAllBatch` 这个名字就知道 "这是自研注入器，不是 MyBatis-Plus 原生 API"。

---

## 五、📌 两代 Mapper 风格并存（这一层最大的历史包袱）

这是读这个仓库最容易懵的地方：**同一个项目里有两套完全不同的 Mapper 写法**。

📌 **两代实测数字与代码并排对比，单一来源在 [[03-POJO 与 DAO 层]]§五**，本节不再存第二份。⚠️ `Example` 类在 `S-Entity` 不在 `S-Dao`——它是查询条件+结果行的双重载体，归 POJO 家族；找 SQL 别只翻 Dao 目录。

| | 老风格：MyBatis Generator | 新风格：MyBatis-Plus |
|---|---|---|
| 典型方法 | `selectByExample` / `countByExample` / `insertSelective` | `selectById` / `selectList(Wrapper)` / `insert` |
| 查询条件 | 另建一个 `XxxExample` 类，链式 `createCriteria()` | `QueryWrapper` / `LambdaQueryWrapper` |
| 大字段 | 单独一套 `XxxWithBLOBs` 实体 | 无此概念 |
| 生成方式 | 工具生成，人**不改**生成代码 | 手写接口 `extends BaseMapper<T>` |

### `S-common-dao` 是干嘛的（它不连数据库）

11 个 java / 1 个 xml，是**两代风格的黏合层**和工具：

| 类 | 作用 |
|---|---|
| `ExtBaseMapper` | 自定义 Mapper 基接口（`S-Dao/S-common-dao/.../com/didi/ExtBaseMapper.java`） |
| `MyBatisBaseDao` / `BaseService` / `IBaseService` | 老风格的基类/接口 |
| `ExtBaseService` / `BaseServiceImpl` / `IExtBaseService` | 新风格（MyBatis-Plus `IService`）的服务基类 |
| `DateTypeHandler` / `DateTimeTypeHandler` / `CalendarTypeHandler` | **日期类型转换器**——JDBC 与 Java 日期的映射 |
| `EmptyStringIfNull` | 空字符串处理 |

🔑 **`DateTypeHandler` 这类才是隐藏的重点**：MyBatis 默认对 `java.util.Date` 的时区处理很容易出错，项目自己写了 3 个 TypeHandler 收口。看到日期字段取值差 8 小时，先来查这里。

### 👉 读写代码的实操建议

```
要查一张表怎么被访问：
  ① S-Dao 里 grep 表名 → 找到 Mapper 接口（注意 XML 里才有 SQL）
  ② 看接口是 extends BaseMapper（新）还是 selectByExample（老）
     → 决定你去哪找 SQL：新风格看 Wrapper + 注解，老风格看 S-Dao/**/*.xml
  ③ 回到 Service，看它是靠 @XxxDataBase 注解路由，还是手写 setDatabaseType
  ④ 如果涉及写操作，去看审计是怎么记的（§六）
```

---

## 六、🔑 核心机制 4：数据变更审计与打点

这一层的"四条横切关注点"，都在 `S-datasource` 里：

| 关注点 | 类 | 规模 | 干什么 |
|---|---|---|---|
| **变更审计** | `DataChangeLogInterceptor` | **374 行**（本层最大的类） | MyBatis 拦截器，抓 `insert/update/delete` |
| 变更主体 | `MysqlChangeContext` | 20 行 | `ThreadLocal<String>` 存**谁**改的（operator） |
| 审计记录 | `CmdbOperateLog` + `MysqlRecordContanst` | 45 + 16 行 | 审计日志的载体与常量 |
| SQL 打点 | `SqlOperatorLogService` + `SqlOperatorLogConfig` | 163 + 22 行 | 统计 SQL 操作次数 |
| 连接池观测 | `DruidCollector` + `DruidMetricsConfiguration` | 86 + 49 行 | Druid 指标 → 走 [[10-指标上报链路]] |

🔑 **审计的用法**（和路由是同一套思路，但换成"谁"）：

```java
MysqlChangeContext.setDataOperator("张三");   // 进入业务前设置"谁"
... 执行 insert/update/delete ...
// DataChangeLogInterceptor 拦截到写操作 → 取出 operator → 写 CmdbOperateLog
```

⚠️ **`MysqlChangeContext` 也是 ThreadLocal，也有同一个坑**：异步线程 / 线程池里会丢。

🔑 **但要注意区分**：MDC（traceId 那 7 个字段）**是做了透传的**—— `S-ServiceConfig` 里的 `MdcTaskDecorator` 实现了「抓快照 → 装回去 → finally 清理」，`ThreadPoolTaskConfig` 也真的 `setTaskDecorator(...)` 用上了。

**所以异步链路里会出现这种"半对半错"的状态**：

```
日志 traceId  ✓ 对得上（MDC 透传了）
审计 operator ✗ 空的（MysqlChangeContext 没透传）
切库目标      ✗ 回到默认库（DataBaseContextHolder 没透传）
```

⚠️ 这比"全丢"更难查——因为**日志看起来是正常的**，你会以为上下文没问题。而且它和 `DataBaseContextHolder` 是**两个独立的 ThreadLocal**，清理时机不同，所以"审计日志里 operator 为空"是这套设计里最常见的现象之一。

📌 **落点的主次关系容易看反**（已核实源码）：

```
写操作被拦截
   ↓
① 先走 Kafka：topic = "cmdb_operate_log"（DidiKafkaService.send）
   ↓ 发送异常才降级
② 落 MySQL：INSERT INTO cmdb_operate_log(...)
   ↓ 再异常
③ 发邮件告警
```

🔑 **所以 Kafka 是主路径、MySQL 是兜底**，不是"两边同时写"。代码里那句注释写得很直白：*「操作日志直接写入公司 kafka，异常后写入 mysql，并发送邮件」*。表名和 topic 同名（都叫 `cmdb_operate_log`），别误以为是两套东西。

📌 `MysqlRecordContanst` 里是审计字段的 key：`operator` / `type` / `ip` / `remote_ip` / `controller` / `url` / `task` / `caller`。

---

## 七、⚠️ 这一层的坑清单

| 坑 | 现象 | 怎么查 |
|---|---|---|
| 注解范围写错 | 整个 Service 走了只读副本，写入报错 | 看 `@XxxDataBase` 打在类还是方法上（`@within` vs `@annotation`） |
| ThreadLocal 没清理 | 偶发连错库，压测才复现 | 切面 `@After` 是否漏了 `clearDatabaseType()`；异步线程有没有继承 |
| 线程池里丢上下文 | 审计 `operator` 为空、路由回到默认库 | ⚠️ 注意**只丢业务上下文**：MDC 有 `MdcTaskDecorator` 透传（`ThreadPoolTaskConfig:37`），但这两个自研 ThreadLocal 没被纳入 |
| 默认兜底 | 方法**没加注解**时不报错，而是静默走 `stable` | `setDefaultTargetDataSource(stableDataSource)`——"没配"≠"没连" |
| `@MapperScan` 各 starter 不一致 | 新写的 Mapper 扫不到，启动报 `NoSuchBeanDefinition` | 以目标服务的配置为准，别照抄别的服务 |
| `Example` 不在 Dao 里 | 在 `S-Dao` 里找不到查询条件类 | 去 `S-Entity` 找那 117 个 `*Example.java` |
| 字段名拼写 | 配置写了 `insertCount` 不生效 | 真实字段是 `insetCount`（少个 r） |
| 数据源被 exclude | 自己 new `DataSource` 或加 `@ConfigurationProperties` 不生效 | 启动类上有 `exclude = {DataSourceAutoConfiguration.class}` |

---

## 八、动手：验证这套路由（15 分钟）

不用起任何服务，直接写测试最省事（参考 `S-ServicesIntra/S-agent-client-service/src/test/java/com/didi/integration/`，那里已经有 3 个现成测试：`DataSourceConfigTest`、`DataSourceRoutingDbTest`、`StableDataSourceAspectTest`）：

```bash
cd /Users/didi/Desktop/work/infra/S-ServicesIntra/S-agent-client-service
mvn test -Dtest=DataSourceRoutingDbTest
```

**然后自己回答（答不上就回去看对应小节）：**

- [ ] `DataBaseContextHolder` 里为什么是 `Deque` 而不是 `String`？（§2.2）
- [ ] 一次 `selectById` 是在哪一刻决定去哪个库的？注解时刻还是拿连接时刻？（§2.4）
- [ ] `@MapperScan` 的 `com.didi.**.dao` 能匹配到 `com.didi.a.b.dao` 吗？（§三）
- [ ] 方法上什么注解都没有时，会报错还是走某个默认库？走哪个？（§七）
- [ ] 为什么 `XxxExample` 放在 `S-Entity` 而不是 `S-Dao`？（§五）
- [ ] `mysqlInsertAllBatch` 和 `saveBatch` 有什么本质区别？（§四）
- [ ] `S-datasource` 为什么可以没有 `spring.factories`，而按域 starter 必须有？（§三）

---

## 九、这一层要看的文件（按优先级）

**🔴 必读（加起来不到 100 行，但含全部核心机制）**

| 文件 | 行数 | 为什么 |
|---|---|---|
| `S-starter/S-datasource/.../DynamicDataSource.java` | 13 | 路由落点，全部逻辑就 1 行 |
| `S-starter/S-datasource/.../DataBaseContextHolder.java` | 37 | 为什么用栈，嵌套怎么工作 |
| `S-starter/S-datasource/.../DataBaseType.java` | 24 | 8 个库，含读写分离的 `STABLE_R` |
| `S-starter/S-datasource-stable-starter/.../StableDataBaseAspect.java` | 31 | 注解 → 切面 → 压栈 的标准套路 |
| 任意服务的 `com/didi/config/DataSourceConfig.java` | ~25 | 路由表怎么组装、`@Primary` 给谁 |
| `S-starter/S-datasource/.../ExtLogicSqlInjector.java` | 28 | 自研注入器的入口 |

**🟡 选读（机制懂了再看）**

| 文件 | 行数 | 为什么 |
|---|---|---|
| `S-starter/S-datasource/.../DataChangeLogInterceptor.java` | 374 | 变更审计，本层最复杂；配 §六 读 |
| `S-starter/S-datasource/.../injector/MysqlInsertAllBatch.java` | 50 | 一条 SQL 多值插入的拼装 |
| `S-starter/S-datasource-stable-starter/.../StableDruidMyBatisAutoConfig.java` | ~80 | `@MapperScan` + `@ConditionalOnBean` 装配 |
| `S-Dao/S-common-dao/.../DateTypeHandler.java` | 短 | 日期时区问题的收口点 |

**⚪ 不用读**：`S-Entity` 的 634 个 POJO（需要时查字段就行）、MBG 生成的 `*Example`（117 个）、以及 `S-Dao/**/*.xml` 里的常规 CRUD SQL——**需要看具体 SQL 时再定向打开**。

---

## 相关笔记

- [[00-总览与学习地图]] · [[01-术语表]] · [[02-模块地图]] · [[03-POJO 与 DAO 层]] · [[04-starter 是什么]] · [[05-服务是怎么启动的]] · [[06-启动与部署]] · [[07-技术TODO]] · [[08-日志治理]] · [[09-Dao 与 Entity 设计]] · [[10-指标上报链路]] · [[11-数据存储与分层]] · [[12-设计模式、最佳实践与设计缺陷]] · [[13-Nacos 面试题设计与评分卡]] · [[14-系统生命周期全景]]
