# LCEL（LangChain Expression Language）

## 核心概念：万物皆 Runnable

所有组件（Prompt、Model、Parser、Tool）都遵循统一接口 `invoke / batch / stream`，因此能用 `|` 随意串联。

## 六大组件

### 1. `|` 管道 — 函数组合

```python
chain = prompt | model | parser
# 等价于 parser(model(prompt(input)))
```

Python 通过 `__or__` 操作符重载实现。**JS 无法做到**（JS 不允许操作符重载，`|` 永远是位运算），所以 JS 生态只能用 `pipe()` 函数调用语法。

### 2. RunnableBranch — 条件分支

```python
from langchain_core.runnables import RunnableBranch

branch_chain = RunnableBranch(
    (lambda x: "紧急" in x["content"], emergency_chain),
    (lambda x: "无聊" in x["content"], joke_chain),
    default_chain,  # 兜底
)
```

一条输入根据条件走不同的下游链。**RunnableBranch 本身可以放在 `|` 右侧，但构造内部不支持 `|` 语法。**

### 3. RunnableParallel — 并行执行

```python
from langchain_core.runnables import RunnableParallel

parallel_chain = RunnableParallel(
    translation=translate_chain,   # 任务1
    summary=summary_chain,         # 任务2
    keywords=keywords_chain,       # 任务3
)
result = parallel_chain.invoke(input)
# result = {"translation": "...", "summary": "...", "keywords": "..."}
```

相当于 JS 的 `Promise.all`，但返回命名字典而非按序数组。**RunnableParallel 本身可以放在 `|` 右侧，但构造内部不支持 `|` 语法。**

### 4. 序列化 — dumps / loads

```python
from langchain_core.load import dumps, loads

# 序列化到字符串
json_str = dumps(prompt)

# 反序列化
restored = loads(json_str)
```

对应 Python 标准库的 `json.dumps` / `json.loads` 命名惯例。**注意**：`ChatOpenAI` 的 `api_key` 是 `SecretStr`，序列化后会被遮蔽，实践中通常只序列化 prompt，model 运行时重建。

### 5. RunnablePassthrough — 透传

```python
from langchain_core.runnables import RunnablePassthrough

# 不对数据做任何处理，直接传给下游
chain = prompt | model | RunnablePassthrough()
```

常用于并行场景中保留原始输入，或作为占位符。

### 6. RunnableLambda — 函数包装

```python
from langchain_core.runnables import RunnableLambda

def clean_text(data: dict) -> dict:
    data["content"] = data["content"].strip().lower()
    return data

clean = RunnableLambda(clean_text)

# 可以和 | 自由拼接
chain = clean | prompt | model | parser
```

**注意**：`RunnableLambda` 接收的是上游 `invoke` 的完整输出（通常是字典），不是裸字符串。函数签名要和管道中上一个组件的输出类型匹配。

## 六种模式对比

| 模式 | 语法 | 能用 `\|` ？ | 行为 | JS 类比 |
|---|---|---|---|---|
| 管道 | `a \| b \| c` | ✅ 作为链节 | 串行，前一个输出→后一个输入 | `pipe(a, b, c)` |
| Lambda | `RunnableLambda(fn)` | ✅ 作为链节 | 包装普通函数，能串入管道 | `(x) => fn(x)` |
| 透传 | `RunnablePassthrough()` | ✅ 作为链节 | 原样传递，不做任何处理 | `(x) => x` |
| 分支 | `RunnableBranch(...)` | ✅ 作为链节 | 根据条件选路由 | `switch` / `if-else` |
| 并行 | `RunnableParallel(...)` | ✅ 作为链节 | 多任务同时跑 | `Promise.all` |
| 序列化 | `dumps()` / `loads()` | — | JSON 导出/恢复 | `JSON.stringify` / `parse` |

> **所有 Runnable 都可以放在 `|` 右侧**。之前教材里常见的"Branch/Parallel 不能用 `|`"指的是**内部构造语法**不能用 `|`（即 `RunnableBranch(a \| b)` 不行），而不是它们本身不能作为链的一环。

## `|` 语法糖的核心规则

**所有 Runnable 实现都能放在 `|` 链中。** 唯一不能放的是"构造语法内部"。

```python
# ✅ 都对 — 任何 Runnable 都可以放 | 右边
add_one | branch | double         # Branch 作为链节
prompt | parallel | parser        # Parallel 作为链节
branch | parallel | lambda_fn     # 混合串联

# ❌ 错误 — Branch/Parallel 的构造语法不支持 |
branch = RunnableBranch((cond, chain_a | chain_b))   # 内部不能用 |
parallel = RunnableParallel(a=chain_a | chain_b)      # 内部不能用 |
```

**记忆方式：**
- 所有 Runnable 都可以做 `|` 链节 — Branch/Parallel 也不例外
- 但 Branch/Parallel **内部子链**要用完整语法，不能用 `|`
- `RunnableLambda` = 普通函数穿了一件 Runnable 外套 → 自由串入

## 组合使用

```python
chain = (
    preprocess                             # 1. Lambda 预处理
    | RunnableBranch(                      # 2. Branch 路由
        (lambda x: "退款" in x, refund_chain),
        (lambda x: "咨询" in x, info_chain),
        default_chain,
    )
    | RunnableParallel(                    # 3. Parallel 并行
        answer=main_model,
        suggestion=recommend_model,
    )
    | format_output                        # 4. Lambda 格式化输出
)
```

**注意**：外层 `|` 连接的是 RunnableSequence/Branch/Parallel 的调用点，不是 Branch/Parallel 内部用 `|`。

## 核心原则

1. **`|` 是管道** — 数据从左向右流
2. **一切皆 Runnable** — prompt、model、parser、Lambda、Branch、Parallel 都是同一类对象
3. **组合优于继承** — 用 `|` 拼装，不写复杂类
4. **懒执行** — `chain = a | b | c` 只是蓝图，`invoke()` 才真正执行
5. **所有 Runnable 都可当 `|` 链节** — 包括 Branch 和 Parallel。只有构造语法内部才不能用 `|`

## Python 语法速查

### 字典迭代

```python
for key, value in result.items():
    print(f"[{key}] {value}")
```
等价于 JS 的 `for (const [k, v] of Object.entries(obj))`。

## 相关问题

[[LangChain Tool Calling 最小 MVP]]