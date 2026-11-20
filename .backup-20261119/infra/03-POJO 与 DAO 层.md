# 03 · POJO 与 DAO 层：从一行数据讲起

> 🧭 **阅读顺序 03 / 14** ｜ ⬅️ [[02-模块地图]] ｜ ➡️ [[04-starter 是什么]]

> 从 [[02-模块地图]] 的"库模块"清单往下讲，会撞上两个最基础的概念：
> **POJO 是什么**、**DAO 层在干什么**——这两件事多数教程默认你懂，其实没人讲清过。
>
> 这份文档不假设你懂任何框架，全部用**本仓库的真实代码**讲。

## 🎯 要点

1. **POJO = 只有字段加 getter/setter、一行业务逻辑都没有的普通 Java 类。**
   本项目有 **634 个**，全在 `S-Entity`。它唯一的职责是**装一行数据**。
2. **DAO 层 = 专门和数据库打交道的那一层。** 它的设计就两条：
   接口声明"我要什么"，SQL 写在别处（XML 或 Wrapper），**Java 里不出现 SQL 字符串**。
3. **为什么要单独打成 jar**：634 个实体、175 个 Dao 被**几十个服务共用**。
   各写一份的话，改一个字段就要改几十处，所以必须"一份代码，所有人引用"。

> 📖 术语见 [[01-术语表]] · 更深的路由机制见 [[09-Dao 与 Entity 设计]]

---

## 一、先拆解一句话

> 「库模块 —— 无 main，只被依赖，打进 ~/.m2 当 jar」

这句话里有四个概念，逐个拆：

### 1.1 `main` 方法 = 程序入口

```java
public static void main(String[] args) {   // ← 有它，才能 java -jar 跑起来
    SpringApplication.run(AclApplication.class, args);
}
```

- **有 main** → 叫**服务模块**，能独立启动，本项目 **42 个**
- **没有 main** → 叫**库模块**，**自己跑不起来**，只能被别的模块引用

🔑 类比：服务模块是**整台机器**（插电就能转）；库模块是**零件**（螺丝、齿轮，必须装进机器里）。

### 1.2 `被依赖` = 别的模块在 pom 里写一行，就能用它的类

```xml
<!-- 某个服务的 pom.xml -->
<dependency>
    <groupId>com.didi</groupId>
    <artifactId>S-Entity</artifactId>   <!-- 我要用它的实体类 -->
</dependency>
```

### 1.3 `打进 ~/.m2` = 装进本地"零件仓库"

`mvn install` 会把模块打成 jar，放进 `~/.m2/repository/`（你机器上的 Maven 本地仓库）。之后**任何模块**都能靠 `groupId + artifactId` 找到它。

📌 这就是为什么 [[06-启动与部署]] 里必须先 `mvn install` 再启动服务—— **先造零件、入库，机器才装得上**。

### 1.4 六个库模块各自装什么（✅ 实测文件数）

| 模块 | 装什么 | 规模 | 没有它会怎样 |
|---|---|---|---|
| **S-Core** | 公共基础设施：`Result` 统一返回、`Page` 分页、`HttpResult`、各种 `Utils`、枚举、常量 | **87** 个类 | 每个服务各写一份"统一返回格式"，前端要对接 42 种格式 |
| **S-Entity** | **POJO**：数据库表的 Java 映射、DTO、VO | **634** 个类 | 同一个 `cmdb_devices` 表，5 个服务各写一个实体类 |
| **S-Dao** | **Mapper 接口 + XML**（真正写 SQL 的地方） | **175** java + **139** xml | 同一个查询，5 个服务各写一遍 SQL |
| **S-DubboApi** | **接口契约**：只有接口和方法签名，没有实现 | **394** 个类 / 19 个模块 | provider 和 consumer 的接口对不上，RPC 调不通 |
| **S-starter** | **自定义 Spring Boot starter**：把"怎么装配"打包好 | **499** 个类 / 31 个模块 | 每个服务手写数据源/日志/Redis 配置 |
| **S-ServiceConfig** | **所有服务都要的启动配置**：6 份 `bootstrap-*.properties` + 3 个线程池/MDC 类 | 4 个类 + 8 份配置 | 每个服务各配一遍 Nacos 地址 |

> 👉 starter 到底怎么工作，见 [[04-starter 是什么]]。

🔑 **判断一个模块是不是库模块，只看一件事：`src/main/java` 下有没有 `main` 方法。**（`S-public-order` 是个反例：名字像服务，但没有 main，实际是给别的服务用的库。）

---

## 二、POJO 到底是什么：用 27 行真实代码讲

这是本仓库 `S-Entity/S-intra-entity/.../entity/tools/Workday.java` 的**全文**（对应"工作日"表）：

```java
package com.didi.entity.tools;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data                                    // ①
public class Workday implements Serializable {   // ②

    @TableField(exist = false)           // ③
    private static final long serialVersionUID = 19284674912L;

    @TableId                            // ④
    private Integer id;                  // ⑤ 对应表的 id 列
    private String restDay;              //    对应表的 rest_day 列
    private String year;                 //    对应表的 year 列
    private String remark;               //    对应表的 remark 列

    public Workday() {                   // ⑥
    }

    public Workday(String restDay, String year, String remark) {
        this.restDay = restDay;
        this.year = year;
        this.remark = remark;
    }
}
```

### 逐行翻译

| 标注                             | 是什么                                                                   | 不懂会怎样                                                |
| ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------- |
| ① `@Data`                      | **Lombok** 注解，编译时**自动生成** `getId()`/`setId()`/`toString()`/`equals()` | 你会以为"这个类怎么没有 getter"——**被生成了，源码里看不到**                |
| ② `implements Serializable`    | 能被"拍成字节"（序列化）                                                         | 放进 Redis、跨进程传输时会报 `NotSerializableException`         |
| ③ `@TableField(exist = false)` | **这个字段不是表里的列**                                                        | 不加的话 MyBatis-Plus 会去找 `serialVersionUID` 这一列，报"列不存在" |
| ④ `@TableId`                   | 这个字段是**主键**                                                           | 不加主键注解，`updateById` 这类方法不知道按谁更新                      |
| ⑤ `private Integer id;`        | 一个字段 = 表的一列，**名字驼峰对下划线**：`restDay` ↔ `rest_day`                       | 名字对不上就映射不到（要么改配置，要么加 `@TableField`）                  |
| ⑥ 两个构造方法                       | 一个给框架用（无参），一个给代码用                                                     | 框架反射实例化需要无参构造，只写带参的会启动失败                             |

### 🔑 最关键的一点：**这个类里一行业务逻辑都没有**

没有 `if`、没有计算、没有校验、没有调数据库。它**只做一件事：装一行数据**。

这就是 POJO 的定义——**Plain Old Java Object（普普通通的 Java 对象）**。

> 这个词是 2000 年代造出来的，用来**对比 EJB**：
> EJB 要求你的类必须继承框架的基类、必须实现一堆接口，业务类被框架"绑死"，连单测都跑不了。
> POJO 的意思就是"**别绑我，我就是一个普通类**"。今天所有 Java 框架都走这条路。

⚠️ **所以 POJO 的三个"不"**：
- 不实现业务接口
- 不继承框架基类（`implements Serializable` 这种标记接口不算）
- 不含业务方法

---

## 三、POJO 家族：Entity / DTO / VO / Example 的区别

都是 POJO，区别只在"**给谁看**"：

| 名字 | 全称 | 一句话 | 本项目在哪 | 例子 |
|---|---|---|---|---|
| **Entity** | 实体 | **对着数据库表**，一字段一列 | `S-Entity`（634 个） | `Workday` |
| **DTO** | Data Transfer Object | **跨进程传输**用的形状 | 契约模块 / entity/dto | `Content`、`ProductTreeNode` |
| **VO** | View Object | **给前端展示**用 | entity/vo | `IdcRoomVO` |
| **Example** | 条件构造器 | **不是数据，是"查询条件"** | `S-Entity`（117 个） | `WorkorderXxxExample` |

🔑 **判断法是问一句"它对着谁"**：

```
对着数据库表   → Entity
对着另一个进程 → DTO
对着前端页面   → VO
对着一个 WHERE → Example
```

📌 为什么要分这么细？因为**同一个概念在不同场合需要的字段不一样**。`Workday` 表里可能有 20 列，但前端只需要 3 列——这时返回 `WorkdayVO`，**不要把整个 Entity 丢给前端**（会泄露内部字段，也浪费带宽）。

---

## 四、DAO 层是什么设计：一句话 + 两条铁律

### 4.1 什么是"层"

"层"就是**一个只干一件事的盒子**。一次请求从进来到落库，要穿过几个盒子：

```
① Controller  ← HTTP 请求进来（参数校验、拼返回值）
      ↓  传的是 DTO
② Service     ← 业务逻辑（判断、编排、事务）★ 只有这层允许写 if/for
      ↓  传的是 Entity
③ Mapper(DAO) ← 只负责"怎么读写数据库"，不含业务判断
      ↓  传的是 SQL 参数
④ JDBC/连接池 → 真正和 MySQL 通信
      ↓
   MySQL
```

**每层的铁律**：
- **Controller 不写业务**（只做参数校验和格式转换）
- **Service 不写 SQL**（要数据就调 Mapper）
- **Mapper 不写业务**（它不懂"什么算合法"，只懂"怎么查")

🔑 违反这条会怎样？**测试写不出来**。业务和 SQL 混在一起时，验证一个判断要靠"连上数据库跑一遍"，没人敢改。

### 4.2 DAO 层的两条核心设计

**铁律一：Mapper 是"接口"，不是"实现"**

```java
public interface WorkdayMapper extends ExtBaseMapper<Workday> { ... }
//     ↑ 只有方法声明，没有方法体
```

**谁实现了它？没人写。** MyBatis 在启动时用**动态代理**生成一个实现类，把方法调用翻译成 SQL。这就是为什么你能"调用一个没有实现的方法"。

**铁律二：SQL 不写在 Java 里**

两种放法（对应两代风格，见 §五）：
- 写到 **XML** 文件里（老风格）
- 用 **Wrapper** 拼条件（新风格，MyBatis-Plus）

**为什么不能写在 Java 字符串里？**
```java
// ❌ 这样写会出事
String sql = "select * from workday where year = '" + year + "'";   // 注入！
```
拼接字符串 = SQL 注入；而且 SQL 混在 Java 里，DBA 审不了、改不动。

### 4.3 一个真实调用长什么样

```java
// Service 层（业务）
public LocalDate getEndDate(LocalDate start, int days) {
    // 业务判断在这儿
    if (days <= 0) throw new BizException("天数必须大于 0");

    // 要数据 → 调 Mapper，不写 SQL
    return workdayMapper.computeEndTime(start, days);
}
```

```java
// Mapper 层（数据访问）——注意：这里没有 SQL 字符串，只有 Wrapper 条件
default boolean isHoliday(LocalDate date) {
    String ymd = DateTimeFormatter.ofPattern(DateTimeUtil.YYYYMMDD).format(date);
    return selectCount(new QueryWrapper<Workday>().eq("rest_day", ymd)) > 0;
}
```

---

## 五、两代写法并排看（这是本项目最需要知道的事）

同一个仓库里**并存两套** Mapper 写法。看懂了对比，就懂了 DAO 层的设计：

### 5.1 新风格（MyBatis-Plus）：`WorkdayMapper`

```java
public interface WorkdayMapper extends ExtBaseMapper<Workday> {
    // ↑ 一行 CRUD 都没写，全从父接口继承来
    // ↑ 没有 XML，没有 SQL 字符串
}
```

| 项 | 情况 |
|---|---|
| XML 文件 | **不存在** |
| 声明的方法数 | **0 个**（CRUD 全继承） |
| SQL 在哪 | 运行时由 `BaseMapper` 拼出来 |
| 条件查询怎么写 | `new QueryWrapper<Workday>().eq("rest_day", ymd)` |

### 5.2 老风格（MyBatis Generator）：`WorkorderReinstallSystemMapper`

```java
public interface WorkorderReinstallSystemMapper {          // ← 不继承任何东西
    int deleteByExample(WorkorderXxxExample example);
    int deleteByPrimaryKey(Integer id);
    int insert(WorkorderXxxWithBLOBs record);
    int insertSelective(WorkorderXxxWithBLOBs record);
    List<WorkorderXxxWithBLOBs> selectByExampleWithBLOBs(WorkorderXxxExample example);
    // ... 还有 6 个
}
```

| 项 | 情况 |
|---|---|
| XML 文件 | **有**，**364 行** |
| 声明的方法数 | **11 个** |
| SQL 在哪 | XML 里的 `<select>` / `<insert>` 标签 |
| 条件查询怎么写 | 传一个 `Example` 对象进去，XML 用 `${criterion.condition}` 拼 WHERE |

XML 里这段就是"条件拼接"的真身：

```xml
<if test="criterion.noValue">
  and ${criterion.condition}                        <!-- 直接拼字符串！ -->
</if>
<if test="criterion.singleValue">
  and ${criterion.condition} #{criterion.value}     <!-- 值用 #{} 安全 -->
</if>
...
order by ${orderByClause}                           <!-- 排序字段也直接拼 -->
```

### 5.3 对比表（📌 这些数字是实测的）

| | 新风格 MP | 老风格 MBG |
|---|---|---|
| 数量 | **58** 个 Mapper | **51** 个 Mapper |
| 每个要写的代码 | 接口 1 行 | 接口 11 个方法 + XML 300~2000 行 |
| 有没有 XML | 无 | 有（共 **139** 个 xml） |
| 条件查询 | `QueryWrapper` 链式 | `Example` + `${criterion.condition}` |
| 安全性 | 天然安全 | ⚠️ `${}` 是拼接，**用错就注入** |

🔑 **看到一个新 Mapper，先看它 `extends` 了什么**：
- `extends BaseMapper` / `ExtBaseMapper` → 新风格，**去 Wrapper 找条件，不用翻 XML**
- 什么都不继承、方法名带 `ByExample` → 老风格，**SQL 在 `S-Dao/**/mapper/xxx.xml`**

⚠️ 还有个坑：老风格的 `*Example.java` 有 **117 个，但它们放在 `S-Entity` 里，不在 `S-Dao`**。只在 Dao 目录里找 Example 会找不到。

---

## 六、一次查询的完整旅程（把上面的东西串起来）

```java
workdayMapper.selectById(1)   // 你写的这一行
```

```
① 你调的是接口 WorkdayMapper 的 selectById
      ↓   但接口没有实现，怎么执行？
② MyBatis 启动时已用「动态代理」生成实现类，方法调用被它截获
      ↓
③ 找到这条 SQL 的定义：
      新风格 → 由 BaseMapper 根据实体注解（@TableId/@TableField）推导出来
      老风格 → 去 XML 找 id="selectById" 的 <select> 标签
      ↓
④ 把参数填进去（TypeHandler 负责类型转换，如 Date ↔ datetime）
      ↓
⑤ 通过 DynamicDataSource 决定连哪个库（见 09 的双层路由）
      ↓
⑥ 连接池（Druid）借出一个连接 → JDBC 发给 MySQL → 拿回结果集
      ↓
⑦ 把结果集按「列名 → 字段名」映射回一个 Workday 对象（POJO 在这里被填充）
      ↓
   返回 Workday 对象（或 null）
```

🔑 **第 ⑦ 步是 POJO 存在的意义**：数据库返回的是"行 + 列"， Java 里要的是"对象 + 字段"，POJO 就是这两者之间的**形状定义**。

---

## 七、把库模块清单补完：剩下三个模块是干嘛的

### 7.1 S-Core（87 个类）—— 所有人都要用的"地基工具"

```
result/    Result、Page、HttpResult、PageResult   ← 统一返回格式
utils/     excel、druid、hc5、log 工具类
enums/     公共枚举
constant/  公共常量
cache/     缓存工具
```

🔑 **为什么要有它**：如果每个服务自己定义"返回格式"，前端就要对接 42 种 JSON 结构。`Result<T>` 统一成 `{code, msg, data}`，这是**契约**。

> 📌 有个细节：`S-Core` 里还**直接放了 `org.apache.poi.ss` 的类**（不是依赖，是源码），
> 说明当年为了改 POI 的某个 bug 而"魔改后内联"了。看到别奇怪。

### 7.2 S-DubboApi（394 个类 / 19 个模块）—— RPC 的"接口说明书"

**只有接口，没有实现**：

```java
public interface IDubboDgwService {
    Result<DgwInfo> queryById(Long id);   // 只有签名
}
```

- **provider**（提供服务的一方）：`implements IDubboDgwService`，写真正的逻辑
- **consumer**（调用方）：只依赖这个 jar，用 `@DubboReference` 拿到一个"假的实现"

🔑 **为什么要单独一个模块**：双方必须用**同一份**接口定义，否则参数类型差一个字段就调不通。把它单独打 jar，是唯一能保证"两边一致"的办法。

### 7.3 S-ServiceConfig（4 个类 + 8 份配置）—— 所有服务的"启动底座"

```
bootstrap.properties / bootstrap-{dev,test,prod,prodhnd,pretest,canoe}.properties
    ← Nacos 地址、命名空间、75 项 extension-configs（见 05）
MdcTaskDecorator.java      ← 把 MDC 上下文透传到线程池
ThreadPoolTaskConfig.java  ← 统一线程池参数
ThreadPoolMetricConfig.java← 线程池指标
```

🔑 **4 个类却有 8 份配置**——因为它的价值在**配置**，不在代码。所有服务都依赖它，就都自动获得了"Nacos 怎么连"的能力。

---

## 八、自检题（答不上就回去看对应小节）

- [ ] "库模块"和"服务模块"的唯一区别是什么？（§1.1）
- [ ] `mvn install` 之后东西去哪了？为什么启动服务前必须先做这一步？（§1.3）
- [ ] 为什么 `Workday` 里看不到 `getId()`？（§二 ①）
- [ ] `@TableField(exist = false)` 不加会报什么错？（§二 ③）
- [ ] POJO 的三个"不"是什么？（§二末）
- [ ] 给你一个 `IdcRoomVO`，你怎么判断它是 Entity 还是 VO？（§三）
- [ ] Controller / Service / Mapper 各自**不允许**写什么？（§4.1）
- [ ] Mapper 是接口，方法没有实现，为什么能调用？（§4.2 铁律一）
- [ ] 看到 `selectByExample` 你该去哪找 SQL？看到 `selectById` 呢？（§5.3）
- [ ] 数据库返回的"行"是怎么变成一个 Java 对象的？（§六 第 ⑦ 步）

---

## 九、附：源码里「看不见」的 10 条规则

读这个仓库时，有一批东西**源码里根本看不到，却真实生效**。它们不是本项目的特殊设计，而是 Java 和 Spring 的基本规则——但没人给你列过，所以单独收在最后。每条都配了本仓库的真实例子和数字（统计口径：全仓 **9975** 个 `.java` 文件）。

### 1. 同包不用 import，而 import 本身只是省字

`JobConfigProperties` 里写着 `private JobExecutorProperties executor;`，却从头到尾没有 `import JobExecutorProperties`。因为两个文件第一行都是 `package com.didi;`—— **同一个包里的类型互相天然可见**。

反过来说，`import` 并不「引入文件」，它只是把 `com.didi.JobExecutorProperties` 这个全名缩写成短名。 Java 编译和运行的单位是**类型**，不是文件。你一旦接受这一点，「它怎么找到那个文件」就不再是个问题：编译器靠的是**目录结构对应包名**（`com/didi/Xxx.java` → `com.didi.Xxx`），运行时靠 classpath。

如果那个类当初放在 `com.didi.job` 包下，你就**必须**写 import，否则编译报「找不到符号」。

### 2. Lombok：getter 和 log 是编译期生成的

源码里看不到 `getId()`，也看不到 `log` 这个变量，但它们真的存在。`@Data` 让编译器生成 getter/setter/`equals`/`hashCode`/`toString`，`@Slf4j` 注入一个 `private static final Logger log`。

全仓 **2677** 个文件用 `@Data`、**1685** 个用 `@Slf4j`——这不是少数派写法，是主流写法。 IDE 的「跳转到定义」能跳过去，因为字节码里确实有这些方法。

### 3. 注解不会自己生效，一定有人在某处读它

`@CmpRequestHeader CmpHeader headers` 这行参数，看着像"框架自动帮我填好"，其实是 `S-cmp-starter` 里的 `CmpHeaderMethodArgumentResolver` 在解析，而它又要靠 `CmpWebMvcConfiguration.addArgumentResolvers` 注册进 Spring MVC 才生效。三件事分散在三个文件里，缺一件这个注解就是纯注释。

全仓只有 **2 个**自定义注解：`CmpRequestHeader`（上面这个）和 `Pii`（由 MyBatis 插件 `PiiInterceptor` 处理）。它们的共同规律是：**注解只是标记，真正的逻辑在别处的解析器或拦截器里**。找不到解析器，就别指望它有效果。

### 4. `@Autowired List<T>` 拿到的是「全部实现」

写 `@Autowired private List<CvmEvent> eventList;`，Spring 会把容器里**所有** `CvmEvent` 实现塞进来。全仓有 **66** 处这种集合注入，最典型的一处再配合 `toMap(...)` 就变成了「按 key 找实现」的注册表—— 这就是 [[12-设计模式、最佳实践与设计缺陷]] §2.1 讲的策略模式落地方式。

⚠️ 这也意味着：新增一个实现类，调用方**不用改一行代码**；但也意味着实现类重复注册 key 时，`toMap` 会在启动时抛 `IllegalStateException`。

### 5. 配置文件里的 key 是「宽松绑定」，写法不止一种

`@ConfigurationProperties(prefix = "xxl.job")` 里的字段 `adminAddresses`，能匹配配置里的 `adminAddresses`、`admin-addresses`、`admin_addresses` 等写法。 Spring 故意做了这层模糊匹配，所以**不要**看到大小写或横杠不一致就以为没配上。

全仓 **111** 个文件用了 `@ConfigurationProperties`，是中大型项目里最常见的配置收口方式。

### 6. `@NestedConfigurationProperty` 表示「这个字段是下一层配置」

全仓只有 **1 处**，就是你看到的那行：

```java
@NestedConfigurationProperty
private JobExecutorProperties executor;
```

它的作用是告诉 Spring：`xxl.job.executor.*` 这些 key 不要当普通值绑，而要**新建一个对象**再往里绑。没有它，绑定行为取决于字段类型是否有 setter 等条件，容易出现"配置写了却没生效"。这个注解不影响 `import`，也不影响类的可见性——它纯粹是给**运行时**看的元数据。

### 7. 接口可以没有实现，照样能调用

`*Mapper.java` 是接口，里面只有方法签名，没有实现；Dubbo 的 `S-xxx-dubbo` 也是只给接口。 Java 语言层面允许接口没有实现类（只要有东西在运行时提供实现）。这里的实现来源是两个动态代理： MyBatis 按方法名和 XML 生成 SQL，Dubbo 按接口名发起 RPC。

所以「这方法点进去没有实现」在这个仓库里是**正常现象**，不是代码残缺。找 SQL 去 XML 或 `QueryWrapper`，找 RPC 实现去对应服务。

### 8. `@Profile` 决定这个 `@Bean` 到底存不存在

`S-job-starter` 的 `JobAutoConfig` 上写着 `@Profile({"test","prod","prodhnd","canoe","pretest"})`，**没有 dev**。所以本地（dev）启动时那个执行器 bean 压根不会被创建—— 你看到的 xxl-job 报错不是配置错，是条件没满足。

判断一个 bean 到底有没有，不能只看有没有写 `@Bean`，还要看它头上有没有 `@Profile`、`@ConditionalOnProperty`、`@ConditionalOnBean`。全仓 **35** 个文件用了这类条件注解。

### 9. `@SuppressWarnings` 是让编译器闭嘴，不是修好问题

全仓 **88** 个文件带 `@SuppressWarnings`。`S-cmp-api-starter` 的 `CmpOfferingApiController` 上写着 `@SuppressWarnings("unchecked")`，但方法体里只有 `return HttpResult.ok(data);`，**没有任何 unchecked 操作**——这个注解属于仪式性复制，删掉也不会有一行警告。

看到 `@SuppressWarnings` 时值得多问一句：被警告的到底是什么？如果答不上来，多半是某个模板里抄下来的。真正的泛型强转（`(List<Foo>) obj`）才需要它。

### 10. Kotlin 混编：扫 `.java` 会漏

全仓有 **402** 个 `.kt` 文件。`S-ServicesCmdb/S-network-device-service` 的启动类`NetworkDeviceApplication` 就是 Kotlin 写的，所以按 `*Application.java` 去数服务会**少数一个**（42 个可启动服务 vs `svc.sh` 的 41 个，就差在这里）。

建索引、搜实现、找启动类时，用 `*Application.*` 而不是 `*Application.java`。

### 顺带两条小的

接口里的 `default` 方法全仓有 **53** 处——它们是"接口里带的实现"，不是抽象方法，看到 `default` 就知道这个方法有默认行为、子类可以覆盖也可以不覆盖。`@Aspect` 只有 **17** 个文件，说明这个项目更倾向用 MyBatis 插件和 Spring 扩展点做横切，而不是堆切面。

---

## 相关笔记

- [[00-总览与学习地图]] · [[01-术语表]] · [[02-模块地图]] · [[03-POJO 与 DAO 层]] · [[04-starter 是什么]] · [[05-服务是怎么启动的]] · [[06-启动与部署]] · [[07-技术TODO]] · [[08-日志治理]] · [[09-Dao 与 Entity 设计]] · [[10-指标上报链路]] · [[11-数据存储与分层]] · [[12-设计模式、最佳实践与设计缺陷]] · [[13-Nacos 面试题设计与评分卡]] · [[14-系统生命周期全景]]
