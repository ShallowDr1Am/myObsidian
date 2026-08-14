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