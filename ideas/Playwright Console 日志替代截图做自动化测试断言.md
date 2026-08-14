---
tags:
  - idea
  - testing
  - playwright
  - automation
date: 2026-08-10
---

# Playwright 自动化测试：用 Console 日志替代截图断言

## 灵感来源

讨论 Playwright 和 `console.log/warn/error` 日志级别时产生的想法。

## 核心思路

传统 E2E 测试重度依赖**截图 + 人眼判断**，但截图存在以下问题：

| 截图 | Console 日志 |
|---|---|
| 几百ms-几秒/张 | 毫秒级 |
| 需要人眼看或用 OCR | 直接字符串匹配，可断言 |
| CI 只能存下来事后翻 | 自动通过/失败 |
| 每张几十KB-几MB | 几乎为零存储 |

## 方案

**业务代码**中养成日志分级习惯：

```js
// 关键状态变更
console.info("[Checkout] 订单提交成功", { orderId: "xxx" });

// 异常路径
console.warn("[Checkout] 库存不足，降级为预售", { sku: "A001" });

// 真正出问题
console.error("[Checkout] 支付接口超时", { paymentId: "xxx" });
```

**Playwright 侧**自动收集并断言：

```python
page.on("console", lambda msg: ...)  # msg.type: log | info | warning | error | debug

# CI 中断言 0 error
assert len(errors) == 0

# 监控 warning 数量
assert len(warnings) <= 3
```

## 价值

- 速度快（毫秒 vs 秒级）
- 全自动可断言，CI 直接通过/失败
- 截图只在**视觉回归测试**时才用，不是万能调试工具
- 形成一套"日志驱动测试"体系

## 待探索

- 是否需要约定统一的日志格式（如 `[Module] 描述`）方便 Playwright 侧分类
- 生产环境是否需要保留 info/warn 日志，还是仅测试环境启用