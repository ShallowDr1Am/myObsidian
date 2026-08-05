# 微前端 Module Federation 模块实例分裂

## 背景

STAR 平台采用 `single-spa + Module Federation` 微前端架构。`star-commons` 是公共能力层（单独仓库、单独部署为 UMD 全局 `star-commons.js`），各 `star-*` 子应用按业务域拆分。

某次出现一个诡异的 bug：**从 netplat 工单详情页经菜单跳转到 VIP 管理页（`/netplat/dgw/vip`）时，列表 query 请求不发**。本地开发完全正常，部署到服务器才复现；浏览器刷新后又正常。

---

## 现象与排查过程

### 现象

- 工单页是**新开标签页**打开的，然后点菜单跳转到 VIP 管理页
- 列表请求 `/lvs/vip/query` 完全不发出（Network 面板无此请求）
- 手动点「查询」按钮、点产品树节点，**都不发请求**
- 浏览器刷新（F5）后正常，列表能加载 1708 条数据
- 只有 **netplat 工单**入口触发，其他工单入口正常

### 逐步排除（每一步都被后面的证据推翻，记录踩坑过程）

#### 1. 误判：FilterCard 去重锁 / 触发时序

最初怀疑是 `FilterCard` 里 `lastSearchKeyRef` 去重锁或 effect 触发时机问题，加了 `mountedRef` 强制首屏搜索、把 `useMutation` 改成 `useQuery`——**都没用**。

> 教训：现象是「请求完全没发」，应先确认请求到底走到哪一步，而不是猜触发逻辑。

#### 2. 加诊断日志定位

在搜索链路各节点加 `[VIP_SEARCH]` 日志部署到服务器，发现：

```
queryFn 发起请求 searchVip  ✅ 打了
mutationFn 发起请求         ✅ 打了
mutationFn 收到响应          ❌ 没打
mutation onError: TypeError: (0, m.wH) is not a function
```

**关键**：请求触发了，但 `searchVip` 调用时抛 `TypeError: (0, m.wH) is not a function`。`(0, m.wH)` 是 webpack 压缩后「从模块对象取方法调用」的典型形态——`m` 是某个 import 的模块对象，`wH` 是它上面的方法，运行时是 `undefined`。

#### 3. 误判：react-query 双实例

看到堆栈里 `fetchFn` 在 `star-commons.js`，一度怀疑是 react-query 双实例（star-commons 和 star-netplat 各打包了一份）。把 `QueryClient`/`QueryClientProvider` 统一改用 `request.tsQuery`——**还是没用**。

#### 4. 误判：federation external/shared 不一致

一度怀疑 `star-commons`/`axios` 声明为 external 但没进 federation `shared`，导致远程组件加载时污染。改 `pkg-local-config` 把它们加进 shared——**也没用，已回退**。

#### 5. 决定性日志：searchVip 是 undefined

在 `queryFn` 里拆步打日志：

```
queryFn step1 进入                ✅
queryFn searchVip 类型: undefined  ❌ ← 就是这里！
queryFn step3 即将调用 searchVip
queryFn 捕获错误: (0, m.wH) is not a function
```

**`searchVip` 这个 import 在异常入口下是 `undefined`！** 调用 `undefined(params)` 抛错，webpack 压缩成 `(0, m.wH) is not a function`。

但同模块的 `getAllIdcRegions`、`getAllCostAccounts`（机房/成本账户下拉）却正常——同一个 `apply.ts` 模块，有的导出在、有的不在。

#### 6. 决定性对比：rs-manage 正常

用户提出：**`/netplat/dgw/rs-manage` 的请求都正常**。

对比发现：
- `api/vip/apply.ts`（出问题的）→ 同时被 **federation 远程组件**（`RsOrderDetail`/`VipOrderDetail`）和**本地页面**（Home/FilterCard）引用
- `api/rs.ts`（正常的）→ 只被本地页面（rs-manage）引用，**不进 federation**

两者模块顶层写法**完全一样**（都 `request.createRequestMethod(...)`），但 rs 正常、apply 不正常——**排除 `request`/`createRequestMethod` 本身的问题**，问题在 `apply.ts` 被 federation 共享。

#### 7. 确认触发条件

用户确认：**只有 netplat 工单触发**（因为只有 netplat 工单详情页会加载 `RsOrderDetail`/`VipOrderDetail` 远程组件）。

---

## 根因

**同一个模块（`apply.ts`）既被 Module Federation 远程组件引用，又被本地页面引用 → 模块实例在 federation shared scope 下分裂。**

完整因果链：

1. 打开 netplat 工单详情页（在 star-order 子应用里）→ `loader.withRemoteComponent('netplat', 'RsOrderDetail')` 加载远程组件
2. 远程组件 chunk 里 `import ... from '@/api/vip/apply'` → webpack 把 `apply.ts` 编译进**远程组件 chunk**，并在 federation `init` 时注册到 shared scope
3. 菜单跳到 VIP 管理页 → star-netplat 子应用激活 → Home/FilterCard 本地 `import { searchVip } from '@/api/vip/apply'`
4. webpack 发现 `apply.ts` 已在 shared scope（远程组件注册的）→ **复用那个实例**，而不是本地重新加载
5. 但那个远程实例是个**部分初始化/分裂的模块对象**，`searchVip` 绑定还是 `undefined` → 调用报 `(0, m.wH) is not a function` → 请求在构造阶段就炸了，Network 里看不到

**为什么本地正常、服务器复现**：本地 dev 模式模块解析时序与服务器 federation 加载不同，本地不易触发实例分裂；服务器上工单页先加载远程组件提前 init shared scope，本地页面随后取到分裂实例才暴露。

**为什么 rs-manage 正常**：`api/rs.ts` 不被任何 federation 远程组件引用，不进 shared scope，始终本地单一实例。

**为什么刷新正常**：刷新是整页重载，star-netplat 重新 mount，不经过「远程组件先加载」的污染时序，`apply.ts` 本地单一实例正常。

---

## 修复

**把远程组件用到的接口从 `apply.ts` 拆到独立文件 `apply-order.ts`，远程组件改 import 新文件。**

```ts
// apply-order.ts（新文件，只被远程组件引用）
import { request } from 'star-commons';
const dgwFetchDefault = request.createRequestMethod('/smart/dgw', {...});

export const getOrderVipInfo = ...;    // 远程组件用的工单接口
export const executeOrder = ...;
export const approveOrder = ...;
// ...
```

三个 federation 远程组件（`RsOrderDetail`/`VipOrderDetail`/`DsiUnbindOrderDetail`）改 import 路径：

```diff
- } from '@/api/vip/apply';
+ } from '@/api/vip/apply-order';
```

修复后：
- `apply-order.ts` 进 federation shared（被远程组件用）——但它只被远程组件用，不存在「先别人加载、后本地取分裂实例」
- `apply.ts` **不再被远程组件引用** → 不进 shared scope → 本地页面始终单一实例 → `searchVip` 正常

---

## 核心规律

**Module Federation 下，一个模块如果同时被远程组件和本地页面引用，会进入 shared scope 被共享，导致本地页面取到「远程组件提前初始化的、可能不完整的实例」。**

判断一个 bug 是否属于此类，看三个特征：
1. 本地正常、服务器复现（federation 加载时序差异）
2. 某入口触发、其他入口正常（只有加载远程组件的入口才污染 shared scope）
3. 报错是 `(0, x.y) is not a function`（import 绑定是 undefined）

排查方法：
- 在调用处打 `typeof 某函数`，看是不是 `undefined`
- 对比正常入口与异常入口：正常入口用的是什么模块？它是否进 federation？
- grep 远程组件（fetk.config `exposes` 里的）import 了哪些本地模块——这些模块就是「分裂源」

修复原则：**被 federation 远程组件引用的模块，和被本地页面引用的模块，尽量分离**，避免同一模块跨 shared scope 与本地双实例。

---

## 对照：为什么 star-commons 里的 react-query 不会分裂

一个自然的疑问：`react-query`（`@tanstack/react-query`）也是全平台多处用到（star-commons 和各子应用），它会不会像 `apply.ts` 一样分裂？

**不会。** 因为 `star-commons` 整个是 **external UMD 全局**，根本不进 federation shared scope。

### 配置证据

```ts
// pkg-local-config/src/build-config/index.ts
webpack.externals?.push(...[/^star-commons$/, /^axios$/]);
```

`/^star-commons$/` 被推进 `webpack.externals`，意味着子应用（无论 host 还是 remote）**编译时不打包 star-commons**，运行时 `require('star-commons')` 被 webpack 替换成读全局变量 `window['star-commons']`。

### 三层原因

1. **commons 是 external 全局单例，不进 shared scope**
   `star-commons` 由 star-root（壳应用）的 `index.html` 用 `<script>` 标签加载成 UMD bundle，挂到 `window['star-commons']`。全平台**只有一个实例**。federation 的 `__webpack_init_sharing__('default')` / `__webpack_share_scopes__.default` 这套机制**完全不碰它**——commons 的解析路径是 externals 的 `module.exports = window['star-commons']`，跟 federation shared chunk 是两条独立路径。

2. **host runtime 时序污染不到它**
   实例分裂的根因是「host 先加载远程组件时提前 init shared scope 并初始化了某个应用内模块，本地页面随后取到被时序污染的实例」。但 commons 不在 shared scope 里，`init` 阶段不会注册它、不会初始化它。host/runtime 时序再乱，也污染不到一个从 `window` 读的固定引用。

3. **host 和 remote 拿同一个对象引用**
   - host（star-order）`import { xxx } from 'star-commons'` → 读 `window['star-commons'].xxx`
   - remote（star-server 的联邦组件）`import { xxx } from 'star-commons'` → 也读 `window['star-commons'].xxx`
   - 同一个对象、同一个 `QueryClient` 实例——双实例问题在 commons 这层天然不存在。

### 一句话区分

| 维度 | `@/api/vip/apply.ts`（会分裂） | `star-commons`（不分裂） |
|---|---|---|
| 打包方式 | 子应用 src 内模块，进 federation shared async chunk | external UMD 全局 `window['star-commons']` |
| 是否进 shared scope | 进（被远程组件 exposes 依赖） | 不进（externals 解析） |
| host/remote 引用 | shared scope 复用 → 时序污染 → 部分 `export` undefined | 同一个 `window` 对象引用 |
| 修复方向 | 拆独立文件物理隔离 | 无需修复，架构免疫 |

所以「拆 api 文件」这个修复手段**只对应用内 shared 模块有效**；commons 这种 external 全局单例，分裂机制根本触不到它。也正因如此，把 `star-commons` 改成 federation `shared`（早期踩坑里试过、已回退）反而会引入分裂风险——它一旦进了 shared scope，就脱离了 externals 的全局单例保护。

---

## 附：相关配置

```ts
// pkg-local-config/src/build-config/index.ts
// 子应用 federation 配置
new webpack.container.ModuleFederationPlugin({
  name: `${pkg}@federation-entry`,
  filename: 'federation-entry-[hash].js',
  exposes,              // 暴露的远程组件
  shared: {
    react: { singleton: true, eager: true },
    'react-dom': { singleton: true, eager: true },
    // star-commons / axios 是 external（单独部署），不在 shared 里
  },
}),
```

```ts
// star-commons/src/loader/loader.tsx
// 远程组件加载时初始化 shared scope
await __webpack_init_sharing__('default');
await federationEntryModule.init(__webpack_share_scopes__.default);
const exportedComponentEvaluator = await federationEntryModule.get(exposeName);
```

> `init` 会把远程组件依赖的模块（含 `@/api/vip/apply` 这类子应用内部模块）注册进 shared scope，这是分裂的起点。
