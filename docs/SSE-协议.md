# AI 对话 SSE 协议契约

前后端共用规范，任何变更须同时更新此文档、后端 `ChatEvent.java` 与前端
`useSSEStream.ts`，并配套修改双端测试。

## 设计原则

1. **完全遵循 WHATWG SSE 规范**
   （<https://html.spec.whatwg.org/multipage/server-sent-events.html>）。
   前端解析器按规范剥离 `data:` / `event:` 后的一个前导空格，
   多条 `data:` 行以 `\n` 拼接为完整 payload。
2. **所有事件的 payload 一律为紧凑 JSON 信封**（除 `event:done` 保留字面量），
   与 OpenAI / Azure OpenAI Chat Completion streaming 官方 wire format 一致。
3. Token 内的空白与换行由 JSON 序列化编码为 `"\u0020"` / `"\\n"`，
   彻底规避两个业界公认坑：
   - WHATWG 空格剥离与 LLM 分词器天然带前导空格 token 冲突（`" 🔴 "` → `"🔴 "`）
   - Spring `ServerSentEventHttpMessageWriter` 会把 payload 中的 `\n`
     拆成多行 `data:`，前端逐条 dispatch 会丢换行边界

参考文献：
- [Medium: The line break problem when using SSE](https://medium.com/@thiagosalvatore/the-line-break-problem-when-using-server-sent-events-sse-1159632d09a0)
- [htmx#2292 Newlines in SSE data](https://github.com/bigskysoftware/htmx/issues/2292)
- OpenAI Chat Completion streaming 官方示例

## HTTP 层

**端点**：`POST /api/v1/chat/stream`
**Content-Type**：`application/json`
**响应 Content-Type**：`text/event-stream`
**CORS**：访客公开，方法级 `@CrossOrigin(origins = "*")`

**Request body**：
```json
{
  "sessionId": "guest-1700000000-abcd1234",
  "message": "长沙今天天气如何？",
  "domainCode": "weather"
}
```

## 事件表

| event 字段    | data payload                            | 前端回调           | 备注 |
|---------------|-----------------------------------------|--------------------|------|
| （缺省）      | `{"content":"..."}` `TokenPayload`      | `onToken`          | 每次 LLM partial-response 一帧 |
| `sources`     | `[{"docId":"...","label":"..."}]`       | `onSources`        | RAG 命中时的知识库溯源 |
| `tool_call`   | `{"tool":"...","status":"RUNNING"}` `ToolCallPayload` | `onToolCall`       | 工具执行开始 |
| `tool_done`   | `{"tool":"...","status":"SUCCESS","durationMs":1499,"errorMsg":null}` `ToolDonePayload` | `onToolDone` | 工具执行完成 |
| `transfer`    | `{"intentCode":"...","message":"..."}` `TransferPayload` | `onTransfer` | AI 触发转人工 |
| `domain_switch` | `{"code":"weather"}` `DomainSwitchPayload` | `onDomainSwitch` | LLM 工具触发域切换 |
| `error`       | `{"message":"..."}` `ErrorPayload`      | `onError`          | 业务错误，接收后终止流 |
| `done`        | `[DONE]`（字面量，非 JSON）             | `onDone`           | 流结束终止帧 |

`ToolDonePayload.status` 取值：`SUCCESS` / `ERROR` / `TIMEOUT` / `SKIPPED`。

## 报文示例

一次典型的多域天气查询交互：

```
event: tool_call
data: {"tool":"get_weather","status":"RUNNING"}

event: tool_done
data: {"tool":"get_weather","status":"SUCCESS","durationMs":1499,"errorMsg":null}

data: {"content":"### "}

data: {"content":" 🔴 "}

data: {"content":"实时天气"}

data: {"content":"\n\n温度 25℃"}

event: done
data: [DONE]
```

注意：
- token 事件**无 `event:` 字段**，与 OpenAI 规范一致
- 每帧之间以**空行**为事件边界（WHATWG 规范）
- `done` 事件的 `data` 保留字面量 `[DONE]`，方便 curl 调试与业界习惯一致

## 后端契约

| 关键点 | 位置 |
|--------|------|
| 事件类型常量 | `ChatEvent.java` 内部 `EventType` 类 |
| Payload record | `application/service/payload/*.java` |
| JSON 序列化 helper | `application/service/support/SseJson.java` |
| Token 发射点 | `ChatAppService.streamFaq()` L338、`DomainAgentService.streamChat()` L141 |
| 终止帧发射 | `ChatController.doneStream()` |

修改 wire format 时**必须**：
1. 更新对应 payload record 或新增 record
2. 更新 `ChatEvent` 工厂方法
3. 同步 `docs/SSE-协议.md` 事件表
4. 同步 `useSSEStream.ts` 的 `SSEStreamHandlers` 与 `dispatchEvent`
5. 同步 `useSSEStream.test.ts` 契约测试
6. 同步 `ChatControllerStreamTest.java` 契约测试

## 前端契约

| 关键点 | 位置 |
|--------|------|
| SSE 解析器 | `apps/src/composables/useSSEStream.ts` |
| 消费方 | `apps/src/views/chat-widget/index.vue`、`apps/src/views/customerservice/chat/index.vue` |
| DOMPurify 净化 | 两处 v-html 均通过 `DOMPurify.sanitize(marked.parse(...))` |
| Markdown 样式 | 各 view 内 scoped `.widget-ai-md` / `.chat-ai-md`（补齐 Tailwind v4 Preflight 清零的原生标签样式） |

## 前后端调试 checklist

1. `curl -N -X POST http://localhost:8082/api/v1/chat/stream \
     -H 'Content-Type: application/json' \
     -d '{"sessionId":"debug-1","message":"你好","domainCode":"weather"}'`
   - 每条 `data:` 应为合法 JSON（`event:done` 除外）
   - `event:done` 后无更多数据
2. 后端 `mvn -pl ai-conversation/conversation-service test -Dtest=ChatControllerStreamTest`
3. 前端 `npx vitest run apps/src/composables/__tests__/useSSEStream.test.ts`
4. 手动回归：
   - `http://localhost:5670/chat?domainCode=weather` 命中天气工具，
     确认 Markdown 表格、标题、加粗、emoji 都正常渲染
   - `customerservice/chat` 页流式对话应产生同样的 wire format
