# LeetCode 复盘与语法错题本

> Hot 100 训练记录 · 训练系统：`../podman/leetcode-hot100/`
> 约定：**精简**——语法条目 ≤5 行（错→对+一句原因），复盘每题 ≤6 行，不贴长代码。

## 语法错题

**001 · 11-19 · JS 串进 Java**（Day1）
`let j`→`int j`，for 三段用分号；`===`→`==`；数组没有 add → `return new int[]{i,j}`
口诀：声明带类型，for 用分号，相等两道杠，数组没有 add

**002 · 11-19 · 两遍哈希自配对**（Day1）
`if(map.get(k))`→`containsKey`：if 只认 boolean；两遍法必须 `j!=null && j!=i`，否则 [3,2,4]/6 → [0,0]；方法末尾要有 return
一遍「先查再存」天然免自配对，更稳

**003 · 11-19 · int vs Integer**（Day1）
Java 无 `Int`；泛型只收 `Integer`；int 接 get 键缺失时 null 拆箱 NPE → 用 Integer 接先判 null；Integer== 比引用（200 false / 127 碰巧 true）→ 用 equals

## 复盘

**Day 001 · 1. 两数之和**（11-19 · 哈希 · 简单）
我的：暴力 O(n²) → 两遍哈希（踩 002/003）；目标：一遍「先查再存」O(n)
差距：没想到哈希把查找降 O(1)；JS 肌肉记忆
自评(1-5)：__ · 复习：11-20 / 11-22 / 11-26
文件：`../podman/leetcode-hot100/days/day-001-two-sum/`