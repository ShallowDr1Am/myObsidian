# AI 助手代码实现总结（S-ops-tool-service）

这份总结只覆盖 AI 助手本身，即 `S-ServicesCmdb/S-ops-tool-service` 这一个服务，
启动类 `com.didi.OpsToolApplication`。所有数字和类名都来自对源码的直接核对。

## 规模与形态

主代码约 950 个 Java 文件（含测试约 1200），其中四个核心包的分布是：

| 包 | 文件数 | 职责 |
|---|---:|---|
| `com.didi.ai` | 573 | 渠道、编排、规划、记忆、知识、交付 |
| `com.didi.cmdbtool` | 218 | 具体业务工具（10 个域） |
| `com.didi.taskgraph` | 63（6363 行） | 图引擎：契约、编译、执行、续跑 |
| `com.didi.toolruntime` | 61 | 工具注册、目录、Provider、门禁 |

它是一个独立的 HTTP 服务：整个模块里 `@DubboReference` 是 **0 处**，
对外一律 HTTP。这在以 Dubbo 为主的 infra 仓库里（全仓 180 个消费方文件）是刻意的隔离。

运行基线是 Java 8 + Spring Boot 2.7.17，这是存量约束，不是选型偏好，
后文「现状与目标」一节会展开。

## 代码分层

从外到内五层，外加一圈横切能力：

```
渠道层      assistantapi / webchat / dc / difychat / cooper
              ↓
应用编排层   UnifiedToolChatService（总调度）
             UnifiedTaskGraphEngine（任务图入口）
              ↓
规划层      planning/tool（33 文件 5730 行）+ skill（12 文件）
              ↓
图引擎层    com.didi.taskgraph（契约 → 编译 → 执行 → 绑定 → 续跑）
              ↓
工具运行时   toolruntime（注册/目录/Provider/校验/门禁/MCP）
             cmdbtool（218 文件，真正取数的业务工具）

横切：llm（模型接入）memory（记忆）knowledge+rag（知识）
      interaction（人机确认）progress（SSE）export queryview
      presentation chatrecord feedbackanalytics debug
```

## 模型接入层（llm 包）

不用任何 AI SDK，走 OpenAI 兼容协议，传输层是 JDK 自带的 `HttpURLConnection`。

`OpenAiCompatibleLlmClient`（149 行）负责差异部分：端点是
`model.getBaseUrl() + "/v1/chat/completions"`，请求头 `Authorization: Bearer <apiKey>`，
请求体是 `model / stream / messages / tools / tool_choice`。
通用部分抽在 `AbstractLlmClient`（389 行）：模板方法模式，子类只实现
端点、请求头、超时、请求体、响应解析五个抽象方法；流式响应逐行解析 SSE 的 `data:` 前缀。

配置与密钥的设计值得单独看：

`LlmPlatformProperties` 用 `@ConfigurationProperties(prefix="dd.llm")` 加 `@RefreshScope`，
由 Nacos 下发 `baseUrl`、Base64 编码的 `key`、有序模型列表和超时，改配置不重启。
`LlmModelCatalog` 把模型列表变成 `LlmModelSnapshot`，**地址和超时绑在每个模型上**，
还带 `toolCalling` 标志——不是所有模型都支持工具调用。

密钥每次调用都重新解析（`LlmCredentialService.resolveForRequest`）：
先查用户个人密钥（AES-GCM 加密存库、Redis 缓存），没有就回落平台默认 key。
来源只有两种：`PERSONAL` 和 `PLATFORM_DEFAULT`。401/403 会被翻译成「密钥失效」，
而不是把原始 HTTP 异常抛给业务。

客户端是**一次调用 new 一个实例**，源码注释写明
`One-invocation OpenAI-compatible client; it holds no global user state`，
模型、密钥、超时全绑在这次请求上，天然没有跨用户污染。

一个现实的兼容细节：`providerCompatibleTools()` 会从工具参数的 JSON Schema 里
删掉 `$schema` 字段，因为部分 OpenAI 兼容实现不认它。

本地另有一条独立链路：`OllamaConfig` 默认 `qwen2.5:7b`，只做 embedding（RAG 用），
与 chat 不共享连接。

## 一次完整请求的链路

以 `POST /smart/opsTool/ai/assistant/v1/messages/stream` 为例
（`/smart/opsTool` 是网关前缀，服务内只有 `/ai/assistant/v1`）：

```
① HTTP 线程
AssistantV1Controller.streamMessage()
  → WebChatStreamApplicationService.streamMessage()   同步阶段，必须快
      ├─ 生成 traceId
      ├─ llmCredentialService.resolveForRequest()     先验凭证
      ├─ llmModelCatalog.requireEnabled(modelId)      模型必须已启用
      ├─ turnAdmissionService.admit()                 PG 事务：建会话 + 原子写两条消息
      ├─ new SseEmitter(120_000)                      开 SSE 通道
      └─ executorService.submit(executeStream)        交给 web-chat-stream 线程

② web-chat-stream 线程
executeStream()
  → WebChatAgentAdapter.ask()                         构建 PipelineContext + ResponseCallback
    → UnifiedToolChatService.process()
        ├─ 维护闸门 / 身份 / 模型偏好 / 注册 LlmRequestContext
        └─ processAccepted()
            ├─ turnIntentResolver.resolve()           本轮意图
            ├─ evidenceExtractor.extract()            输入证据
            ├─ memoryContextBuilder.build()           历史与会话记忆
            ├─ focusService.beginRequest()            会话焦点快照
            ├─ handlePending()                        有待确认交互就先恢复，成功即返回
            ├─ TurnCommand.EXPORT_ONLY                只导出分支
            ├─ UnifiedTaskGraphEngine.execute()       主路径
            │    ├─ CapabilityPlanningService.plan()  模型提交计划
            │    ├─ ToolGraphCompiler.compile*()      编译校验
            │    └─ GenericToolGraphExecutor.execute()
            │         └─ GenericToolStepExecutor → ToolGateway.invoke()
            ├─ DIRECT_ANSWER_REQUIRED                 不调工具，直接回答
            └─ KNOWLEDGE_ATTEMPT                      知识库兜底

③ SSE 推送 PROGRESS → FINAL → DONE，120 秒超时
```

两个顺序是有讲究的。同步阶段**先落库再提交异步任务**，注释写明是为了
「避免未配置凭证的请求留下失败占位消息」——宁可拒在门外，不留脏数据；
而 `submit` 之后 HTTP 线程立刻返回，LLM 再慢也不占 Tomcat 线程。

四道门禁尽量早失败：凭证、模型可用性、编译校验、工具权限，越靠前越便宜。

`handlePending` 在规划**之前**：上一轮若停在「请确认要操作哪台机器」，
这一轮用户只回「确认」，不会重新规划，而是恢复上次计划接着跑。

## 规划层：模型怎么「写计划」

`planning/tool` 是全模块最重的包（33 文件 5730 行），核心是
`CapabilityPlanningService.plan()`，流程大致是：

候选召回（`ToolCandidateRetriever` / `ManifestTextToolCandidateRetriever`）
→ 模型通过 tool calling 提交计划（`ToolPlanSubmissionProtocol` / `SkillInvocationProtocol`）
→ 准入检查（`CapabilityAdmissionResult`）→ 参数证据校验
（`ModelArgumentEvidenceValidator` / `ArgumentEvidenceCheck`）。

模型提交的 `ValidatedToolPlanDraft` 有两个字段：`calls` 和 `dataFlows`。
`ValidatedToolDataFlowDraft` 是 `sourceCallId + sourceOutputPort → targetCallId + targetInputPort`。
也就是说**模型不只选工具，还在提议步骤之间的数据流（边）**。这是整套架构的支点。

能确定性解决的绝不问模型：`ExactCommandPlanResolver`（快捷命令）、
`LiteralInputDeterministicPlanResolver`（字面输入）、`DeterministicToolPlanResolver`
都在模型之前短路。计划来源分两种：`MODEL_PROPOSED` 和 `PLATFORM_GENERATED`，
知识库兜底计划只允许后者，来源非法直接拒绝。

技能（skill）是比工具更高一层的封装：`SkillRegistry` 管理 `SkillDefinition`，
`SourceControlledSkillDefinitionSource` 的注释是
`Reviewed definitions shipped with the application artifact`——
技能定义是**评审过、随制品发布**的，不是运行时随便加的。

## 图引擎（com.didi.taskgraph）

这是自研的编排引擎，概念上与 LangGraph 一一对应，但形态不同。

**契约**。`WorkflowNodeContract` 定义节点：`roleKey`、绑定的 `toolKey`、
角色 `NodeRole`（`TARGET` / `SUPPORT`）、契约版本区间、
`modelWritableInputPointers`（模型允许写哪些输入）、`inputSourceConstraints`（每个输入允许的来源）。
`WorkflowEdgeContract` 定义边：源端口 → 目标端口，加 `purpose / required / onEmpty / onMulti / onNull`。
边是带端口的数据流，分支策略是声明式的，不是写 if 跳转。
契约由 `WorkflowContractRegistry` 管理，`WorkflowContractValidator` 校验，
按 `ActivatedWorkflowRevision` 版本化激活。

**编译**。`ToolGraphCompiler` 把计划编译成 `CompiledToolPlan`
（planId、schemaVersion、toolCatalogVersion、workflowKey、steps、completionPolicy）。
结束条件是 `CompletionPolicy`：`ALL_REQUIRED` 或 `PARTIAL_ALLOWED`。
编译不过就产出 `ToolPlanCompileIssue` 并拒绝执行，返回
「请求参数不符合工具契约，请补充或修改后重试」——**不确定性被挡在执行之前**。

**执行**。`GenericToolGraphExecutor` 按编译好的步骤执行，
`GenericToolStepExecutor` 每一步最终调 `ToolGateway.invoke()`。
步骤间传值由 `ToolResultBindingEngine` 按绑定解析，每个输入的来源被约束为
`InputSource` 四值之一：`CURRENT_TURN`（本轮输入）、`USER_SELECTION`（用户选择）、
`CONVERSATION_FOCUS`（会话焦点）、`UPSTREAM_STEP`（上游步骤），
并有 `InputProvenanceSnapshot` 记录来源，供审计和排障。

**续跑**。`continuation` 包的 `ToolGraphInterruptionSnapshot` /
`ToolGraphInterruptionContinuationCompiler` 把中断现场序列化，
配合 interaction 层实现「停下来等人、然后接着跑」。

与 LangGraph 的根本差异只有一条：**边由谁写**。LangGraph 的边是开发者用代码连的，
图是静态的；这里的边是模型提议的，图是运行时编译出来的，所以必须有编译器。
代价是没有看到运行时改图或循环回溯的机制，这一点比 LangGraph 弱。

## 工具运行时（toolruntime + cmdbtool）

`toolruntime` 七个子包各司其职：

- `registration`：`LocalToolRegistrationBundle` / `LocalToolRegistrationCompiler`，本地工具注册也要过编译
- `catalog`：工具目录，版本化的 `ResolvedToolRevision`
- `provider`：`ToolProvider` / `LocalToolProvider` / `ToolProviderRegistry` / `ProviderHealth`，真正的执行者
- `validation` + `gateway`：`ToolGateway.invoke()` → `invokeGuarded()` →
  `resolveAccess()`（权限）+ Schema 双重门禁，然后才调 Provider；
  注释写明 Provider 内部还会**重复**这些检查——门禁做两遍，宁可冗余
- `governance` + `mcp`：外部 MCP 工具的治理，`HttpMcpBrokerClient` /
  `ExternalMcpDiscoveryClient`，配 `ExternalMcpGovernanceController` 管理接口

权限侧是 `CmdbPlatformToolAuthorizationPolicy` + `HttpCmdbUserRoleClient`（带缓存），
工具执行前先问 CMDB 的用户角色服务「这个人能不能用这个工具」。

`cmdbtool` 是 218 个文件的业务工具实现，10 个域：
cmdb、domain、ipnetwork、serverdiagnosis、hostcomparison、duty、
normalization、analysis、knowledge、support。
其中 6 个 HTTP 客户端（主机对比、服务器诊断、IP 网络查询、工单类型、
基础设施值班、Kylin 平台值班）调的是 CMDB 其他域服务——
`ToolGateway` 在本进程做门禁，真正取数要跨出去。

## 记忆与知识

`memory` 包 60 个文件，是状态最重的地方：
`RedisConversationTurnStore` 存对话轮次，`MemoryContextBuilder` 组装上下文，
焦点状态（focus）有 Redis 和 JDBC 双仓库，`ConversationSummaryService` 做摘要，
`SemanticRecallService` + `SemanticMemoryIndex` 做语义召回，
`MemoryCompressionPolicy` 决定何时压缩，`TokenEstimator` 估 token 预算。

`knowledge` 的后端有两种实现：`AgentHubKnowledgeBackend`（外部知识平台，
SSE 流式、`AgentHubThinkFilter` 过滤思考内容、并发限流、失败分类）
和 `LocalRagKnowledgeBackend`（本地 RAG）。查询先过
`LlmKnowledgeQueryRewriter` 改写，答案带引用（citation）交付。

`rag` 包负责向量化：`OllamaEmbeddingService` / `DdLlmEmbeddingService` 两种 embedding，
`ChunkService` / `DocIndexService` / `DocVectorService` 做切块、索引、向量。
向量库是 **PostgreSQL**（`VectorDataSourceConfig` 读 `spring.datasource.vector.*`，
默认驱动 `org.postgresql.Driver`），与业务库分开的数据源。

## 人机交互与状态持久化（interaction）

33 个文件 2350 行，专门做「停下来等人确认、然后接着跑」：
`PendingInteraction`（澄清/确认两类）、`PendingReplyClassifier` 判断用户回复属于哪种、
`PendingInteractionResumeService` 恢复执行、Redis 仓库为主（另有 InMemory 实现）、
`ResumePayloadCodec` 序列化恢复载荷。写入用乐观并发，
冲突抛 `PendingInteractionWriteConflictException`，上层翻译成冲突提示而不是覆盖。

分页和查询状态单独放：`query/continuation` 的分页续跑描述符（带编解码和过期），
`query/execution` 的 `QueryExecutionState` 落 JDBC，会话游标也落 JDBC。
热状态在 Redis，冷状态和审计在数据库，是贯穿全模块的存储分工。

## 交付与可观测

`progress` 是 SSE 事件体系：`PROGRESS`（阶段事件）→ `FINAL` → `DONE`，
`EventPolicy` 控制哪些事件值得推，`SseEmitterEventPublisher` 负责发送并维护运行时状态。

`presentation` 负责把结果装配成渠道能消费的形状：`AssistantMessageBlock` 消息块、
`HostComparisonHtmlRenderer` 主机对比报告、`QueryListDelivery` 列表交付。

`export` 是完整的导出子系统：意图解析 → 策略判定 → 取数 →
Gift 文件存储 → JDBC 审计，每一步都有独立的包。

会话记录写 Melos（`MelosAgentChatRecordClient`），反馈统计读 AgentHub 数据服务
（带请求签名）。调试有 `AiDebugTraceStore` 和 `/debug/traces/{traceId}` 接口，
规划日志过 `PlanningLogSanitizer` 脱敏。还有一个维护闸门
（`ai.maintenance.*`）：白名单用户放行，其余按渠道封禁并返回配置文案。

## 代码层面的关键设计决定

把散在各处的决定收拢成八条：

1. **双阶段线程**：同步准入（落库、开 SSE）+ 异步执行（专用线程池），HTTP 线程不被模型拖住。
2. **四道早失败门禁**：凭证 → 模型 → 编译 → 工具权限，越靠前越便宜。
3. **模型提议边，编译器把关**：LLM 输出是待校验的计划，不是可执行的命令。
4. **客户端一次调用一实例**：无全局用户状态，天然线程安全。
5. **密钥每次解析、加密落库**：个人 key 优先，平台 key 兜底，401/403 翻译成语义错误。
6. **0 Dubbo、全 HTTP 出站**：AI 的依赖是会变的第三方，用 HTTP 隔离。
7. **确定性短路在模型之前**：快捷命令、字面输入、知识库兜底都不浪费模型调用。
8. **Redis 热状态 + JDBC 冷状态**：会话/焦点/交互在 Redis，执行状态/审计/向量在数据库。

## 现状与目标

现状是 Java 8 上的手写实现。模块自己的设计文档
（`docs/history/2026-07-production-design/cmdb-assistant-overall-design.md`）
把这一点说得很清楚：Spring AI 2.x 基于 Boot 4、Boot 4 最低 Java 17、
LangChain4j 最低 JDK 17，所以存量 Java 8 用不了现代 Java AI 框架。

文档对四条路线做了加权评分：A（Java 8 自研）2.2、B（整体升级）2.6、
C（Python/LangGraph 独立服务）4.1、**D（Java 21 + Spring AI 独立服务）4.6**，
最终决策是 D。当前这套代码对应的是文档里「暂时不允许部署 Java 21」的过渡方案：
只做知识问答和少量只读查询、固定流程、不做自由 Agent 循环，
且明确写着「不应成为完整生产架构」，Java 21 服务具备条件后立即替换。

值得注意的是，即便目标方案用了 Spring AI，文档仍写明
「不使用框架自带的无限工具循环作为业务编排器」「复杂工作流仍需业务层设计」——
Spring AI 省掉的是模型/流式/Tool Calling/RAG 这层标准化能力，
taskgraph 和 planning 这层编排无论如何都要自己写。

截至核对时，整个仓库没有任何 pom 引入 spring-ai，代码里 0 处
`org.springframework.ai` 引用：D 方案是决策，尚未在这个仓库落地。

## 建议阅读路线

按依赖方向从薄到厚读：

1. `llm/client` + `llm/gateway` + `llm/credential`——模型怎么连、密钥怎么来（最薄，先建立手感）
2. `assistantapi/AssistantV1Controller` + `webchat/service/WebChatStreamApplicationService`——请求怎么进来、线程怎么切
3. `application/chat/UnifiedToolChatService.processAccepted`——总调度的分支结构
4. `taskgraph/workflow/contract` + `taskgraph/compilation`——节点、边、编译（理解「模型提议边」这个支点）
5. `toolruntime/gateway/ToolGateway`——门禁与真正执行
6. `interaction` + `taskgraph/continuation`——中断与续跑
7. `memory` + `knowledge`——状态与知识（最重，最后读）
