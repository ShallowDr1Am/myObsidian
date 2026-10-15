# RAG — 检索增强生成

> **先查资料，再回答问题。** 解决 LLM 两大硬伤：知识截止日期 + 幻觉。

## 一句话

**RAG = 搜索工程，不是 LLM 原生能力。** LLM 不知道自己"用了 RAG"，它只是收到了一段更长的 prompt。整个链路里只有检索是 RAG 特有的。

```
检索结果 = 向量数据库.search(用户问题)     ← 纯工程，跟 LLM 无关
prompt = f"上下文：{检索结果}\n{问题}"     ← 字符串拼接
回答 = LLM.invoke(prompt)                  ← LLM 无感
```

**两个模型别混**：LLM 负责「读懂并改写」（原文→摘要、检索结果→回答），输出还是文本；embedding 负责「编码定位」（文本→向量），输出是无人可读的数字数组。LLM 的产物是 embedding 的原料。换 LLM 只影响摘要/回答质量，向量库不用动；换 embedding 模型 = 换坐标系，全量重嵌。

## 全链路

```
加载文档 → 文本分割(Chunk) → 向量化(Embedding) → 存入向量数据库 → 用户提问 → 向量检索 → LLM 基于检索结果生成回答
```

| 步骤 | 做了什么 | 核心组件 |
|------|----------|----------|
| 1. 加载 | 读取本地文件、网页、数据库 | `TextLoader`, `WebBaseLoader` |
| 2. 分割 | 把长文档切成小块 | `RecursiveCharacterTextSplitter` |
| 3. 向量化 | 文本 → 高维向量（语义相近=向量相近） | `OpenAIEmbeddings` / 本地模型 |
| 4. 存储 | 向量 + 原文一起存 | `Chroma` / `FAISS` / `Redis` |
| 5. 检索 | 用户提问 → 向量 → 找最相近的 K 个 chunk | `retriever.invoke(query)` |
| 6. 生成 | 检索结果 + 原始问题 → LLM → 回答 | 标准 LCEL chain |

## 代码骨架

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

# 1. 分割
splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=20)
chunks = splitter.create_documents(documents)

# 2. 向量化 + 存储（一步完成）
embedding = HuggingFaceEmbeddings(model_name="shibing624/text2vec-base-chinese")
vectorstore = Chroma.from_documents(chunks, embedding)

# 3. 检索器
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})

# 4. RAG Chain
rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)
```

## 切分关键点

**递归降级**：`separators = ["\n", "。", "，", " ", ""]` 逐级降级——短 chunk 直接通过，只对超长的用下一级分隔符继续切，最后的 `""` 字符级兜底。不是递归函数，是 while 循环。

**chunk_overlap**：后一个 chunk 往前借前一个的末尾 N 字符，保证跨边界的词组至少在一个 chunk 里完整出现。膨胀率 ≈ `overlap / (chunk_size - overlap)`——20% 是经验最佳值（+25% 成本换命中率），50% 边际收益锐减。

**format_docs**：检索返回 `Document` 对象数组，LLM 只认识字符串，所以 `retriever | format_docs` 拼成一段文字再填 prompt。做的事极简单，缺它链路跑不通。

## 上下文放哪：role 机制

LLM 训练时内化了 `system > user` 的优先级。RAG 上下文塞 system 槽，天然权重最高：

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", "只能根据以下资料回答：\n{context}"),      # ← RAG 文档
    MessagesPlaceholder(variable_name="chat_history"),    # ← 历史对话
    ("human", "{question}"),                              # ← 当前问题
])
```

多轮对话的坑（**Lost in the Middle**）：RAG + 历史反复堆积，LLM 只对开头结尾注意力高，中间等于白注入。解法不是开新 session，是结构化分隔 + system 槽优先级指令。

## RAG vs Tool Calling

| 维度 | RAG | Tool Calling |
|------|-----|--------------|
| 解决的问题 | 给 LLM **知识** | 给 LLM **行动能力** |
| LLM 角色 | 阅读理解 + 总结 | 决策（调哪个工具）+ 总结结果 |
| 典型场景 | 客服知识库、文档问答 | 查天气、发邮件、操作数据库 |

不互斥，经常组合：先 RAG 查知识库，再 Tool Calling 执行操作。

## 评测

RAG 问题 **80% 出在检索层**，不是 LLM。诊断分两层：

| 层 | 指标 | 标注需求 |
|------|------|:--:|
| 检索层（搜对了吗） | **Recall@K**（正确答案进 top-K 的比例）、**MRR**（首个正确答案排名） | 人工标注 expect |
| 生成层（答对了吗） | **RAGAS**：Faithfulness（幻觉率）、Answer Relevancy（答非所问） | LLM 当法官，无需标注 |

实战做法（novel_rag）：评测集三种题型——有答案题（考 Recall）、无答案题（考拒答误报）、结构级题（考粒度边界）。**每次系统答错的真实提问都加进评测集，只增不减。改动前后各跑一遍，数字说话。**

## 向量库操作（写入/检索/删除）

**写入**——`ids` 设计决定后续能不能精准删。推荐 `{doc_id}_chunk_{idx}` 格式（novel_rag 实际用 `{书名}#ch{章号}`），带语义，删除靠它。固定 id 重复写入 = upsert 覆盖（幂等）。

**检索**——四种方式按需选：

| 方式 | 何时用 |
|------|--------|
| `similarity_search(q, k)` | 默认 |
| `max_marginal_relevance_search(q, k, fetch_k)` | **生产必备**：从 top-10 挑 3 个最不重复的，否则可能返回同一段话的三个变体 |
| `similarity_search(q, k, filter=...)` | 限定范围（多租户、按类型） |
| `similarity_search_with_relevance_scores(q, k)` | 返回分数，做置信度过滤 |

**删除/更新**——更新 = 删 + 写，向量没有「改一个维度」的操作。`delete(ids=...)` 按身份删、`delete(where={...})` 按条件删。**不能按 ID 精准删除的向量库等于定时炸弹。**

**持久化**——内存模式进程退出即消失，生产必须 `PersistentClient(path=...)` 或 C/S 模式。

**纠错闭环**：metadata 带 `doc_id`/`page` → 用户点踩按 doc_id 聚合 → 人工核验 → 单篇 delete + re-ingest。全量重建只留给一种情况：**换 embedding 模型**（新旧向量不同坐标系，无解，必须全量）。

## Top-K 检索算法

**Top-K 是目标，不是算法。** 底层：小库暴力比对 O(n)；生产全是 **ANN（近似最近邻）**，核心算法 **HNSW** 分层图——上层稀疏边长（高速公路找城市），第 0 层全量（村里挨家挨户），查询贪心逐层下降，O(log n)。trade-off：99.9% 准确换 1000 倍性能，RAG 完全可接受。

**相似度算法**：RAG 几乎 100% 用**余弦**——只看方向不管长度，不被字数差干扰。点积在归一化后与余弦等价。欧氏距离受向量长度干扰，不用。

## 检索进阶（按性价比排序）

| 技术 | 解决什么 | 备注 |
|---|---|---|
| **归一化 embedding** | 模长统一 → L2 排名 ≡ 余弦排名，度量坑消失 | 一行参数，全量重嵌 |
| **换 embedding 模型** | 语义分辨率（bge-m3/bge-large-zh） | 全量重嵌 + 阈值重标定 |
| **Hybrid Search** | 实体精确匹配（向量搜不到「古筝行动」这种专有名词的措辞变体） | 向量管语义 + BM25 管实体，`rank_bm25` 包即可起步 |
| **Multi-Query + RRF** | 措辞 gap：一个问法搜不到，多个问法投票能搜到 | 见下 |
| **Reranker** | 粗排 top-20 → 交叉编码器精排取 top-5 | 检索质量天花板通常在这 |

### Multi-Query + RRF 融合（novel_rag 实测）

![[RAG-MultiQuery-RRF融合图解.mp4]]

三段分工，只有第一段有智能：

| 环节 | 谁决策 | 干什么 |
|---|---|---|
| 改写 | **LLM**（1 次调用） | 「古筝行动」→ 审判日号/纳米丝/夺取信息 等 N 个问法 |
| 排序 | **向量**（cosine） | 每路各自检索，排出名次 1,2,3… |
| 合票 | **算术**（RRF） | `score(doc) = Σ 1/(60 + rank_i)`，K=60 |

⚠️ **合票只用名次、不用分数**——cosine 跨 query 不可比（每路分布不同），名次才是每路内部可比的量。

实测（三体「古筝行动」，正确答案 ch34）：单路排名 >10；四路合票第 1。原理：ch34 在每一路都进前 5，投票顶上去；只在一路靠前的「提到它」的章票数被稀释。RRF 的 `1/(60+rank)` 衰减比线性加权更陡——「多路都前排」明显胜过「单路第 1」，正是融合的本意。

**Multi-Query ≠ agentic**：改写次数固定、流程固定，是 Advanced RAG；LLM 运行时自己决定「还查不查、往哪查」才是 agentic。先做 Multi-Query（便宜、固定），攒了救不回的坏例再上 agent 循环。

## 接地生成（G）—— RAG 的另一半

检索（R）只负责找资料，**防编造靠生成端的指令**，两者正交。2×2 消融（novel_rag 实测，temperature=0）：

| | 有资料 | 无资料 |
|---|---|---|
| **有接地指令** | ✅ 只答资料里的，逐句标来源 | ✅ 明确拒绝：「资料里没有」 |
| **无指令** | ⚠️ 混入预训练知识（答出资料里没有的「科学边界」「ETO」） | ⚠️ 编造（周小满「遇害」，实际是失踪） |

结论：**「不让它编」是指令的功劳，不是检索的；检索只负责提供事实。** 缺一不可。

### 接地 system prompt 的写法（实测有效）

```python
ANSWER_SYSTEM_PROMPT = """你是小说阅读助手。你的任务是**仅根据下面提供的章节摘要**回答读者提问。

铁律（违反任何一条都算失败）：
1. 只能用【资料】里的内容回答。禁止使用你自己对这本书的了解、常识或推测。
   即使你"知道"答案，只要资料里没写，就必须说资料里没有。
2. 资料不足以回答时，明确说"提供的资料里没有相关内容"，并说明资料实际讲了什么。
3. 每句话末尾标注来源章节，格式 [第N章]。
4. 不要输出"根据资料""综上所述"这类客套话，直接给答案。
5. 如果问题的前提和资料矛盾，指出这个矛盾。

回答要简洁，一般 3-6 句话。宁可少说，不可编造。"""
```

要点：**负面清单**比正面鼓励有效；「即使你知道也要说没有」是关键——不写它，预训练知识就会漏进来。

### 三个信号，性质不同，别混在一个字段

| 信号 | 含义 | 性质 |
|---|---|---|
| `refused` | 零召回，根本没调 LLM | **事实**（代码可证） |
| `hedged` | 模型说「资料没覆盖」 | **猜测**（关键词匹配，只扫开头 80 字） |
| `low_confidence` | 相关度低于阈值 | **启发式**（阈值只对本语料+本 embedding 有效） |

实测教训：「第一部的主角是谁」开头说「资料里没有明确说明」但后面给了具体线索——**是有用回答**。混成一个「失败」标记，前端就会给正确答案打红标。**能确定的信号和猜测的信号，永远分开存。**

### 能力边界（实测）

章节摘要索引答不了**全书结构问题**（「主角是谁」）——跨 37 章的综合，没有任何一个 chunk 里写着。这是**索引粒度**问题，prompt 修不了。解法：分层索引（全书摘要 → 分卷摘要 → 章节摘要，先答粗层、不够再下钻）。

---

完整实战：`learn/agent/langgraph/novel_rag/`（`answer.py` 是 G 的 LangGraph 实现，阅读清单见 [[小说RAG — 代码阅读清单]]）

[[LangChain Tool Calling 最小 MVP]]
[[LCEL — LangChain Expression Language]]
