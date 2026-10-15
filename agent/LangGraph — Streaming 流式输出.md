# LangGraph — Streaming 流式输出

> 节点执行时实时推送数据，像看直播而非等录像。配合 Checkpointer 形成完整的生产级 Agent。

---

## 1. Streaming vs Checkpointer

```
Checkpointer：存档                          Streaming：看直播
┌──────────────────────┐                  ┌──────────────────────┐
│ 节点执行后存快照       │                  │ 节点执行时实时推送      │
│ 事后查询、回溯         │                  │ 当下观察、即时响应     │
│ get_state_history()  │                  │ graph.astream()      │
└──────────────────────┘                  └──────────────────────┘

一个管"回头看"，一个管"当下看"。组合起来才是完整的生产级 Agent。
```

---

## 2. 五种流模式速查

| 模式 | 输出内容 | 数据量 | 使用频率 | 额外要求 |
|---|---|---|---|---|
| **values** | 每步后的完整 State | 大 | ⭐⭐ | 无 |
| **updates** | 每步修改了什么（增量） | 小 | ⭐⭐⭐⭐ | 无 |
| **messages** | LLM 逐 token 文本 | 极小 | ⭐⭐⭐⭐⭐ | 需手动拼接 |
| **custom** | 你自定义的数据 | 可控 | ⭐⭐⭐ | 节点内加 `writer` |
| **debug** | 所有执行细节 | 巨大 | ⭐ | 仅开发环境 |

**values / updates / messages / debug — 只改 `stream_mode` 一个参数就生效。**

---

## 3. 按需求选模式

```
你的需求是什么？
│
├─ 需要实时显示 LLM 回复？
│  └─ 用 messages 模式 ⭐
│
├─ 需要知道程序执行到哪一步？
│  ├─ 只需要知道变了什么 → updates 模式（省流量）
│  └─ 需要完整状态重建UI → values 模式（省代码）
│
├─ 需要显示进度条/自定义信息？
│  └─ 用 custom 模式
│
└─ 需要调试/排查问题？
   └─ 用 debug 模式（仅开发环境）
```

---

## 4. 基本用法

```python
# 同步方式（一次性拿结果）
result = graph.invoke({"messages": [HumanMessage(content="北京天气？")]})
print(result)  # 等全部跑完才看到

# 流式方式（逐步看过程）
async for event in graph.astream(
    {"messages": [HumanMessage(content="北京天气？")]},
    stream_mode="updates"
):
    print(event)
    # 输出示例：
    # {'agent': {'messages': [AIMessage(tool_calls=[...])]}}
    # {'tools': {'messages': [ToolMessage(content="北京：晴，25°C")]}}
    # {'agent': {'messages': [AIMessage(content="北京今天晴，25°C。")]}}
```

### 同时开多个模式

```python
async for event in graph.astream(
    input,
    stream_mode=["updates", "messages"]
):
    print(event)  # 两种数据都有
```

---

## 5. 两种试过的坑

### 5.1 `astream` 是异步的

```python
# ❌ 同步遍历会报错
for event in graph.astream(input, stream_mode="updates"):
    ...

# ✅ 必须用 async for
async for event in graph.astream(input, stream_mode="updates"):
    ...
```

### 5.2 `messages` 输出的是 token 片段，要自己拼

```python
# messages 模式给的是这个：
# AIMessageChunk(content="今", ...)
# AIMessageChunk(content="天", ...)
# AIMessageChunk(content="晴", ...)

# 不是直接给 "今天晴"，要自己拼：
full_text = ""
async for chunk in graph.astream(input, stream_mode="messages"):
    full_text += chunk.content
```

---

## 6. custom 模式的特殊之处

其他四种改 `stream_mode` 就够了，但 custom 还需要在节点里手动推送：

```python
# 其他四种：只改参数
graph.astream(input, stream_mode="updates")    # 改这一个参数
graph.astream(input, stream_mode="messages")   # 改这一个参数

# custom：改参数 + 节点代码
def my_node(state, writer):   # ← 多了个 writer 参数
    writer("进度：50%")         # ← 手动调用推送
    return {"key": "value"}

graph.astream(input, stream_mode="custom")
```

---

## 快速参考卡

```python
# 最常用：LLM 打字机效果
async for chunk in graph.astream(input, stream_mode="messages"):
    print(chunk.content, end="", flush=True)

# 最常用：看 Agent 执行进度
async for event in graph.astream(input, stream_mode="updates"):
    for node_name, output in event.items():
        print(f"✅ {node_name} 执行完毕: {output}")
```

---

## 7. 双流解复用（实战踩坑）

`stream_mode` 传**列表**时，每个事件是 `(模式名, 载荷)` 二元组，要自己分流：

```python
for mode, raw in graph.stream(input, stream_mode=["updates", "custom"]):
    if mode == "custom":
        handle_progress(raw)          # writer 推的进度
        continue
    for node, out in raw.items():     # updates：{节点名: 返回值}
        handle_result(node, out)
```

两个实战坑（novel_rag 项目踩过）：

1. **`updates` 给的是节点返回值，不是完整 State。** `answer` 节点只 return `{answer, hedged}`，里面没有 `contexts`——想拿别的节点产出的字段，只能在循环里自己累积，或改用 `values` 模式（每步全量，流量大）
2. **`writer` 是按函数签名注入的**（见 [[LangGraph — Node 节点]] §2），不是 State 字段。在节点里写 `state["writer"]` 拿不到东西

---

## 相关

- 扇出图的流式进度（144 路并行 + writer）：[[LangGraph — Send 扇出]]
- 完整实战：`learn/agent/langgraph/novel_rag/` 的 `answer.py`（token 流）和 `build_index.py`（进度流）