# Generator 与 Async

## 一、Generator 函数

Generator 函数可以理解为一个**状态机**，封装了多个内部状态。

执行 Generator 函数会返回一个**遍历器对象**（Iterator），通过调用 `next()` 方法可以遍历每个状态。

### 基本用法

```javascript
function* helloWorldGenerator() {
  yield 'hello';
  yield 'world';
  return 'ending';
}

const hw = helloWorldGenerator();

hw.next(); // { value: 'hello', done: false }
hw.next(); // { value: 'world', done: false }
hw.next(); // { value: 'ending', done: true }
hw.next(); // { value: undefined, done: true }
```

### next() 的返回值

| 属性 | 说明 |
|------|------|
| `value` | 当前状态的值，即 `yield` 后面表达式的值 |
| `done` | `false` 表示遍历未结束，`true` 表示遍历已结束 |

---

## 二、yield 与 yield*

### yield

`yield` 是暂停标志，遇到 `yield` 就会暂停执行，将后面表达式的值作为返回对象的 `value`。

```javascript
function* gen() {
  const a = yield 1;
  const b = yield a + 2;
  return b;
}

const g = gen();
g.next();      // { value: 1, done: false }
g.next(10);    // 传入 10 作为上一个 yield 的返回值，a = 10
               // { value: 12, done: false }
g.next(20);    // 传入 20，b = 20
               // { value: 20, done: true }
```

### yield*

在 Generator 函数中直接调用另一个 Generator 函数不会生效，需要用 `yield*` 调用：

```javascript
function* foo() {
  yield 'a';
  yield 'b';
}

function* bar() {
  yield 'x';
  yield* foo();  // 委托给 foo
  yield 'y';
}

for (const v of bar()) {
  console.log(v);
}
// 'x', 'a', 'b', 'y'
```

---

## 三、next() 方法

### 不带参数

遍历 Generator 生成的遍历器，每次返回下一个状态。

### 带参数

参数会作为**上一个 `yield` 表达式的返回值**：

```javascript
function* gen() {
  const a = yield 1;
  console.log('a =', a);  // a = 10
}

const g = gen();
g.next();      // 启动，返回 { value: 1, done: false }
g.next(10);    // 传入 10，作为 yield 1 的返回值赋给 a
```

---

## 四、throw() 方法

可以在 Generator 函数内部或外部抛出错误。

### 内部捕获

使用遍历器对象的 `throw()` 方法：

```javascript
function* gen() {
  try {
    yield 1;
  } catch (e) {
    console.log('内部捕获:', e);
  }
  yield 2;
}

const g = gen();
g.next();              // { value: 1, done: false }
g.throw('error');      // 内部捕获: error
                       // { value: 2, done: false }
g.next();              // { value: undefined, done: true }
```

### 外部捕获

使用全局的 `throw` 命令。

> ⚠️ **重要**：当内部部署了 `try...catch` 代码块，错误不会影响后续的遍历。

---

## 五、return() 方法

可以提前终止 Generator 函数：

```javascript
function* gen() {
  yield 1;
  yield 2;
  yield 3;
}

const g = gen();
g.next();           // { value: 1, done: false }
g.return('end');    // { value: 'end', done: true }
g.next();           // { value: undefined, done: true }
```

---

## 六、协程与线程

| 特性 | 线程 | 协程 |
|------|------|------|
| 并发模型 | 抢占式 | 合作式 |
| 执行权 | 由系统调度 | 由协程自己分配 |
| 同时运行 | 多个线程可同时运行 | 只有一个协程处于运行态 |

Generator 最大的特点是**可以交出函数的执行权**（暂停执行），这使其非常适合处理异步操作。

---

## 七、for...of 循环

`for...of` 可以自动遍历 Generator 函数：

```javascript
function* fibonacci() {
  let [a, b] = [0, 1];
  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

for (const n of fibonacci()) {
  if (n > 100) break;
  console.log(n);
}
// 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89
```

---

# Async 函数

`async` 是 Generator 的语法糖，提供了更简洁的异步编程方式。

## 一、对 Generator 的改进

| 改进点 | Generator | Async |
|--------|-----------|-------|
| 执行器 | 需要手动调用 `next()` 或使用 co 库 | 内置执行器，自动执行 |
| 语义 | `*` 和 `yield` 不够直观 | `async` 和 `await` 语义清晰 |
| 适用性 | `yield` 后面只能是 Promise | `await` 后面可以是原始类型 |
| 返回值 | 返回遍历器对象 | 返回 Promise |

## 二、基本用法

```javascript
async function fetchUser() {
  try {
    const response = await fetch('/api/user');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('请求失败:', error);
    throw error;
  }
}

// 调用
fetchUser()
  .then(user => console.log(user))
  .catch(err => console.error(err));
```

## 三、注意事项

### 1. 错误处理

因为返回值是 Promise，建议用 `try...catch` 包裹代码：

```javascript
async function myFunc() {
  try {
    const result = await riskyOperation();
    return result;
  } catch (error) {
    console.error('操作失败:', error);
    // 可以选择返回默认值或重新抛出
    throw error;
  }
}
```

### 2. 并行执行

多个 `await` 命令如果不存在继发关系，应该用 `Promise.all` 让它们同时触发：

```javascript
// ❌ 串行执行（慢）
async function slow() {
  const a = await fetchA();  // 等待完成
  const b = await fetchB();  // 再开始
  return [a, b];
}

// ✅ 并行执行（快）
async function fast() {
  const [a, b] = await Promise.all([fetchA(), fetchB()]);
  return [a, b];
}
```

### 3. 顶层 await

在 ES2022+ 中，可以在模块顶层使用 `await`：

```javascript
// module.mjs
const data = await fetchData();
export default data;
```

---

## 四、对比总结

```javascript
// Generator 方式
function* fetchUserGen() {
  const response = yield fetch('/api/user');
  const data = yield response.json();
  return data;
}
// 需要执行器自动运行

// Async 方式
async function fetchUserAsync() {
  const response = await fetch('/api/user');
  const data = await response.json();
  return data;
}
// 自动执行，返回 Promise
```

| 场景 | 推荐 |
|------|------|
| 异步流程控制 | `async/await` |
| 惰性序列/无限序列 | Generator |
| 自定义迭代行为 | Generator |
| 状态机实现 | Generator |