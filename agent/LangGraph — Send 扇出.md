# LangGraph — Send 扇出

> 条件边的第二种形态：路由函数不返回「去哪个节点」，而是返回一列 `Send` —— 同一个节点带着不同输入并行跑 N 遍。Map-Reduce 的 Map 靠它实现。

![[LangGraph-Send扇出图解.mp4]]

---

## 1. 一句话

`add_conditional_edges` 的路由函数有两种合法返回值：

| 返回 | 含义 | 例子 |
|---|---|---|
| `"tools"`（字符串） | 下一步去**哪个**节点 | agent 循环 |
| `[Send("n", d1), Send("n", d2), …]`（列表） | 同时启动 **N 份**，各带各的输入 | 144 章并行总结 |

---

## 2. 最小骨架（novel_rag 实战代码）

```python
class OverallState(TypedDict):
    summaries: Annotated[list, operator.add]   # ← reducer，扇出的另一半（见 §3）
    _pending: list                              # ← 必须声明，LangGraph 只传声明过的字段

class SummarizeState(TypedDict):                # ← 并行副本拿到的瘦 State
    title: str; index: int; content: str

def dispatcher(state: OverallState) -> list[Send]:
    return [
        Send("summarize_chapter", {             # 参数1：节点名
            "title": c["title"],
            "index": c["index"],                # 参数2：这一份的输入（就是 SummarizeState）
            "content": c["content"],
        })
        for c in state["_pending"]              # 144 章 → 144 张任务单
    ]

builder = StateGraph(OverallState)
builder.add_node("summarize_chapter", summarize_chapter)
builder.add_conditional_edges(START, dispatcher)   # 和普通条件边同一个 API
builder.add_edge("summarize_chapter", END)
graph = builder.compile()
```

三个要点：
1. **Send 的第二个参数是独立数据**，不是整个 State —— 所以并行副本用瘦 State（`SummarizeState`），父图字段不用全带
2. **`_pending` 必须在 OverallState 里声明**。漏了不报错，dispatcher 拿到空列表，图跑完什么都不干 —— 最阴的静默失败
3. dispatcher 里**不要做耗时操作**，它只是发任务单；真正干活的是并行节点

---

## 3. reducer —— 扇出的另一半

N 个并行副本同时 `return {"summaries": [一条]}`，写同一个 key。没有 reducer 直接报冲突（`InvalidUpdateError`）：

```python
summaries: Annotated[list, operator.add]   # operator.add = 列表拼接
```

框架把 144 个单元素 list 拼成一个大 list。**Map-Reduce = dispatcher 劈开（Map）+ reducer 收拢（Reduce）**。

没有现成 reducer 时自己写一个：

```python
def merge_dicts(a: dict, b: dict) -> dict:
    return {**a, **b}

class State(TypedDict):
    results: Annotated[dict, merge_dicts]
```

---

## 4. 乱序是常态

实测 144 章的完成顺序：`24 → 41 → 44 → 43 → 48 …`（LLM 响应快慢不一）。两条纪律：

- **每条结果自带身份**（`index`），写库/对齐靠它，绝不靠列表位置
- **别假设「先发先回」**。任何「第 N 个完成的就是第 N 章」的逻辑都是定时炸弹

---

## 5. 和其他模式的分工

| 需求 | 用什么 |
|---|---|
| 二选一/多选一的路由 | 条件边返回字符串（[[LangGraph — Agent 编排]]） |
| 同一节点 × N 份不同输入并行 | **Send 扇出**（本文） |
| N 个**不同**节点并行 | 条件边返回多个节点名 `["a", "b"]`（无独立输入时够用） |
| 逐 token 流式进度 | 节点签名注入 `writer`（[[LangGraph — Streaming 流式输出]]） |

⚠️ 条件边返回 `["a", "b"]` 也能并行，但**所有副本共享同一份 State**；Send 的价值在于**每份输入可以不同**。

---

## 6. 流式构建全流程（把 §2-§5 串起来）

一次「总结 144 章」从触发到落盘，数据经过四段管道：

```
①建图（静态）        ②图执行（动态）            ③消费（生成器）      ④落盘
──────────          ──────────────            ────────────        ──────
dispatcher 返回      每个并行节点：             stream_build：      cache/*.json
144 张 Send  ──→    writer({...})→custom流 ─→ 收一个yield一个 →  每章存一次盘
（Map：劈开）        return {...}→updates流      ↓ mode 分流       ↓
                     （144份乱序完成）          progress/chapter  index_to_chroma
                     operator.add 归并（Reduce）  事件             → 向量库
```

| 段 | 代码（build_index.py） | 机制 |
|---|---|---|
| ① 建图 | `dispatcher()`（L130） | 条件边返回 `list[Send]` = 并行 N 份 |
| ② 图执行 | `summarize_chapter()`（L103） | 跑前 `writer()` 推 custom；跑完 `return` 进 updates |
| ③ 消费 | `stream_build()`（L282） | `for mode, raw in graph.stream()` 收，`yield` 转交 |
| ④ 落盘 | `save_cache` / `index_to_chroma` | 每章存盘（断点续跑）；摘要+metadata 入向量库 |

三个关键认知：

1. **mode 是运行时标签。** `stream_mode` 是调用时传的白名单；数据来源在建图时定（writer 推什么 → custom，节点 return 什么 → updates）。换 stream_mode 就换观测方式，图不用改
2. **custom 和 updates 是两份不同的数据。** custom = 「第 41 章开始了」（跑前推）；updates = 「第 41 章完成了」（return，带摘要）。所以必须分流，不能塞一个 kv
3. **`for ... in graph.stream()` + `yield` 是两段流的接龙。** 两个生成器首尾相接，数据全程不落地——CLI 直接 for 循环，网页转 SSE，同一份逻辑

### 消费端分流的标准写法

```python
for mode, raw in graph.stream(input, stream_mode=["updates", "custom"]):
    if mode == "custom":
        yield {"type": "progress", **cast(dict, raw)}   # ** 是 dict 解包平铺
        continue
    chunk = cast(dict, raw)                              # ⚠️ 先 cast 收窄再下标
    item = cast(dict, chunk["summarize_chapter"]["summaries"][0])
    # updates 取值路径：{节点名}[节点 return 的字段][list 元素]
```

⚠️ `cast` 只作用于括住的最外层表达式——内联成 `raw["节点名"][...]` 时 raw 还是联合类型，Pylance 报「字符串下标 tuple」错。**先 cast 收窄，再下标**（踩过）。

⚠️ updates 给的是**节点 return 的增量**，不是完整 State——`summarize_chapter` 只 return `{"summaries": [一条]}`，里面没有 `_pending`。要拿别的节点产出的字段，只能在循环里自己累积，或改用 `stream_mode="values"`（每步全量，流量大）。

---

## 实战文件

- `learn/agent/langgraph/novel_rag/build_index.py` — dispatcher（L130）/ OverallState（L81）/ summarize_chapter（L103）/ stream_build 消费循环（L282）
- `learn/agent/langgraph/send-fanout/index.html` — 本文动画的源码（HyperFrames）
- 图解动画：[[小说RAG — 代码阅读清单]] 站 4

[[LangGraph — Agent 编排]] · [[LangGraph — Node 节点]] · [[LangGraph — Streaming 流式输出]]
