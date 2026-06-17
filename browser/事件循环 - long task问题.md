### 浏览器事件循环（Event Loop）

JavaScript 是单线程语言，通过事件循环机制实现异步编程。

## 执行流程

1. **执行全局 Script 同步代码**，同步代码中可能包含异步调用（如 setTimeout、Promise 等）
2. **全局 Script 执行完毕**，调用栈（Call Stack）清空
3. **清空微任务队列**：从微任务队列取出队首任务执行，直到队列清空
   - 如果执行微任务时产生了新的微任务，会在**当前周期**继续执行
4. **执行一个宏任务**：从宏任务队列中取出一个任务执行
5. **宏任务执行完毕后**，调用栈清空，回到第3步，再次清空微任务队列
6. **循环执行第3-5步**，这就是事件循环

---

## 浏览器事件循环模型

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌─────────────┐                                           │
│   │ Call Stack  │                                           │
│   │  (调用栈)    │                                           │
│   │             │                                           │
│   │  function3  │                                           │
│   │  function2  │                                           │
│   │  function1  │                                           │
│   └─────────────┘                                           │
│          │                                                  │
│          │ 同步代码执行                                       │
│          ▼                                                  │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Web APIs (后台线程)                      │   │
│   │  setTimeout / setInterval / DOM事件 / fetch / ...    │   │
│   └─────────────────────────────────────────────────────┘   │
│          │                                                  │
│          │ 异步完成后回调入队                                 │
│          ▼                                                  │
│   ┌──────────────────┐                                      │
│   │ Microtask Queue  │ ◀─── 最高优先级，每次清空             │
│   │  (微任务队列)     │      Promise.then / queueMicrotask   │
│   └──────────────────┘      MutationObserver                │
│          │                                                  │
│          │ 微任务清空后                                       │
│          ▼                                                  │
│   ┌──────────────────┐                                      │
│   │ Macrotask Queue  │ ◀─── 每次只执行一个                   │
│   │  (宏任务队列)     │      setTimeout / UI渲染 / I/O       │
│   └──────────────────┘                                      │
│          │                                                  │
│          │ 执行完一个宏任务后，回到微任务队列                   │
│          ▼                                                  │
│   ┌─────────────────┐                                       │
│   │   Event Loop    │ ──────── 循环 ────────▶               │
│   └─────────────────┘                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心要点

### 微任务（Microtask）

**特点**：每个宏任务执行后，会清空所有微任务

**浏览器中的微任务**：
- `Promise.then / .catch / .finally`
- `queueMicrotask()`
- `MutationObserver`

### 宏任务（Macrotask）

**特点**：每次只执行一个，执行完后会清空微任务队列

**常见宏任务**：
- `setTimeout / setInterval`
- `I/O 操作`
- `UI 渲染`
- `用户交互事件`（click、input 等）

---

## 任务队列的真相

浏览器中并非只有一个宏任务队列，而是**多个任务队列**：

```
┌─────────────────────────────────────────┐
│  微任务队列（Microtask Queue）- 最高优先  │
├─────────────────────────────────────────┤
│  交互队列（Interaction）- 高优先级        │
│  延时队列（Timer）- 中优先级              │
│  网络队列（Network）- 低优先级           │
│  ...其他队列                             │
└─────────────────────────────────────────┘
```

浏览器会根据**优先级策略**从多个宏任务队列中选择任务执行。

### 多个宏任务队列的执行顺序

**问题**：如果 DOM 事件和 fetch 请求几乎同时完成，谁先执行？

```javascript
// DOM 事件先绑定
document.body.addEventListener('click', () => {
  console.log('DOM 事件');
});

// fetch 后发起
fetch('/api').then(() => {
  console.log('fetch 回调');
});

// 假设两个几乎同时完成...
```

**答案**：不固定，取决于浏览器实现。

| 问题 | 答案 |
|------|------|
| 标准有规定吗？ | ❌ 没有规定宏任务队列间优先级 |
| 可以依赖这个顺序吗？ | ❌ 不应该依赖，这是实现细节 |
| Chrome 的倾向？ | 交互队列通常优先于网络队列 |

Chrome 的大致优先级：

```
微任务队列 ─────────── 最高优先级
交互队列 ─────────── 高优先级（用户交互）
延时队列 ─────────── 中优先级（setTimeout）
网络队列 ─────────── 较低优先级（fetch）
```

**注意**：==这只是 Chrome 的实现倾向，不是规范。实际开发中**不应该依赖**这种执行顺序，如果需要控制顺序，应该用 Promise 或其他机制显式管理。==

---

## ⚠️ 浏览器 vs Node.js 的区别

很多网上的图片和文章会混淆浏览器和 Node.js 的事件循环，**这是错误的**。

### 常见的混淆点

`process.nextTick` 是 **Node.js 独有**的 API，浏览器中不存在：

```javascript
// ❌ 浏览器中会报错
process.nextTick(() => console.log('nextTick'));
```

### 两者的差异对比

| 特性 | 浏览器 | Node.js |
|------|--------|---------|
| 微任务 | Promise、queueMicrotask、MutationObserver | Promise、queueMicrotask、**process.nextTick** |
| 微任务优先级 | 所有微任务同级 | **nextTick > Promise** |
| 宏任务队列 | 多个队列，按优先级调度 | 6个阶段循环 |
| UI渲染 | 有 | 无 |

### Node.js 事件循环阶段

Node.js 事件循环有 6 个阶段：

```
   ┌───────────────────────┐
┌─>│        timers         │ setTimeout/setInterval
│  └───────────┬───────────┘
│  ┌───────────┴───────────┐
│  │     pending callbacks │ I/O 回调
│  └───────────┬───────────┘
│  ┌───────────┴───────────┐
│  │     idle, prepare     │ 内部使用
│  └───────────┬───────────┘
│  ┌───────────┴───────────┐
│  │         poll          │ 轮询，等待新 I/O
│  └───────────┬───────────┘
│  ┌───────────┴───────────┐
│  │        check          │ setImmediate
│  └───────────┬───────────┘
│  ┌───────────┴───────────┐
└──┤    close callbacks    │ close 事件
   └───────────────────────┘
```

---

## 经典面试题解析

```javascript
console.log('1');

setTimeout(() => {
  console.log('2');
  Promise.resolve().then(() => console.log('3'));
}, 0);

Promise.resolve()
  .then(() => console.log('4'))
  .then(() => console.log('5'));

console.log('6');
```

**执行顺序**：`1 → 6 → 4 → 5 → 2 → 3`

**解析**：
1. 同步代码：`1`、`6`
2. 清空微任务：`4`、`5`（第二个 then 等第一个执行完才入队）
3. 执行宏任务 setTimeout：`2`
4. 清空微任务：`3`

---

## 如何深入理解

### 1. 阅读规范

- [HTML Standard - Event Loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops) - 浏览器规范
- [Node.js Event Loop](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/) - Node.js 官方文档

### 2. 动手实验

```javascript
Promise.resolve().then(() => {
  console.log('微任务1');
  Promise.resolve().then(() => console.log('微任务中的微任务'));
});
console.log('同步');

setTimeout(() => console.log('setTimeout'), 0);
Promise.resolve().then(() => console.log('Promise'));
console.log('同步代码');


结果： 
同步
同步代码
微任务1
promise
微任务中的微任务
setTimeout
```

### 3. 使用调试工具

- Chrome DevTools → Sources → 右侧 Call Stack 可查看调用栈
- Performance 面板可录制事件循环过程

### 4. 推荐阅读

- [Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/) - 经典可视化文章
- [Loupe](http://latentflip.com/loupe/) - 事件循环可视化工具

---

## Long Tasks 性能问题

### 什么是 Long Task？

执行时间超过 **50ms** 的任务，称为 Long Task。

### 为什么是 50ms？

用户对延迟的感知：

| 延迟时间 | 用户感知 |
|---------|---------|
| 0-100ms | 即时响应 |
| 100-300ms | 轻微延迟 |
| 300-1000ms | 明显卡顿 |
| >1000ms | 失去耐心 |

浏览器以 60fps 运行时，每帧约 **16.67ms**。50ms 意味着连续 3 帧被阻塞，用户会感知到卡顿。

### 问题表现

```javascript
// ❌ Long Task：阻塞主线程 100ms
function heavyTask() {
  const start = Date.now();
  while (Date.now() - start < 100) {}
  console.log('完成');
}

button.onclick = () => {
  heavyTask();  // 用户点击后，页面冻结 100ms
};
```

**后果**：
- 用户交互无响应（点击、输入）
- 动画掉帧
- 页面卡顿

### 检测 Long Task

```javascript
// PerformanceObserver 检测
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('Long Task:', entry);
    console.log('耗时:', entry.duration, 'ms');
    console.log('开始时间:', entry.startTime);
  }
});

observer.observe({ entryTypes: ['longtask'] });
```

### 解决方案

#### 1. 任务分片

```javascript
// ❌ 一次性处理 10 万条数据
function processData(items) {
  items.forEach(item => {
    // 处理逻辑
  });
}

// ✅ 分片处理，每批处理一部分
function processDataChunked(items, chunkSize = 100) {
  return new Promise((resolve) => {
    let i = 0;

    function processChunk() {
      const end = Math.min(i + chunkSize, items.length);

      while (i < end) {
        // 处理 items[i]
        i++;
      }

      if (i < items.length) {
        // 让出主线程，下一帧继续
        requestIdleCallback(processChunk);
      } else {
        resolve();
      }
    }

    processChunk();
  });
}
```

#### 2. Web Worker

```javascript
// 主线程
const worker = new Worker('worker.js');

worker.postMessage({ data: largeArray });
worker.onmessage = (e) => {
  console.log('处理完成:', e.data);
};

// worker.js
self.onmessage = (e) => {
  const result = heavyProcessing(e.data);
  self.postMessage(result);
};
```

#### 3. requestIdleCallback

在浏览器空闲时执行低优先级任务：

```javascript
requestIdleCallback((deadline) => {
  while (deadline.timeRemaining() > 0 && tasks.length) {
    const task = tasks.shift();
    task();
  }

  if (tasks.length) {
    // 没空了，下次继续
    requestIdleCallback(arguments.callee);
  }
});
```

#### 4. setTimeout 分片

简单的分片方案：

```javascript
function chunkedProcess(items, fn, delay = 0) {
  if (!items.length) return;

  const batch = items.splice(0, 50);
  batch.forEach(fn);

  if (items.length) {
    setTimeout(() => chunkedProcess(items, fn, delay), delay);
  }
}
```

### 性能指标

| 指标 | 含义 | 目标值 |
|------|------|--------|
| TTI | 可交互时间 | < 3.8s |
| TBT | 总阻塞时间 | < 200ms |
| FID | 首次输入延迟 | < 100ms |

### 总结

```
Long Task (>50ms) 的危害：
├── 阻塞主线程
├── 用户交互无响应
├── 动画掉帧
└── 页面卡顿

解决方案：
├── 任务分片（requestIdleCallback / setTimeout）
├── Web Worker（多线程）
└── 时间切片（React Fiber 的实现原理）
```

---

## 总结

事件循环是浏览器渲染主线程的工作方式，核心流程：

**同步代码 → 清空微任务 → 执行一个宏任务 → 清空微任务 → 循环**

理解的关键：
1. 浏览器和 Node.js 的事件循环**有差异**，不要混淆
2. 微任务队列只有一个，宏任务队列有多个
3. 每次循环只执行一个宏任务，但会清空所有微任务
4. 微任务可以在当前周期不断添加微任务
5. setTimeout 延时不精确，因为它依赖事件循环的调度

---

## 相关笔记

- [[浏览器的进程与线程]]
