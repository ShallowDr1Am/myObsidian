# Python 基础语法速查

## 引号

| 语法 | 特点 |
|---|---|
| `'...'` / `"..."` | 单行，完全等价 |
| `'''...'''` / `"""..."""` | 跨多行，也用作 docstring |

## 类继承

```python
class WeatherInput(BaseModel):   # 继承 BaseModel
    loc: str = Field(...)
```

等价于 JS 的 `class WeatherInput extends BaseModel {}`。

| 概念 | Python | JS/TS |
|---|---|---|
| 继承 | `class A(B):` | `class A extends B {}` |
| 构造函数 | `def __init__(self):` | `constructor() {}` |
| 自身引用 | `self.xxx` | `this.xxx` |

## Pydantic

Python 的数据校验库，相当于 JS 的 **Zod**。Python 的 type hint（`def foo(x: str)`）只是注释不校验，Pydantic 在运行时真的会检查类型。

```python
from pydantic import BaseModel, Field

class WeatherInput(BaseModel):
    loc: str = Field(description="城市英文名")
    limit: int = Field(default=10, ge=1, le=100)
```

## 列表推导式（List Comprehension）

一行替代 for 循环，等价于 JS 的 `arr.map()`：

```python
[Send("generate_joke", {"subject": s}) for s in subjects]
```

拆开看：

```python
result = []
for s in subjects:
    result.append(Send("generate_joke", {"subject": s}))
```

`[ ]` 是语法的一部分，去掉就不是合法语句。`Send(...)` 只是每轮生成的表达式，和 `for` 紧贴容易误读成"Send 带了个循环"。

变体：`[x for x in nums if x > 0]` 过滤，`{k: v for k, v in pairs}` 字典。

## `|` 管道操作符

LangChain 利用 Python 的**操作符重载**（`__or__` 方法）把 `|` 变成了串联运算符：

```python
class Runnable:
    def __or__(self, other):
        return RunnableSequence(self, other)

chain = prompt | model | parser
# 等价于 RunnableSequence(prompt, model, parser)
# 等价于 parser(model(prompt(input)))
```

**JS 无法实现这一点** — JS 不允许操作符重载，`|` 永远是位运算。所以 JS 生态只能用 `pipe()`/`compose()` 函数调用语法，没有这种"运算符即管道"的写法。

前一个的输出自动成为后一个的输入，数据从左流到右，类似 Unix 管道（`cat | grep | wc`）。条件是前后两个 Runnable 的输入输出类型能对上。

## 三元表达式 — 值在中间，条件在右边

```python
cache = {} if force else load_cache(book)
#      └─A─┘ ──B──  └────C────┘
```

等价 TS 的 `cache = force ? {} : loadCache(book)`。差异点：

| | Python | TS |
|---|---|---|
| 语序 | `A if 条件 else C` | `条件 ? A : C` |
| 条件位置 | 右边 | 左边 |
| 读法 | 「A，如果条件；否则 C」 | 「条件？A：C」 |

Python 语序和自然语言一致但**条件在右**，初读容易把 `{}` 当成条件。它和 TS 三元一样是**表达式**（有值），能直接放在 `=` 右边。

## `in` / `not in` — 成员判断，dict 查的是键

```python
"3" in {"3": "摘要"}    # True  —— dict 的 in 查【键】，不查值
3 in {"3": "摘要"}      # False —— int ≠ str，类型不同永远查不中
```

TS 对应物是 `key in obj`（查键）和 `Object.values(obj).includes(x)`（查值）——TS 的 `in` **只**能查键，Python 的 `in` 一身三职：序列查元素、dict 查键、set 查成员。

⚠️ 实战坑（novel_rag 踩过）：JSON 里对象的键只能是字符串，数组元素却可以是数字。`chapters` 里的 `index` 是 `int`，`cache` 的键是 `str`，同一个「第 3 章」一边是 `3` 一边是 `"3"`。不 `str()` 对齐就查不中，且**不报错**——断点续跑静默失效，144 章全部重烧 LLM。

同类陷阱：`1 == 1.0` 是 `True`，但 `1 in ["1"]` 是 `False`。用 `in` 前先问：两边类型真的一样吗？

## 连续字符串字面量 — 相邻的 `"..."` 自动拼接

```python
s = "abc" "def"        # "abcdef"，中间没有 + 号
```

TS 也有同样行为（`"abc" "def"`），但 Python 里它和 docstring 组合出一个阴险变体：

```python
def f():
    """文档
    """
    """另一个字符串"""      # ← 合法！被当成无害的裸表达式
    global x                # ← 之前的 """ 没闭合时，这行被吞进字符串
```

docstring 忘了闭合、后面又跟一个 `"""`，语法**不报错**（连续字面量拼接），函数体被静默吞掉，直到 import 或运行才炸。实战教训：改 docstring 时把结尾的 `"""` 一起纳入编辑范围，改完立刻 `python -c "import 模块"` 验证。