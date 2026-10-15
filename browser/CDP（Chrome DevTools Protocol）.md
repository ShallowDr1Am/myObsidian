# CDP（Chrome DevTools Protocol）

> 记录时间：2026-10-13 · 实测环境 Chrome 155.0.8059.40 · Protocol 1.3 · macOS arm64
>
> 一句话：**CDP 是 Chrome 暴露出来的远程控制协议。你按 F12 用的 DevTools，本身就是通过它跟内核通信的。**
>
> 关联笔记：[browser-use 实践与选型](./browser-use%20实践与选型.md)

---

## 一、最重要的认知：DevTools 不是浏览器的一部分

```
你按 F12 → DevTools 面板打开
              ↓
    DevTools 前端（一个独立的 Web 应用）  ──CDP──>  Chrome 内核
       Elements / Console / Network / Performance 面板
```

DevTools 的那些 UI 是**用 HTML/CSS/JS 写的一个网页**，它通过 CDP 跟内核对话：

- 你在 Console 敲一行 JS → DevTools 发一条 `Runtime.evaluate`
- 你打开 Network 面板 → DevTools 订阅 `Network.requestWillBeSent` 等事件
- 你在 Elements 里改样式 → DevTools 发 `CSS.setStyleTexts`

这个事实带来两个推论：

1. **CDP 不是给外部程序设计的"黑客接口"**，它是 Chrome 官方内部就在用的协议，稳定、文档完备
2. **凡是你能在 F12 里手工做的事，都能用代码做** —— 这是 CDP 能力的实际上限

---

## 二、协议规模（实测）

从 Chrome 的 `/json/protocol` 端点拉到的权威数据：

```
协议版本: 1.3
域总数:   58
命令总数: 664
事件总数: 231
```

命令数 Top 12：

| 域 | 命令 | 事件 | 管什么 |
|---|---:|---:|---|
| `Page` | 63 | 28 | 页面级：导航、截图、生命周期 |
| `DOM` | 57 | 19 | DOM 树查询与修改 |
| `Emulation` | 49 | 2 | 模拟设备、地理位置、时区、网络状况 |
| `CSS` | 39 | 6 | 样式读取与修改 |
| `Network` | 35 | 43 | 网络请求、cookie、拦截、改 header |
| `Debugger` | 33 | 5 | 断点调试 |
| `Overlay` | 31 | 6 | 页面上的可视化高亮层 |
| `Storage` | 23 | 6 | cookie、localStorage、IndexedDB、缓存 |
| `Runtime` | 23 | 8 | **JS 执行（最常用）** |
| `Browser` | 22 | 2 | 浏览器级：窗口、版本、下载 |
| `Target` | 19 | 7 | 标签页/进程管理 |
| `BluetoothEmulation` | 15 | 3 | 蓝牙模拟 |

自己查完整清单：

```bash
curl -s http://localhost:9222/json/protocol | python3 -m json.tool | less
```

---

## 三、协议长什么样

两层，缺一不可。

### ① HTTP 发现层

端口默认 9222，只有三个常用端点，**只用来问"有什么可以连"**：

| 端点 | 返回 |
|---|---|
| `/json/version` | 浏览器信息 + **浏览器级** WebSocket 地址 |
| `/json` (= `/json/list`) | 所有标签页，每个带**页面级** WebSocket 地址 |
| `/json/protocol` | 完整协议 schema（上面那份数据的来源） |

实测 `/json/version`：

```json
{
  "Browser": "Chrome/155.0.8059.40",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (Macintosh; ...) Chrome/155.0.0.0 Safari/537.36",
  "V8-Version": "15.5.35.20",
  "WebKit-Version": "537.8059.40 (...)",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/7916dfcc-5045-..."
}
```

**注意有两个层级的 WebSocket**：
- `devtools/browser/<uuid>` —— 浏览器级，管标签页（`Target.*`）、全局 cookie（`Storage.getCookies`）
- `devtools/page/<uuid>` —— 页面级，管单个标签页（`Runtime.*`、`Page.*`、`DOM.*`）

**命令发错层级会报错**，这是实测踩过的：

```json
// 往浏览器级端点发 page 级命令
{"code": -32601, "message": "'Network.getAllCookies' wasn't found"}
```

浏览器级要用 `Storage.getCookies`（browser-use 源码 `export_storage_state` 用的也是这个）。

### ② WebSocket 通信层

双向 JSON。一次完整的请求-响应（实测原文）：

```json
→ {"id": 1, "method": "Runtime.evaluate",
   "params": {"expression": "document.getElementById(\"t\").textContent", "returnByValue": true}}

← {"id": 1, "result": {"result": {"type": "string", "value": "CDP Demo"}}}
```

三个字段就是全部：

| 字段 | 作用 |
|---|---|
| `id` | 请求配对。**必须自己维护递增**，因为消息异步乱序回来 |
| `method` | `域.命令`，如 `Page.navigate` |
| `params` | 参数对象，可省略 |

**响应可能是 `result` 也可能是 `error`**，两个都得处理。

### ③ 反向推送：事件

Chrome 会主动推消息给你，**没有 `id`**，靠 `method` 区分：

```json
← {"method": "Network.responseReceived", "params": {"requestId": "...", "response": {...}}}
← {"method": "Page.loadEventFired", "params": {"timestamp": 123456.78}}
```

这就是 Network 面板能实时刷出请求列表的原理。多数事件需要**先订阅**：

```json
→ {"id": 1, "method": "Network.enable"}     // 不 enable 就收不到 Network.* 事件
→ {"id": 2, "method": "Page.enable"}
```

**读消息循环必须过滤 id**，否则会把事件当成某个请求的响应：

```python
while True:
    d = json.loads(await ws.recv())
    if d.get('id') == my_id:      # ← 关键：只取自己那条
        return d
    # 否则是事件推送，忽略或另行处理
```

---

## 四、`Runtime.evaluate`：90% 的需求靠它

最常用的命令，等于"在页面里执行 JS 并拿回结果"。

```json
{"method": "Runtime.evaluate", "params": {
  "expression": "任意 JS 表达式",
  "returnByValue": true,       // ← 不加这个只能拿到对象引用，取不到值
  "awaitPromise": true          // 表达式返回 Promise 时必加
}}
```

**`returnByValue: true` 是最容易漏的参数**。不加的话复杂对象返回的是
`{"type":"object","objectId":"..."}`，你得再用 `Runtime.callFunctionOn` 去解，很麻烦。

**异常不会体现在 `error` 字段里**，而是 `result.exceptionDetails`：

```python
r = await send('Runtime.evaluate', {...})
if 'exceptionDetails' in r['result']:
    raise RuntimeError(r['result']['exceptionDetails'])   # ← 必须单独检查
return r['result']['result'].get('value')
```

**多层 shell 转义会毁掉 JS**。实测把带引号的 JS 通过 Bash 传给 CLI 直接炸出 traceback。
复杂 JS 写进临时 `.py` 文件执行，别在命令行里套三四层引号。

---

## 五、两种"点击"的本质区别

这个区别很能体现 CDP 的层次感：

| | `Runtime.evaluate("el.click()")` | `Input.dispatchMouseEvent` |
|---|---|---|
| 层级 | JS 层：直接调 DOM 的 click() | 输入栈层：注入真实鼠标事件 |
| 流程 | 直接触发事件处理器 | hit-test → 命中元素 → 派发事件 |
| 需要 | 选择器 | **坐标** |
| 速度 | 快 | 略慢 |
| 兼容性 | 普通元素够用 | React/Vue 合成事件、自定义弹窗**只能靠它** |

实测案例：一个 `div.modal.demo-editor-modal` 自定义弹窗，JS `.click()` 和
完整的 `pointerdown/mousedown/pointerup/mouseup/click` 事件序列**全部无效**，
只有 `Input.dispatchMouseEvent` 有效。

```python
for typ in ('mousePressed', 'mouseReleased'):      # 必须成对
    await send('Input.dispatchMouseEvent', {
        'type': typ, 'x': x, 'y': y,
        'button': 'left', 'clickCount': 1,
    })
```

**坐标必须过滤可见性**，否则会点到隐藏元素：

```js
const e = els.find(x => {
  const r = x.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && 文本匹配;   // ← 宽高 > 0 是关键
});
```

不过滤时实测踩到：匹配到一个 rect 全 0 的隐藏元素，坐标算成 `(0,0)`，
真实点击就点到了**页面左上角**，有误触风险。

---

## 六、iframe：坐标与文档的双重边界

页面里如果有 iframe，两件事会变复杂。

### ① 主文档查不到 iframe 内的元素

必须显式钻进去（同源才可达）：

```js
const f = [...document.querySelectorAll('iframe')].find(x => x.src.includes('关键字'));
const d = f.contentDocument;        // 跨域会抛 SecurityError
d.querySelector('.target');
```

检测是否同源：

```js
try { return !!f.contentDocument } catch(e) { return '跨域' }
```

### ② 点击坐标要叠加 iframe 偏移

iframe 内元素的 `getBoundingClientRect()` 是**相对 iframe 视口**的，
而 `Input.dispatchMouseEvent` 要的是**相对主页面**的坐标：

```js
const fr = iframe.getBoundingClientRect();     // iframe 在主文档中的位置
const r  = el.getBoundingClientRect();       // 元素在 iframe 中的位置
const clickX = fr.x + r.x + r.width/2;       // ← 必须相加
const clickY = fr.y + r.y + r.height/2;
```

### ③ `position:fixed` 在 iframe 里被"关住"

**这是 iframe 最反直觉的一点**：fixed 的定位基准是**它所在文档的视口**，
即 iframe 那个框，不是浏览器窗口。所以：

- 浮窗盖不满浏览器窗口，只能铺满 iframe 区域
- 外层主页面滚动时，iframe 元素移动，里面 fixed 的浮窗被一起带走

两层滚动叠加，`fixed` 只能钉住内层、钉不住外层。

解法有三种，按推荐度：

1. **把浮窗提到父页面**（最干净）：iframe 内点击 → `postMessage` → 父页面渲染浮窗。
   父页面的 `fixed` 相对真正的浏览器窗口，盖满全屏、不受任何滚动影响
2. **锚定 + 可见性检测**：浮窗留在 iframe 内，用 `getBoundingClientRect()` 实时跟随触发元素，
   配合 `IntersectionObserver` 在元素不可见时关闭浮窗（避免"悬空"）
3. **放进文档流**：浮窗塞进滚动容器改 `position: absolute`，与内容共享裁切，
   天然同步、零 JS 监听，代价是会被容器边缘裁切

可运行对照样板间：`~/Desktop/learn/popover-anchor-demo.html`（三种策略可实时切换）

---

## 七、后台标签的渲染节流（重要且反直觉）

**Chrome 不给后台标签渲染帧**，导致依赖渲染帧的 **JS API** 不工作：

| 受影响 | 表现 |
|---|---|
| `IntersectionObserver` | 回调一次都不 fire |
| `requestAnimationFrame` | 不执行 |
| CSS transition / animation | 不推进 |

实测案例：一个 `IntersectionObserver` 检测卡片可见性，卡片 `top=-99`（已滚出）
但回调始终不触发，`anchorVisible` 卡在 `true`。挂探针后发现**回调一次都没被调用**。

解法：操作前先 `Page.bringToFront`

```python
await send('Page.bringToFront')
await asyncio.sleep(0.5)      # 等一帧
```

### 但 CDP 自己的命令不受影响（实测修正）

这点我原本以为也受影响，**实测证明不是**：

```
后台标签 Page.captureScreenshot: OK, PNG 20755 字节
前台标签 Page.captureScreenshot: OK, PNG 20755 字节   ← 完全一致
```

`captureScreenshot` 会**强制触发一次捕获**，不依赖渲染帧。

**准确的结论**：需要 `bringToFront` 的是**依赖渲染帧的 JS API**（IO / rAF / 动画），
不是所有 CDP 命令。截图、`Runtime.evaluate`、DOM 查询这些都不受影响。

---

## 八、连接方式与生命周期

### 启动一个可控的 Chrome

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/my-profile \
  --no-first-run --no-default-browser-check \
  "https://目标URL"
```

**`--user-data-dir` 必须指定独立目录**，否则：
- 会复用你的日常 Chrome profile（agent 能摸到你所有站点登录态，很危险）
- 或者因为已有 Chrome 实例在跑而直接失败

### attach 到已有浏览器（复用登录态）

比 `launch()` 新的更有用的场景 —— 人工完成 SSO 登录后，程序接上去操作：

```python
with urllib.request.urlopen('http://localhost:9222/json/version') as r:
    ws_url = json.load(r)['webSocketDebuggerUrl']
```

Playwright 也支持这条路：`chromium.connectOverCDP('http://localhost:9222')`

### 最小可用客户端（~30 行）

```python
import asyncio, json, urllib.request, websockets

CDP = 'http://localhost:9222'

def page_ws(index=0):
    with urllib.request.urlopen(f'{CDP}/json', timeout=5) as r:
        pages = [p for p in json.load(r) if p.get('type') == 'page']
    return pages[index]['webSocketDebuggerUrl']

class CDPClient:
    def __init__(self, ws): self.ws, self._id = ws, 0
    async def send(self, method, params=None):
        self._id += 1
        await self.ws.send(json.dumps({'id': self._id, 'method': method, 'params': params or {}}))
        while True:
            d = json.loads(await self.recv_wrapper())
            if d.get('id') == self._id:
                if 'error' in d: raise RuntimeError(f"{method}: {d['error'].get('message')}")
                return d.get('result', {})
    async def js(self, expr, await_promise=False):
        r = await self.send('Runtime.evaluate', {
            'expression': expr, 'returnByValue': True, 'awaitPromise': await_promise})
        if 'exceptionDetails' in r:
            raise RuntimeError(json.dumps(r['exceptionDetails'], ensure_ascii=False)[:300])
        return r.get('result', {}).get('value')

async def main():
    async with websockets.connect(page_ws(), max_size=None) as ws:
        c = CDPClient(ws)
        print(await c.js('document.title'))

asyncio.run(main())
```

**`max_size=None` 必须设**，否则大页面（HTML、截图 base64）会因超出默认帧大小被断连。

### 长连接不稳，用短连接

实测长连接做连续滚轮操作会 `ConnectionClosedError: no close frame received`。
稳妥做法是**每次操作用独立短连接**：

```python
async def ev(expr):
    async with websockets.connect(page_ws(), max_size=None, open_timeout=8) as ws:
        ...   # 发一次、收一次、关闭
```

慢一点，但不会莫名断连。

---

## 九、和 Playwright / Puppeteer 的关系

```
你的代码
   ↓
Playwright / Puppeteer      ← 高层封装：selector、waitFor、断言、自动重试、trace
   ↓
CDP                          ← 底层协议（仅 Chromium）
   ↓
Chrome 内核
```

- **Puppeteer** ≈ CDP 的 JS 封装（Google 出品，早期几乎一对一映射）
- **Playwright** 对 Chromium 也走 CDP，但额外抽象了自己的协议层，好同时支持 Firefox / WebKit

所以：**Playwright 帮你写好了 CDP 调用，但它不一定暴露你要的每个能力。**

### 什么时候直接写 CDP

| 场景 | 选择 |
|---|---|
| 需要 attach 到**已登录**的浏览器 | CDP（Playwright 的 `launch()` 起的是全新实例，没有你的 cookie） |
| 只需要"读内容 / 点几下"，不需要测试框架 | CDP（300 行标准库 vs 100MB 浏览器下载） |
| 要读浏览器级全局 cookie | CDP `Storage.getCookies` |
| 回归测试、断言、CI、跨浏览器 | **Playwright** |
| 要 trace 回放、自动等待、并行 worker | **Playwright** |

### 一个佐证

`browser-use` 0.13.11 **不依赖 Playwright**：

```
含 playwright 的依赖: 无
含 cdp 的依赖:       cdp-use==1.4.5
session.py:15        from cdp_use import CDPClient
playwright 实际装了吗: 否
```

它自己就是直连 CDP。所以"自己写 CDP 工具"不是降级方案，而是**同层级**方案。

---

## 十、限制

**① 只有 Chromium 系支持**

Firefox（有自己的 remote protocol）和 Safari（WebKit Inspector Protocol）不认 CDP。
要跨浏览器必须用 Playwright 那种抽象层。

**② 不是稳定 API 的正式承诺**

协议大版本（1.3）很稳，但小改动时有发生。Playwright/Puppeteer 会帮你吸收，
裸写 CDP 得自己扛。`Network.getAllCookies` 那个 `-32601` 就是这类问题。

**③ 开着调试端口 = 本机任何进程都能完全控制你的浏览器**

`--remote-debugging-port` 没有鉴权。别在有敏感登录态的日常 Chrome 上开，
别暴露到非 localhost，用完关掉。

---

## 十一、踩坑清单

| 坑 | 现象 | 解法 |
|---|---|---|
| 命令发错层级 | `-32601 'Network.getAllCookies' wasn't found` | 浏览器级用 `Storage.getCookies` |
| 忘 `returnByValue` | 只拿到 `objectId`，取不到值 | `params` 里加 `returnByValue: true` |
| 忘查 `exceptionDetails` | JS 报错被当成正常返回 | 单独检查这个字段 |
| 消息循环不过滤 id | 把事件推送当成响应，错位 | `if d.get('id') == my_id` |
| `max_size` 默认值太小 | 大页面/截图直接断连 | `websockets.connect(..., max_size=None)` |
| 长连接被断 | `ConnectionClosedError: no close frame` | 改独立短连接 |
| **后台标签不渲染** | IO / rAF 回调一次不触发 | `Page.bringToFront` + 等一帧 |
| 点击不过滤可见性 | 坐标算成 (0,0)，误点页面左上角 | `getBoundingClientRect()` 宽高 > 0 |
| JS click 无效 | 自定义弹窗/框架组件不响应 | 换 `Input.dispatchMouseEvent` |
| iframe 坐标偏移 | 点到错误位置 | 叠加 `iframe.getBoundingClientRect()` |
| shell 多层转义 | JS 引号被毁，traceback | 写临时 .py 文件执行 |
| `window.open` 被拦 | 返回 `blocked` | 用 `Target.createTarget` |
| macOS 无 `timeout`/`setsid` | `command not found` | 直接跑 / 用 `nohup & disown` |
| 索引会变 | `--tab 1` 指到了别的页面 | **每次操作前重新 `tabs` 确认** |

---

## 十二、快速上手

```bash
# 1. 起一个可控 Chrome（独立 profile）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/cdp-demo \
  --no-first-run "https://example.com"

# 2. 确认通了
curl -s http://localhost:9222/json/version | python3 -m json.tool

# 3. 看有哪些标签页
curl -s http://localhost:9222/json | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p.get('type')=='page': print(p['title'], '|', p['url'][:60])"

# 4. 查完整协议
curl -s http://localhost:9222/json/protocol | python3 -m json.tool | less
```

现成工具：`~/Desktop/learn/bu-lab/cdp.py`（332 行，封装了
`tabs / info / text / js / html / click / realclick / type / nav / shot / cookies`）

官方文档：https://chromedevtools.github.io/devtools-protocol/
