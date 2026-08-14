# LangChain Tool Calling 最小 MVP

## 完整链路

```
@tool 定义工具 → bind_tools 注入 LLM → LLM 返回 tool_calls → 执行工具 → ToolMessage 喂回 LLM → LLM 总结回复
```

## 代码骨架

```python
# 1. 定义工具 — @tool 语法糖，自动提取 name/description/参数schema
@tool
def get_weather(loc: str) -> str:
    """[什么时候用]... [参数]... [返回]..."""

# 2. 创建 LLM 并 bind_tools — 把工具转成 JSON Schema 注入每次请求
llm = ChatAnthropic(model="...")
llm_with_tools = llm.bind_tools([get_weather])

# 3. 调用
response = llm_with_tools.invoke([HumanMessage(content="北京天气？")])

# 4. 遍历 tool_calls，执行工具
for tc in response.tool_calls:
    result = tool.invoke(tc["args"])
    messages.append(ToolMessage(content=result, tool_call_id=tc["id"]))

# 5. LLM 汇总工具结果，生成最终回复
final = llm_with_tools.invoke(messages)
```

## 关键概念

### Runnable 协议（LangChain 最核心设计）

万物皆 Runnable，统一接口：

| 方法 | 作用 |
|---|---|
| `invoke(input)` | 单个输入 → 单个输出 |
| `batch(inputs)` | 多个输入 → 多个输出（并行）|
| `stream(input)` | 单个输入 → 逐块输出 |

因为接口统一，任意两个 Runnable 能用 `\|` 管道符串联：`prompt \| llm \| output_parser`

### Tool 三种写法

| 方式 | 原理 | 适用场景 |
|---|---|---|
| `@tool` 装饰器 | 语法糖，底层也是 BaseTool | **日常 90%，推荐** |
| 继承 `BaseTool` | 完全可控，支持 `_arun` 异步 | 需要异步请求时 |
| `Tool` 类实例化 | 旧版写法 | 不推荐，已被 @tool 覆盖 |

**结论**：写新代码一律 `@tool`，遇到异步需求才继承 `BaseTool`。

### bind_tools 关键参数

`bind_tools` 做的事：把 Tool 转成 JSON Schema 注入请求，让 LLM"知道"自己能调什么。

| 参数 | 作用 |
|---|---|
| `bind_tools([t1, t2])` | 注入工具列表，LLM 自行判断调哪个 |
| `tool_choice="auto"` | LLM 自行决定要不要调工具（**默认**）|
| `tool_choice="any"` | 强制 LLM 必须调某个工具 |
| `parallel_tool_calls=True/False` | 允不允许同时调多个工具 |

### ChatPromptTemplate → [[Prompt Template — 提示词工程]]

### Tool 描述最佳实践

好的描述应该包含：

1. **什么时候用** — 触发条件
2. **什么时候不能用** — 约束条件（LLM 对反例比正例更敏感，必须加上"不要做什么"）
3. **参数格式要求**
4. **返回值结构**
5. **错误处理** — **始终返回字符串，不要抛异常**。LLM 拿到错误字符串后会自己解释给用户，不需要代码里细分 404/超时/未知错误。

```python
@tool
def get_weather(loc: str) -> str:
    """
    [什么时候用] 当用户询问任何城市的天气时使用此工具。
    [重要约束] loc 必须是英文城市名，绝对不能传入中文。
               错误：'北京' → 正确：'Beijing'
    [返回] JSON 字符串，包含温度、湿度、天气状况。
    """
```

## 进阶

### args_schema — 复杂参数（嵌套、枚举）

简单 `def get_weather(loc: str)` 不需要它。参数一复杂就必须上：

```python
from pydantic import BaseModel, Field
from typing import Literal

class SearchInput(BaseModel):
    query: str
    category: Literal["news", "image", "video"]
    sort: Literal["hot", "new", "top"] = "hot"

@tool(args_schema=SearchInput)
def search(query: str, category: str, sort: str = "hot"):
    ...
```

等价于 JS 的 Zod schema。Pydantic 直接转成 JSON Schema 发给 LLM，精确度远超纯 type hint。

### 异步 Tool

`@tool` 是同步的。需要同时发多个 HTTP 请求时继承 `BaseTool`：

```python
class GetWeatherTool(BaseTool):
    name = "get_weather"
    description = "..."

    async def _arun(self, loc: str) -> str:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, ...)
        return json.dumps(resp.json())
```

同步 `@tool` 能调 API，异步只在"同时发多个请求省总时间"时才有意义。

### handle_tool_error — 错误兜底

BaseTool 的字段属性（不是独立函数），三种值：`True`（返回原始错误）、`"固定文案"`、`lambda e: f"错误：{e}"`。

```python
@tool(handle_tool_error="查询失败，请稍后重试")
def get_weather(loc: str) -> str: ...
```

### return_direct — 跳过 LLM 总结

```python
@tool(return_direct=True)
def get_weather(loc: str) -> str: ...
```

查询类工具（天气、汇率）适用，结果直接给用户。默认流程是 LLM 再过一遍。

## 扩展：MCP — 工具集成的标准化协议

> 以下内容已完成概念了解 + 代码实操（STDIO/SSE 两种模式）。

### 本质：MCP 是协议，不是库

MCP（Model Context Protocol）= 标准化工具交互协议，就像 HTTP 定义了请求/响应格式，MCP 定义了**工具发现 + 调用 + 响应的统一规范**。各语言的 SDK（Python/TypeScript/Java/Kotlin）只是协议的实现。

```
MCP 三层架构
┌─────────────────────────────────────┐
│ 1. 工具发现协议  — list_tools()     │  ← MCP 的核心价值：AI 不需要硬编码知道有哪些工具
│ 2. 调用-响应规范  — JSON-RPC        │  ← 统一的请求/响应格式
│ 3. 传输层         — STDIO / SSE / WS│  ← 最不重要的一层，只决定"怎么传"，不影响"能做什么"
└─────────────────────────────────────┘
```

### 传输层对比（你已实操验证）

| 维度 | STDIO | SSE（HTTP） |
|---|---|---|
| 连接方式 | 父进程 fork 子进程，管道直连 | HTTP 长连接，通过端口通信 |
| 能否远程 | ❌ 必须同机 | ✅ 可跨机器 |
| 主动推送 | ❌ 只能请求-响应 | ✅ 服务器可主动推数据 |
| 复杂度 | 无依赖，subprocess 即用 | 需要 Flask + sseclient |
| 适用场景 | 本地 IDE 插件、CLI 工具 | Web 应用、远程服务、实时推送 |

传输层不重要 — 同一套协议，换 STDIO 还是 HTTP 不影响工具定义和调用逻辑。

### 语言无关

MCP Server 可以用任意语言实现，客户端用其他语言连接 — 协议保证互操作性：

```
Node.js MCP Server  ←── MCP 协议 ──→  Python LangChain Client
Java MCP Server     ←── MCP 协议 ──→  TypeScript Client
```

### 相关文件

- `mcp_stdio_server.py` / `mcp_stdio_client.py` — STDIO 管道通信
- `mcp_sse_server.py` / `mcp_sse_client.py` — HTTP/SSE 端口通信
- `stdio_demo.py` — 管道原理简化演示

[[Pydantic 速查]]
[[Python 基础语法速查 — 引号、继承、Pydantic]]
[[LCEL — LangChain Expression Language]]