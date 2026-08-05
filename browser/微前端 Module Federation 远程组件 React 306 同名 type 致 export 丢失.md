# Module Federation 远程组件 React #306：type import 与组件同名致 export 注册丢失

> 配套阅读：《微前端 Module Federation 模块实例分裂.md》《微前端 Module Federation 多共享池 ShareScope.md》。本篇讲一个更隐蔽的坑：模块求值成功，但联邦运行时拿到的模块对象是空的（`default: undefined`），导致 React lazy 报 #306。

## 现象

STAR monorepo（webpack5 原生 `ModuleFederationPlugin` + swc）里新建了一个联邦 expose 组件，host（star-order）经 `loader.withRemoteComponent` 加载时报：

```
Minified React error #306
invariant=306&args[]=undefined
```

React 17 的 #306 含义：**Element type is invalid. Received a promise that resolves to: %s. Lazy element type must resolve to a class or function.** —— 即 `React.lazy` 解析后拿到的组件是 `undefined`。

## 排查中踩的坑（先排除的误判）

1. **不是实例分裂**：模块求值日志正常打印，所有 import 绑定 `typeof` 都正常（`React: object`、`order: object`、`getPlacementCreateOrderDetail: function`…）。分裂症状是部分 `export const` 绑定为 `undefined`，这里是整个 `default` 没有。
2. **不是 expose 名不匹配**：`fetk.config.js` 的 `exposes` key 和 `loader.withRemoteComponent` 传入的一致，federation-entry 里 factory 存在。
3. **不是 React Refresh（HMR）包装**：对比能跑的旧 expose，同样有 `$ReactRefreshModuleRuntime$` 包装，照样能拿到 `default`。
4. **不是 loader 的 init shared scope 时序**：手动 `fed.get(exposeName)()` 拿到的模块对象就是空的。

## 真根因

**联邦 expose 的组件文件里，组件 const 的名字与一个 `import type` 引入的类型同名。** swc 在 dev 模式转译时，`export default <同名标识符>` 没有生成 `__webpack_require__.d(__webpack_exports__, { default: ... })` 注册代码。

问题代码：

```tsx
// 从 api 文件 import 一个类型，名叫 PlacementCreateOrderDetail
import type {
  PlacementCreateOrderDetail,   // ← 类型：工单详情数据结构
  ExclusiveResourceRecord,
} from '@/api/placement';

// 本地组件 const，也叫 PlacementCreateOrderDetail
const PlacementCreateOrderDetail: React.FC = () => { ... };

// export default 用了这个同名的标识符
export default PlacementCreateOrderDetail;
```

webpack 打包后的 chunk 里，该模块只有：

```js
__webpack_require__.r(__webpack_exports__);   // 标记为 ES 模块
// ❌ 缺少：__webpack_require__.d(__webpack_exports__, { default: ... });
```

所以联邦运行时 `evaluator()` 返回的模块命名空间对象是 `{ __esModule: true }`——**空的，`default` 是 undefined**。对比正常的 expose 模块，会有 `__webpack_require__.d(__webpack_exports__, { default: () => XxxComp })`。

## 验证方法

在 host 页面控制台手动复现 loader 的联邦加载，看模块对象：

```js
(async () => {
  const pp = window.StarAppConfList.server.publicPath;
  const html = await fetch(pp + 'index.html').then(r => r.text());
  const m = html.match(/content="(manifest-[^"]+)"/);
  const manifest = await fetch(pp + m[1]).then(r => r.json());
  const fedFile = manifest.assetsByChunkName['star-server@federation-entry'].find(f => f.endsWith('.js'));
  const fed = await window.System.import(pp + fedFile);
  const evaluator = await fed.get('placementCreateOrder');
  const comp = evaluator();
  const s = comp?.then ? await comp : comp;
  console.log({
    keys: s ? Object.keys(s) : 'null',          // 异常：[]
    defaultFn: typeof s?.default === 'function', // 异常：false
    hasEsModule: !!s?.__esModule,                // true（空模块也有这个标记）
  });
})();
```

异常时 `keys: []`、`defaultFn: false`；正常时 `keys: ['default']`、`defaultFn: true`。

对比同 host 下能跑的其它 expose（`placementRuleOrder`、`deliveryApply`），它们的模块对象 `keys: ['default']`、`defaultFn: true`，唯独新加的这个是空的——就能锁定是新组件文件本身的问题。

再拉该 expose 实际所在的 async chunk 文件，grep 模块体：

```bash
# chunk URL 从 federation-entry 的 chunk map 拿（chunkId + contenthash）
curl -s "http://localhost:3002/<chunkId>-<hash>.js" | grep -oE '__webpack_require__\.d\(__webpack_exports__[^}]*\}'
```

异常模块匹配不到 `__webpack_require__.d`，正常模块能匹配到。

## 修复

**让组件名和 import 的类型名不冲突**。改组件 const 的名字（加 `Comp` 后缀）：

```tsx
import type {
  PlacementCreateOrderDetail,   // 类型名保持不变
} from '@/api/placement';

const PlacementCreateOrderDetailComp: React.FC = () => { ... };  // 组件改名

export default PlacementCreateOrderDetailComp;
```

改完重新编译，模块对象立刻变成 `{ default: [Function] }`，#306 消失，组件正常渲染。

## 为什么 dev 模式才暴露

- **生产构建**（`fetk build`，`mode=micro fetk build`）走的是压缩 + tree-shaking + 完整 esModule 转换，`export default` 能正确生成 `__webpack_require__.d` 注册，所以生产环境不会 #306。
- **dev 构建**（`fetk dev`）用 swc 快速转译 + React Refresh 注入，`import type` 的擦除和同名标识符的解析在 dev 下更脆弱，容易漏掉 export 注册。
- 所以这是**只在 dev 模式联邦加载时才出现的坑**，本地非联邦页面（同一模块直接 import）也不触发，因为不走联邦的 `evaluator()` 取命名空间对象那条路。

## 教训

1. **联邦 expose 的组件文件里，组件名不要和 `import type` 的类型同名。** 即使 TS 允许（type 和 value 命名空间分离），swc dev 转译会出问题。统一加 `Comp` / `Component` 后缀，或类型加 `Props` / `Data` 后缀。
2. **#306 + 模块求值日志正常** → 不是实例分裂，是 export 注册丢失。优先查 expose 文件有没有"同名 type + const + export default"。
3. **手动 `fed.get(name)()` 看模块对象 keys** 是判断联邦 export 是否注册的最快手段，比读 chunk 源码快。
4. 排查时别被 webpack 默认 splitChunks 把多个模块合并到一个 async chunk（chunkId 拼接多个模块名）干扰——合并本身不会导致 export 丢失，能跑的 expose 也会被合并。

## 关联

- 实例分裂（`export const` 绑定 undefined、请求不发）：见《微前端 Module Federation 模块实例分裂.md》，根因不同（共享 async chunk 经 host runtime 时序污染），解法是拆 api 文件物理隔离。
- 本篇根因是 export 注册代码没生成，解法是改名避冲突，和拆文件无关。
- 多共享池治不了这两个问题：见《微前端 Module Federation 多共享池 ShareScope.md》。
