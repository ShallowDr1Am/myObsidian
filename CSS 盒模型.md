# CSS 盒模型

每个 HTML 元素都被看成一个矩形盒子（Box Model），由四个部分组成：**content、padding、border、margin**。

---

## 两种盒模型

### 标准盒模型（box-sizing: content-box）

默认模式。`width` 和 `height` 只包含 **content**：

```
┌─────────────────────────────────────────┐
│                 margin                  │
│  ┌──────────────────────────────────┐   │
│  │              border              │   │
│  │  ┌───────────────────────────┐   │   │
│  │  │          padding          │   │   │
│  │  │  ┌───────────────────┐    │   │   │
│  │  │  │     content       │    │   │   │
│  │  │  │   width × height  │    │   │   │
│  │  │  └───────────────────┘    │   │   │
│  │  └───────────────────────────┘   │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

实际占据宽度 = margin-left + border-left + padding-left + width + padding-right + border-right + margin-right
```

### IE 盒模型（box-sizing: border-box）

`width` 和 `height` 包含 **content + padding + border**：

```
┌─────────────────────────────────────────┐
│                 margin                  │
│  ┌──────────────────────────────────┐   │
│  │       width × height             │   │
│  │  ┌───────────────────────────┐   │   │
│  │  │          padding          │   │   │
│  │  │  ┌───────────────────┐    │   │   │
│  │  │  │     content       │    │   │   │
│  │  │  └───────────────────┘    │   │   │
│  │  └───────────────────────────┘   │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

实际占据宽度 = margin-left + width + margin-right
（width 已包含 padding 和 border）
```

---

## 两种模型对比

| 特性 | content-box | border-box |
|------|-------------|------------|
| width 包含 content | ✅ | ❌（包含 content + padding + border）|
| 计算实际宽度 | 需要手动加 padding 和 border | width 就是实际占用宽度 |
| 适用场景 | 需要精确控制内容区域 | 更直观，布局更方便 |

---

## 实际开发建议

**推荐全局设置 `border-box`**：

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}
```

好处：
- 设置 `width: 100px` 后，无论怎么加 padding 和 border，元素总宽度始终是 100px
- 避免元素超出父容器
- 大多数 UI 框架（如 Bootstrap、Tailwind）默认使用 `border-box`

---

## margin 折叠（Collapse）

垂直方向相邻的块级元素，外边距会**重叠**（取较大值）：

```css
.box1 { margin-bottom: 20px; }
.box2 { margin-top: 30px; }

/* 两个盒子间距为 30px，不是 50px */
```

常见触发场景：
- 相邻兄弟元素
- 父元素与第一个/最后一个子元素
- 空块级元素自身

解决方法 → 详见 [[BFC 块格式化上下文]]

---

## 相关笔记

- [[文档流]]
- [[BFC 块格式化上下文]]
