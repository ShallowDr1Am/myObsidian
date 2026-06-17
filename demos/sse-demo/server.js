import http from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// AI 模拟数据 - 逐字输出
const AI_RESPONSE = '你好！我是一个 AI 助手，很高兴为你服务。我可以帮助你解答各种问题，比如编程、写作、分析等。请问有什么我可以帮你的吗？';

// SSE 解析器（服务端用）
class SSEMessage {
  static create(data, options = {}) {
    const { id, event = 'message' } = options;
    let message = '';

    if (id !== undefined) {
      message += `id: ${id}\n`;
    }
    if (event !== 'message') {
      message += `event: ${event}\n`;
    }
    message += `data: ${JSON.stringify(data)}\n`;
    message += '\n';

    return message;
  }

  static heartbeat() {
    return ': heartbeat\n\n';
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3000`);

  // 静态文件服务
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = await readFile(join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (url.pathname === '/client.js') {
    const js = await readFile(join(__dirname, 'client.js'));
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(js);
    return;
  }

  // SSE 流式接口
  if (url.pathname === '/api/chat') {
    console.log('收到 SSE 请求');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    let id = 0;
    let index = 0;
    let closed = false;

    // 心跳保活
    const heartbeat = setInterval(() => {
      if (!closed) {
        res.write(SSEMessage.heartbeat());
        console.log('发送心跳');
      }
    }, 10000);

    // 逐字发送
    const sendChunk = () => {
      if (closed || index >= AI_RESPONSE.length) {
        // 发送完成信号
        if (!closed) {
          res.write(SSEMessage.create(
            { done: true, fullText: AI_RESPONSE },
            { id: ++id }
          ));
          console.log('流式输出完成');
        }
        clearInterval(heartbeat);
        res.end();
        return;
      }

      // 每次发送 1-3 个字符（模拟真实场景）
      const chunkSize = Math.min(
        Math.floor(Math.random() * 3) + 1,
        AI_RESPONSE.length - index
      );
      const text = AI_RESPONSE.slice(index, index + chunkSize);

      res.write(SSEMessage.create(
        { text, index, done: false },
        { id: ++id }
      ));

      console.log(`发送第 ${id} 条消息: "${text}"`);
      index += chunkSize;

      // 随机延迟 50-150ms
      setTimeout(sendChunk, Math.random() * 100 + 50);
    };

    // 开始发送
    setTimeout(sendChunk, 100);

    // 客户端断开
    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      console.log('客户端断开连接');
    });

    return;
  }

  // 多行 data 演示
  if (url.pathname === '/api/multiline') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // 发送多行 data
    res.write('id: 1\n');
    res.write('data: 第一行内容\n');
    res.write('data: 第二行内容\n');
    res.write('data: 第三行内容\n');
    res.write('\n');

    res.write('id: 2\n');
    res.write('event: custom\n');
    res.write('data: {"message": "自定义事件"}\n');
    res.write('\n');

    res.end();
    return;
  }

  // 分片测试（故意发送不完整的消息）
  if (url.pathname === '/api/fragmented') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // 故意分片发送
    res.write('id: 1\nda');
    await new Promise(r => setTimeout(r, 100));
    res.write('ta: {"text": "分片测试"}\n');
    await new Promise(r => setTimeout(r, 100));
    res.write('\n');

    // 多条消息在一个 chunk 中
    res.write('id: 2\ndata: {"text": "消息A"}\n\nid: 3\ndata: {"text": "消息B"}\n\n');

    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(3030, () => {
  console.log('SSE 示例服务器运行在 http://localhost:3030');
  console.log('');
  console.log('可用的测试接口:');
  console.log('  - http://localhost:3030/              主页面');
  console.log('  - http://localhost:3030/api/chat      AI 对话流式输出');
  console.log('  - http://localhost:3030/api/multiline 多行 data 演示');
  console.log('  - http://localhost:3030/api/fragmented 分片测试');
});