# JS 模块化：CommonJS 与 ES Module

---

## 一、现状概览

### 运行时默认规范

| 运行时 | 默认规范 | 说明 |
|--------|----------|------|
| **Node.js** | CommonJS | `.js` 默认是 CJS，需配置启用 ESM |
| **Bun** | ES Module | `.js` 默认是 ESM，原生支持互操作 |
| **Deno** | ES Module | 从设计之初就只用 ESM |
| **浏览器** | ES Module | `<script type="module">` |

### 趋势

```
2010 ──────────────────────────────────────► 2025
  │                                          │
  CommonJS 统治                    ESM 成为标准
  (Node.js 专属)                   (浏览器 + 所有新运行时)
```

> 💡 **核心结论**：ES Module 是标准，CommonJS 是历史遗留。**新项目统一用 ESM**。

---

## 二、CommonJS

CommonJS 是 Node.js 的**历史默认**模块规范（2010 年设计）。

### 基本语法

```javascript
// 导出
module.exports = { name: 'foo', say: () => 'hello' };
// 或
exports.name = 'foo';

// 导入
const foo = require('./foo');  // 注意：不需要写 .js
```

### 核心特点

| 特性 | 说明 |
|------|------|
| 加载时机 | 运行时加载 |
| 加载方式 | 同步加载（阻塞） |
| 导出值 | 值的拷贝 |
| 动态导入 | 支持（可在任意位置 `require`） |
| Tree Shaking | ❌ 不支持 |

### 导出值的拷贝

```javascript
// a.js
let count = 1;
module.exports = {
  count,
  increment: () => count++
};

// b.js
const a = require('./a');
console.log(a.count);      // 1
a.increment();
console.log(a.count);      // 1（仍是 1，因为导出的是拷贝）
```

---

## 三、ES Module

ES Module 是 ES6 标准的模块规范，**现代浏览器和所有新运行时均原生支持**。

### 基本语法

```javascript
// 命名导出
export const name = 'foo';
export function say() { return 'hello'; }

// 默认导出
export default { name: 'foo' };

// 导入
import { name, say } from './module.js';  // 注意：需要写扩展名
import myModule from './module.js';
import * as utils from './module.js';
```

### 核心特点

| 特性 | 说明 |
|------|------|
| 加载时机 | 编译时静态分析 |
| 加载方式 | 异步加载 |
| 导出值 | 值的引用（只读） |
| 动态导入 | 支持 `import()` 函数 |
| Tree Shaking | ✅ 支持 |
| 顶层 `this` | `undefined` |

### 导出值的引用

```javascript
// a.js
export let count = 1;
export function increment() { count++; }

// b.js
import { count, increment } from './a.js';
console.log(count);        // 1
increment();
console.log(count);        // 2（实时更新，因为是引用）
count = 10;                // TypeError: 只读
```

---

## 四、Node.js 中启用 ES Module

Node.js 默认仍是 CommonJS，启用 ESM 有三种方式：

### 方式一：package.json

```json
{
  "type": "module"
}
```

此时 `.js` 文件视为 ES Module。

### 方式二：文件扩展名

```javascript
// file.mjs — 强制 ES Module
import foo from './foo.js';

// file.cjs — 强制 CommonJS
const foo = require('./foo');
```

### 方式三：命令行参数

```bash
node --experimental-modules file.js
```

---

## 五、ESM 与 CommonJS 互操作

### ESM 导入 CJS

```javascript
// ✅ 可以在 ESM 中导入 CJS 模块
import cjsModule from './cjs-module.cjs';
console.log(cjsModule.foo);

// ❌ 不能直接命名导入
import { foo } from './cjs-module.cjs';  // 报错
```

### CJS 导入 ESM

```javascript
// ❌ 不能用 require 导入 ESM
const esm = require('./esm-module.mjs');  // 报错

// ✅ 只能用动态 import
const esm = await import('./esm-module.mjs');
```

### Bun 的优势

Bun 的互操作更丝滑：

```javascript
// Bun 中可以混用
import a from './a.js';       // ESM
const b = require('./b.js');  // CJS

// 甚至在同一个文件里
import { foo } from './esm.js';
const bar = require('./cjs.js');
```

---

## 六、CommonJS vs ES Module 对比

| 特性 | CommonJS | ES Module |
|------|----------|-----------|
| 加载时机 | 运行时 | 编译时 |
| 加载方式 | 同步（阻塞） | 异步 |
| 导出值 | 拷贝 | 引用（只读） |
| 动态导入 | `require()` 任意位置 | 静态 `import` + 动态 `import()` |
| Tree Shaking | ❌ | ✅ |
| 循环引用 | 只输出已执行部分 | 动态引用 |
| 浏览器支持 | 需打包工具 | 原生支持 |
| 扩展名要求 | 可省略 | 必须写明 |

---

## 七、动态导入

```javascript
// 静态 import — 编译时确定，无条件加载
import { foo } from './module.js';

// 动态 import() — 运行时按需加载，返回 Promise
button.addEventListener('click', async () => {
  const module = await import('./heavy.js');
  module.doSomething();
});
```

### 使用场景

| 场景 | 示例 |
|------|------|
| 路由懒加载 | `const Home = () => import('./Home.vue')` |
| 条件加载 | `if (admin) import('./admin.js')` |
| 代码分割 | Webpack/Vite 自动拆分 |

---

## 八、循环引用

### CommonJS

只输出已执行部分：

```javascript
// a.js
exports.done = false;
const b = require('./b');
exports.done = true;

// b.js
const a = require('./a');
console.log(a.done);  // false（只拿到已执行的部分）
```

### ES Module

动态引用，访问时才取值：

```javascript
// a.js
export let done = false;
import { message } from './b.js';
done = true;

// b.js
import { done } from './a.js';
console.log(done);  // true（动态引用）
```

---

## 九、浏览器中使用 ES Module

```html
<!-- ES Module -->
<script type="module">
  import { foo } from './module.js';
  foo();
</script>

<!-- 降级处理 -->
<script nomodule src="fallback.js"></script>
```

> ⚠️ ES Module 脚本默认具有 `defer` 行为，按顺序执行。

---

## 十、选择建议

| 场景 | 推荐 | 说明 |
|------|------|------|
| **新项目** | ES Module | 统一标准，所有运行时支持 |
| **库开发** | ES Module | 同时提供 CJS 入口（dual export） |
| **维护旧 Node.js 项目** | 保持 CJS | 迁移成本高，不值得 |
| **Bun / Deno 项目** | ES Module | 默认就是 ESM |
| **需要 Tree Shaking** | ES Module | CJS 不支持 |

### 迁移建议

```javascript
// ❌ 旧写法
const foo = require('./foo');
module.exports = foo;

// ✅ 新写法
import foo from './foo.js';
export default foo;
```

---

## 十一、总结

| 运行时 | 默认 | 建议 |
|--------|------|------|
| Node.js | CJS | 新项目加 `"type": "module"` 启用 ESM |
| Bun | ESM | 直接用，互操作无缝 |
| Deno | ESM | 直接用 |
| 浏览器 | ESM | 直接用 |

> 💡 **一句话**：ES Module 是未来，CommonJS 是历史。新项目无脑选 ESM，旧项目能不动就不动。