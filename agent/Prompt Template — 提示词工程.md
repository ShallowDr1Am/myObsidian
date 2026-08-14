# Prompt Template — 提示词工程

> Prompt 是 LLM 的入口，ChatPromptTemplate 是 LangChain 对 Prompt 的结构化封装。

## ChatPromptTemplate — Prompt 层的基石

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个友好的客服。"),
    MessagesPlaceholder(variable_name="chat_history"),  # 动态注入历史对话
    ("human", "{user_input}")
])

final_prompt = prompt.invoke({
    "chat_history": [...],   # 聊天历史
    "user_input": "你好"     # 当前输入
})
```

一切 LCEL 链的入口，和 Runnable 一样实现 `invoke`，所以能和其他组件串联。

## Chat API 的三层 role 机制

Chat API 不是纯文本，而是带 role 标签的**结构化消息数组**。LLM 训练阶段就内化了 `system > user` 的优先级。

```python
[
    {"role": "system", "content": "你是客服，只能根据以下资料回答。"},
    {"role": "user",   "content": "北京天气？"},
]
```

| role | 权重 | 放什么 |
|------|:--:|------|
| `system` | **最高** | RAG 上下文、系统指令、安全规则 |
| `MessagesPlaceholder` | 一般 | 历史聊天记录 |
| `human` | 一般 | 当前用户问题 |

RAG 上下文放 system 槽位，LLM 天然会更重视——比在 user prompt 里加 "请依据以下内容..." 可靠。

## 固定变量：`partial()` / `partial_variables`

就像一碗米粉——店家给你底料（模板），佐料可以固定加好或者临时调。

```python
# partial() — 固定变量，后续每次不用传
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是{role}，用{language}回答。"),
    ("human", "{question}"),
])
prompt = prompt.partial(role="客服", language="中文")

# 调用时只传没固定的变量
prompt.invoke({"question": "你好"})  # role/ language 自动填入

# 临时覆盖单次
prompt.partial(language="英文").invoke({"question": "hello"})
```

其实就是 JS 里 `Function.prototype.bind`——先绑死几个参数，后面只管变的。典型场景：`user_id`、`tenant_id` 等每轮都一样的固定变量。

> **参数缺失会直接抛 KeyError**：`template.invoke({"a": "hello"})` 缺了 `b` → `KeyError: "Missing input variables: ['b']"`。用 `partial()` 提前填好能避免。

## 动态修改模板：`append_text()` / `prepend_text()`

**使用频率极低**。模板是自己写的 → 直接改模板就行。它们唯一有意义的时候：**模板来自外部（配置文件、数据库、别的团队），你不能改，但需要运行时注入系统级控制。**

```python
base = PromptTemplate.from_template("推荐{cuisine}菜")

# 系统级安全注入（模板不是你写的，不能改）
guarded = base.prepend_text("安全规则：不要泄露个人信息。")
# → "安全规则：不要泄露个人信息。\n推荐{cuisine}菜"
```

典型场景：安全中间件、多租户 SaaS 风格注入、A/B 测试、合规声明。属于"知道存在就行"的知识点。

## Tool 描述最佳实践

`@tool` 的 docstring 本质上也是 prompt。好的描述包含：

1. **什么时候用** — 触发条件
2. **什么时候不能用** — LLM 对反例比正例更敏感
3. **参数格式要求**
4. **返回值结构**
5. **错误处理** — **始终返回字符串，不要抛异常**

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

## Output Parser — 把 LLM 原始输出转成代码可用格式

LLM 返回的是 `AIMessage` 对象，parser 负责转换。

### 四种 Parser

| Parser | 输出 | 场景 |
|--------|------|------|
| `StrOutputParser` | `str` | 90% 场景，取 `.content` |
| `CommaSeparatedListOutputParser` | `list[str]` | "列出 X 种..." |
| `JsonOutputParser` | `dict` | 自由 JSON，不需要固定结构 |
| `PydanticOutputParser` | Pydantic 对象 | 严格字段 + 类型校验 |

### with_structured_output（推荐）

```python
class MovieInfo(BaseModel):
    title: str
    year: int
    director: str

# 一行搞定，不需要拼接 parser
result = llm.with_structured_output(MovieInfo).invoke("《盗梦空间》2010年诺兰导演")
# → MovieInfo(title='盗梦空间', year=2010, director='诺兰')
```

`with_structured_output` 调的是模型 API 原生能力（Function Calling / JSON Mode），LLM 不可能输出格式错误的数据。`PydanticOutputParser` 是旧的纯文本注入 + 解析方案，新项目一律用前者。

## 高级方法（按需使用）

### merge() — 组合模板

把多个独立模板拼成一个。适用于模块化构建复杂 prompt、复用模板片段：

```python
starter = PromptTemplate.from_template("开胃菜：{starter}")
main = PromptTemplate.from_template("主菜：{main}")
dessert = PromptTemplate.from_template("甜点：{dessert}")

full_meal = starter.merge(main).merge(dessert)
full_meal.invoke({"starter": "沙拉", "main": "牛排", "dessert": "冰淇淋"})
# → "开胃菜：沙拉，主菜：牛排，甜点：冰淇淋"
```

### from_examples() — 少样本学习（Few-Shot）

给 LLM 看几个例子，它按例子模式处理新输入。适用于需要模仿特定格式、分类任务：

```python
examples = [
    {"input": "开心的", "output": "微笑"},
    {"input": "伤心的", "output": "哭泣"},
    {"input": "惊讶的", "output": "惊叹"},
]

template = PromptTemplate.from_examples(
    examples=examples,
    suffix="输入：{word}\n输出：",
    input_variables=["word"],
)

template.invoke({"word": "困惑的"})
# 输入：困惑的
# 输出：思考  (LLM 根据例子推理)
```

**本质就是 prompt 里拼几组 example 进去**，核心价值是省掉手写"请按如下格式..."的自然语言描述。

### from_file() — 模板与代码分离

模板数量多时，从文件加载，配合 git 版本控制：

```python
# templates/greeting.txt 内容：
# 你好，{name}！欢迎来到{store}。

template = PromptTemplate.from_file("templates/greeting.txt")
template.invoke({"name": "王小明", "store": "老王茶馆"})

[[LangChain Tool Calling 最小 MVP]]
[[Pydantic 速查]]
[[RAG — 检索增强生成]]