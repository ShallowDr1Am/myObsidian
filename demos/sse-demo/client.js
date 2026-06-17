// ============================================
// SSE 解析器 - 核心实现（函数式）
// ============================================

const createSSEParser = (options = {}) => {
  const { onMessage = () => {}, onError = () => {}, debug = false } = options
  let buffer = ''

  /**
   * 解析单条消息的字段
   */
  const parseMessage = (rawMessage) => {
    const lines = rawMessage.split('\n')
    const message = {
      event: 'message',
      data: [],
      id: null,
      retry: null
    }

    for (const line of lines) {
      // 忽略注释行（以冒号开头）
      if (line.startsWith(':')) continue

      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const field = line.slice(0, colonIndex)
      let value = line.slice(colonIndex + 1)

      // 去掉值开头的空格
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

  /**
   * 解析接收到的 chunk
   */
  const parse = (chunk) => {
    if (debug) {
      console.log('[Parser] 收到 chunk:', JSON.stringify(chunk))
    }

    buffer += chunk
    const messages = []

    // 持续查找完整的消息（以 \n\n 结尾）
    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) break

      // 提取一条消息
      const rawMessage = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      // 解析消息字段
      const message = parseMessage(rawMessage)
      if (message) {
        messages.push(message)
        onMessage(message)
      }
    }

    if (debug && buffer.length > 0) {
      console.log('[Parser] buffer 中剩余:', JSON.stringify(buffer))
    }

    return messages
  }

  /**
   * 获取当前 buffer 状态（用于调试）
   */
  const getBuffer = () => buffer

  /**
   * 重置解析器
   */
  const reset = () => {
    buffer = ''
  }

  return { parse, parseMessage, getBuffer, reset }
}

// ============================================
// AI 流式对话处理器（函数式）
// ============================================

const createAIStreamHandler = (options = {}) => {
  let fullText = ''
  let messageCount = 0
  let byteCount = 0
  let startTime = null
  let reader = null
  let aborted = false

  const { onChunk = () => {}, onComplete = () => {}, debug = false } = options

  const parser = createSSEParser({
    debug,
    onMessage: (msg) => handleMessage(msg)
  })

  const handleMessage = (msg) => {
    messageCount++

    try {
      const data = JSON.parse(msg.data)

      if (data.text) {
        fullText += data.text
        onChunk(data.text, fullText, {
          messageCount,
          byteCount,
          duration: Date.now() - startTime
        })
      }

      if (data.done) {
        onComplete(fullText, data.fullText)
      }
    } catch (e) {
      console.error('JSON 解析失败:', e, msg.data)
    }
  }

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
        parser.parse(chunk)
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
    if (reader) {
      reader.cancel()
    }
  }

  const getStats = () => ({
    messageCount,
    byteCount,
    duration: startTime ? Date.now() - startTime : 0
  })

  return { handleStream, abort, getStats, parser }
}

// ============================================
// UI 交互函数
// ============================================

let currentHandler = null
let eventSourceInstance = null

// AI 对话演示
async function startAIChat() {
  const output = document.getElementById('aiOutput')
  const rawOutput = document.getElementById('rawOutput')
  const parserState = document.getElementById('parserState')

  output.textContent = ''
  rawOutput.textContent = ''
  output.classList.add('streaming')

  currentHandler = createAIStreamHandler({
    debug: true,
    onChunk: (chunk, full, stats) => {
      output.textContent = full
      updateStats(stats)
    },
    onComplete: (text, expected) => {
      output.classList.remove('streaming')
      parserState.innerHTML = `<div class="log-entry info">✅ 流式输出完成</div>
<div class="log-entry">总长度: ${text.length} 字符</div>
<div class="log-entry">预期长度: ${expected?.length || 'N/A'} 字符</div>
<div class="log-entry">匹配: ${text === expected ? '✓' : '✗'}</div>`
    }
  })

  try {
    const response = await fetch('/api/chat')
    await currentHandler.handleStream(response)
  } catch (error) {
    output.classList.remove('streaming')
    output.textContent = '错误: ' + error.message
  }
}

function stopAIChat() {
  if (currentHandler) {
    currentHandler.abort()
    document.getElementById('aiOutput').classList.remove('streaming')
  }
}

// 更新统计信息
function updateStats(stats) {
  document.getElementById('msgCount').textContent = stats.messageCount
  document.getElementById('byteCount').textContent = stats.byteCount
  document.getElementById('duration').textContent = stats.duration + 'ms'
}

// 多行 data 测试
async function testMultiline() {
  const output = document.getElementById('multilineOutput')
  output.textContent = '请求中...\n'

  const parser = createSSEParser({ debug: true })
  const response = await fetch('/api/multiline')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const messages = parser.parse(chunk)

    for (const msg of messages) {
      output.textContent += `\n收到消息:\n`
      output.textContent += `  event: ${msg.event}\n`
      output.textContent += `  id: ${msg.id}\n`
      output.textContent += `  data: ${msg.data}\n`
    }
  }
}

// 分片测试
async function testFragmented() {
  const output = document.getElementById('fragmentedOutput')
  const parserState = document.getElementById('parserState')

  output.textContent = '测试分片解析...\n\n'

  const parser = createSSEParser({
    debug: true,
    onMessage: (msg) => {
      output.textContent += `✅ 解析成功:\n`
      output.textContent += `   id: ${msg.id}\n`
      output.textContent += `   data: ${msg.data}\n\n`
    }
  })

  const response = await fetch('/api/fragmented')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let chunkCount = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    chunkCount++
    const chunk = decoder.decode(value, { stream: true })

    output.textContent += `📦 Chunk ${chunkCount}: ${JSON.stringify(chunk)}\n`

    const messages = parser.parse(chunk)
    output.textContent += `   → 解析出 ${messages.length} 条消息\n\n`
  }

  // 显示 buffer 状态
  parserState.innerHTML = `<div class="log-entry info">解析完成</div>
<div class="log-entry">总 chunk 数: ${chunkCount}</div>
<div class="log-entry">buffer 剩余: ${parser.getBuffer().length} 字节</div>
<div class="log-entry">剩余内容: ${JSON.stringify(parser.getBuffer())}</div>`
}

// 使用原生 EventSource
function useEventSource() {
  const output = document.getElementById('esOutput')
  const status = document.getElementById('esStatus')

  output.textContent = ''
  eventSourceInstance = new EventSource('/api/chat')

  eventSourceInstance.onopen = () => {
    status.textContent = '已连接'
    status.className = 'status connected'
    output.textContent += '🔗 连接已建立\n'
  }

  eventSourceInstance.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.text) {
        output.textContent += data.text
      }
      if (data.done) {
        output.textContent += '\n\n✅ 完成'
      }
    } catch (err) {
      output.textContent += '\n解析错误: ' + err.message
    }
  }

  eventSourceInstance.onerror = (e) => {
    status.textContent = '错误/断开'
    status.className = 'status disconnected'
    output.textContent += '\n❌ 连接错误'

    if (eventSourceInstance.readyState === EventSource.CLOSED) {
      output.textContent += ' (已关闭)'
    }
  }
}

function closeEventSource() {
  if (eventSourceInstance) {
    eventSourceInstance.close()
    document.getElementById('esStatus').textContent = '已关闭'
    document.getElementById('esStatus').className = 'status disconnected'
    eventSourceInstance = null
  }
}

// ============================================
// 工具函数
// ============================================

// 监听原始数据
const originalFetch = window.fetch
window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args)

  if (args[0].includes && args[0].includes('/api/')) {
    const rawOutput = document.getElementById('rawOutput')
    const clonedResponse = response.clone()

    // 异步读取原始数据
    ;(async () => {
      const reader = clonedResponse.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        if (rawOutput) {
          rawOutput.textContent += text
          rawOutput.scrollTop = rawOutput.scrollHeight
        }
      }
    })()
  }

  return response
}

console.log('SSE 客户端已加载（函数式版本）')
console.log('可用函数: startAIChat(), stopAIChat(), testMultiline(), testFragmented(), useEventSource(), closeEventSource()')
