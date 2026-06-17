# BFC 块格式化上下文

## 什么是 BFC

BFC（Block Formatting Context，块格式化上下文）是 CSS 中一个独立的渲染区域，内部元素的布局不会影响外部元素。

可以把 BFC 想象成一个**隔离的容器**，容器内部的元素无论怎么布局，都不会影响到外面的元素。

---

## BFC 可视化演示

### 特性一：阻止 Margin 折叠

同一 BFC 内相邻块级元素 margin 折叠取较大值；不同 BFC 之间不会折叠

<div style="background:#0f0f1a;border-radius:12px;padding:24px 28px;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#e8e6e3;max-width:780px;">
  <div style="display:flex;gap:20px;align-items:flex-start;">
    <div style="flex:1;">
      <div style="text-align:center;font-size:14px;font-weight:700;color:#EF233C;margin-bottom:10px;">❌ 同一 BFC</div>
      <div style="background:rgba(43,45,66,0.3);border:2px solid #3a3d52;border-radius:8px;padding:14px;">
        <div style="background:#2B2D42;border:2px solid #8D99AE;border-radius:6px;padding:10px;text-align:center;font-size:13px;color:#EDF2F4;font-weight:600;">Box 1 · margin-bottom: 20px</div>
        <div style="display:flex;flex-direction:column;align-items:center;padding:2px 0;">
          <div style="width:3px;height:20px;background:#EF233C;border-radius:2px;"></div>
        </div>
        <div style="text-align:center;font-size:12px;color:#EF233C;font-weight:700;">30px（取较大值）</div>
        <div style="display:flex;flex-direction:column;align-items:center;padding:2px 0;">
          <div style="width:3px;height:20px;background:#EF233C;border-radius:2px;"></div>
        </div>
        <div style="background:#2B2D42;border:2px solid #8D99AE;border-radius:6px;padding:10px;text-align:center;font-size:13px;color:#EDF2F4;font-weight:600;">Box 2 · margin-top: 30px</div>
      </div>
      <div style="text-align:center;margin-top:8px;font-size:13px;color:#EF233C;font-weight:700;">期望 50px，实际 30px</div>
    </div>
    <div style="display:flex;align-items:center;font-size:28px;color:#EB5E28;padding-top:60px;">→</div>
    <div style="flex:1;">
      <div style="text-align:center;font-size:14px;font-weight:700;color:#2DC653;margin-bottom:10px;">✅ 不同 BFC</div>
      <div style="background:rgba(43,45,66,0.3);border:2px solid #3a3d52;border-radius:8px;padding:14px;">
        <div style="background:#2B2D42;border:2px solid #8D99AE;border-radius:6px;padding:10px;text-align:center;font-size:13px;color:#EDF2F4;font-weight:600;">Box 1 · margin-bottom: 20px</div>
        <div style="display:flex;flex-direction:column;align-items:center;padding:2px 0;">
          <div style="width:3px;height:12px;background:#2DC653;border-radius:2px;"></div>
        </div>
        <div style="text-align:center;font-size:12px;color:#2DC653;font-weight:700;">20px</div>
        <div style="display:flex;flex-direction:column;align-items:center;padding:2px 0;">
          <div style="width:3px;height:12px;background:#2DC653;border-radius:2px;"></div>
        </div>
        <div style="border:3px dashed #2DC653;border-radius:8px;padding:18px 8px 8px;position:relative;background:rgba(45,198,83,0.04);">
          <div style="position:absolute;top:-12px;left:12px;background:#0f0f1a;color:#2DC653;font-size:11px;font-weight:800;padding:2px 10px;border-radius:3px;border:2px solid #2DC653;">display: flow-root</div>
          <div style="display:flex;flex-direction:column;align-items:center;padding:2px 0;">
            <div style="width:3px;height:16px;background:#2DC653;border-radius:2px;"></div>
          </div>
          <div style="text-align:center;font-size:12px;color:#2DC653;font-weight:700;">30px</div>
          <div style="display:flex;flex-direction:column;align-items:center;padding:2px 0;">
            <div style="width:3px;height:16px;background:#2DC653;border-radius:2px;"></div>
          </div>
          <div style="background:#2B2D42;border:2px solid #8D99AE;border-radius:6px;padding:10px;text-align:center;font-size:13px;color:#EDF2F4;font-weight:600;">Box 2 · margin-top: 30px</div>
        </div>
      </div>
      <div style="text-align:center;margin-top:8px;font-size:13px;color:#2DC653;font-weight:700;">间距 = 50px ✅</div>
    </div>
  </div>
  <div style="margin-top:14px;background:rgba(43,45,66,0.5);border-radius:6px;padding:10px 16px;font-family:'Fira Code','Courier New',monospace;font-size:12px;color:#8D99AE;line-height:1.7;">
    &lt;div class="box1"&gt;Box 1&lt;/div&gt;<br/>
    &lt;div style="<span style="color:#2DC653">display:flow-root</span>"&gt;<br/>
    &nbsp;&nbsp;&lt;div class="box2"&gt;Box 2&lt;/div&gt;<br/>
    &lt;/div&gt;
  </div>
</div>

### 特性二：包含浮动元素（清除浮动）

浮动子元素脱离文档流导致父元素高度塌陷；BFC 可以包含浮动元素

<div style="background:#0f0f1a;border-radius:12px;padding:24px 28px;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#e8e6e3;max-width:780px;">
  <div style="display:flex;gap:20px;align-items:flex-start;">
    <div style="flex:1;">
      <div style="text-align:center;font-size:14px;font-weight:700;color:#EF233C;margin-bottom:10px;">❌ 高度塌陷</div>
      <div style="border:2px solid #EF233C;border-radius:8px;background:rgba(43,45,66,0.2);min-height:4px;padding:0;">
        <div style="float:left;width:100%;background:#2B2D42;border:2px solid #8D99AE;border-radius:6px;padding:14px;text-align:center;font-size:13px;color:#EDF2F4;font-weight:600;">float: left · 100px × 100px</div>
      </div>
      <div style="clear:both;"></div>
      <div style="text-align:center;margin-top:10px;font-size:13px;color:#EF233C;font-weight:700;">父元素 height: 0（塌陷）</div>
    </div>
    <div style="display:flex;align-items:center;font-size:28px;color:#EB5E28;padding-top:30px;">→</div>
    <div style="flex:1;">
      <div style="text-align:center;font-size:14px;font-weight:700;color:#2DC653;margin-bottom:10px;">✅ BFC 包含浮动</div>
      <div style="border:3px dashed #2DC653;border-radius:8px;padding:18px 8px 8px;background:rgba(45,198,83,0.04);position:relative;">
        <div style="position:absolute;top:-12px;left:12px;background:#0f0f1a;color:#2DC653;font-size:11px;font-weight:800;padding:2px 10px;border-radius:3px;border:2px solid #2DC653;">display: flow-root</div>
        <div style="float:left;width:100%;background:#2B2D42;border:2px solid #8D99AE;border-radius:6px;padding:14px;text-align:center;font-size:13px;color:#EDF2F4;font-weight:600;">float: left · 100px × 100px</div>
      </div>
      <div style="clear:both;"></div>
      <div style="text-align:center;margin-top:10px;font-size:13px;color:#2DC653;font-weight:700;">父元素包含浮动子元素 ✅</div>
    </div>
  </div>
  <div style="margin-top:14px;background:rgba(43,45,66,0.5);border-radius:6px;padding:10px 16px;font-family:'Fira Code','Courier New',monospace;font-size:12px;color:#8D99AE;line-height:1.7;">
    .parent { <span style="color:#2DC653">display: flow-root;</span> }<br/>
    /* BFC 包含浮动子元素，高度不再塌陷 */
  </div>
</div>

### 特性三：阻止浮动元素覆盖

BFC 区域不会与浮动元素重叠，可实现两栏自适应布局

<div style="background:#0f0f1a;border-radius:12px;padding:24px 28px;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#e8e6e3;max-width:780px;">
  <div style="display:flex;gap:20px;align-items:flex-start;">
    <div style="flex:1;">
      <div style="text-align:center;font-size:14px;font-weight:700;color:#EF233C;margin-bottom:10px;">❌ 浮动覆盖内容</div>
      <div style="height:100px;border-radius:8px;overflow:hidden;position:relative;border:2px solid #3a3d52;">
        <div style="position:absolute;left:0;top:0;width:100px;height:100px;background:#3a1a0a;border-right:2px solid #EB5E28;border-bottom:2px solid #EB5E28;border-radius:6px;text-align:center;line-height:100px;font-size:13px;color:#EB5E28;font-weight:700;">float: left</div>
        <div style="position:absolute;left:0;top:0;width:100%;height:100px;background:rgba(43,45,66,0.6);border:2px solid #EF233C;border-radius:6px;text-align:center;line-height:100px;font-size:13px;color:#EF233C;font-weight:600;opacity:0.7;">普通块级元素（被覆盖）</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;font-size:28px;color:#EB5E28;padding-top:30px;">→</div>
    <div style="flex:1;">
      <div style="text-align:center;font-size:14px;font-weight:700;color:#2DC653;margin-bottom:10px;">✅ BFC 两栏布局</div>
      <div style="height:100px;border-radius:8px;position:relative;border:2px solid #3a3d52;">
        <div style="position:absolute;left:0;top:0;width:100px;height:100px;background:#3a1a0a;border-right:2px solid #EB5E28;border-bottom:2px solid #EB5E28;border-radius:6px;text-align:center;line-height:100px;font-size:13px;color:#EB5E28;font-weight:700;">float: left</div>
        <div style="position:absolute;left:108px;top:0;right:0;height:100px;background:rgba(43,45,66,0.6);border:2px solid #2DC653;border-radius:6px;text-align:center;line-height:100px;font-size:13px;color:#2DC653;font-weight:600;">BFC 自适应剩余空间</div>
        <div style="position:absolute;left:108px;top:-14px;background:#0f0f1a;color:#2DC653;font-size:10px;font-weight:800;padding:2px 8px;border-radius:3px;border:2px solid #2DC653;">display: flow-root</div>
      </div>
    </div>
  </div>
  <div style="margin-top:14px;background:rgba(43,45,66,0.5);border-radius:6px;padding:10px 16px;font-family:'Fira Code','Courier New',monospace;font-size:12px;color:#8D99AE;line-height:1.7;">
    &lt;div style="<span style="color:#2DC653">float:left</span>;width:200px"&gt;左侧导航&lt;/div&gt;<br/>
    &lt;div style="<span style="color:#2DC653">display:flow-root</span>"&gt;右侧内容自适应&lt;/div&gt;
  </div>
</div>

### 触发 BFC 的条件

满足以下任一条件即可创建 BFC

<div style="background:#0f0f1a;border-radius:12px;padding:24px 28px;font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#e8e6e3;max-width:780px;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <div style="background:rgba(43,45,66,0.4);border:2px solid #2B2D42;border-radius:8px;padding:14px 18px;">
      <div style="font-size:15px;font-weight:700;color:#EB5E28;margin-bottom:6px;">float</div>
      <div style="font-size:13px;color:#CCC5B9;"><code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">left</code> <code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">right</code>（不是 none）</div>
    </div>
    <div style="background:rgba(43,45,66,0.4);border:2px solid #2B2D42;border-radius:8px;padding:14px 18px;">
      <div style="font-size:15px;font-weight:700;color:#EB5E28;margin-bottom:6px;">overflow</div>
      <div style="font-size:13px;color:#CCC5B9;"><code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">hidden</code> <code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">auto</code> <code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">scroll</code></div>
    </div>
    <div style="background:rgba(43,45,66,0.4);border:2px solid #2B2D42;border-radius:8px;padding:14px 18px;">
      <div style="font-size:15px;font-weight:700;color:#EB5E28;margin-bottom:6px;">display</div>
      <div style="font-size:13px;color:#CCC5B9;"><code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">inline-block</code> <code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">flex</code> <code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">grid</code> ...</div>
    </div>
    <div style="background:rgba(43,45,66,0.4);border:2px solid #2B2D42;border-radius:8px;padding:14px 18px;">
      <div style="font-size:15px;font-weight:700;color:#EB5E28;margin-bottom:6px;">position</div>
      <div style="font-size:13px;color:#CCC5B9;"><code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">absolute</code> <code style="background:rgba(235,94,40,0.12);color:#EB5E28;padding:1px 6px;border-radius:3px;font-size:12px;">fixed</code></div>
    </div>
    <div style="grid-column:1/3;background:rgba(45,198,83,0.06);border:2px solid #2DC653;border-radius:8px;padding:14px 18px;text-align:center;">
      <div style="font-size:15px;font-weight:700;color:#2DC653;margin-bottom:4px;">⭐ 推荐方式</div>
      <div style="font-size:13px;color:#CCC5B9;"><code style="background:rgba(45,198,83,0.12);color:#2DC653;padding:2px 8px;border-radius:3px;font-size:13px;">display: flow-root</code> — 专为创建 BFC 设计，无副作用</div>
    </div>
  </div>
</div>

---

## 触发 BFC 的条件

满足以下任一条件即可创建 BFC：

| 属性 | 值 |
|------|-----|
| `float` | `left` / `right`（不是 `none`） |
| `overflow` | `hidden` / `auto` / `scroll`（不是 `visible`） |
| `display` | `flow-root` / `inline-block` / `table-cell` / `flex` / `grid` / `inline-flex` / `inline-grid` |
| `position` | `absolute` / `fixed`（不是 `static` / `relative`） |

**推荐方式**：使用 `display: flow-root`，这是专门为创建 BFC 设计的，没有副作用：

```css
.container {
  display: flow-root;
}
```

---

## BFC 的特性与作用

### 1. 阻止 margin 折叠

同一个 BFC 内的相邻块级元素会发生 margin 折叠，但**不同 BFC 之间不会**。

```html
<!-- ❌ margin 折叠：间距为 20px（取较大值） -->
<div style="margin-bottom: 20px;">box1</div>
<div style="margin-top: 20px;">box2</div>

<!-- ✅ 阻止折叠：间距为 40px -->
<div style="margin-bottom: 20px;">box1</div>
<div style="display: flow-root;">
  <div style="margin-top: 20px;">box2</div>
</div>
```

### 2. 包含浮动元素（清除浮动）

BFC 可以包含浮动元素，防止父元素高度塌陷：

```html
<!-- ❌ 父元素高度塌陷：浮动元素脱离文档流，父元素高度为 0 -->
<div style="border: 1px solid red;">
  <div style="float: left; width: 100px; height: 100px;"></div>
</div>

<!-- ✅ 创建 BFC 后，父元素包含浮动子元素 -->
<div style="border: 1px solid red; display: flow-root;">
  <div style="float: left; width: 100px; height: 100px;"></div>
</div>
```

### 3. 阻止浮动元素覆盖

BFC 区域不会与浮动元素重叠，可实现两栏自适应布局：

```html
<!-- 左侧固定宽度浮动，右侧 BFC 自适应 -->
<div style="float: left; width: 200px;">左侧导航</div>
<div style="display: flow-root;">右侧内容自适应</div>
```

---

## 常见应用场景总结

| 场景 | 方案 |
|------|------|
| 清除浮动（父元素高度塌陷） | 父元素设置 `overflow: hidden` 或 `display: flow-root` |
| 阻止 margin 折叠 | 将其中一个元素包裹在 BFC 容器中 |
| 两栏自适应布局 | 左侧浮动 + 右侧 BFC |

---

## 相关笔记

- [[文档流]]
- [[CSS 盒模型]]
