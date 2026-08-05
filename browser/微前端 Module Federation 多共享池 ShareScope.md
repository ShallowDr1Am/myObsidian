# 微前端 Module Federation 多共享池（Share Scope）

> 配套阅读：《微前端 Module Federation 模块实例分裂.md》。那篇讲「单池下实例为什么会分裂、怎么拆文件规避」；本篇讲「多池（Share Scope）是什么、能解决什么、**为什么在我们项目里用不上**」。

## 一句话

Module Federation 默认所有共享依赖都注册在名为 `default` 的**唯一共享池**里。多共享池（Share Scope）就是给共享依赖**按名字分组**，让不同业务域 / 版本 / 灰度的依赖各用各的池，互不影响。

## 什么时候需要多池

单 `default` 池不够用的场景：

- **两套 React 生态并存**：host 用 React 18，某个老 remote 还在 React 16，不想互相污染 singleton。
- **灰度升级**：新版本依赖只对灰度流量生效，老流量继续用旧版本。
- **微前端子域隔离**：A 子域和 B 子域各自维护一套共享依赖，不跨域复用。
- **同一个包在不同业务域用不同版本 / 策略**，但各自域内仍可 singleton 复用。

核心价值：**把共享依赖的「注册」与「解析」切到不同的命名空间（Scope）**，实现共享池隔离与策略分层。

## 三个配置项速览

只看「生产者怎么配」「消费者怎么配」「shared 条目落在哪个池里」：

| 角色 | 配置项 | 作用 | 默认 |
|------|--------|------|------|
| 生产者 | `shareScope`（顶层） | 声明该 Provider 会**初始化**哪些共享池 | `'default'`（string \| string[]）|
| 消费者 | `remotes[remote].shareScope` | 声明与某个 Consumer 需要**对齐**哪些共享池 | `'default'` |
| shared 条目 | `shared[pkg].shareScope` | 决定某个依赖注册 / 解析在哪个池 | `'default'` |

> **规则速记：共享池由消费者提供，由生产者初始化**。消费者没列出的 Scope 会被补成 `{}`（不崩，但该 Scope 下 shared 无法从消费者复用，回退到本地依赖）；生产者没列出的 Scope 不会被初始化。两边都列出，shared 才能真正在该 Scope 下复用。

## 配置组合效果

HostShareScope = 消费者侧 `remotes[remote].shareScope`；RemoteShareScope = 生产者侧 `shareScope`。

| HostShareScope | RemoteShareScope | 共享池行为 |
|----------------|------------------|-----------|
| `'default'` | `'default'` | `default` 完全共用 |
| `['default','scope1']` | `'default'` | 仅 `default` 共用；`scope1` 不会被生产者初始化 |
| `'default'` | `['default','scope1']` | `default` 共用；`scope1` 消费者未提供（补成 `{}`），其下 shared 无法复用，回退本地 |
| `['scope1','default']` | `['scope1','scope2']` | `scope1` 共用；`scope2` 消费者未提供，回退本地 |

### ⚠️ 不要写成数组单元素或空数组

- **单个 Scope 用字符串，不要用数组**：`'default'` ✅，`['default']` ❌。两者在「共享池对齐 / 初始化」分支上的实现不同——消费者配数组、生产者配字符串时，生产者按消费者列表对齐；生产者配数组时只按生产者列表处理。
- **空数组 `[]`**：没有任何 Scope 被初始化（既不初始化 `default` 也不对齐其它），是错误配置。

## 构建插件配置

### 生产者

```ts title="remote/rspack.config.ts"
new ModuleFederationPlugin({
  name: 'app_remote',
  filename: 'remoteEntry.js',
  exposes: { './Button': './src/Button' },
  shareScope: ['default', 'scope1'],   // 运行时会初始化这两个 Scope
  shared: {
    react: { singleton: true, requiredVersion: false, shareScope: 'default' },
    'react-dom': { singleton: true, requiredVersion: false, shareScope: 'default' },
    '@company/design-system': { singleton: true, requiredVersion: false, shareScope: 'scope1' },
  },
})
```

- `shareScope: ['default','scope1']` 决定 remoteEntry 运行时初始化哪些 Scope。
- `shared[pkg].shareScope` 决定该包最终注册 / 解析时用哪个池。`@company/design-system` 放 `scope1` → 只在 `scope1` 池里参与版本选择与复用。

### 消费者

```ts title="host/rspack.config.ts"
new ModuleFederationPlugin({
  name: 'app_host',
  remotes: {
    app_remote: {
      external: 'app_remote@http://localhost:2001/remoteEntry.js',
      shareScope: ['default', 'scope1'],   // 运行时初始化生产者时，把这两个 Scope 作为 shareScopeKeys 传入
    },
  },
})
```

- 消费者配多 Scope 但生产者仍是单 Scope：生产者会对齐 scopeMap，但只初始化单 Scope 的 sharing。**多池要真正生效，通常需要两侧都配一致。**

## 纯运行时（Runtime API）配置

不通过构建插件声明时（动态注册场景）：

- **注册生产者**：`registerRemotes` / `createInstance({ remotes })`，每条配置用 `shareScope: string | string[]` 声明对齐的池。
- **注册共享依赖**：`registerShared` / `createInstance({ shared })`，每条用 `scope: string | string[]` 决定落在哪个池。

> ⚠️ **字段名差异**：注册共享依赖时是 **`scope`**，不是 `shareScope`（与构建插件的 `shared[pkg].shareScope` 不一致）。

```ts title="host/runtime.ts"
import React from 'react';
import { registerRemotes, registerShared } from '@module-federation/enhanced/runtime';

registerRemotes([
  { name: 'app_remote', alias: 'remote', entry: 'http://localhost:2001/mf-manifest.json', shareScope: ['default', 'scope1'] },
]);

registerShared({
  react: { version: '18.0.0', scope: 'default', lib: () => React, shareConfig: { singleton: true, requiredVersion: '^18.0.0' } },
  '@company/design-system': { version: '1.2.3', scope: 'scope1', lib: () => require('@company/design-system'), shareConfig: { singleton: true, requiredVersion: false } },
});
```

## Runtime Hook 精细控制

多 Scope 的本质是「把共享池按名称分组」。需要更细粒度控制 Scope 选择 / 对齐 / 回退时，用 Runtime Hook 在 init 阶段或共享解析阶段介入。

### 1. 按生产者动态改写 shareScopeKeys（beforeInitContainer）

让 `legacy_remote` 永远用 `legacy` Scope：

```ts title="multi-scope-policy-plugin.ts"
export function multiScopePolicyPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: 'multi-scope-policy',
    async beforeInitContainer(args) {
      if (args.remoteInfo.name !== 'legacy_remote') return args;
      const hostShareScopeMap = args.origin.shareScopeMap;
      if (!hostShareScopeMap.legacy) hostShareScopeMap.legacy = {};
      args.remoteEntryInitOptions.shareScopeKeys = ['legacy'];
      return { ...args, shareScope: hostShareScopeMap.legacy };
    },
  };
}
```

### 2. Scope 缺失时别名 / 回退（initContainerShareScopeMap / resolveShare）

- `initContainerShareScopeMap`：生产者初始化共享池过程中，对每个 Scope 的映射做改写。
- `resolveShare`：改写 `args.resolver` 改写最终选择结果。注意只返回 `{ ...args, scope: 'default' }` 并不会真的切过去。

`scope1` 找不到某包时回退 `default`：

```ts title="scope-fallback-plugin.ts"
export function scopeFallbackPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: 'scope-fallback',
    resolveShare(args) {
      const current = args.shareScopeMap[args.scope]?.[args.pkgName]?.[args.version];
      if (current) return args;
      args.resolver = () => {
        const fallbackVersionMap = args.shareScopeMap.default?.[args.pkgName];
        if (!fallbackVersionMap) return undefined;
        const fallbackShared = fallbackVersionMap[args.version] ?? Object.values(fallbackVersionMap)[0];
        if (!fallbackShared) return undefined;
        return { shared: fallbackShared, useTreesShaking: false };
      };
      return args;
    },
  };
}
```

把 `scope1` 直接别名到 `default`（两个 Scope 共用同一个池）：

```ts title="scope-alias-plugin.ts"
export function scopeAliasPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: 'scope-alias',
    initContainerShareScopeMap(args) {
      if (args.scopeName !== 'scope1') return args;
      if (!args.hostShareScopeMap?.default) return args;
      args.hostShareScopeMap.scope1 = args.hostShareScopeMap.default;
      return { ...args, shareScope: args.hostShareScopeMap.default };
    },
  };
}
```

## ⚠️ 在我们 STAR 项目里用不上（重要反差）

上面所有 API（`shareScope: ['default','scope1']`、`registerShared`、`beforeInitContainer`、`shareScopeMap`、`resolveShare`）都属于 **`@module-federation/enhanced`（Rspack 新运行时）**。

**STAR 项目用的是 webpack 5 原生 `ModuleFederationPlugin`，不是 enhanced**：

- `pkg-local-config/src/build-config/index.ts` 里直接 `new webpack.container.ModuleFederationPlugin({ name, exposes, shared })`，`shared` 只配了 `react` / `react-dom`（singleton）。
- 加载侧 `star-commons/src/loader/loader.tsx` 用的是 `__webpack_init_sharing__('default')` + `federationEntryModule.init(__webpack_share_scopes__.default)`——这是 webpack 原生的**全局单 `default` 池**，没有 `shareScopeMap`、没有多池概念。
- 要用多池，得迁到 `@module-federation/enhanced`（换构建链 Rspack + 改 loader），是整个仓库级别的大改，不值得。

### 而且多池也治不了「实例分裂」

《模块实例分裂》那篇记的根因是：**应用内模块（`src/...` 下的 api / 组件）被远程 expose 组件和本地页面同时 import，进入 webpack 默认 splitChunks 的共享 async chunk，经 host（star-order）`init shared scope` 后实例半初始化、部分 `export const` 绑定变 `undefined`**。

多池解决的是「两个共享包版本冲突 / 域隔离」，**不是**「同一份代码实例被 host runtime 时序污染」。即使有多池，只要业务模块仍走共享 async chunk，分裂依旧。对症解法仍是**拆文件物理隔离**（远程组件独享一份 api，如 `api/vip/apply-order.ts`、`api/placement-order.ts`），让远程组件和本地页面加载不同的 chunk，不经过 host runtime 的共享 async chunk 解析。

| 问题 | 多池能解决？ | 对症解法 |
|------|------------|---------|
| 两套 React 版本共存 | ✅ | 多池（enhanced）|
| 灰度升级依赖版本隔离 | ✅ | 多池（enhanced）|
| 子域共享依赖隔离 | ✅ | 多池（enhanced）|
| 实例分裂（请求不发、`export const` undefined）| ❌ | 拆文件物理隔离（见《模块实例分裂》）|

## 参考链接

- enhanced 多池文档：shareScope / remotes.shareScope / shared.shareScope
- 配套：《微前端 Module Federation 模块实例分裂.md》
