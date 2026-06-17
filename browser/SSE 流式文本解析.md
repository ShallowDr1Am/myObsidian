# SSE 流式文本解析完全指南

## 一、SSE 协议规范

### 1.1 基本格式

SSE（Server-Sent Events）使用简单的文本格式，每个消息以 `\n\n` 结尾：

```
field: value\n
field: value\n
\n
```

### 1.2 字段类型

| 字段 | 说明 | 示例 |
|------|------|------|
| `event` | 事件类型（默认 `message`） | `event: custom\n` |
| `data` | 消息数据（可多行） | `data: {"text": "hello"}\n` |
| `id` | 事件ID（用于重连） | `id: 123\n` |
| `retry` | 重连间隔（毫秒） | `retry: 3000\n` |

### 1.3 完整消息示例

```
id: 100\n
event: message\n
data: {"content": "你好", "done": false}\n
\n
```

## 二、流式文本解析的核心问题

### 2.1 数据分片问题

TCP 是流式协议，一条 SSE 消息可能被拆分成多个 chunk：

```
发送端: "data: hello\n\n"

接收端可能收到:
chunk1: "data: hel"
chunk2: "lo\n\n"

或者:
chunk1: "data: hello\n"
chunk2: "\n"
```

### 2.2 消息边界问题

多个消息可能在一个 chunk 中：

```
chunk: "data: msg1\n\ndata: msg2\n\n"
```

### 2.3 多行 data 字段

```
data: 第一行\n
data: 第二行\n
\n
```
解析后应该是：`"第一行\n第二行"`

## 三、解析器实现

### 3.1 基础解析器（工厂函数）

```javascript
// 创建 SSE 解析器
const createSSEParser = () => {
  let buffer = ''  // 缓存未完成的数据

  // 解析单条消息的字段
  const parseMessage = (rawMessage) => {
    const lines = rawMessage.split('\n')
    const message = {
      event: 'message',  // 默认事件类型
      data: [],
      id: null,
      retry: null
    }

    for (const line of lines) {
      // 忽略注释行（以冒号开头）
      if (line.startsWith(':')) continue

      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue  // 无效行

      const field = line.slice(0, colonIndex)
      let value = line.slice(colonIndex + 1)

      // 去掉值开头的空格（如果有）
      if (value.startsWith(' ')) {
        value = value.slice(1)
      }

      switch (field) {
        case 'event':
          message.event = value
          break
        case 'data':
          message.data.push(value)
          break
        case 'id':
          message.id = value
          break
        case 'retry':
          message.retry = parseInt(value, 10)
          break
      }
    }

    // 如果没有数据，返回 null
    if (message.data.length === 0) return null

    // 合并多行 data
    message.data = message.data.join('\n')

    return message
  }

  // 处理每个 chunk
  const parse = (chunk) => {
    buffer += chunk
    const messages = []

    // 持续查找完整的消息（以 \n\n 结尾）
    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) break  // 没有完整消息

      // 提取一条消息
      const rawMessage = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)  // 跳过 \n\n

      // 解析消息字段
      const message = parseMessage(rawMessage)
      if (message) messages.push(message)
    }

    return messages
  }

  // 获取当前 buffer（调试用）
  const getBuffer = () => buffer

  // 重置解析器
  const reset = () => {
    buffer = ''
  }

  return { parse, parseMessage, getBuffer, reset }
}
```

### 3.2 使用示例

```javascript
const parser = createSSEParser()

// 模拟接收流式数据
const chunks = [
  'id: 1\n',
  'data: {"text": "你"}\n\n',
  'id: 2\ndata: {"text": "好"}\n\n',
  'data: 不完整...',  // 这个会留在 buffer 中
]

for (const chunk of chunks) {
  const messages = parser.parse(chunk)
  for (const msg of messages) {
    console.log('收到消息:', msg)
    // 处理消息...
  }
}

// 输出:
// 收到消息: { event: 'message', data: '{"text": "你"}', id: '1', retry: null }
// 收到消息: { event: 'message', data: '{"text": "好"}', id: '2', retry: null }
```

## 四、实际应用场景

### 4.1 AI 对话流式输出

```javascript
// 创建 AI 流式处理器
const createAIStreamHandler = (options = {}) => {
  const { onChunk, onComplete } = options
  const parser = createSSEParser()
  let fullText = ''
  let messageCount = 0
  let byteCount = 0
  let startTime = null
  let reader = null
  let aborted = false

  const handleStream = async (response) => {
    startTime = Date.now()
    reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (!aborted) {
        const { done, value } = await reader.read()
        if (done) break

        byteCount += value.length
        const chunk = decoder.decode(value, { stream: true })
        const messages = parser.parse(chunk)

        for (const msg of messages) {
          messageCount++
          try {
            const data = JSON.parse(msg.data)

            if (data.text) {
              fullText += data.text
              onChunk?.(data.text, fullText, {
                messageCount,
                byteCount,
                duration: Date.now() - startTime
              })
            }

            if (data.done) {
              onComplete?.(fullText, data.fullText)
            }
          } catch (e) {
            console.error('JSON 解析失败:', e)
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('流读取错误:', error)
      }
    }

    return fullText
  }

  const abort = () => {
    aborted = true
    reader?.cancel()
  }

  const getStats = () => ({
    messageCount,
    byteCount,
    duration: startTime ? Date.now() - startTime : 0
  })

  return { handleStream, abort, getStats }
}

// 使用示例
async function chat() {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '你好' })
  })

  const handler = createAIStreamHandler({
    onChunk: (chunk, full, stats) => {
      // 实时更新 UI
      document.getElementById('output').textContent = full
      console.log(`进度: ${stats.messageCount} 条消息, ${stats.duration}ms`)
    },
    onComplete: (text) => {
      console.log('流式输出完成:', text)
    }
  })

  const result = await handler.handleStream(response)
  return result
}
```

### 4.2 服务端实现（Node.js）

```javascript
import http from 'http';

http.createServer((req, res) => {
  if (req.url === '/stream') {
    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      // CORS（如需要）
      'Access-Control-Allow-Origin': '*'
    });

    let id = 0;
    const texts = ['你', '好', '，', '世', '界', '！'];

    const sendEvent = (data, event = 'message') => {
      res.write(`id: ${++id}\n`);
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n`);
      res.write('\n');  // 消息结束
    };

    // 逐字发送
    let index = 0;
    const interval = setInterval(() => {
      if (index >= texts.length) {
        sendEvent({ done: true });
        clearInterval(interval);
        res.end();
        return;
      }

      sendEvent({ text: texts[index], done: false });
      index++;
    }, 100);

    // 客户端断开时清理
    req.on('close', () => {
      clearInterval(interval);
    });
  }
}).listen(3000);
```

## 五、高级技巧

### 5.1 心跳保活

```javascript
// 服务端
const heartbeat = setInterval(() => {
  res.write(': heartbeat\n\n');  // 注释行，浏览器忽略
}, 15000);

// 客户端检测断线
let lastReceive = Date.now();
setInterval(() => {
  if (Date.now() - lastReceive > 30000) {
    console.log('连接可能已断开');
    // 重连逻辑...
  }
}, 5000);
```

### 5.2 断点续传

```javascript
// 客户端
const eventSource = new EventSource('/stream');
let lastEventId = localStorage.getItem('lastEventId');

// 发送重连请求时带上 Last-Event-ID
// 浏览器会自动处理，也可以手动：
fetch('/stream', {
  headers: { 'Last-Event-ID': lastEventId }
});

// 收到消息时保存
eventSource.onmessage = (e) => {
  if (e.lastEventId) {
    localStorage.setItem('lastEventId', e.lastEventId);
  }
  // 处理消息...
};
```

### 5.3 错误处理与重连

```javascript
// 创建健壮的 SSE 连接器
const createRobustSSE = (url, options = {}) => {
  const {
    maxReconnectAttempts = 5,
    reconnectDelay = 1000,
    onMessage,
    onOpen,
    onError
  } = options

  let es = null
  let reconnectAttempts = 0
  let isClosed = false

  const connect = () => {
    if (isClosed) return

    es = new EventSource(url)

    es.onopen = () => {
      console.log('SSE 连接成功')
      reconnectAttempts = 0
      onOpen?.()
    }

    es.onerror = (e) => {
      console.error('SSE 错误:', e)
      onError?.(e)

      if (es.readyState === EventSource.CLOSED) {
        handleReconnect()
      }
    }

    es.onmessage = (e) => {
      onMessage?.(e)
    }
  }

  const handleReconnect = () => {
    if (isClosed) return
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error('重连次数超限，停止重连')
      return
    }

    reconnectAttempts++
    const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1)

    console.log(`${delay}ms 后尝试第 ${reconnectAttempts} 次重连`)

    setTimeout(connect, delay)
  }

  const close = () => {
    isClosed = true
    es?.close()
  }

  // 自动连接
  connect()

  return { connect, close }
}

// 使用示例
const sse = createRobustSSE('/api/stream', {
  onMessage: (e) => {
    console.log('收到消息:', e.data)
  },
  onOpen: () => {
    console.log('连接已建立')
  },
  onError: (e) => {
    console.log('连接出错')
  }
})

// 关闭连接
// sse.close()
```

## 六、常见问题与解决方案

### 6.1 中文乱码

```javascript
// 确保使用 UTF-8 解码
const decoder = new TextDecoder('utf-8');
const text = decoder.decode(uint8Array);
```

### 6.2 消息过大被截断

```javascript
// 服务端分片发送大消息
function sendLargeData(res, data) {
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    res.write(`data: ${JSON.stringify({ chunk, index: i })}\n\n`);
  }
  res.write('data: {"done": true}\n\n');
}
```

### 6.3 连接数限制（重要）

#### 限制规则

在 HTTP/1.1 协议下，浏览器对**每个域名**的并发连接数有限制（通常为 6 个），这是浏览器的策略，源自 HTTP/1.1 规范（RFC 2616）。

**关键点**：限制是**每个域名**，不是整个浏览器。

```
浏览器总连接能力：

example1.com  →  6 个连接（所有标签页共享）
example2.com  →  6 个连接（所有标签页共享）
example3.com  →  6 个连接（所有标签页共享）

每个域名独立计算，互不影响
```

#### HTTP/1.1 vs HTTP/2 对比

| 协议 | 连接限制 | 范围 | 说明 |
|------|----------|------|------|
| HTTP/1.1 | 6 个 | 每个域名，所有标签页共享 | SSE 长连接会持续占用 |
| HTTP/2 | ~100 个（可协商） | 每个域名 | 多路复用，一个连接承载多个流 |

#### 实际场景示例

```
假设你打开了 6 个标签页，都连接同一个域名：

标签页1: SSE 连接 → 占用 1 个
标签页2: SSE 连接 → 占用 1 个
标签页3: SSE 连接 → 占用 1 个
标签页4: SSE 连接 → 占用 1 个
标签页5: SSE 连接 → 占用 1 个
标签页6: SSE 连接 → 占用 1 个
标签页7: SSE 连接 → 阻塞！等待前面的释放
```

Chrome 和 Firefox 已将此问题标记为 "Won't Fix"，建议开发者迁移到 HTTP/2。

#### 解决方案

**方案1：使用 HTTP/2（推荐）**

Nginx 配置示例：
```nginx
server {
    listen 443 ssl http2;  # 启用 HTTP/2
    
    location /sse {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

**方案2：多标签页连接复用**

使用 `BroadcastChannel` 让多个标签页共享一个 SSE 连接：

```javascript
// sse-manager.js
const createSharedSSE = (url, options = {}) => {
  const { onMessage } = options
  const channel = new BroadcastChannel('sse-updates')
  let isLeader = false
  let es = null

  // 监听其他标签页的消息
  channel.onmessage = (e) => {
    if (e.data.type === 'sse-message') {
      onMessage?.(e.data.payload)
    }
  }

  // 竞选 leader（只有一个标签页建立连接）
  const electLeader = () => {
    const leaderId = localStorage.getItem('sse-leader')
    const myId = sessionStorage.tabId || (sessionStorage.tabId = Date.now())

    if (!leaderId || leaderId == myId) {
      isLeader = true
      localStorage.setItem('sse-leader', myId)
      connect()
    }
  }

  const connect = () => {
    es = new EventSource(url)

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      // 广播给所有标签页
      channel.postMessage({
        type: 'sse-message',
        payload: data
      })
    }

    es.onerror = () => {
      localStorage.removeItem('sse-leader')
      setTimeout(electLeader, 1000)
    }
  }

  // 页面卸载时重新选举
  window.addEventListener('beforeunload', () => {
    if (isLeader) {
      channel.postMessage({ type: 'leader-resign' })
      localStorage.removeItem('sse-leader')
    }
  })

  // 启动选举
  electLeader()

  return {
    close: () => {
      es?.close()
      channel.close()
    }
  }
}

// 使用
const sse = createSharedSSE('/api/stream', {
  onMessage: (data) => {
    console.log('收到消息:', data)
  }
})
```

**方案3：页面不可见时断开连接**

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    eventSource.close();
    console.log('页面隐藏，释放连接');
  } else {
    eventSource = new EventSource(url);
    console.log('页面可见，重新连接');
  }
});
```

**方案4：使用多个子域名**

如果业务允许，可以使用多个子域名来突破限制：

```
stream1.example.com  →  6 个连接
stream2.example.com  →  6 个连接
stream3.example.com  →  6 个连接
```

## 七、调试技巧

### 7.1 查看原始数据

```javascript
// 在 Network 面板中，SSE 请求会显示 "EventStream" 类型
// 可以看到每条消息的原始格式

// 或手动打印
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log('原始 chunk:', new TextDecoder().decode(value));
}
```

### 7.2 模拟测试

```javascript
// 模拟 SSE 服务器
function mockSSE(messages) {
  return new ReadableStream({
    start(controller) {
      messages.forEach((msg, i) => {
        setTimeout(() => {
          const data = `id: ${i}\ndata: ${JSON.stringify(msg)}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
          if (i === messages.length - 1) {
            controller.close();
          }
        }, i * 100);
      });
    }
  });
}
```

## 八、总结

| 场景 | 推荐方案 |
|------|----------|
| 简单实时通知 | 原生 `EventSource` |
| 需要自定义请求头 | `fetch` + 手动解析 |
| AI 流式对话 | 解析器 + 累积文本 |
| 高可靠性 | 重连 + 心跳 + 断点续传 |
| 多标签页共享 | `BroadcastChannel` 复用连接 |

**核心要点**：
1. 理解 `\n\n` 消息边界
2. 正确处理 buffer 缓存
3. 多行 `data` 字段需要合并
4. 实现健壮的重连机制
5. 注意连接数和内存管理