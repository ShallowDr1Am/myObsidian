# Set、Map 与数组方法 map、forEach

---

## 一、Map

Map 是键值对集合，键和值可以是任意类型。

### 基本特性

- 通过 `get()` 方法获取值
- 可通过 `for...of` 遍历
- 存储按插入顺序排列
- 键如果是对象，实际保存的是**引用地址**而非具体值

### 基本用法

```javascript
const m = new Map();

const obj = { name: 'test' };
m.set(obj, 'hello');
m.set('key', 'world');

m.get(obj);     // 'hello'
m.has('key');   // true
m.size;         // 2

m.delete('key');
m.clear();
```

### 相等性规则

Map 的 `get` 根据 `SameValueZero` 算法判断键的相等性：

```javascript
const m = new Map();
const a = 0 / '';     // NaN
const b = 0 / '';     // NaN
const pz = +0;
const nz = -0;

a === b;    // false（NaN !== NaN）
pz === nz;  // true（+0 === -0）

m.set(a, 'foo');
m.set(pz, 'bar');

m.get(b);    // 'foo'（Map 中 NaN === NaN）
m.get(nz);   // 'bar'（Map 中 +0 === -0）
```

| 比较规则 | `===` 运算符 | Map 键比较 |
|----------|-------------|-----------|
| `NaN === NaN` | `false` | `true` |
| `+0 === -0` | `true` | `true` |
| 对象比较 | 引用相等 | 引用相等 |

---

## 二、Set

Set 是值的集合，值具有**唯一性**。

### 基本特性

- 值唯一，常用于数组去重
- 可通过 `for...of` 遍历
- 没有 `get()` 方法（只有值，没有键）

### 基本用法

```javascript
const s = new Set([1, 2, 3, 3, 4]);

s.size;            // 4（自动去重）
s.has(3);          // true
s.add(5);
s.delete(1);

// 数组去重
const arr = [1, 2, 2, 3, 3, 4];
const unique = [...new Set(arr)];  // [1, 2, 3, 4]
```

---

## 三、Map vs Set 对比

| 特性 | Map | Set |
|------|-----|-----|
| 存储内容 | 键值对 | 值的集合 |
| 获取值 | `get(key)` | 无法直接获取 |
| 唯一性 | 键唯一 | 值唯一 |
| 典型用途 | 数据存储/映射 | 去重/成员判断 |
| 遍历 | `for...of` | `for...of` |
| 顺序 | 按插入顺序 | 按插入顺序 |

---

## 四、WeakMap 与 Map

### 区别

| 特性 | Map | WeakMap |
|------|-----|---------|
| 键类型 | 任意值 | 仅限对象 |
| 引用方式 | 强引用 | 弱引用 |
| 遍历 | 支持 `keys()`/`values()`/`entries()` | 不支持 |
| `clear()` | 支持 | 不支持 |
| 垃圾回收 | 不受影响 | 键对象无其他引用时自动回收 |

### 为什么 WeakMap 不能遍历？

弱引用意味着对象可能随时被垃圾回收，前一秒取到的值下一秒可能就不存在了，因此无法保证遍历的一致性。

### 可用方法

WeakMap 只有 4 个方法：`get`、`set`、`has`、`delete`。

### 典型用途

```javascript
// DOM 元素事件绑定
const wm = new WeakMap();
const element = document.getElementById('btn');

wm.set(element, {
  onClick: () => console.log('clicked'),
  data: { count: 0 }
});

// element 被移除后，关联数据自动被垃圾回收，不会内存泄漏
```

---

## 五、数组方法：forEach

`forEach()` 对数组每个元素执行提供的函数。

### 特点

1. **没有返回值**（返回 `undefined`）

```javascript
const a = [1, 2, 3];
const b = a.forEach(item => item * 2);
console.log(b); // undefined
```

2. **无法中断执行**（不能用 `break`，需要中断请用 `for...of` 或 `some`/`every`）

3. **会跳过数组空位**

```javascript
const a = [null, , undefined];

// for 循环：不跳过空位
for (let i = 0; i < a.length; i++) {
  console.log(a[i]); // null, undefined, undefined
}

// forEach：跳过空位
a.forEach(item => {
  console.log(item); // null, undefined（跳过了空位）
});
```

4. **修改引用类型的属性会生效，但重新赋值不生效**

```javascript
// ❌ 重新赋值不生效
const a = [1, '1', { num: 1 }, true];
a.forEach(item => { item = 2; });
console.log(a); // [1, '1', { num: 1 }, true]

// ✅ 修改引用类型的属性生效
const b = [1, '1', { num: 1 }, true];
b.forEach(item => { item.num = 2; });
console.log(b); // [1, '1', { num: 2 }, true]
```

---

## 六、数组方法：map

`map()` 对每个元素执行函数，**返回一个新数组**，不改变原数组。

### 特点

1. **返回新数组，不修改原数组**

```javascript
const a = [1, 2, 3, 4, 5];
const b = a.map(item => item * 2);

console.log(a); // [1, 2, 3, 4, 5]
console.log(b); // [2, 4, 6, 8, 10]
```

2. **无法中断执行**（同 `forEach`）

3. **会跳过数组空位**（同 `forEach`）

---

## 七、map vs forEach 对比

| 特性 | map | forEach |
|------|-----|---------|
| 返回值 | 新数组 | `undefined` |
| 是否修改原数组 | 否 | 否（但可修改引用属性） |
| 可链式调用 | 是（返回数组） | 否（返回 `undefined`） |
| 可中断 | 否 | 否 |
| 跳过空位 | 是 | 是 |
| 适用场景 | 数据转换 | 副操作（打印、存储） |

> 💡 **选择建议**：需要返回新数组用 `map`，只需遍历执行操作用 `forEach`。

### 链式调用

`map` 返回数组，可以继续链式调用其他数组方法；`forEach` 返回 `undefined`，无法链式调用。

```javascript
// ✅ map 可以链式调用
const result = [1, 2, 3, 4, 5]
  .map(x => x * 2)      // [2, 4, 6, 8, 10]
  .filter(x => x > 5)   // [6, 8, 10]
  .reduce((a, b) => a + b, 0);  // 24

// ❌ forEach 无法链式调用
[1, 2, 3]
  .forEach(x => x * 2)  // 返回 undefined
  .filter(x => x > 1);  // TypeError: Cannot read property 'filter' of undefined
```

### 常见错误示例

```javascript
// ❌ 错误：想转换数据但用了 forEach + 手动 push
const doubled = [];
arr.forEach(item => doubled.push(item * 2));

// ✅ 正确：直接用 map
const doubled = arr.map(item => item * 2);

// ❌ 错误：用 map 但不用返回值（浪费性能）
arr.map(item => console.log(item));

// ✅ 正确：用 forEach
arr.forEach(item => console.log(item));
```