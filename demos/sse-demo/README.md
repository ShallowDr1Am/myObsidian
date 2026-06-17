# SSE 流式文本解析演示

## 快速开始

```bash
# 进入目录
cd sse-demo

# 启动服务器
npm start

# 或直接运行
node server.js
```

然后访问 http://localhost:3000

## 演示内容

### 1. AI 对话流式输出
模拟 AI 逐字输出，展示：
- 实时文本累积
- 消息统计（数量、字节、耗时）
- 原始 SSE 数据查看

### 2. 多行 Data 字段
演示 SSE 协议中多行 `data:` 字段的正确解析：
```
data: 第一行
data: 第二行
data: 第三行
```
应解析为：`"第一行\n第二行\n第三行"`

### 3. 分片/粘包测试
模拟 TCP 层面的数据分片和粘包：
- 一条消息被拆分成多个 chunk
- 多条消息合并在一个 chunk 中

### 4. 原生 EventSource 对比
使用浏览器原生 EventSource API，对比手动解析的差异

## 核心代码

### 解析器 (client.js)

```javascript
class SSEParser {
  parse(chunk) {
    this.buffer += chunk;
    const messages = [];

    while (true) {
      const boundary = this.buffer.indexOf('\n\n');
      if (boundary === -1) break;

      const rawMessage = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const message = this.parseMessage(rawMessage);
      if (message) messages.push(message);
    }

    return messages;
  }
}
```

### 服务端 (server.js)

```javascript
// SSE 消息格式
function createSSE(data, options = {}) {
  let msg = '';
  if (options.id) msg += `id: ${options.id}\n`;
  if (options.event) msg += `event: ${options.event}\n`;
  msg += `data: ${JSON.stringify(data)}\n`;
  msg += '\n';
  return msg;
}

// 发送
res.write(createSSE({ text: '你好' }, { id: 1 }));
```

## 测试接口

| 接口 | 说明 |
|------|------|
| `/api/chat` | AI 对话流式输出 |
| `/api/multiline` | 多行 data 演示 |
| `/api/fragmented` | 分片/粘包测试 |

## 相关文档

详细理论请查看：`../SSE 流式文本解析.md`