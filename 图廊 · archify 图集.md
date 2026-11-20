# 图廊 · archify 图集

> 🧭 用法：PNG 是笔记内联预览；点 HTML 链接在 **Obsidian 内部**打开交互版（缩放 / 切主题 / 导出 / 路径高亮）。
> 📌 **收敛约定**：图**文件**收敛在 `assets/archify/` 单目录，本篇是**总索引**（全量嵌图）；各知识点笔记**在对应小节就地内联嵌相关图**（PNG 与交互版链接）。新图三步：先把文件放进目录，再在本篇加小节，最后在对应知识点笔记里嵌图。
> 依赖插件：**HTML Reader Plus 1.0.22**。它忠实渲染并执行 HTML 内脚本——只打开可信文件（本目录全部为 archify 自产）。
> ⚠️ 该插件不支持 `![[xxx.html]]` 内联交互嵌入（上游就没有此能力），所以采用「PNG 内联加 HTML 点击打开」组合。

## 1. 工单 12 步全链路（sequence）

![[gongdan-chain.png]]

👉 交互版：[[gongdan-chain.html]] · 来源：[[07-技术TODO]] L★ · 技能树 M4 蓝本

## 2. 工单状态机（lifecycle）

![[gongdan-state.png]]

👉 交互版：[[gongdan-state.html]] · operating 状态的自环表示自愈；⚠️ CAS（比较并交换：值没变才写回）写回部分仍是待验证的预测

## 3. 异步方式光谱（architecture）

![[async-spectrum.png]]

👉 交互版：[[async-spectrum.html]] · infra 5 种异步机制 · 指标链路是「先拉后推」的接力 · 详见 [[异步选型 — 轮询 vs MQ]]

## 4. 轮询 vs MQ 选型决策（workflow）

![[poll-vs-mq.png]]

👉 交互版：[[poll-vs-mq.html]] · 三个独立触发器：延迟 / 速率 / 拓扑 · 详见 [[异步选型 — 轮询 vs MQ]]

## 5. 一条条件查询：✅ 最佳实践实现（sequence）

![[bestpractice-query.png]]

👉 交互版：[[bestpractice-query.html]] · 与 infra 老 Example 路径同题对照（[[03-POJO 与 DAO 层]]§五）· ✅ 规范清单与对照数字在图卡片

## 6. 三阶段生成模型（architecture）

![[three-phase-model.png]]

👉 交互版：[[three-phase-model.html]] · 编译期/启动期/运行时三块 · 纠正 03 自检的三类错误 · 详解 [[框架认知 — 三阶段生成模型]] · **懵的话先读 §7 故事版**

## 7. 一行 selectById(1) 故事版（sequence）

![[selectbyid-story.png]]

👉 交互版：[[selectbyid-story.html]] · 一行代码穿过三阶段 · 卡片里有三个「不可能」与生活类比 · 认知笔记§0 置顶

## 8. @Autowired List<T>：仓库、装零件、排班表（sequence）

![[autowired-list-story.png]]

👉 交互版：[[autowired-list-story.html]] · 16 个 CvmEvent 实现的全旅程：先全部注册进 Spring 容器，@Autowired 一次全拿，toMap 排成「排班表」，运行时按类型查 · 白话三句在卡片

## 9. 不用 vs 用了 @Autowired（architecture 对照）

![[autowired-contrast.png]]

👉 交互版：[[autowired-contrast.html]] · 左边是手工装配（你当管理员），右边是 Spring 装配（你只写领料单）· 差异表与验证在卡片

## 10. spring.factories：发现与编排（sequence）

![[factories.png]]

👉 交互版：[[factories.html]] · ① 扫类路径收清单 ② 过滤排序后注册 · 三问三答与实测数字在卡片

## 维护：再生成与同步

源产物在 `podman/.archify/`（archify finalize 输出）。更新一张图分三步：

```bash
A="$HOME/Desktop/learn/minemine/assets/archify"
# ① 拷 HTML 入库
cp /Users/didi/Desktop/learn/podman/.archify/<目录>/<名字>.html "$A/"
# ② 重截 PNG（高度按图调整：sequence 1300 / 其余 980~1100）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --force-device-scale-factor=2 --window-size=1440,1300 \
  --virtual-time-budget=10000 --screenshot="$A/<名字>.png" "file://$A/<名字>.html"
# ③ obsidian-git 提交（HTML+PNG 一起同步）
```

## 相关笔记

[[后端框架技能树TODO]] · [[异步选型 — 轮询 vs MQ]] · [[07-技术TODO]]