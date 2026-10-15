# audit-server 规则引擎解读 — 自研 DSL 解释器

> 项目里最有后端含金量的 5000 行：`src/utils/audit-context/`（占全库 26%）。
> 定位：这不是 if-else 集合，是一个**披着 CRUD 外皮的小型解释器项目**。读透它 = 同时学会元编程、惰性求值、沙箱安全。

---

## 全景：它解决什么问题

工单审计规则由运营人员在**前端编辑器**配置（不是写代码），后端要把这些配置变成可执行的审计逻辑。三块能力：

```
① 字段元数据 → 前端编辑器"选工单字段"下拉框的数据来源
② 断言/变换算子 → 前端"配置规则"的积木块（如"部署集群 等于 xxx"）
③ 链式调用 → 一条规则的执行载体（lazy 收集 + 统一求值）
```

**核心设计决策：规则不是数据驱动的硬编码（switch-case），而是算子驱动的 DSL**——新增一种审计能力 = 注册一个新算子，不用改执行引擎。

---

## 模块一：声明式元数据（describes.ts + @PMeta）

```ts
function PMeta(config: IPMeta) {
  return function (target: any, propertyKey: string) {
    Reflect.defineMetadata(symbolMetaKey, config, target, propertyKey);
  };
}

class AssertionPublicDescribeStore implements RuleTicketContext {
  @PMeta({ displayName: '部署集群列表', type: 'string', category: ['common', 'ticket'] })
  clusters = 'hna-v,hnb-v';

  getAllMeta() {
    return Object.getOwnPropertyNames(this)
      .map((k) => Reflect.getMetadata(symbolMetaKey, this, k))
      .filter(isObject)
      .map((meta) => ({ example: this[meta.name], ...meta }));
  }
}
```

要点：

- `reflect-metadata` + Symbol 作 key —— **把描述信息附着在字段上，运行时可枚举**。这就是 Java 注解 / C# Attribute 的 TS 手工版
- `getAllMeta()` 自省（introspection）：遍历自身属性 → 收集所有元数据 → 输出给前端。**编辑器的字段列表永远和代码里的字段定义同步**——加字段不用改前端
- 前端同构：`@PMeta` ≈ 你们给表单 schema 生成器写的字段装饰器（schema-driven form）

## 模块二：算子注册表（v4/decorators.ts）

三个装饰器构成 DSL 的"动词表"：

```ts
@Assertion({ displayName: '等于', description: '...' })   // 比较类：产出布尔
@Transform({ displayName: '取集群' })                     // 变换类：产出新值
@DefineParam({ acceptTypes: ['string', 'options'], required: true })  // 参数声明
```

被 `@Assertion` 装饰的方法**不会被立即执行**——装饰器偷换了 descriptor：

```ts
descriptor.value = function (...args) {
  // 把 args 合入当前控制栈的 right 节点
  merge(this.getOperatingStack().right, { type: 'value', valueSource: 'list',
    value: args.map(arg => arg instanceof AssertionLazyEvaluationContext
      ? { valueSource: 'field', value: arg.field }   // 左值：字段引用
      : { valueSource: 'direct', value: arg }) });   // 右值：直接量
  this.getOperatingStack().useCompare = originalMethod.name;
  this.commit();     // 提交当前节点到执行计划
  return this;       // 链式调用继续
};
```

**读这段代码的关键：链上的每一步都在"记笔记"（构建 AST 节点），不在"算题"。** `return this` 让 `t.field('clusters').equals('hna-v')` 这种链式写法成立——和 jQuery/RxJS 的 fluent API 是同一手法，区别是这里记的笔记最终要跨进程序语言边界（序列化、前端编辑器回显）。

参数注入类装饰器是另一组：

```ts
@GetLeft()            left: any      // 方法参数位置注入"左操作数"
@PutResult()          callback       // 注入"结果回写回调"
```

用 `Reflect.defineMetadata(symbolLeftInject, index, ...)` 把"第几个参数是什么角色"也记进元数据——**参数级元数据 + 运行时注入 = 迷你版依赖注入容器**。

## 模块三：惰性执行（TicketAssertionBase）

base.ts 的核心数据结构：

```ts
executionPlan: [() => typeof this, any[], (...args) => Promise<any>, number][] = [];
rootStack: IAssertionControlStackInfo = { type: 'collection', stack: [], ... };
```

`IAssertionControlStackInfo` 是一个 15+ 字段的可变控制栈（conditionStack / branchCompleted / negated / stackOperation: 'and'|'or' ...），支撑 `if/elseif/else` 分支、集合迭代、逻辑组合。

**两阶段执行 = 前端"构建期/提交期"分离的后端版**：

```
阶段一（build）：链式调用只是往 executionPlan / rootStack 里追加节点 —— 纯同步、零 IO
阶段二（execute）：统一遍历计划求值 —— 这时才发 HTTP（observable API）、查 Apollo、算结果
```

为什么这么设计：

1. **延迟求值的正确性**：`asyncTask`（如调外部 observable API）只在真正需要该节点时才执行，没被规则命中的分支不发请求
2. **可序列化**：执行计划是纯数据（JSON 可表达），前端编辑器才能回显已配置的规则（AST ↔ 配置 JSON 双向转换）
3. **速率控制成为可能**：所有出站请求集中在执行阶段，才能在入口统一过 `RateLimitLock`（滑动窗口限流）

> 同构：Vue 的"响应式依赖收集（build）→ watcher 统一触发（execute）"、React 的 render 收集 effect → commit 阶段统一执行，都是这个两阶段的变体。

## 模块四：沙箱（safe-eval.ts）—— 最近一次安全加固

规则里允许用户写表达式（如 `$ticket.gray_config_group_intervals.default` 拼逻辑），早期直接 eval，74ad9d4 提交堵上了逃逸口。三层防御：

```ts
// ① vm 隔离 + 关代码生成（防 eval('...') 套娃、防 wasm）
const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
runInContext(`(function () { return ${funcStr}; })()`, context);

// ② Proxy 膜（membrane）：所有对象包一层递归代理
get(t, prop) {
  if (BLOCKLIST.has(prop)) return undefined;   // constructor/__proto__/prototype/call/apply/bind...
  return wrapResult(Reflect.get(t, prop));      // 返回值继续包裹——访问任何东西都出不了膜
}

// ③ WeakMap 双向缓存：proxyCache（target→proxy）+ proxyToTarget（proxy→target）
//    保证同一对象拿到同一个代理（恒等性），结果 unwrap 后归还原始引用
```

经典攻击路径为什么失效：

| 攻击 | 挡在哪 |
|---|---|
| `"".constructor.constructor("return process")()` | `constructor` 在 BLOCKLIST，get 返回 undefined |
| `obj.__proto__.polluted = true` | `__proto__` 进不去；set 也被代理拦截 |
| 拿到函数后 `.call(null, ...)` 跨上下文调用 | `call/apply/bind` 全在 BLOCKLIST |
| 逃逸对象后改宿主全局 | 所有出膜返回值都被 wrapResult 重新包膜 |

**教学价值：这是"JavaScript 里如何安全执行不可信代码"的完整案例**——vm 隔离只是第一层（官方文档明说 vm 不是安全边界），真正的防线是 Proxy 膜的递归包裹 + 属性黑名单。前端同构：你们的 playground 沙箱（iframe sandbox + postMessage 通信）解决的是同一个问题，边界换成 iframe。

## 值得批评的地方（同样是学习素材）

1. **v4/index.ts 单文件 825 行**，控制栈 15+ 个可变字段手工维护——解释器状态机靠裸栈 + 布尔标记，是 bug 温床（对照成熟实现：AST visitor + 不可变节点）
2. **引擎住在 `utils/` 目录**——全项目最核心的领域资产放在"工具函数"目录，架构错位。按 DDD 它该是独立 bounded context（`src/engine/`），有自己的模块边界和测试策略
3. **any 密度较高**（executionPlan 元组、IAssertionControlStackInfo.result）——重构到强类型 AST 是最有价值的改造方向

---

## 与稳定性笔记的关系

| 这篇（骨架） | 稳定性篇（免疫） |
|---|---|
| DSL 怎么把配置变逻辑 | 逻辑跑挂了怎么不拖垮全站 |
| 惰性求值省请求 | 出站请求必须有界（timeout） |
| 沙箱防内部攻击面 | 闸门防外部依赖故障 |

两篇合起来 = 这个项目"是什么 + 怎么不死"的完整知识地图。
