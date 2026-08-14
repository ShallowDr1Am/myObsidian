# antd Table 单元格 overflow 与 inline-flex / block-flex 的交互

## 背景

antd v4 Table 的普通单元格（td）默认样式：

```css
td {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

固定列（`td.ant-table-cell-fix-left` / `td.ant-table-cell-fix-right`）例外，重置了这些属性：

```css
td.ant-table-cell-fix-left,
td.ant-table-cell-fix-right {
  overflow: visible;
  text-overflow: unset;
}
```

## 现象

当单元格内容是一个 flex 容器（如 `display: flex` / `inline-flex`）时，`block` 属性的不同取值会导致完全不同的溢出行为。

---

## 两种模式对比

### 模式一：`block={false}` — inline-flex

容器渲染为 `display: inline-flex`，是**行内元素**。

单元格的 `text-overflow: ellipsis` 直接作用于整行内容末尾，容器的 `+N` badge 被省略号覆盖。

```
┌─── 单元格 (width: 220px, overflow: hidden) ──────────────┐
│                                                           │
│  ┌ inline-flex ──────────────────────────────────────┐    │
│  │ [👤张三]  [👤李四]  [👤王五]  [👤赵六]  [+3]  │···│ ← 单元格 ellipsis
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  实际可见： [👤张三] [👤李四] [👤王五] [+3]...           │
│                                     ↑                     │
│                            +N badge 后面出现省略号         │
└───────────────────────────────────────────────────────────┘
```

### 模式二：`block={true}` — block flex

容器渲染为 `display: flex`（block 级），撑满单元格宽度。

单元格的 `text-overflow` **对 block 子元素不生效**。溢出控制权交给 flex 容器内部：

```
┌─── 单元格 (width: 220px, overflow: hidden) ──────────────┐
│                                                           │
│  ┌ flex 容器 (width: 100%) ──────────────────────────┐    │
│  │                                                    │    │
│  │  [👤张三]  [👤李四...]  [👤王五...]  [+3]        │    │
│  │  flex-0     flex-1         flex-1        flex-0    │    │
│  │  不缩       挤压+省略号    挤压+省略号    不缩     │    │
│  │                                                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                           │
│  实际可见： [👤张三] [👤李四...] [+3]                     │
│                          ↑         ↑                      │
│                    用户名省略号  +N badge 完整可见         │
└───────────────────────────────────────────────────────────┘
```

---

## 关键差异

| 属性 | `block={false}` | `block={true}` |
|---|---|---|
| 容器类型 | `inline-flex` | `flex`（block） |
| 省略号施加者 | **单元格** `text-overflow` | **flex 子项**（用户名）自身的 `text-overflow` |
| 省略号位置 | 整行末尾 → 盖在 `+N` 后面 | 只在用户名过长时出现在用户名上 |
| `+N` badge | 被裁掉，后面跟 `...` | `flex-shrink: 0`，始终完整可见 |

---

## 涉及的实际样式

### 单元格样式（`style.less`）

```less
.ant-table-tbody > tr > td {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 固定列例外
td.ant-table-cell-fix-left,
td.ant-table-cell-fix-right {
  overflow: visible;
  text-overflow: unset;
}
```

### flex 容器样式（`dc-users-noId/index.less`）

```less
.dc-users-no-id {
  align-items: center;
  // block={true} → display: flex（撑满）
  // block={false} → display: inline-flex（内容撑开）

  &__display-username {
    flex-shrink: 1;          // 允许挤压 → 用户名过长时省略
    overflow: hidden;
    display: flex;

    &__username {
      flex-shrink: 1;
      overflow: hidden;
      text-overflow: ellipsis; // 用户名自身的省略号
      white-space: nowrap;
    }
  }

  &__hidden-counter {
    flex-shrink: 0;          // 绝不压缩 → +N badge 始终可见
  }
}
```

---

## 核心结论

> **inline-flex 容器的溢出由父级单元格 `text-overflow: ellipsis` 控制，省略号出现在整行末尾。**
>
> **block flex 容器的溢出由自身 flex 子项的 `text-overflow` 控制，`flex-shrink: 0` 的子项始终完整可见。**

适用场景：antd Table 中任何包含 flex 容器的列，如用户列表、标签列表、产品线列表等。如果容器末尾的 badge/标签被省略号盖住，改 `block={true}` 即可。