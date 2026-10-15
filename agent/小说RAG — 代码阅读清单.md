# 小说RAG — 代码阅读清单

> 项目位置：`learn/agent/langgraph/novel_rag/`
> 读法：按数据流顺序读，每站带着「验证问题」去读，读完能自己回答再勾选。
> 遇到看不懂的，直接跑 `python ask.py "…" --sources` 对照事件序列。

## 附：Send 扇出图解（24s 动画）

![[LangGraph-Send扇出图解.mp4]]

对应站 4 的 `dispatcher()` / `OverallState`。项目源码在 `learn/agent/langgraph/send-fanout/`。

---

## 站 0 · 鸟瞰

- [ ] 能不看笔记画出数据流：`data/*.txt` → `chapters/*.json` → `cache/*.json` → `chroma_db` → 答案流
- [ ] 能说出两条设计原则：**文件即接口**（每阶段产物落盘，可单独重跑/断点续跑）、**产出与消费分离**（`stream_build`/`stream_answer` 纯事件生成器，CLI 和网页共用）

## 站 1 · paths.py（130 行，5 分钟）

- [ ] 读全文，重点 `doc_id()`（L48）、`safe_name()`（L30）
- [ ] 验证：`doc_id` 为什么是 `书名#ch3` 这种字符串而不是数字 id？（提示：Chroma 的 id 是全库唯一的，多本书共用一个 collection）

## 站 2 · split_chapters.py（584 行，只读三段）

- [ ] 读 `decode_bytes()`（L82）+ `_decode_score()`（L46）
  - 验证：`decode()` 不抛异常为什么还不够？（提示：latin-1 对任意字节都成功）
- [ ] 读 `split_chapters()`（L349）+ `_make_chapter()`（L422）
  - 验证：超长章节二次切分后，`title` 和 `parent_title` 各存什么？
- [ ] 读 `annotate_volumes()`（L444）+ `title_family()`（L210）
  - 验证：为什么靠「标题家族变化」能推出分卷边界？碎段为什么并入**后**一段而不是前一段？

## 站 3 · answer.py（288 行，全文精读 ⭐ LangGraph 最佳入门）

- [ ] 读 `AnswerState`（L62）→ 三个节点 `retrieve`/`answer`/`no_context` → 图的组装（L206-215）
- [ ] 验证：State / 节点返回值 / 条件边返回值，三者各承担什么？（数据有什么 / 我改了哪几项 / 下一个节点叫什么）
- [ ] 验证：零召回走 `no_context`，为什么说不只是省 12 秒，而是防幻觉的第一道闸？
- [ ] 读 `stream_answer()`（L218）
  - 验证：`stream_mode=["updates","custom"]` 里，为什么 `contexts` 必须在循环里单独存，不能从最后的节点拿？（提示：updates 流给的是**节点返回值**，不是完整 State）
- [ ] 验证：`refused` 和 `hedged` 为什么要拆成两个字段？混成一个会怎样？

## 站 4 · build_index.py（611 行，精读四段 ⭐ Map-Reduce）

- [ ] 读 `OverallState`（L81）：`Annotated[list, operator.add]` 是理解一切的钥匙
  - 验证：144 个并行节点同时写 `summaries`，没有 reducer 会发生什么？
- [ ] 读 `dispatcher()`（L130）+ 图的组装（L145-149）
  - 验证：`Send` 返回的是「N 个任务描述」，数据怎么到达每个并行节点的？
- [ ] 读 `stream_build()`（L274）
  - 验证：并行完成是乱序的（实测 24→41→44→43→48），写库时靠什么对齐？（提示：每条数据自带 index，不靠 list 位置）
- [ ] 读 `search()`（L452）+ `build_filter()`（L423）+ `get_vectorstore()`（L157）
  - 验证：为什么必须显式 `{"hnsw:space": "cosine"}`？为什么空间改参数不生效、必须重建集合？
- [ ] 验证：缓存断点续跑怎么实现的？（`load_cache` 里已有的 index 跳过 LLM）

## 站 5 · web_app.py（504 行，读一个等于读全部）

- [ ] 读 `api_build()`（L159）+ `opt_int()`（L141）
- [ ] 验证：`def events()` 生成器怎么变成 HTTP 流的？（`Response(events(), mimetype="text/event-stream")` + `X-Accel-Buffering: no`）
- [ ] 验证：异常为什么要包成 `{"type":"error"}` 帧，而不是让连接断掉？（提示：前端只能干等到超时）
- [ ] 验证：两处 falsy 陷阱——`if "only" in data`（L185）和 `opt_int(...) or 3`（L327 附近的注释），`or` 默认值对哪些值不安全？
- [ ] 对照看 `api_ask()`（L247）：和 `api_build` 是同一个模式

## 站 6 · index.html（1576 行，只读两处）

- [ ] 读 `readAskSSE()`（L1369）
  - 验证：TCP 一次 `read()` 为什么不保证读到完整 SSE 帧？半帧怎么处理？（`buf` 留残）
  - 验证：`{value, done}` 解构错一个词，bug 表现是什么？（100% CPU 空转，且只在流**正常结束**时触发）
- [ ] 读 `doAsk()`：整体重画 vs append 的取舍；`AbortController` 怎么实现「停止生成」

## 站 7 · 收尾（可选）

- [ ] 跑通 CLI 两条路径并解释输出：`python query.py "古筝行动" --book 三体`（纯检索）vs `python ask.py "古筝行动是什么" --book 三体 --sources`（检索+生成）
- [ ] 对 `query.py`（72 行）和 `migrate_chapters.py`（一次性脚本，看「重新推导而非逆向工程自己输出」的思路）扫一眼即可
- [ ] 能独立说出：如果要做「分层索引」（全书摘要→分卷摘要→章节摘要），会改哪几个文件、图结构怎么变

---

| 文件 | 行数 | 读法 |
|---|---|---|
| paths.py | 130 | 全文 |
| split_chapters.py | 584 | 三段 |
| answer.py | 288 | **全文** |
| build_index.py | 611 | 四段 |
| web_app.py | 504 | 一个 endpoint |
| index.html | 1576 | 两处 JS |
