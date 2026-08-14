# Pydantic 速查

> Python 的数据校验库，LangChain 用它定义 Tool 参数、结构化输出、配置模型。等价于 JS 的 **Zod**。

## 核心三件套

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional

class UserInput(BaseModel):
    name: str                                      # 必填字符串
    age: int = Field(ge=0, le=150)                 # 带校验的整数
    role: Literal["admin", "user"] = "user"        # 枚举，默认 "user"
    email: Optional[str] = None                    # 可选字段
```

| 概念 | 代码 | JS 等价 |
|------|------|---------|
| 定义模型 | `class X(BaseModel):` | `z.object({...})` |
| 字段描述 | `Field(description="...")` | `.describe("...")` |
| 枚举限制 | `Literal["a", "b"]` | `z.enum(["a", "b"])` |
| 可选字段 | `Optional[str] = None` | `z.string().optional()` |
| 数字范围 | `Field(ge=0, le=100)` | `z.number().min(0).max(100)` |

## 在 LangChain 中的角色

Pydantic 是 LangChain 以下功能的**底层依赖**：

```
@tool(args_schema=...)     → BaseModel → JSON Schema → 发给 LLM
with_structured_output()   → BaseModel → 约束 LLM 输出格式
BaseTool.args_schema       → BaseModel → 自动生成工具参数文档
```

你用 `@tool` 时即使不写 `args_schema`，LangChain 也自动从函数签名生成了一个隐式的 Pydantic model。复杂参数场景才需要显式写出来。

## 校验能力速览

```python
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime

class OrderInput(BaseModel):
    # 基础校验
    product: str = Field(min_length=1)          # 最短长度
    quantity: int = Field(gt=0)                 # 大于 0
    price: float = Field(gt=0, le=99999)        # 浮点数范围
    tags: list[str] = []                        # 字符串列表

    # 自定义校验（@field_validator）
    @field_validator("product")
    @classmethod
    def product_no_sql_injection(cls, v):
        if any(kw in v.lower() for kw in ["drop", "delete", "insert"]):
            raise ValueError(f"疑似 SQL 注入: {v}")
        return v
```

## 模型嵌套（args_schema 的杀手场景）

```python
class Address(BaseModel):
    city: str
    district: Optional[str] = None

class UserInput(BaseModel):
    name: str
    address: Address            # ← 模型里面塞模型
    tags: list[str] = []
```

等价 JS：
```ts
const Address = z.object({ city: z.string(), district: z.string().optional() });
const UserInput = z.object({ name: z.string(), address: Address, tags: z.array(z.string()) });
```

序列化成 JSON Schema 后，LLM 就知道怎么传嵌套参数了：
```json
{"name": "张三", "address": {"city": "北京", "district": "朝阳"}, "tags": ["vip"]}
```

## 模型实例化 & 序列化

```python
# 创建实例 → 自动校验
user = UserInput(name="张三", address=Address(city="北京"))

# 实例 → dict → JSON
user.model_dump()                 # {"name": "张三", "address": {"city": "北京", "district": null}}
user.model_dump_json()            # JSON 字符串

# dict → 实例
UserInput.model_validate({...})   # 从 dict 构造，会校验
UserInput.model_validate_json('{"name": "张三", ...}')  # 从 JSON 字符串构造
```

## 学习优先级

| 优先级 | 内容 | 理由 |
|--------|------|------|
| ⭐⭐⭐ | `BaseModel` + `Field` 基本用法 | 99% 的 LangChain 场景就这些 |
| ⭐⭐ | 模型嵌套 | `args_schema` 复杂参数必用 |
| ⭐ | `field_validator` 自定义校验 | 偶尔需要，知道有这个能力就行 |
| - | `model_config`、泛型、递归模型 | LangChain 场景几乎用不到 |

**结论**：Pydantic 本身深度有限，15 分钟过一遍文档就够。真正花时间的是用它在 LangChain 里定义复杂 Tool 参数和实践 `with_structured_output`。

## PydanticOutputParser vs with_structured_output

两种方式都能让 LLM 输出结构化数据，但原理完全不同。

### 核心区别

| 维度 | PydanticOutputParser | with_structured_output |
|------|---------------------|----------------------|
| 本质 | 一个**解析器组件**，放在 chain 末尾 | 一个**模型包装方法**，直接返回 LLM 的结构化能力 |
| 工作原理 | 在 prompt 中注入 JSON 格式说明 → LLM 输出文本 → 解析 JSON | 通过模型 API 原生能力（如 Function Calling / JSON Mode）直接返回结构化数据 |
| 可靠性 | 依赖 LLM "理解"格式要求，可能输出非法 JSON | 模型原生支持，LLM 不可能输出格式错误的数据 |
| 代码量 | 多步：定义 parser → 注入 `format_instructions` → 拼 chain | 一步：`llm.with_structured_output(Schema)` |

### 生活例子

**PydanticOutputParser（口头嘱咐）**：
> 你给员工一张纸条："请按以下格式写报告：`{'姓名': 'xxx', '年龄': 数字}`"
> 员工写完后你检查格式对不对。
> 问题：员工可能写错，比如写成 `"二十五岁"`（字符串而非数字）。

**with_structured_output（强制表格）**：
> 你给员工一个固定表格，必须往里面填。
> 优势：员工不会写错格式，因为表格已经定死了。

### 代码对比

```python
# PydanticOutputParser — 注入 prompt + 解析文本
from langchain_core.output_parsers import PydanticOutputParser

parser = PydanticOutputParser(pydantic_object=MovieInfo)
prompt = ChatPromptTemplate.from_messages([
    ("system", "按格式输出。\n{format_instructions}"),  # ← 必须手动注入格式说明
    ("human", "{input}"),
])
chain = prompt | llm | parser  # ← parser 作为 chain 最后一环
result = chain.invoke({"input": "...", "format_instructions": parser.get_format_instructions()})

# with_structured_output — 一行搞定
structured_llm = llm.with_structured_output(MovieInfo)
result = structured_llm.invoke("《盗梦空间》2010年诺兰导演，科幻悬疑，评分9.3")
# result 直接是 MovieInfo 对象，字段已校验
```

### 怎么选

| 场景 | 推荐 |
|------|------|
| 模型支持原生 structured output（大多现代模型） | **with_structured_output**，简洁可靠 |
| 老模型 / 本地模型不支持 | PydanticOutputParser 兜底 |
| 需要精确控制 prompt 格式 | PydanticOutputParser（因为格式说明在 prompt 里，你可以改） |

**结论**：新项目一律用 `with_structured_output`。PydanticOutputParser 知道存在就行，作为兜底方案。