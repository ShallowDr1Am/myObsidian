# RAG — 检索增强生成

## 一句话

**RAG = 先查资料，再回答问题。** 解决 LLM 两大硬伤：知识截止日期 + 幻觉。

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
# 本地模型，不需要 API key，首次运行自动下载
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

answer = rag_chain.invoke("什么是 RAG？")
```

## 本质

**RAG = 搜索工程，不是 LLM 原生能力。** LLM 不知道自己"用了 RAG"，它只是收到了一段更长的 prompt，里面有"上下文"和"问题"。整个链路里只有检索是 RAG 特有的，后面的 prompt 拼接和 LLM 调用跟普通对话没区别。

```
检索结果 = 向量数据库.search(用户问题)     ← 纯工程，跟 LLM 无关
prompt = f"上下文：{检索结果}\n{问题}"     ← 字符串拼接
回答 = LLM.invoke(prompt)                  ← LLM 无感
```

### RAG 上下文优先级 — 利用 Chat API 的 role 机制

Chat API 不是纯文本，而是带 role 标签的**结构化消息数组**：

```python
[
    {"role": "system", "content": "你是客服"},
    {"role": "user",   "content": "北京天气？"},
]
```

LLM 训练阶段就内化了 `system > user` 的优先级。所以 RAG 上下文放哪？**塞进 system prompt**，LLM 天然会更重视：

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", "只能根据以下资料回答：\n{context}"),  # ← RAG 查出来的文档
    MessagesPlaceholder(variable_name="chat_history"),   # ← 历史聊天
    ("human", "{question}"),                            # ← 当前问题
])
```

三个槽位，天然分层：
- `system` — RAG 上下文，权重最高
- `MessagesPlaceholder` — 历史对话，一般权重
- `human` — 当前问题，一般权重

无需 JSON 标记或其他 hack，API 原生的 role 机制就是最干净的优先级方案。

### 多轮对话下的 RAG 干扰（Lost in the Middle）

每轮都重新注入 RAG + 聊天历史不断堆积，LLM 面对的噪声指数级增长：

```
第1轮：年假怎么算？   → RAG 注入《员工手册》→ 回答
第2轮：婚假呢？       → 又注入《员工手册》+ 第1轮的历史
第3轮：前面说的再说一遍？→ 上下文已成粥
```

可怕的是 Lost in the Middle——LLM 对开头和结尾注意力高，中间部分容易被忽略。如果 RAG 内容不幸落在中间，等于白注入。

**解法不是开新 session，而是结构化分隔 + 优先级指令**。RAG 上下文用分隔符标记，放 system 槽，明确告诉 LLM"这是唯一依据，跟聊天记录区分开"。

## 关键概念

### RecursiveCharacterTextSplitter 原理与参数

#### 切分逻辑：逐级降级

不是一次性切完，而是递归降级——对每个超长的 chunk 用下一级分隔符继续切：

```
separators = ["\n", "。", "，", " ", ""]
              ↑     ↑     ↑     ↑    ↑
            段落级  句子级  短语级  词级  字符级（兜底硬切）

执行过程：
1. 用 "\n" 切 → 每个子段 ≤ chunk_size？→ 通过 ✓
2. 还超长的子段 → 用 "。" 切 → 通过 ✓
3. 还超长 → 用 "，" 切 → 通过 ✓
4. ...
5. 最后的 ""（字符级）→ 硬切，100% 能切完
```

**不是预先生成所有版本再挑，而是 while 循环——短 chunk 直接通过，只对超长的递归降级。** 所以叫 "Recursive"，不是递归函数的意思。

#### chunk_overlap：相邻 chunk 回借文字

切片完成后，后一个 chunk 往前借前一个 chunk 末尾的 N 个字符，塞到自己开头：

```
chunk_size=10, overlap=3
原文："今年假5天带薪年假试用期不享受"

切完（无 overlap）：
  Chunk 0: "今年假5天带薪"
  Chunk 1: "年假试用期不享"
  Chunk 2: "受"

加上 overlap=3 后：
  Chunk 0: "今年假5天带薪"
  Chunk 1: "带薪年假试用期"    ← 开头多了 Chunk 0 末尾的 "带薪"
  Chunk 2: "不享受"           ← 开头多了 Chunk 1 末尾的 "不享"
```

为什么需要：如果"5 天"和"年假"刚好被切到两个 chunk 里，检索"年假多少天"时没有单个 chunk 同时包含两个关键词，命中率受损。overlap 让边界处的文字被相邻 chunk 共享，保证关键词组合至少在一个 chunk 里完整出现。

#### overlap 的膨胀代价

不是越大越好。数据会膨胀：

```
1000 字符文档：
  无 overlap → 10 个 chunk
  overlap=20%（chunk_size=100, overlap=20）→ ~13 个 chunk（+25%）
  overlap=50%（overlap=50）→ ~20 个 chunk（+100%）

膨胀率 ≈ overlap / (chunk_size - overlap)
```

| overlap | chunk 增长 | embedding 成本增长 | 检索改善 |
|---------|:--:|:--:|------|
| 0% | 基准 | 基准 | 边界词易丢失 |
| 20% | +25% | +25% | **性价比最高** |
| 50% | +100% | +100% | 边际收益锐减 |

20% 是经验最佳值——花 25% 额外成本换检索命中率，值这个价。

#### format_docs：把检索结果拼成 prompt

向量检索返回的是 Document 对象数组，不能直接塞进 prompt。需要先拼成字符串：

```python
def format_docs(docs):
    return "\n\n".join(d.page_content for d in docs)

# 检索返回 [Document("RAG 全称..."), Document("LangChain 是...")]
# format_docs 后 → "RAG 全称...\n\nLangChain 是..."
```

在 LCEL 链中的位置：

```python
{"context": retriever | format_docs, "question": RunnablePassthrough()}
#           ^^^^^^^^   ^^^^^^^^^^^
#           搜 top-K    拼成一段文字 → 填入 {context}
```

做的事极简单，但 RAG chain 缺它跑不通——LLM 不认识 `Document` 对象，只认识字符串。

### Embedding 模型对比

| 模型 | 是否本地 | 适用场景 |
|------|----------|----------|
| `HuggingFaceEmbeddings` | ✅ 本地 | 开发/原型，无需 API key，demo 在用 |
| `OpenAIEmbeddings` | ❌ 需 API | 生产环境，效果好 |

### 向量数据库对比

| 数据库 | 是否本地 | 适用场景 |
|--------|----------|----------|
| **ChromaDB** | ✅ 本地 | 开发、原型、小规模 |
| FAISS | ✅ 本地 | 高性能、大规模、纯向量 |
| Redis Stack | ❌ C/S | 生产环境、需要持久化 |
| Pinecone | ❌ 云服务 | 免运维、大规模生产 |

### 为什么不能直接搜关键词

"苹果很好吃"和"Apple 发布了 iPhone"——关键词搜索找不到交集，但向量空间里"苹果"和"Apple"距离很近。Embedding 理解的是**语义**，不是字面。

## RAG vs Tool Calling

| 维度 | RAG | Tool Calling |
|------|-----|--------------|
| 解决的问题 | 给 LLM **知识** | 给 LLM **行动能力** |
| 数据来源 | 文档、数据库、网页 | API、函数、外部服务 |
| LLM 角色 | 阅读理解 + 总结 | 决策（调哪个工具）+ 总结结果 |
| 典型场景 | 客服知识库、文档问答 | 查天气、发邮件、操作数据库 |

两者不互斥，实际应用经常组合：先 RAG 查知识库，再 Tool Calling 执行操作。

## 准确率评估与迭代

RAG 问题诊断分两层，混乱通常不在 LLM 而在检索。

### 检索层指标（搜对了吗）

| 指标 | 含义 | 依赖人工标注？ |
|------|------|:--:|
| **Recall@K** | 正确答案在 top-K 里的比例。10 个问题 8 个命中 → 80% | ✅ 需要 |
| **Precision@K** | top-K 里有多少是真正相关的 | ✅ 需要 |
| **MRR** | 第一条正确答案排在第几位。排第 1 得 1 分，排第 5 得 0.2 分 | ✅ 需要 |

传统搜索指标，需要人工标注"哪个问题应该匹配哪篇文档"，没有标注就算不了。

### 生成层指标（答对了吗）— RAGAS 框架

不看检索，只看 LLM 最终输出。三个维度可以用 **LLM 评估 LLM**，无需人工标注：

| 指标 | 问什么 | 测什么 |
|------|--------|--------|
| **Faithfulness** | 回答里有没有编造上下文之外的东西？ | 幻觉率 |
| **Answer Relevancy** | 回答有没有真正回答问题？ | 答非所问率 |
| **Context Precision** | 给 LLM 的 chunk，真的都用上了吗？ | 噪声比例 |

原理：用另一个 LLM 当法官，判断"回答是否严格基于上下文、有无虚构"。实验证明此法跟人类判断准确率相近。

### 实践三步走

```
第 1 层：人工抽检 50-100 条 → 看检索失败/瞎编的分布
第 2 层：调 chunk_size、embedding、加 reranker → 回测指标
第 3 层：上线后用用户反馈（点赞/踩）补充标注集 → 持续迭代
```

**结论**：RAG 准确率问题 **80% 出在检索层**，不是 LLM。评估重点在 Recall 和 Context Precision，盯着最终回答看是舍本逐末。

## 生产级架构

demo 里 8 句话直接写代码里，生产环境完全不同——**是两套系统叠加**。

### 离线管线 + 在线服务

```
┌────────── 离线管线（定时/事件触发）──────────┐
│ 文档源 → 解析(PDF/Word/HTML) → 切分 →        │
│ Embedding → 写入向量数据库(Milvus/Qdrant)     │
│ 变更检测：只处理增删改的文档，不全量重建        │
└──────────────────────────────────────────────┘
                    │
┌────────── 在线服务（实时，低延迟）────────────┐
│ 用户提问 → Query Embedding → 向量检索          │
│ → Reranker 精排 → LLM 生成 → 返回             │
└──────────────────────────────────────────────┘
```

### 多语言分工（不是一个项目一种语言）

| 层 | 主流选择 | 原因 |
|----|----------|------|
| **在线 API** | Node / Go / Java | 高并发低延迟，Python 扛不住 |
| **Embedding + 文档解析** | **Python** | ML 生态全在 Python，`unstructured`、`pypdf` 等离线批处理库只有 Python |
| **LLM 调用** | Node / Python | 取决于主服务语言，gRPC 通信 |
| **任务调度** | Airflow (Python) / Temporal (多语言) | DAG 管道编排 |

生产姿态：Node 扛在线，Python 扛 data/ML，各自干最擅长的活，gRPC/HTTP 通信。

## 纠错闭环

全量重建成本极高，所以必须是**精准打击单文档**。

### 存入时打 metadata 标签

```python
Chroma.from_documents(
    documents=chunks,
    embedding=embedding,
    metadatas=[
        {"doc_id": "hr_v3", "page": 12, "chunk_idx": i, "source": "员工手册.pdf"}
        for i in range(len(chunks))
    ]
)
```

向量库存的不是纯向量，是**向量 + metadata + 原始文本**。用户反馈一条错误，那次检索返回的 chunk 本身就带着 `doc_id` + `page`，直接定位到原文第几页。

### 三种纠错场景

| 场景 | 操作 | 成本 |
|------|------|------|
| 原文改了 | `collection.delete(where={"doc_id": "xxx"})` → 只对这篇重做 embedding | 极低 |
| 切分策略不对（chunk_size 太小） | 只重切受影响的文档类型 | 中等 |
| Embedding 模型升级 | 新旧向量不在同一空间，**必须全量** | 高，无解 |

### 反馈闭环

```
用户点踩 → 记录{问题, chunk_ids, LLM回答}
           → 按 doc_id 聚合 → 发现《员工手册》第3章被踩 15 次
           → 人工核验原文 → 确实写错了 → 改文档 → delete 旧 chunk → 单篇 re-ingest
```

**不能按 ID 精准删除的向量库，等于定时炸弹。**

## 向量库操作（写入/检索/删除 — 全部关键）

日常操作 5 个维度，按优先级排。

### 写入 — ids 设计决定了后续能不能精准删

```python
# demo 写法
Chroma.from_documents(chunks, embedding)

# 生产写法 — 显式控制 id 和 metadata
collection.add(
    documents=["文本1", "文本2"],
    metadatas=[{"doc_id": "a", "page": 1}, {"doc_id": "a", "page": 2}],
    ids=["a_chunk_0", "a_chunk_1"],  # 自定义 ID，别用 uuid
)
```

`ids` 格式推荐 `{doc_id}_chunk_{idx}`——带语义，后面 `delete` 靠它。

### 检索 — 不止相似度一种

| 方式 | 做什么 | 何时用 |
|------|--------|--------|
| `similarity_search(q, k=3)` | 找 top-K 最相似的 | 默认，大多数场景 |
| `max_marginal_relevance_search(q, k=3, fetch_k=10)` | 从 top-10 里挑 3 个**最不重复**的 | **生产必备**。否则 k=3 可能返回同一段话的三个变体，LLM 拿到等于只有 1 条 |
| `similarity_search(q, k=3, filter={...})` | 限定范围里搜 | 多租户隔离、按文档类型筛选 |
| `similarity_search_with_relevance_scores(q, k=3)` | 返回每个结果的相似度分数 | 置信度过滤（分数 < 0.7 的扔掉） |

### 删除/更新 — 更新 = 删 + 写

```python
# 按 ID 删
collection.delete(ids=["a_chunk_0", "a_chunk_1"])

# 按条件删（依赖 metadata）
collection.delete(where={"doc_id": "hr_v3"})

# 更新 = 删 + 写。向量没有"改一个维度"这种操作
collection.delete(where={"doc_id": "hr_v3"})
collection.add(documents=新chunks, ids=新ids, metadatas=...)
```

### 持久化 — demo 可能已经不是跑完就没了

```python
# 内存模式 — 进程退出数据消失
Chroma.from_documents(chunks, embedding)

# 磁盘模式 — 指定目录，重启还在
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("my_docs")

# C/S 模式 — 类比 Redis
client = chromadb.HttpClient(host="localhost", port=8000)
```

`rag_demo.py` 第 50 行没指定 `persist_directory`，是内存模式。生产必须用 PersistentClient 或 C/S 模式。

### Collection 管理

```python
client.list_collections()              # 列出所有
client.get_collection("rag_demo")      # 按名获取
collection.count()                     # 向量条数
client.delete_collection("rag_demo")   # 整库删除
```

### 学习优先级

| 优先级 | 内容 | 理由 |
|--------|------|------|
| ⭐⭐⭐ | 写入 + `ids` 设计 | 写错后续全废 |
| ⭐⭐⭐ | 删除 (`delete` by id/where) | 纠错闭环基础 |
| ⭐⭐ | MMR 检索 | 生产必备，demo 容易忽略 |
| ⭐⭐ | 持久化 | demo ↔ 生产的桥梁 |
| ⭐ | `filter`/`where` | 多租户、限定范围搜

## Top-K 检索算法

**Top-K 是目标（返回最相关的 K 条），不是具体算法。** 底层怎么找到这 K 条才是关键。

### 暴力对比 → ANN 近似检索

```
暴力：embedding(q) 和数据库每一行算余弦相似度 → 排序 → 取前 K 条
复杂度 O(n)，1000 条无感，1 亿条直接卡死
```

生产环境全是 **ANN（近似最近邻）**，核心算法 **HNSW**——分层图：

```
第 2 层：稀疏，快速跳过大量无关区域（高速公路上找城市）
  ↓
第 1 层：中等密度，缩小范围（省道上找镇）
  ↓
第 0 层：全连接，精确比较（村子里挨家挨户）
```

每次检索只遍历少量节点，O(log n)，1 亿和 1000 体验一样。**trade-off：允许 99.9% 准确率换 1000 倍性能。** 少召回一条相似 chunk 对 RAG 回答几乎无影响，完全可接受。

### 三种相似度算法

| 算法 | 直观理解 | 公式 | RAG 适用？ |
|------|----------|------|:--:|
| **余弦相似度** | 关注**方向**是否一致，不受向量长度影响 | cos(θ) = (A·B) / (‖A‖×‖B‖) | ✅ 最常用 |
| **点积** | 向量归一化后等价于余弦，省去除法运算 | A·B = Σ(Ai × Bi) | ✅ 归一化后与余弦等价 |
| **欧氏距离** | 关注**绝对距离**远近 | d = √Σ(Ai - Bi)² | ❌ 长度干扰大 |

RAG 场景几乎 100% 用余弦相似度。文本 embedding 后，两段话意思相近但字数差 5 倍——余弦只看方向不管长度，欧氏距离会被字数差严重干扰。 |

### Hybrid Search（向量 + 关键词）

```
用户提问 → 同时走两条路：
            ├→ 向量检索：语义相似（"年假"≈"带薪休假"）→ 30 条
            └→ ES/BM25：精确命中（合同号、产品名、ID）→ 10 条
         合并去重 → Reranker 精排 → top-5 → LLM
```

向量管语义，ES/BM25 管实体精确匹配，互补不互斥。

### ES（Elasticsearch）要不要学

| 情况 | 建议 |
|------|------|
| 刚学完基础 RAG | **不需要。** 向量检索够用 |
| 准备做企业搜索/知识库 | **值得学。** 倒排索引/分词/BM25 是搜索工程必修课 |
| 后续搞 Hybrid Search | **到时候再补，1-2 天上手** |

ES 8.x 已内置向量搜索，但定位仍然是**关键词搜索引擎**，不是原生向量库。两者互补，不是替代关系。

## 进阶方向

- **Parent Document Retriever** — 检索小块、返回大块，解决 chunk 太小丢失上下文的问题
- **Multi-Query** — 把一个问题改写成多个角度，分别检索，合并结果
- **Self-Query** — LLM 先提取查询条件（时间、分类）再检索
- **Reranking** — 粗检索后二次精排，提高准确率
- **Hybrid Search** — 向量搜索 + 关键词搜索，互补不足

[[LangChain Tool Calling 最小 MVP]]
[[LCEL — LangChain Expression Language]]