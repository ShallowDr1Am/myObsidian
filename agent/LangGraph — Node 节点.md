# LangGraph — Node 节点

> 图里的执行单元，本质是一个 Python 函数：接收 State，返回增量 dict。

---

## 1. 节点本质

```python
def agent(state: AgentState) -> dict:
    response = llm.invoke(state["messages"])
    return {"messages": [response]}   # 只返回变更的字段，框架自动合并到 State
```

三条规则：
1. **接收 State**，读数据、算新值
2. **只返回变更的字段**，不需要 `return state`
3. 返回值合并进 State（merge 方式由 reducer 决定，见 [[LangGraph — Checkpointer 检查点]]）

---

## 2. 函数签名注入（重要）

LangGraph 根据函数**声明了哪些参数**，自动注入不同的对象：

| 参数名 | 注入内容 | 典型用途 |
|---|---|---|
| `state` | 当前共享状态 | 读数据、算新值 |
| `config` | 运行时配置 `RunnableConfig` | 拿 `thread_id`、用户信息 |
| `writer` | `StreamWriter` | 实时推送进度（见 [[LangGraph — Streaming 流式输出]]） |
| `store` | `Store` | 跨会话长期记忆（进阶） |

```python
# ① 只要 state（最常用）
def node_a(state): ...

# ② state + config（拿 thread_id）
def node_b(state, config):
    thread_id = config["configurable"]["thread_id"]
    return {...}

# ③ state + writer（Streaming 用）
def node_c(state, writer): ...

# ④ 三个都要
def node_d(state, config, writer): ...
```

**参数名是约定，不是随便取的**——`config` 这个名字和 Checkpointer 的 `thread_id` 在这里连通了。

---

## 3. 返回值：dict 增量 vs Command

### 3.1 旧写法：return dict，靠条件边路由

```python
def agent(state):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}    # 只更新 state

# 路由交给条件边
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
```

### 3.2 新写法：return Command，更新 + 路由一体

```python
from langgraph.types import Command

def agent(state):
    response = llm.invoke(state["messages"])
    # 一次同时做两件事：更新 state + 决定下一步去哪
    return Command(
        update={"messages": [response]},   # 更新 state
        goto="tools",                       # 直接跳到 tools 节点
    )
```

**区别**：`dict` 把"去哪"的决定权交给图结构（条件边）；`Command` 把决策写在节点内部，更内聚。

---

## 4. 同步 vs 异步节点

```python
def sync_node(state): ...          # 同步节点，框架自动丢线程池跑
async def async_node(state): ...   # 异步节点，真并发，省资源
```

```python
# 同步函数里用同步 API
def node(state):
    return self.subgraph.invoke(state)      # 不能 await

# 异步函数里用异步 API
async def node(state):
    return await self.subgraph.ainvoke(state)  # 必须 await
```

**关键**：LangGraph 两种节点都支持并发（同步节点框架用多线程兜底）。但异步节点资源利用率更高，因为 LLM 调用天然是异步 IO。多 Agent 场景 `ainvoke` 更常见，但不会因为没用它而"阻塞所有节点"。

```python
# ⚠️ 异步函数里写了同步操作 = 白 async
async def bad_node(state):
    time.sleep(5)                          # 同步 sleep，协程被卡死
    return self.subgraph.invoke(state)     # 没 await，等于白 async

# ✅ 正确的异步
async def good_node(state):
    await asyncio.sleep(5)                          # 异步 sleep
    return await self.subgraph.ainvoke(state)       # 真让出控制权
```

---

## 5. 节点策略：retry / cache（可选增强）

> 属于"按需开启"的横切关注点，不是默认行为。不配置时节点就是普通节点。

### 5.1 RetryPolicy — 对抗临时性故障

```python
from langgraph.types import RetryPolicy

retry = RetryPolicy(
    max_attempts=3,                 # 最多试 3 次
    retry_on=[TimeoutError],        # 只有这些异常才重试
)
builder.add_node("process", process_node, retry=retry)
```

```python
# 不指定 retry_on → 默认重试所有异常
retry = RetryPolicy(max_attempts=3)
```

**场景**：节点里调外部 API，网络抖动超时 → 自动重试。类比打电话占线自动重拨。

### 5.2 CachePolicy — 避免重复计算

```python
from langgraph.types import CachePolicy

cache = CachePolicy(
    key_func=lambda s: s["query"],   # 相同 query → 命中缓存
    ttl=300,                          # 缓存 300 秒失效
)
builder.add_node("process", process_node, cache=cache)
```

**场景**：相同 query 处理过 → 直接复用结果，不重跑。类比同一道题问两遍直接抄答案。

### 5.3 两个注意点

1. **`retry_on` 限定重试的异常类型** — 代码 bug 的 `ValueError` 不会被吞掉重试，会直接抛出来
2. **`cache` 依赖 Checkpointer 才能真正持久化** — 否则缓存只在内存里，进程重启就没了：
   ```python
   graph = builder.compile(checkpointer=InMemorySaver())
   ```

### 5.4 定位

这两个策略把"重试""缓存"这类横切逻辑从节点函数里抽出来，做成**声明式配置**。节点里不用写 `try/except` 重试、不用写 `if 缓存` 判断，框架代劳。

**类比 webpack**：不是 `mode` 那类默认配置，而是你主动挑的 `cache` / `retry` 插件——默认没有，按需开启。

---

## 快速参考

```python
# 标准节点
def node(state) -> dict:
    return {"result": "..."}

# 拿 config
def node(state, config):
    tid = config["configurable"]["thread_id"]

# 拿 writer（Streaming）
def node(state, writer):
    writer({"msg": "进度"})

# 返回 Command（更新+路由）
from langgraph.types import Command, RetryPolicy, CachePolicy
return Command(update={...}, goto="next_node")

# 加策略
builder.add_node("n", node, retry=RetryPolicy(max_attempts=3), cache=CachePolicy(...))
```

---

[[LangGraph — Agent 编排]]
[[LangGraph — Checkpointer 检查点]]
[[LangGraph — Streaming 流式输出]]
