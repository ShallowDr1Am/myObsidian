#!/usr/bin/env node

/**
 * 文档索引生成器
 * 功能：
 * 1. 生成 llms.txt（LLM 友好索引）
 * 2. 生成 search-index.json（倒排索引）
 * 3. 生成 keywords.json（关键词索引）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// ========== 配置 ==========
const CONFIG = {
  docsDir: ROOT_DIR,
  outputFile: {
    llmsTxt: path.join(ROOT_DIR, 'llms.txt'),
    searchIndex: path.join(ROOT_DIR, 'search-index.json'),
    keywords: path.join(ROOT_DIR, 'keywords.json'),
  },
  exclude: ['.git', '.obsidian', 'node_modules', 'Excalidraw'],
};

// ========== 工具函数 ==========

/**
 * 提取 Markdown 标题
 */
function extractTitles(content) {
  const titles = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      titles.push({
        level: match[1].length,
        text: match[2].trim(),
      });
    }
  }

  return titles;
}

/**
 * 提取关键词（简单分词）
 */
function extractKeywords(content) {
  // 移除代码块
  let text = content.replace(/```[\s\S]*?```/g, ' ');
  // 移除行内代码
  text = text.replace(/`[^`]+`/g, ' ');
  // 移除链接
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 移除标记符号
  text = text.replace(/[#*_`>|()\[\]{}]/g, ' ');

  // 分词（中文按字符，英文按单词）
  const words = [];
  const englishWords = text.match(/[a-zA-Z][a-zA-Z0-9-]*/g) || [];
  const chineseChars = text.match(/[一-龥]+/g) || [];

  words.push(...englishWords.map(w => w.toLowerCase()));
  words.push(...chineseChars);

  // 过滤停用词
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    '的', '了', '是', '在', '有', '和', '与', '或', '等', '也', '都',
    '这', '那', '个', '些', '上', '下', '中', '来', '去', '到', '从',
    '可以', '如果', '因为', '所以', '但是', '然而', '例如', '比如',
  ]);

  return words.filter(w => w.length > 1 && !stopWords.has(w));
}

/**
 * 提取代码块
 */
function extractCodeBlocks(content) {
  const blocks = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim().slice(0, 200), // 截取前200字符
    });
  }

  return blocks;
}

/**
 * 生成文档摘要
 */
function generateSummary(content, maxLength = 200) {
  // 移除代码块和标题
  let text = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/[*_`#>\[\]()]/g, '')
    .replace(/\n+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + '...';
  }

  return text;
}

// ========== 核心逻辑 ==========

/**
 * 递归扫描目录中的 Markdown 文件
 */
function scanDirectory(dir, category = '') {
  const docs = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    // 跳过排除目录
    if (CONFIG.exclude.includes(file)) continue;

    // 递归扫描子目录
    if (stat.isDirectory()) {
      const subDocs = scanDirectory(filePath, file);
      docs.push(...subDocs);
      continue;
    }

    // 处理 Markdown 文件
    if (!file.endsWith('.md')) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const titles = extractTitles(content);
    const keywords = extractKeywords(content);
    const codeBlocks = extractCodeBlocks(content);
    const summary = generateSummary(content);

    // 相对于根目录的路径
    const relativePath = category ? `${category}/${file}` : file;

    docs.push({
      file: relativePath,
      category: category || 'root',
      title: titles[0]?.text || file.replace('.md', ''),
      titles,
      keywords,
      codeBlocks,
      summary,
      wordCount: content.length,
      lastModified: stat.mtime.toISOString(),
    });
  }

  return docs;
}

/**
 * 扫描所有 Markdown 文件
 */
function scanDocuments() {
  return scanDirectory(CONFIG.docsDir);
}

/**
 * 构建倒排索引
 */
function buildInvertedIndex(docs) {
  const index = {};

  for (const doc of docs) {
    // 标题权重高
    for (const title of doc.titles) {
      const words = extractKeywords(title.text);
      for (const word of words) {
        if (!index[word]) index[word] = [];
        const existing = index[word].find(d => d.file === doc.file);
        if (existing) {
          existing.weight += 10;
        } else {
          index[word].push({ file: doc.file, weight: 10 });
        }
      }
    }

    // 内容关键词
    for (const word of doc.keywords) {
      if (!index[word]) index[word] = [];
      const existing = index[word].find(d => d.file === doc.file);
      if (existing) {
        existing.weight += 1;
      } else {
        index[word].push({ file: doc.file, weight: 1 });
      }
    }
  }

  // 排序
  for (const word in index) {
    index[word].sort((a, b) => b.weight - a.weight);
  }

  return index;
}

/**
 * 生成 llms.txt
 */
function generateLlmsTxt(docs) {
  // 按分类分组
  const categories = {
    css: { name: 'CSS 文档', docs: [] },
    javascript: { name: 'JavaScript 文档', docs: [] },
    browser: { name: '浏览器机制文档', docs: [] },
    go: { name: 'Go 语言文档', docs: [] },
  };

  for (const doc of docs) {
    if (categories[doc.category]) {
      categories[doc.category].docs.push(doc);
    }
  }

  let output = `# /llms.txt

> 本文档库为前端开发学习笔记，按技术栈分类，包含 CSS、JavaScript、浏览器机制等核心知识点。

## 目录结构

\`\`\`
minemine/
├── css/           # CSS 相关文档
├── javascript/    # JavaScript 相关文档
├── browser/       # 浏览器机制文档
├── go/            # Go 语言文档（新增）
├── demos/         # 示例代码
└── scripts/       # 工具脚本
\`\`\`

`;

  // 按分类输出
  for (const [key, cat] of Object.entries(categories)) {
    if (cat.docs.length === 0) {
      output += `---\n\n## ${cat.name}\n\n> 待添加\n\n`;
      continue;
    }

    output += `---\n\n## ${cat.name}\n\n`;

    for (const doc of cat.docs) {
      output += `### ${doc.title}\n`;
      output += `- 文件: ${doc.file}\n`;
      output += `- 摘要: ${doc.summary}\n`;
      if (doc.titles.length > 1) {
        output += `- 章节: ${doc.titles.slice(1, 5).map(t => t.text).join(' → ')}\n`;
      }
      output += '\n';
    }
  }

  output += `---\n\n## 关键词索引\n\n`;
  output += `详见 keywords.json\n`;

  return output;
}

// ========== 主函数 ==========

function main() {
  console.log('🔍 扫描文档...');
  const docs = scanDocuments();
  console.log(`   找到 ${docs.length} 篇文档`);

  console.log('📊 构建索引...');
  const invertedIndex = buildInvertedIndex(docs);

  console.log('📝 生成文件...');

  // 生成 llms.txt
  const llmsTxt = generateLlmsTxt(docs);
  fs.writeFileSync(CONFIG.outputFile.llmsTxt, llmsTxt, 'utf-8');
  console.log(`   ✓ ${CONFIG.outputFile.llmsTxt}`);

  // 生成 search-index.json
  fs.writeFileSync(
    CONFIG.outputFile.searchIndex,
    JSON.stringify({ docs, index: invertedIndex }, null, 2),
    'utf-8'
  );
  console.log(`   ✓ ${CONFIG.outputFile.searchIndex}`);

  // 生成 keywords.json（关键词到文档的映射）
  const keywordMap = {};
  for (const doc of docs) {
    for (const word of doc.keywords) {
      if (!keywordMap[word]) keywordMap[word] = [];
      if (!keywordMap[word].includes(doc.file)) {
        keywordMap[word].push(doc.file);
      }
    }
  }
  fs.writeFileSync(
    CONFIG.outputFile.keywords,
    JSON.stringify(keywordMap, null, 2),
    'utf-8'
  );
  console.log(`   ✓ ${CONFIG.outputFile.keywords}`);

  console.log('\n✅ 索引生成完成！');
  console.log(`   - 文档数: ${docs.length}`);
  console.log(`   - 关键词数: ${Object.keys(keywordMap).length}`);
}

main();
