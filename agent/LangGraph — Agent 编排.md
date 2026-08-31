# LangGraph — Agent 编排

> 把 LCEL 的单向管道变成带循环的有向图，让 Agent 能自动多轮推理。

## 为什么需要 LangGraph

LCEL 的 `|` 管道是单向的，一次执行就结束。但 Agent 需要**循环**——LLM 调了一个工具、拿到结果、觉得不够、再调另一个工具、重复直到满意。

```
LCEL：     prompt | llm | parser  → END（单次）
LangGraph： agent ⇄ tool_executor → END（循环，自动多轮）
```

你之前的 Tool Calling demo 手动写 `for tc in tool_calls:` + 手动调第二次 LLM，LangGraph 把这套逻辑变成了**框架自动执行的图**。

## 核心四概念

```
┌──────────┐     ┌───────────┐     ┌──────────────┐     ┌──────────────────┐
│  State   │     │   Node    │     │     Edge     │     │ Conditional Edge │
│ 共享数据  │     │  执行单元  │     │   固定连线   │     │    动态路由       │
└──────────┘     └───────────┘     └──────────────┘     └──────────────────┘
所有节点读写      每个节点是         A 执行完一定       A 执行完后根据
同一份 TypedDict   一个 Python 函数   走到 B            函数返回值决定走哪
```

| 概念 | 代码 | 干什么 |
|------|------|--------|
| **State** | `class AgentState(TypedDict): messages: Annotated[list, add_messages]` | 图中所有节点共享的数据，`add_messages` = 新消息自动 append |
| **Node** | `def agent(state) -> dict:` | 一个 Python 函数，return 的 dict 会合并到 State |
| **Edge** | `add_edge("a", "b")` | 固定连线，A 完了一定走 B |
| **Conditional Edge** | `add_conditional_edges("a", fn, {...})` | A 完后根据 fn 返回值决定走 tools 还是 END |

### 三个关键机制

1. **`Annotated[list, add_messages]` — 不覆盖，只追加**
   不加 `add_messages` 的话，每次 `return {"messages": [xxx]}` 会覆盖之前的对话历史。加了之后新消息自动 append。

2. **节点只返回变更的部分**
   `return {"messages": [reply]}` 就够了，不需要 `return state`。LangGraph 自动把返回值合并到当前 State。

3. **`compile()` 不只是运行前的检查**
   验证图结构（无孤立节点、无不可达节点、无非法循环），生成可执行的 Runnable，为 Checkpointer/interrupt 等扩展做准备。

## 最小完整 Agent（你手写的）

```
             ┌────────────────────┐
             │       START        │
             └──────────┬─────────┘
                        ▼
             ┌──────────────────┐
     ┌──────►│      agent       │◄─────────┐
     │       │  llm_with_tools  │          │
     │       └────────┬─────────┘          │
     │                │                    │
     │                ▼                    │
     │       ┌──────────────────┐          │
     │       │ should_continue  │          │
     │       │                  │          │
     │       │ if tool_calls:   │          │
     │       │   → "tools"      │          │
     │       │ else:            │          │
     │       │   → END          │          │
     │       └───┬──────────┬───┘          │
     │           │          │              │
     │   有tools │          │ 没有tools     │
     │           ▼          ▼              │
     │   ┌───────────┐  ┌──────┐          │
     │   │   tools   │  │ END  │          │
     │   │ for tc:   │  └──────┘          │
     │   │  执行工具   │                   │
     │   └─────┬─────┘                    │
     │         │                          │
     └─────────┘  循环边                   │
          ("tools", "agent")              │
                                         │
```

```python
# 建图代码（你手写的）
graph = StateGraph(AgentState)
graph.add_node("agent", agent)
graph.add_node("tools", tool_executor)

graph.add_edge(START, "agent")                            # 入口
graph.add_conditional_edges("agent", should_continue,     # 条件路由
    {"tools": "tools", "__end__": END})
graph.add_edge("tools", "agent")                          # 循环边 ← 关键
```

### 循环怎么停

不是 LangGraph 停的，是 **LLM 自己决定的**。`bind_tools` 后 LLM 返回的 `AIMessage` 有两种形态：

```python
# 需要工具 → tool_calls 不为空
AIMessage(content="", tool_calls=[{"name": "get_weather", "args": {...}}])

# 不需要工具 → tool_calls 为空（信息够了，直接回答）
AIMessage(content="北京晴 25°C", tool_calls=[])
```

`should_continue` 只做一件事：读最后一条消息，`tool_calls` 有就走 tools，没有就走 END。

### tools 定义去哪了

**在请求里，不在回复里。** `bind_tools` 每次 API 调用都会把工具的 JSON Schema 注入请求参数，LLM 据此判断是否调工具。回复里只有 `tool_calls: [...]` 或 `tool_calls: []`，不包含工具定义。**工具 Schema 每轮请求都带，这是 Agent 比普通对话更费 token 的主因。**

## 子图 — 模块化 Agent 的底座

```
┌─────────────────────────────────────────────┐
│          父图 (RouterState)                  │
│                                             │
│  START → router_proxy → END                 │
│              │                              │
│      ┌───────┴────────┐                     │
│      ▼                ▼                     │
│  ┌─────────┐    ┌───────────┐               │
│  │ 退货子图  │    │ 技术子图   │              │
│  │ START→...│    │ START→... │              │
│  └─────────┘    └───────────┘               │
└─────────────────────────────────────────────┘
```

### router_proxy — 分诊台

**不做推理，只做分发。** 判断用户意图 → 转发给对应子图 → 收集结果。

```python
def router_proxy(state: RouterState) -> RouterState:
    query = state["user_query"]

    if "退货" in query:
        result = return_subgraph.invoke({"order_id": "xxx", ...})
        return {"final_response": result["return_result"]}

    elif "故障" in query:
        result = tech_subgraph.invoke({"product_name": "音箱", ...})
        return {"final_response": result["solution"]}

    else:
        return {"final_response": "转人工客服"}
```

### router_proxy 的能力边界

它不是简单的 if/elif 分发器。随着业务复杂，它可以做这些事：

| 层级 | 能力 | 例子 |
|------|------|------|
| 基础 | 关键词匹配 | `"退货" in query` → 退货子图 |
| 进阶 | LLM 意图分类 | `llm.with_structured_output(IntentEnum)` → 精确路由 |
| 高级 | 多意图拆解 | "退货顺便问下音箱怎么修" → 并行调退货子图 + 技术子图 |
| 专家 | 上下文感知 | 根据历史对话推断用户没说清楚的意图 |

但核心原则不变：**router 不做业务，只做分发。** 业务逻辑封装在子图里。

**router_proxy 本身技术上没有复杂度**——就是 if/elif 分发。真正花心思的是"怎么判断意图"这层业务策略（关键词规则够不够？什么时候升级到 LLM 分类？多意图要不要并行？），这些是产品设计问题，不是 LangGraph 框架问题。

### State 设计 — 企业级最容易被低估的部分

State 不是随便塞几个字段就完事了。不同层级的图有**完全不同的视角**，State 设计错了，后面所有节点都得跟着改。

**核心原则：每个图只定义自己关心的字段。** 子图 State 和父图完全隔离：

```python
# 父图：业务视角 — 只关心输入和输出
class ParentState(TypedDict):
    user_query: str
    final_answer: str | None

# 子图：技术分析视角 — 关心分析过程和中间步骤
class SubgraphState(TypedDict):
    analysis_input: str
    analysis_result: str
    intermediate_steps: list    # 这个字段父图完全不关心
```

> 如果父图 State 和子图 State **没有同名字段**，必须用 proxy 手动翻译（下例）。如果有同名字段（如 `messages`），可以直接 `add_node("sub", compiled_subgraph)` 自动共享，不需要 proxy。这是机械规则，不是模式选择。

**proxy 节点 = 翻译官**，三步走：

```python
def proxy_node(state: ParentState) -> ParentState:
    # 步骤 1：ParentState → SubgraphState
    sub_input = {
        "analysis_input": state["user_query"],
        "analysis_result": "",
        "intermediate_steps": [],
    }
    # 步骤 2：调用子图
    sub_output = compiled_subgraph.invoke(sub_input)
    # 步骤 3：SubgraphState → ParentState（只取需要的）
    return {
        "user_query": state["user_query"],
        "final_answer": sub_output["analysis_result"],
    }
```

**为什么不能共用一个 State？**

| 方案 | 问题 |
|------|------|
| 所有图共用一个巨大 State | 子图改个字段，父图也得跟着改。100 个字段的 TypedDict，谁都不敢动 |
| 每个图独立 State + proxy 翻译 | 子图内部怎么重构，父图无感。`intermediate_steps` 是子图的私有财产 |

```
父图 State = API 的 Response DTO  — 只暴露调用方需要的字段（对外 contract）
子图 State = 内部 Domain Object  — 埋点、日志、中间状态，自己消化
proxy     = 序列化层             — 把内部对象转成对外 contract
```

**三条铁律：**

1. **只放本图需要的数据** — 不要"以防万一"预填字段
2. **子图的私有字段不进父图** — 中间步骤、debug 日志、临时状态，子图自己消化
3. **State 的命名暴露设计水平** — `final_answer` 比 `result` 清楚一百倍，`intermediate_steps` 一眼就知道是中间过程不是最终输出

### 最佳实践

| 实践 | 为什么 |
|------|--------|
| proxy 节点加 `try/except` 兜底 | 子图挂了父图不能崩，返回降级响应（如"该服务暂时不可用"） |
| 子图嵌套不超过 3 层 | 超过 3 层排查问题变成噩梦，先考虑能不能拆分而非继续套娃 |
| 子图之间不直接通信 | 通过父图 State 协调，否则子图互相依赖 = 改一个炸一片 |

## 关键约束

| 约束 | 说明 |
|------|------|
| 编译顺序 | `add_node` + `add_edge` 必须在 `compile()` 之前 |
| 入口必须 | `START` 必须连到一个节点，否则 compile 报错 |
| 同步/异步 | `invoke()` 只能调同步节点，`ainvoke()` 只能调异步节点，不能混 |
| State reducer | `add_messages` 自动 append，普通字段默认覆盖 |

## 当前进度

```
✅ State + Node + Edge 基本结构
✅ agent → should_continue ⇄ tools 循环 Agent
✅ 子图 + router_proxy 模块化编排
🔄 Checkpointer（图状态持久化 → [[LangGraph — Checkpointer 检查点]]）
⬜ Human-in-the-loop（执行前人工确认）
⬜ 并行分支（多子图同时跑）
```

## 相关文件

- `langgraph/my_agent.py` — 手写的最小 Agent（agent → tools 循环）
- `langgraph/subgraph_demo.py` — 子图 + 路由分发
- `langgraph/langgraph_state_flow.md` — State 流转逐帧图解

[[LangChain Tool Calling 最小 MVP]]
[[LCEL — LangChain Expression Language]]
[[RAG — 检索增强生成]]
[[LangChain 记忆（Memory）]]