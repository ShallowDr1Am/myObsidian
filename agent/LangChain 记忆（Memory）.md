# LangChain 记忆（Memory）

## 核心：MessagesPlaceholder + 手动管理

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是助手。"),
    MessagesPlaceholder(variable_name="history"),  # 注入历史消息
    ("human", "{input}"),
])

history = []
def chat(user_input):
    resp = chain.invoke({"input": user_input, "history": history})
    history.append(HumanMessage(user_input))
    history.append(AIMessage(resp))
    return resp
```

## 本质

记忆 = 存消息列表 + 每次调用塞进 prompt。三种存储：

| 存储 | 特点 |
|---|---|
| `InMemoryChatMessageHistory` | 内存，重启丢失 |
| `FileChatMessageHistory` | JSON 文件，单机持久 |
| `RedisChatMessageHistory` | Redis，分布式/生产 |

## 注意事项

- `add_message` 必须传 `BaseMessage` 对象，不能直接传字符串
- `RunnableWithMessageHistory` 已废弃（v1.3.3），官方推荐 LangGraph persistence

## 相关问题

[[LangChain Tool Calling 最小 MVP]]
[[LCEL — LangChain Expression Language]]