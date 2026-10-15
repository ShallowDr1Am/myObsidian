# browser-use 实践与选型：从 Agent 到纯 CDP 提取

> 记录时间：2026-10-13 · browser-use 0.13.11 · Python 3.12.10 · macOS arm64
>
> 这次实践的**核心结论**：browser-use 的 agent 模式不适合"对话式页面提取"场景，
> 真正好用的是自己写一个 ~300 行的纯 CDP 工具。过程比结论更有价值，踩坑清单在最后一节。

---

## 一、browser-use 是什么

[browser-use/browser-use](https://github.com/browser-use/browser-use)，117k stars，MIT，Python。

一句话：**让 LLM 自己操作浏览器完成自然语言任务**。你给"找到 Show HN 排名第一的帖子"，
它自己开浏览器、看页面、决定点哪里，直到完成。

### 与 Playwright 的定位差别

| | Playwright | browser-use agent |
|---|---|---|
| 你写什么 | 精确选择器 `.nat-tree-pane` | 自然语言任务 |
| 谁决定点哪 | 你，写死在代码里 | LLM，运行时推理 |
| 确定性 | 同输入同输出 | 每次可能不同 |
| 成本 | 免费 | 每步都烧 token |
| 用途 | 回归测试 | 自动化操作、探索未知页面 |

### 一个关键事实：它不依赖 Playwright

```
browser-use 依赖里有 playwright 吗：无
含 cdp 的依赖：cdp-use==1.4.5
session.py:15  from cdp_use import CDPClient
playwright 实际装了吗：否
```

它**直接说 Chrome DevTools Protocol**，不走 Playwright。这个事实后面很重要——
意味着"绕过 browser-use 直接写 CDP"不是降级方案，而是和它同层级的方案。

### 它没有内置可视化界面

官方仓库只有 `examples/ui/` 下三个示例（command_line / gradio / streamlit），
gradio 和 streamlit 都**不在依赖里**，且写死 `ChatOpenAI` 无 `base_url`。
官方 gradio demo 还有个 bug：收了 `model` 参数但第 72 行写死了值，下拉框是摆设。

---

## 二、环境搭建

```bash
uv venv --python 3.12        # ⚠️ 必须 3.12，见下
source .venv/bin/activate
uv pip install browser-use
```

**别用系统 Python 3.14**：`pillow`、`pyobjc` 这类需要预编译 wheel 的包在 3.14 上没有对应版本，
会现场编译然后失败。官方要求 `>=3.11,<4.0`。

macOS 上两个命令**不存在**，写脚本时注意：
- `timeout` → 没有，直接跑或用后台任务
- `setsid` → 没有（Linux 专属），用 `nohup ... &` + `disown` 脱离会话

---

## 三、架构选择：这是本次最重要的认知

同一个需求"提取这个页面的内容"，两种架构成本差两个数量级：

### 架构 A：browser-use agent 模式

```
你的任务 → browser-use Agent → 调 LLM(公司网关) 理解页面、决定动作
                                    ↑ 每步都调，页面内容反复发送
```

**问题**：在对话场景里，**我（Claude）本身就是那个理解内容、回答、接受追问的 LLM**。
再套一层 qwen 去"理解页面"是重复劳动，而且：

- 每步都把页面状态 + 截图重发给网关模型
- 22K 字符的页面，3~5 步下来约 **50K~100K tokens**
- 还可能报 schema 400 重试，再翻倍

### 架构 B：纯 CDP 提取（最终采用）

```
你的任务 → 我(Claude)决定提取什么 → cdp.py 走 CDP 读页面 → 内容回到对话 → 我回答
                                      ↑ 零 LLM 调用，零 token，零外发
```

实测提取 io.xiaojukeji.com 那个 22K 字符的文档页：**LLM token = 0**。
服务日志确认 agent 启动次数没有增加，`cdp.py` 不 import browser_use。

**这才是"playwright cli 但更便捷"的正确形态**：browser-use 当"手"，我当"脑"。

---

## 四、接公司 DCC 网关（中转）

如果确实要用 agent 模式，公司网关可以接。DCC 是本地代理工具，把凭据注入环境变量：

```python
from browser_use.llm.openai.chat import ChatOpenAI

llm = ChatOpenAI(
    model="qwen3.8-max",
    base_url="http://llm-proxy.intra.xiaojukeji.com/v1",   # 末尾必须 /v1
    api_key=os.environ["ANTHROPIC_AUTH_TOKEN"],
    max_completion_tokens=8192,                            # 必须给够，见下
)
```

用 `ChatOpenAI` 而非 `ChatAnthropic`：网关同时兼容两种协议，但 browser-use 的
结构化输出走 OpenAI 的 `response_format`。源码里 `ChatOpenAI` / `ChatAnthropic`
都有 `base_url`、`api_key`、`default_headers`，**无 license 校验**，还有个
`ChatOpenAILike` 类，docstring 明写 "any provider using the OpenAI API schema"。
报错文案里甚至主动提到 proxy：

> If you are using a proxy via `base_url`, ensure it implements the OpenAI
> `/v1/chat/completions` schema and returns `choices` as a non-empty list.

### 模型兼容性（strict JSON schema，实测）

browser-use 靠 `response_format` + `strict: true` 强制模型输出 JSON，网关必须支持：

| 模型 | strict schema |
|---|---|
| `qwen3.8-max` | ⚠️ 小 schema 通过，**复杂 schema 会 400** |
| `deepseek-v4-pro` | ✅ |
| `glm-5.3` | ✅（注意不是 flash 版） |
| `glm-5.3-flash` | ❌ HTTP 400 TokenserviceException |
| `kimi-k3` | ❌ HTTP 400 |

网关共 14 个模型：`kimi-k3 / glm-5 / glm-5.2 / minimax-m2.7 / glm-5.3 /
deepseek-v4-flash / kimi-k2.5 / minimax-m3 / glm-5.3-flash / glm-5.1 /
deepseek-v4-pro / hy4-preview / qwen3.8-max / kimi-k2.7-code`

**这里有个我犯过的判断错误**，值得记：我用 `{city, temp}` 两字段的小 schema 测通了
qwen3.8-max 就下了"✅ 跑通"的结论。但 browser-use 真实的 action schema 是**深度嵌套**的
（动作数组、多种动作类型），qwen3.8-max 生成时会产出残缺 JSON → 400：

```
<400> InternalError.Algo.InvalidParameter: Model output became abnormal while
generating a JSON response for response_format. The generation was aborted
because the partial output may be incomplete or invalid JSON.
```

**教训：用简化 fixture 验证通过 ≠ 真实场景能用。**

不兼容时有官方留的逃生开关（源码注释写 "for compatibility with some providers"）：

```python
dont_force_structured_output=True,
remove_min_items_from_schema=True,
remove_defaults_from_schema=True,
```

### max_tokens 必须给够

网关模型带 thinking。`max_tokens=32` 时实测：

```
content 长度: 0          ← 正文全空
reasoning_content: 781   ← 全被思考吃掉了
finish_reason: length
```

给 4096+ 才有正文。

---

## 五、安全：browser-use 的四个 phone-home 通道

装完必须处理。逐个源码核实过：

| 开关 | 目标 | 发送内容 | 默认 |
|---|---|---|---|
| `ANONYMIZED_TELEMETRY` | `eu.i.posthog.com` | **task 全文、urls_visited、action_history、judge_reasoning** | **true** ⚠️ |
| `BROWSER_USE_CLOUD_SYNC` | `api.browser-use.com` | 会话同步 | 跟随 telemetry |
| `BROWSER_USE_VERSION_CHECK` | `pypi.org` | 仅查版本号，无用户数据 | **true** |
| `BROWSER_USE_DISABLE_EXTENSIONS` | `clients2.google.com` | 下载扩展 | 默认下载 |

遥测那条最危险，`telemetry/views.py` 里 `AgentTelemetryEvent` 明确带：

```python
task: str
urls_visited: Sequence[str | None]
action_history: Sequence[list[dict] | None]
judge_reasoning: str | None
```

**"你让 agent 干什么、上了哪些网站"全部上报。**

关闭方式（注意扩展那个是**反向逻辑**，实测确认）：

```bash
ANONYMIZED_TELEMETRY=False          # → posthog_client = None，capture() 直接 return
BROWSER_USE_CLOUD_SYNC=False
BROWSER_USE_VERSION_CHECK=False
BROWSER_USE_DISABLE_EXTENSIONS=1    # ⚠️ =1 才是关闭；=0/=false 反而是开启
```

`BROWSER_USE_DISABLE_EXTENSIONS` 的源码逻辑是反的：

```python
env_val = os.getenv('BROWSER_USE_DISABLE_EXTENSIONS')
if env_val is not None:
    return env_val.lower() in ('0','false','no','off','')   # 这些值 → True(启用扩展)
return True                                                  # 未设置 → 也启用
```

实测映射：`=1/true/yes` → 扩展关闭；`=0/false/空字符串/未设置` → 扩展启用。

默认下载三个扩展（源码 1030-1046 行，另有两个被注释掉）：
`uBlock Origin Lite`、`I still don't care about cookies`、`Force Background Tab`。
公司网络下这个下载会 `[Errno 60] Operation timed out` **卡死整个 agent 启动**。

代码里用 `os.environ.setdefault` 固化最稳（放在 `load_dotenv()` 之后、
`import browser_use` 之前），不依赖 `.env` 有没有写对。

### LLM 那条链路无法关闭

`use_vision=True` 时每步发送：页面截图 + 所有可交互元素 DOM + task + memory。
这是 agent 工作的必要前提，关不掉。走公司网关时链路是：

```
内网页面截图 → llm-proxy.intra.xiaojukeji.com → service-aliyun-qwen3.8-max
```

错误信息里露出的 `provider service-aliyun-qwen3.8-max` 说明**网关会路由到阿里云**。
所以"内网网关 = 数据不出境"这个假设不成立，要单独确认网关留存策略。

`use_vision=False` 能显著减少外发（只发 DOM 文本，不发截图）。

---

## 六、SSO 登录态：cookie 提取

### 三种携带方式

| 方式 | 做法 | 评价 |
|---|---|---|
| A `storage_state` | 传 dict / JSON 路径 | ✅ 精确可控，推荐 |
| B `user_data_dir` | 指向日常 Chrome profile | ❌ 危险：agent 能摸到你**所有**站点登录态 |
| C `cdp_url` | attach 到手动开好的 Chrome | ✅ 最可控，能实时看着 |

`storage_state` 类型是 `str | Path | dict | None`，三种都能给，Playwright 格式：

```python
BrowserProfile(storage_state={
    "cookies": [{"name":"session_id","value":"...","domain":"example.com",
                 "path":"/","expires":-1,"httpOnly":True,"secure":True,"sameSite":"Lax"}],
    "origins": [],   # localStorage
})
```

### 独立 profile + CDP 提取（实际采用的方案）

关键设计：**用全新独立 profile，不要用日常 Chrome**。因为
`export_storage_state()` 会解密导出**所有域名**的 cookie（源码注释原话
"bypassing keychain encryption"），用日常 Chrome 等于把所有站点凭据导出成一个明文文件。

```bash
# 1. 起独立 profile 的 Chrome（人工完成 SSO）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/bu-sso-profile \
  --no-first-run "https://目标URL"

# 2. 提取（纯本地，不联网）
python extract_auth.py --domain xiaojukeji.com --out ./auth.json
```

### 两个实测发现

**① 必须用 `Storage.getCookies`，不能用 `Network.getAllCookies`**

浏览器级 WS 端点上，后者是 page 级命令，会报：

```
{"code": -32601, "message": "'Network.getAllCookies' wasn't found"}
```

（browser-use 源码 `export_storage_state` 用的也是 `Storage.getCookies`）

**② cookie 的 domain 前导点决定能否跨子域**

提取结果 12 条，但对目标域真正有效的只有 4 条：

```
.xiaojukeji.com     × 4   ← 前导点 = 子域共享，freight-pilot.intra.* 能收到 ✅
me.xiaojukeji.com   × 8   ← host-only，只属 SSO 登录中心，带不过去 ❌
```

有效的那 4 条正是登录票据：`pilot_un`、`pilot_un.sig`、
`pilot_ticket_2103734_online`、`pilot_ticket_2103734_online.sig`

**导出的 auth.json 是明文密码级文件**：chmod 600 + 进 `.gitignore`（`auth*.json`）。

---

## 七、最终工具：cdp.py

~330 行，纯标准库 + websockets，不 import browser_use。

```bash
cd ~/Desktop/learn/bu-lab
.venv/bin/python cdp.py tabs                    # 第一步永远先探活
.venv/bin/python cdp.py --tab 1 text --max 3000 # 提取正文
.venv/bin/python cdp.py --tab 1 js "任意JS"      # 执行 JS
.venv/bin/python cdp.py --tab 1 click "text=查看详情"
.venv/bin/python cdp.py --tab 1 realclick "text=确定"   # 弹窗/框架组件用这个
.venv/bin/python cdp.py --tab 1 shot            # 截图存本地
```

### 关键实现细节

**长文档标准流程**（避免一次性灌进对话）：

```bash
.venv/bin/python cdp.py --tab 0 text --max 200000 > /tmp/page.txt
grep -n "目标章节" /tmp/page.txt      # 定位行号
sed -n '645,780p' /tmp/page.txt       # 精读片段
```

**开新标签必须用 `Target.createTarget`**，`window.open` 会被弹窗拦截
（非用户手势），实测返回 `blocked`。

**点击必须过滤可见性**，否则会点到隐藏元素：

```js
const e = els.find(x => {
  const r = x.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && text.includes(txt);   // ← 宽高 > 0 是关键
});
```

不过滤时我实测踩到：匹配到一个 rect 全 0 的隐藏元素，坐标算成 `(0,0)`，
真实点击就点到了**页面左上角**，有误触风险。

**`click` vs `realclick`**：
- `click` = JS `.click()`，快，对普通元素够用
- `realclick` = CDP `Input.dispatchMouseEvent`，走浏览器输入栈，
  能触发 React/Vue/自定义组件的事件处理器

**iframe 内容要显式钻进去**：

```js
const f = [...document.querySelectorAll('iframe')].find(x => x.src.includes('real-resources'));
const d = f.contentDocument;   // 同源才可达
```

主文档直接 `querySelector` 是查不到 iframe 里的东西的。

---

## 八、踩坑清单（本次最有价值的部分）

### browser-use 侧

| 坑 | 现象 | 解法 |
|---|---|---|
| 默认下载扩展 | `[Errno 60] Operation timed out`，agent 卡死启动不了 | `enable_default_extensions=False` |
| max_tokens 太小 | `content` 为空，全在 `reasoning_content`，`finish_reason=length` | 给 4096+ |
| 模型不支持 strict schema | HTTP 400 TokenserviceException | 换模型或开 `dont_force_structured_output` |
| 复杂 schema vs 简单 schema | 小 fixture 通过，真实 agent 400 | 用真实 schema 验证 |
| `Agent` 无 headless 参数 | 传了报错 | 走 `BrowserProfile(headless=...)` |
| 任务结束浏览器被关 | follow-up 要重新登录 | `keep_alive=True`（但会变成孤儿进程） |
| URL 被中文污染 | 任务里"打开 https://x.com，读取…"生成畸形地址 `x.xn--com,...` | URL 后加空格或句号隔开 |
| 遥测默认开 | task/url/action 上报 posthog | `ANONYMIZED_TELEMETRY=False` |
| `use_judge` 默认 True | 每次任务结束多调一次 LLM | 环境变量关或参数传 False |

### Gradio UI 侧

| 坑 | 现象 | 解法 |
|---|---|---|
| handler 写成 sync | worker 线程无事件循环，`get_event_loop()` 抛 RuntimeError，状态卡"启动中"、步数永远 0 | 改 `async def` + `get_running_loop()` |
| gradio 6.x API 变更 | `show_copy_button` 不存在 | 改 `buttons=["copy"]` |
| `outputs=None` 但函数有返回值 | `returned too many output values` 警告，校验提示被丢弃 | 返回值交给状态轮询，或配 outputs |
| 后台任务被 SIGTERM 带走 | exit 143/144，且留下孤儿 Chrome | `nohup ... & disown`，确认 `PPID=1` |

gradio 源码 `blocks.py:1960` 的分派逻辑是根因：

```python
if inspect.iscoroutinefunction(fn):
    prediction = await fn(...)                        # async → 主循环，有 loop
else:
    prediction = await anyio.to_thread.run_sync(...)  # sync → worker 线程，无 loop
```

### CDP 自动化测试侧

| 坑 | 现象 | 解法 |
|---|---|---|
| **后台标签不渲染** | IntersectionObserver / rAF 一次都不 fire | 每次操作前 `Page.bringToFront` |
| monkey-patch 自我递归 | 函数被调 17730 次，刷屏 260KB | 别劫持，用干净页面 + 只读状态 |
| 容器滚不到"完全不可见" | `threshold:0` 只要有 1px 可见就算 intersecting | 确认卡片 bottom 也 < 0 |
| WS 长连接滚轮超时 | 连接被断 | 每次操作用独立短连接 |
| `scrollTop` 改了没生效 | SPA/容器结构导致滚动被重置 | 改用 `scrollIntoView` + 校验 rect |

**其中"后台标签不渲染"最值得记**：它让我误判了两次"代码有 bug"，
实际是 CDP 标签在非前台时浏览器节流不给渲染帧，依赖渲染帧的 API 全都不动。

### macOS 环境

| 坑 | 解法 |
|---|---|
| `timeout` 命令不存在 | 直接跑，或后台任务 |
| `setsid` 不存在（Linux 专属） | `nohup ... & disown` |
| `grep -c` 把 grep 自身算进去 | 加 `grep -v grep` |

---

## 九、Agent 使用手册

写好了在 `~/Desktop/learn/bu-lab/AGENT_PROMPT.md`，任何有 Bash 权限的 agent 都能照着用。
设计原则：**给 agent 的 prompt ≠ 给人的文档**——命令要精确、坑要前置、要有验证步骤，
因为 agent 每次试错都烧对话轮次。

里面每条规则都对应一个真实踩过的坑（timeout / Target.createTarget / 索引会变 /
rect 可见性 / 转义地狱 / 安全红线）。

---

## 十、选型结论

### 什么时候用 browser-use agent

- 无人值守自主完成任务（不需要人在对话里追问）
- 目标页面结构未知、需要 LLM 探索
- 一次性脚本，不在乎 token 成本

### 什么时候用纯 CDP

- **对话式提取**（本次场景）：我就是那个 LLM，不需要再套一层
- 需要精确、可重复、零成本
- 数据敏感，不想截图外发到网关

### 什么时候用 Playwright

- 回归测试、确定性断言
- 要进 CI

**一句话**：browser-use 的价值在"自主决策"，不在"操作浏览器"。
如果决策者已经在场（对话里的 LLM），那你要的只是操作层 —— 直接写 CDP 更轻更快更可控。

---

## 附：交付物清单

```
~/Desktop/learn/bu-lab/
├── cdp.py              332 行  ★ 核心工具，纯 CDP 提取
├── extract_auth.py      98 行  SSO cookie 导出（Storage.getCookies）
├── AGENT_PROMPT.md     140 行  ★ 给其他 agent 的使用手册
├── README.md            94 行  环境说明 + DCC 接入
├── run.py              157 行  browser-use agent 命令行入口
├── ui/app.py           352 行  Gradio UI（停止按钮 + 状态持久 + 单任务锁）
├── ui/gradio_demo.py   111 行  官方原版，留作对照
├── auth.json           600 权限，明文 cookie，已 gitignore
├── .env / .env.example         四个 phone-home 开关已关
└── .venv               491 MB
```

`~/Desktop/learn/popover-anchor-demo.html` — 浮窗锚定三策略样板间（衍生产物）
`~/Desktop/learn/bu-lab/popup-scroll-test.html` — absolute 挂载点滚动对照实验
