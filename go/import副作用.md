# Go import 的副作用

## 什么是副作用？

`import` 不仅仅是引入符号，**导入一个包时会自动执行该包的 `init()` 函数**。这个自动执行的行为就是"副作用"。

## 典型场景：`_` 导入（blank import）

```go
import (
    "go-learn/sideeffect/register"

    // _ 表示：我不使用这个包的任何函数/类型
    // 但我要触发它的 init() 副作用
    _ "go-learn/sideeffect/plugin"
)
```

## 完整示例：插件注册

```
register/register.go  — 全局注册表
plugin/hello.go       — init() 中自动注册自己
main.go               — _ 导入 plugin，触发注册
```

### register.go
```go
package register

var plugins = make(map[string]func())

func Register(name string, fn func()) {
    plugins[name] = fn
}

func RunAll() {
    for name, fn := range plugins {
        fn()
    }
}
```

### plugin/hello.go
```go
package plugin

import "go-learn/sideeffect/register"

func init() {
    register.Register("hello", func() {
        println("Hello, 世界!")
    })
}
```

### main.go
```go
package main

import (
    "go-learn/sideeffect/register"
    _ "go-learn/sideeffect/plugin"  // 触发 init → 自动注册
)

func main() {
    register.RunAll()  // 输出: Hello, 世界!
}
```

## 重复导入会怎样？

**同一个包无论被多少个包 import，它的 `init()` 只执行一次。** Go 编译器保证这一点。

```
A imports C  ─┐
              ├── C 的 init() 只执行 1 次
B imports C  ─┘
```

## init 的执行顺序

```
1. 被导入的包先 init
2. 同一包内多个 init 按文件名排序执行
3. 同一文件内多个 init 按声明顺序执行
4. main 包的 init 最后执行
```

```
依赖链: D → C → B → A
init 顺序: A.init → B.init → C.init → D.init → main.init
```

## 标准库中的真实例子

```go
import (
    _ "image/png"   // 注册 PNG 解码器到 image 包
    _ "image/jpeg"  // 注册 JPEG 解码器到 image 包
    _ "image/gif"   // 注册 GIF 解码器到 image 包
)

// 现在 image.Decode() 能自动识别格式
img, _, err := image.Decode(file)
```

`image/png` 的 init 做了什么：
```go
func init() {
    image.RegisterFormat("png", pngHeader, Decode, DecodeConfig)
}
```

## 要点总结

| 问题 | 答案 |
|------|------|
| import 有副作用吗？ | 有，触发 init() |
| 同一包 init 执行几次？ | 只执行 1 次 |
| `_` 导入的意义？ | 只要副作用，不用符号 |
| 常见用途？ | 插件注册、格式注册、驱动注册 |

## 注意事项

- 不要滥用 init 副作用，会让代码难以追踪
- `_` 导入的包在代码中不出现，阅读时需要查看 import 才能发现
- 适合场景：数据库驱动、图像解码器、插件系统等"注册"模式
