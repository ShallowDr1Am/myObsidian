# LangGraph — Checkpointer 检查点

> 把图中每次执行的 State 快照持久化，支撑多轮对话、时间回溯、断点续跑。

---

## 1. 核心概念

### 1.1 Checkpointer 是什么

```
┌─────────────────────────────────────────────────┐
│                 LangGraph 框架                   │
│  ┌──────────────┐      ┌──────────────────┐    │
│  │ Checkpointer │ ←→  │   StateGraph     │    │
│  │ (存/取状态)   │      │   (执行图)        │    │
│  └──────────────┘      └────────┬─────────┘    │
│                                 │               │
│                                 │ 传入 messages  │
│                                 ▼               │
│                        ┌──────────────────┐    │
│                        │       LLM        │    │
│                        │                  │    │
│                        │ LLM 完全不知道    │    │
│                        │ Checkpointer 存在  │    │
│                        └──────────────────┘    │
└─────────────────────────────────────────────────┘
```

**Checkpointer 是 LangGraph 框架层面的基础设施，LLM 对此无感知。** LLM 每次请求都是无状态的，Agent 通过 Checkpointer 保存/恢复消息列表，在每次调用时把全量历史重新发给 LLM。

### 1.2 三种实现 + 选型

| 后端 | 特点 | 一句话总结 | 代码示例 |
|---|---|---|---|
| `MemorySaver` | 内存存储，极快，无需依赖，重启即丢 | 仅适合本地开发测试 / 单元测试 | `checkpointer=MemorySaver()` |
| `SqliteSaver` | 磁盘文件持久化，轻量级，无需额外服务 | 适合小体量 Demo、个人工具、边缘设备 | `checkpointer=SqliteSaver.from_conn_string("sqlite.db")` |
| `PostgresSaver` | 数据库持久化，支持高并发、分布式、备份 | 企业级生产标配，可靠性和扩展性最佳 | `checkpointer=PostgresSaver.from_conn_string(DB_URL)` |

**选型决策：看两点 —— 是否需要持久化（重启不丢）、是否需要多进程共享（并发/分布式）。**

```
需要持久化？
├─ 否 → MemorySaver（开发测试）
└─ 是 → 需要多进程共享 / 高并发？
        ├─ 否 → SqliteSaver（个人工具、边缘设备）
        └─ 是 → PostgresSaver（企业生产）
```

### 1.3 最小接入方式

```python
from langgraph.checkpoint.memory import InMemorySaver

# 只需要在 compile 时加一个参数
graph = workflow.compile(checkpointer=InMemorySaver())

# 调用时传 config
config = {"configurable": {"thread_id": "user_1"}}
graph.invoke(input_data, config)
```

---

## 2. State 更新策略（重要）

### 2.1 两种策略对比

| | Reducer 策略 | 直接覆盖策略 |
|---|---|---|
| **写法** | `Annotated[类型, reducer]` | 纯类型标注 |
| **节点返回值行为** | 新旧值经过 reducer 合并 | 新值直接替换旧值 |
| **典型场景** | 消息列表（需要累积） | 单一状态值（改了就是改了） |
| **你的代码示例** | `messages: Annotated[list, add_messages]` | `character: NotRequired[str]` |

**决定因素不是字段类型（list vs str），而是有没有 `Annotated` + reducer。**

### 2.2 覆盖策略的陷阱

```python
class StoryState(TypedDict):
    character: NotRequired[str]  # 没有 reducer → 直接覆盖

# 节点硬编码返回值：
def create_character(state):
    return {"character": "一只猫"}  # 每次都覆盖，不考虑旧值

# 时间回溯时：
update_state(config, {"character": "一只龙"})  # 注入龙
graph.invoke(None, config)                     # 从检查点继续
# → create_character 执行 → return {"character": "一只猫"}  # 龙被覆盖了！
```

**修复方式：节点逻辑里先检查 state 是否已有值（`state.get("character")`），有则跳过。**

### 2.3 自定义 Reducer

```python
# 内置
messages: Annotated[list, add_messages]

# 自定义：取最后一个值
def keep_last(old, new):
    return new

# 自定义：累加
def add(old: int, new: int) -> int:
    return old + new

class MyState(TypedDict):
    status: Annotated[str, keep_last]
    count: Annotated[int, add]
```

---

## 3. 检查点结构

### 3.1 什么时候保存检查点

```
graph.invoke({}, config)
         │
         ▼
    保存 CP-5（初始输入状态）
         │
    START → create_character
         │
    保存 CP-4（进入节点前）
         │
    create_character 执行完毕 → 保存 CP-3
         │
    set_setting 执行完毕 → 保存 CP-2
         │
    develop_plot 执行完毕 → 保存 CP-1
         │
    write_ending 执行完毕 → 保存 CP-0（最终状态）
```

**每个节点执行前后都会保存检查点。4 个节点 + 2 个框架快照 = 6 个检查点。**

### 3.2 每个检查点包含四个属性

```python
state = graph.get_state(config)

state.values      # {"character": "猫", "setting": "图书馆", ...}
state.next         # ("create_character",)  — 接下来要执行的节点
state.config       # 该检查点的配置（含 checkpoint_id）
state.metadata     # {"step": 3, "source": "loop", ...}
```

### 3.3 历史顺序是倒序

```
states[0] = 最后一步（最终状态）
states[1] = 倒数第二步
...
states[-1] = 起点（初始输入）
```

**通过检查 values 中哪个字段第一次出现非空值，可以推算出对应节点刚执行完。**

---

## 4. 检查点查询

### 4.1 三种查询方式

```python
# ① 只看最新一条（O(1)）
current = graph.get_state(config)

# ② 历史列表
states = list(graph.get_state_history(config))

# ③ 直接指定 checkpoint_id 定位（O(1)）
config = {
    "configurable": {
        "thread_id": "user_1",
        "checkpoint_id": "1ef2abc-..."  # 直接跳，不遍历
    }
}
```

### 4.2 遍历 vs 直接查询

| 方式 | 成本 | 适用场景 |
|---|---|---|
| `get_state_history + for` | 全量 | 教学演示、可视化 |
| `get_state` | O(1) | 拿当前状态 |
| 指定 `checkpoint_id` | O(1) | 生产环境、恢复执行 |

**检查点的 state values 是序列化的 blob，无法按业务字段索引查询。业务代码可以自己维护关键检查点的配置引用，避免每次遍历。**

---

## 5. 时间回溯

### 5.1 核心四步法

```python
# 步骤 1：运行，生成历史
config = {"configurable": {"thread_id": "user_123"}}
graph.invoke(initial_input, config)

# 步骤 2：获取历史状态
states = list(graph.get_state_history(config))

# 步骤 3：选择目标，可选修改状态
target_state = states[3]  # 索引从倒序中选
new_config = graph.update_state(
    target_state.config,
    {"field": "new_value"}  # 可选
)

# 步骤 4：从新配置继续执行
result = graph.invoke(None, config=new_config)
#                         ↑ 必须是 None，不能是 {}
# None = 无新输入，从检查点继续
# {}   = 新空输入，可能从头开始（常见错误！）
```

### 5.2 三种回溯模式

| 模式 | 是否修改状态 | 代码 | 场景 |
|---|---|---|---|
| 纯重放 | 否 | `invoke(None, config)` | 验证确定性 |
| 部分修改 | 是（部分字段） | `update_state(config, {"field": new})` | 修正错误 |
| 完全替换 | 是（全部字段） | `update_state(config, new_state)` | 极端测试 |

### 5.3 回溯的关键规则

1. **原始检查点不可变** — 每次回溯产生新检查点分支
2. **`update_state` 是覆盖，不是合并** — 传入的字段完全替换顶层同名字段
3. **注意下游节点是否覆盖你的注入值** — 如果节点 return 固定值，回溯注入会被覆盖（见 2.2）
4. **`invoke(None, config)` 是回溯的核心操作** — 传空 dict 可能被框架当作新初始输入

### 5.4 检查点生命周期

```
执行前 → 节点1执行 → 保存 CP-1 → 节点2执行 → 保存 CP-2
                             ↓
                        （时间回溯）
                             ↓
                   读取 CP-1 → 修改状态 → 保存 CP-1' → 继续执行
```

---

## 6. 时间回溯的价值

### 6.1 三种价值场景

| 场景 | 说明 | 谁在用 |
|---|---|---|
| 开发者调试 | 回到错误现场重放，无需从头运行 | 开发者 |
| Human-in-the-loop | 用户"反悔"后回退，底层是时间回溯 | 终端用户（间接） |
| 策略探索 | 同一状态测试不同决策路径，选最优 | 系统自己 |

**时间回溯主要不是直接面向终端用户的 UI 功能。** 不要让用户在检查点列表里手动选择回退位置，而是作为开发调试和 Human-in-the-loop 的底层支撑机制。

### 6.2 何时使用 / 不使用

| 使用 | 不使用 |
|---|---|
| 调试非确定性行为 | 确定性的纯函数流程 |
| 修复历史错误 | 实时在线推理（延迟敏感） |
| What-If 分析 | 简单线性流程 |
| 人机协同审核 | 无状态计算 |

---

## 7. 持久化存储（生产环境）

### 7.1 PostgresSaver 配置

```python
from langgraph.checkpoint.postgres import PostgresSaver

conn_string = "postgresql://user:pass@localhost/db"

# with 保证连接自动关闭（上下文管理器）
with PostgresSaver.from_conn_string(conn_string) as checkpointer:
    checkpointer.setup()  # 创建表
    graph = builder.compile(checkpointer=checkpointer)
```

### 7.2 `with ... as` 理解

```python
# with 写法
with PostgresSaver.from_conn_string(conn_string) as checkpointer:
    # 使用 checkpointer

# 等价于：
checkpointer = PostgresSaver.from_conn_string(conn_string)
try:
    # 使用 checkpointer
finally:
    checkpointer.close()  # ← 无论如何都会执行，防止连接泄漏
```

### 7.3 设计建议

| 建议 | 说明 |
|---|---|
| 每个用户独立 `thread_id` | 避免状态混淆 |
| 定期清理过期检查点 | 防止存储无限膨胀 |
| 结合 LangSmith 追踪 | 可视化查看分支和状态变化 |
| 关键节点添加人工确认 | 高风险操作前插入 `interrupt()` |

---

## 8. 分支（Fork）

```python
# 从一个检查点开新对话分支
parent_state = graph.get_state({"configurable": {"thread_id": "user_1"}})
fork_config = graph.update_state(
    parent_state.config,
    values={...},  # 可选修改
)
# fork_config 有新的 checkpoit_id，可以独立发展
# 像一个存档玩出多条分支线
```

---

## 快速参考卡

```python
# 最常用的 4 行代码（时间回溯核心操作）
states = list(graph.get_state_history(config))           # 看历史
target = states[2]                                       # 选目标
new_cfg = graph.update_state(target.config, {"key": v})  # 改状态
result = graph.invoke(None, config=new_cfg)              # 回溯执行

# 查看最新状态
current = graph.get_state(config)

# 直接跳转指定检查点
config = {"configurable": {"thread_id": "xxx", "checkpoint_id": "yyy"}}
graph.invoke(None, config)
```