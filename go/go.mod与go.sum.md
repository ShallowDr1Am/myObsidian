# go.mod 与 go.sum

## go.mod 依赖管理

```go
module hellomodule      // 模块名

go 1.26.4               // Go 版本

require (               // 直接依赖
    github.com/valyala/fasthttp v1.71.0
    go.uber.org/zap v1.28.0
)

require (               // 间接依赖（传递依赖）
    github.com/andybalholm/brotli v1.2.1 // indirect
    github.com/klauspost/compress v1.18.6 // indirect
)
```

**依赖关系：**

```
hellomodule
├── fasthttp v1.71.0
│   ├── brotli v1.2.1      (indirect)
│   ├── compress v1.18.6   (indirect)
│   └── bytebufferpool v1.0.0 (indirect)
└── zap v1.28.0
    └── multierr v1.10.0   (indirect)
```

---

## go.sum 版本校验

```
github.com/valyala/fasthttp v1.71.0 h1:tepR7H+Guh9VUqxxcPggYi8R3lGUu2Rsdh+z7/FCY3k=
github.com/valyala/fasthttp v1.71.0/go.mod h1:z1sDUvOShhXq/C9mwH/fSm1Vb71tUJwmQdgkBrBNwnA=
```

**每行格式：**

| 字段 | 说明 |
|------|------|
| 模块路径 | `github.com/valyala/fasthttp` |
| 版本 | `v1.71.0` |
| 类型 | `h1` = 代码校验和，`/go.mod` = go.mod 校验和 |
| 哈希值 | SHA-256 校验和（base64 编码） |

---

## 两者关系

| 文件 | 记录什么 | 用途 |
|------|----------|------|
| `go.mod` | 依赖 + 版本 | 声明需要哪些包 |
| `go.sum` | 校验和 | 验证下载的包是否被篡改 |

**验证流程：**

```
go build
    ↓
下载依赖到 $GOPATH/pkg/mod
    ↓
计算下载文件的 SHA-256
    ↓
对比 go.sum 中的校验和
    ↓
不一致 → 报错退出
一致 → 继续编译
```

---

## import 机制

Go 的 `import` 是**编译时静态导入**，不是运行时动态导入。

| 问题 | 答案 |
|------|------|
| import 是动态的吗？ | 否，Go 是静态编译 |
| 什么时候拉取远端？ | `go mod tidy` / `go build` / `go run` 时拉取并缓存 |
| 运行时需要网络吗？ | 不需要，依赖已编译进二进制 |

---

## 常用命令

| 命令 | 作用 |
|------|------|
| `go mod init` | 初始化模块 |
| `go mod tidy` | 整理依赖（添加缺失、移除无用） |
| `go mod download` | 下载依赖到缓存 |
| `go list -m all` | 查看所有依赖 |

---

## 总结

- **go.mod**：声明依赖清单（直接 + 间接）
- **go.sum**：锁定依赖完整性（防篡改）
- 两者都应提交到 Git，确保团队依赖一致
