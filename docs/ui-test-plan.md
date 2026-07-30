# UI 功能测试计划 — 智能客服平台

> 覆盖页面：`/chat?`（访客聊天组件）和 `/customerservice/agent`（坐席工作台）
> 服务端代码：`/Users/lycodeing/IdeaProjects/aria-server`
> 前端代码：`/Users/lycodeing/WebstormProjects/aria-frontend`

---

## 一、概述与测试策略

### 1.1 测试目标

对以下两个页面的**全部可见功能和业务逻辑**进行系统性验证：

| 页面 | 路由 | 用户角色 |
|---|---|---|
| 访客聊天组件 | `/chat?` | 访客（匿名 / 已认证） |
| 坐席工作台 | `/customerservice/agent` | 客服坐席（已登录后台） |

### 1.2 核心技术栈

- **前端**：Vue 3 + Vite + Ant Design Vue + Tailwind CSS
- **实时通信**：SSE（坐席队列推送 / AI 流式回复）、WebSocket（访客↔坐席双向消息）
- **状态持久化**：localStorage（访客 session、消息历史、认证 token、转接标志、CSAT 邀请、坐席 lastSeq）
- **后端**：Spring Boot，conversation-service（端口 8082），经 Vite proxy `/conversation` 前缀路由

### 1.3 测试分层

```
P0 — 核心主流程（必须全部通过）
P1 — 重要交互反馈（状态变更、提示、禁用态）
P2 — 输入边界与防御（空输入、重复操作、并发）
P3 — 异常与降级（网络断线、重连、离线兜底）
P4 — 布局与视觉（溢出、对齐、响应式）
```

### 1.4 测试前置条件

1. 服务端 `aria-server` 已启动，健康检查通过：
   - `GET http://localhost:8082/actuator/health` → `{"status":"UP"}`
2. 前端开发服务器已启动：`http://localhost:5670`
3. 数据库（MySQL）、缓存（Redis）、消息队列（RocketMQ/Kafka）均正常运行
4. 至少存在以下测试数据：
   - 一个已激活的坐席账号（用于登录后台）
   - 标签字典中至少 2 条标签记录（用于标签功能测试）
   - 快捷回复（CannedResponse）至少 1 条
5. 浏览器开启开发者工具，关注 Network 面板确认接口调用和 Console 报错

### 1.5 术语说明

| 术语 | 说明 |
|---|---|
| anonymousId | 访客持久 UUID，存于 `aria_visitor_id` localStorage，永不过期 |
| sessionId | 单次对话会话 ID，由后端 `/chat/session/init` 分配 |
| lastSeq | 消息单调序号游标，用于断线重连后增量补齐消息 |
| SSE | Server-Sent Events，后端单向推送流 |
| WS | WebSocket，双向实时消息通道 |
| CSAT | Customer Satisfaction，会话结束后的满意度评价 |
| AI_CHAT | 会话状态：AI 自动应答中 |
| WAITING | 会话状态：已入人工队列，等待坐席接入 |
| ACTIVE | 会话状态：坐席已接入，人工服务中 |
| CLOSED | 会话状态：会话已结束 |

### 1.6 关键业务流程全貌

```
访客侧主流程：
  访客打开 /chat → 初始化 session (POST /chat/session/init)
    → AI 回答 (POST /chat/stream SSE)
    → [可选] 身份验证 (手机号短信)
    → [可选] 转人工 (POST /chat/transfer)
    → 等待坐席接入 (WS /ws/chat/{sid})
    → 人工对话 (WS 双向)
    → 会话结束 (WS close 1000)
    → [可选] CSAT 评价
    → 开始新对话

坐席侧主流程：
  坐席登录后台 → SSE 监听队列 (GET /sessions/events)
    → 看到等待队列 (GET /sessions)
    → 接入会话 (POST /sessions/{id}/accept)
    → WS 接收访客消息 (/ws/agent 单连接多路复用)
    → 坐席回复 (WS send)
    → [可选] 转交其他坐席 (POST /sessions/{id}/transfer)
    → 结束会话 (POST /sessions/{id}/close)
    → 自动生成摘要
```

## 二、访客聊天页（`/chat?`）功能描述与接口清单

### 2.1 页面功能模块总览

| 模块 | 子功能 | 核心 Composable |
|---|---|---|
| 会话初始化 | getOrCreate 语义，持久 anonymousId | `useVisitorSession` |
| AI 流式对话 | SSE fetch 流，Markdown 渲染，工具调用状态 | `useSSEStream` |
| 身份验证 | 手机号 + 短信验证码，60s 倒计时 | `useAuth` |
| 转人工 | 入队接口 + localStorage 标志 + WS 连接 | `useTransfer` |
| 访客 WebSocket | 双向消息，AGENT_JOINED，KICKED_OUT，心跳，重连 | `useVisitorWs` |
| 消息持久化 | localStorage 最多 100 条，刷新恢复 | `useVisitorSession` |
| 消息反馈 | 点赞 / 点踩，乐观更新，取消 | `submitVisitorFeedbackApi` |
| CSAT 评价 | 会话结束后推送评价卡，提交/跳过 | `CsatRatingCard` |
| 新对话 | 会话结束后保留历史，新建 session | `startNewSession` |
| 快捷问题 | 4 个预置快捷提问按钮 | 内联 `QUICK` 常量 |
| 清除历史 | 清空本地消息 + 获取新 session | `clearHistory` |
| 域路由 | URL ?domain= / ?domainCode= 透传给 AI | `domainCode` computed |

### 2.2 接口调用清单（访客侧）

| 接口 | 方法 | 路径 | 时机 | 鉴权 |
|---|---|---|---|---|
| 会话初始化 | POST | `/conversation/api/v1/chat/session/init` | onMounted | 无（X-Anonymous-Id header） |
| AI 流式对话 | POST | `/conversation/api/v1/chat/stream` | 用户发送消息 | 无 / 可选 Bearer token |
| 获取历史消息 | GET | `/conversation/api/v1/chat/history` | onMounted 兜底 | 无 |
| 查询会话状态 | GET | `/conversation/api/v1/chat/state` | onMounted 恢复转接 | 无 |
| 转人工入队 | POST | `/conversation/api/v1/chat/transfer` | 用户点击「转人工」 | 无 |
| 发送短信验证码 | POST | `/conversation/api/v1/chat/auth/sms/send` | 点击「发送验证码」 | 无 |
| 校验验证码 | POST | `/conversation/api/v1/chat/auth/sms/verify` | 点击「立即验证」 | 无 |
| 查询认证状态 | GET | `/conversation/api/v1/chat/auth/state` | onMounted 权威恢复 | 无 |
| 提交消息反馈 | POST | `/conversation/api/v1/chat/messages/feedback` | 点赞/点踩 | 无 |
| 查询待评价 CSAT | GET | `/conversation/api/v1/chat/csat/pending` | onMounted 权威恢复 | 无 |
| 提交 CSAT 评分 | POST | `/conversation/api/v1/chat/csat/{id}/rate` | 用户提交评价 | 无 |
| 跳过 CSAT | POST | `/conversation/api/v1/chat/csat/{id}/skip` | 用户关闭或开新对话 | 无 |
| 访客 WebSocket | WS | `/ws/chat/{sessionId}?token=` | 转人工成功后 | 可选 token |

### 2.3 localStorage 键说明（访客侧）

| 键名 | 含义 | 清除时机 |
|---|---|---|
| `aria_visitor_id` | 持久访客 UUID（永不过期） | 用户手动清除 |
| `chat_session_id` | 当前会话 ID | `clearSession` / `startNewSession` |
| `chat_history_{sid}` | 最近 100 条消息 JSON | `clearSession` |
| `chat_last_seq_{sid}` | 消息序号游标 | `clearSession` |
| `chat_transferred_{sid}` | 是否已转人工标志（值 `"1"`） | 转接成功/会话结束/新对话 |
| `chat_session_ended_{sid}` | 会话是否已结束标志 | 新对话/后端确认活跃 |
| `chat_csat_invite_{sid}` | CSAT 邀请 JSON | 提交/跳过/开新对话 |
| `chat_auth_token` | 访客认证 JWT token | 登出/认证过期 |
| `chat_auth_label` | 脱敏手机号标签 | 登出 |

### 2.4 SSE 事件类型（AI 流式）

| event 字段 | data 格式 | 前端处理 |
|---|---|---|
| `(缺省)` | `{"content":"..."}` | token 追加到当前 AI 气泡 |
| `sources` | `[{"docId":"...","label":"..."}]` | 知识库溯源标签 |
| `tool_call` | `{"tool":"...","status":"RUNNING"}` | 工具状态条 running |
| `tool_done` | `{"tool":"...","status":"SUCCESS","durationMs":N}` | 工具状态条 done/error |
| `transfer` | `{"intentCode":"...","message":"..."}` | 切换到人工模式 |
| `domain_switch` | `{"code":"..."}` | 静默忽略 |
| `csat_request` | `CsatRequestPayload` | 展示评价卡并 markSessionEnded |
| `error` | `{"message":"..."}` | 显示错误文本，停止流 |
| `done` | `[DONE]` | 流正常结束 |

### 2.5 WebSocket 消息类型（访客侧）

| type | 方向 | 说明 |
|---|---|---|
| `MESSAGE` | 双向 | 文字消息，含 `role` 和 `seq` |
| `AGENT_JOINED` | 服务端→访客 | 座席接入通知，`agentJoined=true` |
| `TYPING` | 访客→服务端 | 访客输入中信号（防抖 500ms） |
| `PING` | 访客→服务端 | 心跳（每 25s），防代理超时断连 |
| `csat_request` | 服务端→访客 | CSAT 评价邀请（人工关闭后推送） |
| `KICKED_OUT` | 服务端→访客 | 同一 sessionId 被其他标签页抢占 |

### 2.6 关键业务规则

1. **AUTH_WORDS 触发身份验证**：消息含「订单、退款、投诉、账单、发票、快递、损坏」时，未认证用户会被拦截，触发手机验证 Modal，消息暂存 `pendingMsg` 待验证完成后自动发送。

2. **会话已结束拒绝发送**：`sessionEnded=true` 时，输入框区域替换为「开始新对话」按钮，`sendMsg` 会 `message.info` 提示。

3. **转人工后走 WS 通道**：`transferred=true` 时，`sendMsg` 不走 SSE，而是调用 `ws.sendText()`（`sendWsWithLoading`），带 sending 状态和失败重试。

4. **SSE transfer 事件不再重复调 POST**：后端 AI 工具触发转接后，SSE 推送 `event:transfer`，前端直接 `transfer.markTransferred()` + `ws.connect()`，不再调用 `POST /chat/transfer`（防二次入队）。

5. **刷新恢复优先级**：后端 `/chat/state` 为权威，WAITING/ACTIVE → 恢复转接；CLOSED → 清转接标志 + 补 session_end 分隔条；网络错误 → 降级到 localStorage 标志。

6. **重连策略**：最多重试 3 次，延迟分别为 1s / 3s / 8s；超出后调 `onMaxRetryExceeded` 清除转接状态；KICKED_OUT 后不重连。

7. **lastSeq 游标**：每收到 WS `MESSAGE` 更新游标；重连成功后按 `lastSeq` 拉增量，仅补 agent 角色消息（AI 已由 SSE echo）。

## 三、访客聊天页测试用例

### TC-C-001：页面初始化与会话创建（P0）

**前置**：清空 localStorage（或使用无痕窗口）

**步骤**：
1. 打开 `http://localhost:5670/chat`
2. 观察页面加载

**预期**：
- 页面渲染「智能客服助手」顶栏，状态显示「在线服务中」（绿点）
- `POST /chat/session/init` 被调用，Header 含 `X-Anonymous-Id`（新生成的 UUID）
- localStorage 写入 `aria_visitor_id`（UUID）和 `chat_session_id`（会话 ID）
- 消息区显示欢迎气泡（无消息时默认文案）
- 快捷问题区显示 4 个预置按钮

**接口验证**：
- 请求体为空 `{}`，Header `X-Anonymous-Id` 为 UUID 格式
- 响应含 `sessionId`、`isNew: true`、`status: "AI_CHAT"`

---

### TC-C-002：AI 流式对话基本流程（P0）

**步骤**：
1. 在输入框输入「你好，我想了解产品定价」
2. 点击发送（或按 Enter）

**预期**：
- 用户消息气泡立即出现（蓝底白字）
- AI 气泡出现，先显示三点跳动动画（thinking 状态）
- SSE 流建立，token 逐字追加到 AI 气泡，气泡尾部有脉冲光标
- 流结束后光标消失，气泡下方出现「有帮助吗？👍👎」反馈按钮
- 发送按钮在流进行中为 loading 状态，禁止重复提交
- `POST /chat/stream` 请求体含 `message` 和 `sessionId`

---

### TC-C-003：Markdown 渲染（P1）

**步骤**：
1. 发送能触发包含 Markdown 格式回答的问题（如「给我列出几个功能点」）

**预期**：
- AI 气泡正确渲染有序/无序列表（`.widget-ai-md ul { list-style: disc }`）
- **加粗**、*斜体*、`代码`、表格均正确显示
- 无 XSS 注入风险（DOMPurify 净化有效）

---

### TC-C-004：知识库溯源标签（P1）

**步骤**：
1. 发送能命中知识库的问题

**预期**：
- AI 回复气泡下方出现蓝色「📄 xxx」溯源标签（`event:sources` 触发）
- 多个知识源时显示多个标签，每个标签样式一致

---

### TC-C-005：工具调用状态展示（P1）

**步骤**：
1. 发送触发 AI 工具调用的问题（如「查一下今天天气」）

**预期**：
- AI 气泡顶部出现工具状态条：`🔄 <工具名> 查询中...`（running）
- 工具完成后变为：`✅ <工具名> Nms`（done）
- 工具失败时显示：`❌ <工具名>`（error）
- 工具状态条与 AI 文字内容在同一气泡内，中间有虚线分隔

---

### TC-C-006：快捷问题按钮（P1）

**步骤**：
1. 点击「产品标准版定价？」快捷按钮

**预期**：
- 输入框自动填充该问题并立即发送
- AI 正常回复
- 若当前会话已结束，点击快捷按钮应先 `startNewSession` 再发消息

---

### TC-C-007：AUTH_WORDS 触发身份验证拦截（P0）

**步骤**：
1. 确保当前未认证（顶栏显示「🔓 访客模式」）
2. 输入「我想查询我的订单」并发送

**预期**：
- 用户消息气泡正常显示
- 400ms 后 AI 气泡提示「这个问题需要验证手机号才能处理，请先完成身份验证 📱」
- 身份验证 Modal 自动弹出，标题「身份验证」，提示文案含「处理"我想查询我的订单..."需要验证身份」
- 消息未走 SSE，`pendingMsg` 暂存原始文本

---

### TC-C-008：手机号短信验证码流程（P0）

**步骤**：
1. 在验证 Modal 中输入正确手机号（11 位）
2. 点击「发送验证码」
3. 按钮变为倒计时（60s 后重发）
4. 输入收到的 6 位验证码
5. 点击「立即验证」

**预期**：
- `POST /chat/auth/sms/send` 被调用，body 含 `phone`
- 按钮倒计时从 60 开始递减，到 0 后变为「发送验证码」可重发
- `POST /chat/auth/sms/verify` 被调用，body 含 `phone`, `code`, `sessionId`
- 验证成功后 Modal 关闭，顶栏变为「✅ 已登录 · 138****5678」（绿色背景）
- AI 气泡追加「✅ 身份验证成功！」提示
- `pendingMsg` 暂存的消息在 800ms 后自动发出（走 SSE）
- localStorage 写入 `chat_auth_token` 和 `chat_auth_label`

---

### TC-C-009：手机号格式校验（P2）

**步骤**：
1. 打开身份验证 Modal
2. 输入非法手机号（如 `123`）点击「发送验证码」

**预期**：
- 字段下方显示错误提示「请输入正确的手机号」
- 不调用发送短信接口

---

### TC-C-010：验证码错误（P2）

**步骤**：
1. 输入正确手机号并发送验证码
2. 输入错误的验证码点击验证

**预期**：
- 后端返回错误，验证码字段显示「验证码错误，请重试」
- 验证码输入框清空
- Modal 保持打开状态，可重新输入

---

### TC-C-011：转人工流程（P0）

**步骤**：
1. 点击顶栏右侧「转人工」按钮

**预期**：
- `POST /chat/transfer` 被调用，body 含 `sessionId`、`userName: "访客"`、`tag`（根据对话内容推断）、`transferReason`
- 顶栏「转人工」按钮变为「👤 人工服务中」绿色徽章
- AI 流式触发入队时（SSE `event:transfer`）同样切换状态，且不重复调 POST
- WS 连接建立（`/ws/chat/{sessionId}`）
- 消息区出现排队中提示（若座席尚未接入）

---

### TC-C-012：座席接入通知（P0）

**前置**：已转人工并建立 WS 连接，后台座席接入该会话

**预期**：
- 收到 WS `AGENT_JOINED` 消息，`agentJoined=true`
- 此后访客输入时触发 TYPING 信号（WS 发送 `{"type":"TYPING"}`）
- 座席消息以「👤 人工客服」标签 + 浅蓝气泡展示

---

### TC-C-013：访客输入中 TYPING 信号（P1）

**前置**：`agentJoined=true`，WS 已连接

**步骤**：
1. 在输入框持续输入文字

**预期**：
- 第一次按键立即发送 TYPING 信号
- 500ms 防抖内不重复发送（同一 500ms 窗口内多次按键只触发一次）
- WS 状态非 `connected` 时不发送（无报错）

---

### TC-C-014：WS 消息发送与失败重试（P1）

**前置**：已转人工，WS 已连接

**步骤**：
1. 发送一条消息
2. 模拟 WS 断线后再次发送

**预期**：
- 正常发送：消息气泡带 250ms 转圈动画后正常显示
- WS 未连接时发送：消息气泡变红色底，下方出现「🔄 重试」按钮
- 点击重试：`sending=true` 重新发送，成功后恢复正常

---

### TC-C-015：WS 断线重连（P1）

**前置**：已转人工，WS 已连接

**步骤**：
1. 模拟网络中断（或后端重启）

**预期**：
- 顶部出现黄色重连提示条「正在自动重连，消息可能短暂延迟…」（connecting 状态）
- 脉冲橙色圆点动画
- 按延迟 1s/3s/8s 重连，成功后提示条消失
- 重连后调 `GET /chat/history?sinceSeq=N` 补齐离线消息（仅 agent 角色）

---

### TC-C-016：WS 断线超过重试上限（P2）

**步骤**：
1. 持续保持网络断线，超过 3 次重试

**预期**：
- 提示条变红色「会话连接已断开，自动重连已停止」
- 出现「立即重连」手动按钮
- `agentJoined=false`，`transferred=false`（localStorage 标志清除）

---

### TC-C-017：KICKED_OUT 多标签处理（P2）

**前置**：已转人工，同一 sessionId 在另一标签页打开

**预期**：
- 旧标签页收到 WS `KICKED_OUT` 消息后，弹出 Modal 提示「您已在其他标签页打开此会话，本页面连接已断开」
- 旧标签页不重连（kickedOut 标志阻止）
- 用户点击「知道了」关闭 Modal，`agentJoined=false`

---

### TC-C-018：会话结束处理（P0）

**前置**：已转人工，座席关闭会话

**预期**：
- 收到 WS close code 1000，触发 `onSessionClosed`
- 消息区出现「本次会话已结束，感谢您的使用。」分隔条（绿色圆角徽章，含 ✓ 图标）
- 输入框区域替换为「开始新对话」按钮
- localStorage 写入 `chat_session_ended_{sid} = "1"`
- `transferred=false`（清除 localStorage 标志）

---

### TC-C-019：AI 直接结束会话（CSAT via SSE）（P1）

**前置**：纯 AI 对话场景，后端 AI 流末尾追加 `event:csat_request`

**预期**：
- 消息区出现「本次会话已结束，感谢您的使用。」分隔条
- CSAT 评价卡片出现在消息区底部
- 输入区变为「开始新对话」按钮
- 不重复调用 `markSessionEnded`（幂等）

---

### TC-C-020：CSAT 评价提交（P0）

**前置**：会话已结束，CSAT 卡片显示

**步骤**：
1. 在 CsatRatingCard 中点击星级评分（如 4 星）
2. 可选填写评论
3. 点击提交

**预期**：
- `POST /chat/csat/{id}/rate` 被调用
- 卡片提交成功后消失（`setCsatInvite(null)` 清 localStorage）
- 成功提示 toast

---

### TC-C-021：CSAT 跳过（P1）

**步骤**：
1. CSAT 卡片显示时点击关闭（X）

**预期**：
- `POST /chat/csat/{id}/skip` 被调用（静默，失败不通知用户）
- 卡片消失，localStorage 中 CSAT 邀请清除

---

### TC-C-022：开始新对话（P0）

**前置**：会话已结束，输入区显示「开始新对话」按钮

**步骤**：
1. 点击「开始新对话」

**预期**：
- 旧消息历史保留在消息区（可见）
- 追加「新对话开始」分隔条（蓝紫色，含 💬 图标）
- `POST /chat/session/init` 被调用，获得新 sessionId
- 旧 sid 的 localStorage 键（`sessionEnded`/`CSAT`/`transferred`）被清除
- 若旧 sid 有未处理 CSAT，`POST /chat/csat/{id}/skip` 被静默调用
- 输入框恢复可用，`agentJoined=false`

---

### TC-C-023：清除历史（P1）

**步骤**：
1. 点击顶栏垃圾桶图标

**预期**：
- 消息列表清空
- `POST /chat/session/init` 被调用，获得新 sessionId
- localStorage 中旧 sid 相关所有键清除
- 显示初始欢迎气泡（无消息状态）

---

### TC-C-024：消息反馈点赞/点踩（P1）

**步骤**：
1. AI 回复结束后点击 👍
2. 再次点击 👍（取消）
3. 点击 👎

**预期**：
- 乐观更新：图标立即变色（绿/红）
- `POST /chat/messages/feedback` 被调用，body 含 `sessionId`, `feedback: "up"/"down"/null`, 可选 `seq`
- 后端失败时图标回滚原色，显示错误 toast
- 同一消息只能有一种反馈（点 👎 后 👍 自动取消）

---

### TC-C-025：失败消息重新生成（P1）

**步骤**：
1. 模拟 SSE 流报错（后端返回 `event:error`）
2. 点击 AI 气泡下方「🔄 重新生成」

**预期**：
- AI 气泡显示橙色错误底色和错误文本
- 点击重新生成：移除当前失败 AI 气泡，重新发起 SSE 请求
- `currentAiMsgId` 复位，避免悬空引用
- 重试后正常渲染新回复

---

### TC-C-026：刷新页面状态恢复（P3）

**前置**：已认证，已转人工，WS 连接中

**步骤**：
1. 刷新页面（F5）

**预期**：
- 从 localStorage 恢复历史消息（最多 100 条）
- `POST /chat/session/init` 返回已存在的 sessionId（`isNew: false`）
- `GET /chat/auth/state` 恢复认证态（顶栏显示已登录标签）
- `GET /chat/state` 返回 WAITING/ACTIVE → 恢复转接标志，重连 WS
- `GET /chat/csat/pending` 恢复 CSAT 邀请（如有）
- 若后端状态为 CLOSED → 补 session_end 分隔条，输入区显示「开始新对话」

---

### TC-C-027：会话结束后拒绝发送（P2）

**前置**：`sessionEnded=true`

**步骤**：
1. 直接调用 `sendMsg`（或通过快捷按钮触发）

**预期**：
- `message.info('本次会话已结束，请点击「开始新对话」')` 提示
- 不发送任何消息，不调用 SSE/WS 接口

---

### TC-C-028：domainCode 域路由参数（P2）

**步骤**：
1. 打开 `http://localhost:5670/chat?domainCode=weather`
2. 发送消息

**预期**：
- `POST /chat/stream` 请求体含 `domainCode: "weather"`
- （同时支持 `?domain=weather` 写法）

---

### TC-C-029：访客提示条（P4）

**预期**：
- 未认证时显示蓝色提示条「ℹ️ 当前为访客模式，可咨询通用问题。」
- 提示条含「立即登录」超链接，点击触发身份验证 Modal
- 认证成功后提示条消失

---

### TC-C-030：主题隔离（P4）

**步骤**：
1. 后台管理系统切换为暗色主题
2. 打开 `/chat` 页面

**预期**：
- 聊天页保持白色背景，不受后台暗色主题影响
- 页面根元素含 `data-theme="light"` 和 `color-scheme: light` 样式

## 四、坐席工作台（`/customerservice/agent`）功能描述与接口清单

### 4.1 页面布局

坐席工作台采用**三栏布局**（flex，比例 2:6:2）：

| 栏位 | 组件 | 主要内容 |
|---|---|---|
| 左栏（2/10） | `AgentLeftPanel.vue` | 队列 Tab（等待中/AI 对话/接待中/已结束）、会话列表、搜索、分页 |
| 中栏（6/10） | `AgentChatArea.vue` | 消息气泡区、输入框、操作按钮（结束/转交/重连） |
| 右栏（2/10） | `AgentRightPanel.vue` | 会话信息、访客/会话标签、内部备注、AI 回复建议、历史工单 |

顶部横幅：SSE 断线时显示橙色警告条 + 「立即重试」按钮。

### 4.2 接口调用清单（坐席侧）

| 接口 | 方法 | 路径 | 时机 | 鉴权 |
|---|---|---|---|---|
| 获取所有会话列表 | GET | `/conversation/api/v1/sessions` | onMounted / loadSessions | Bearer token |
| 订阅 SSE 事件流 | EventSource | `/conversation/api/v1/sessions/events?token=` | 布局初始化 | token 在 URL |
| 接入会话 | POST | `/conversation/api/v1/sessions/{id}/accept` | 点击「接入」 | Bearer token |
| 关闭会话 | POST | `/conversation/api/v1/sessions/{id}/close` | 点击「结束会话」 | Bearer token |
| 转交会话 | POST | `/conversation/api/v1/sessions/{id}/transfer` | 点击「转交」确认 | Bearer token |
| 获取在线坐席 | GET | `/conversation/api/v1/sessions/agents/online` | 打开转交 Modal | Bearer token |
| 获取会话历史 | GET | `/conversation/api/v1/chat/history` | 接入会话/查看已结束 | Bearer token |
| 访客历史工单 | GET | `/conversation/api/v1/sessions/visitor-history` | 右栏加载 | Bearer token |
| 查询 AI 摘要 | GET | `/conversation/api/v1/sessions/{id}/ai-summary` | 历史工单抽屉 | Bearer token |
| 生成 AI 摘要 SSE | EventSource | `/conversation/api/v1/sessions/{id}/ai-summary/stream?token=` | 点击「生成总结」 | token 在 URL |
| 获取 AI 回复建议 | POST | `/conversation/api/v1/sessions/{id}/reply-suggestions` | 切换会话/收到新消息 | Bearer token |
| 获取会话备注 | GET | `/conversation/api/v1/sessions/{id}/notes` | 右栏加载 | Bearer token |
| 新建会话备注 | POST | `/conversation/api/v1/sessions/{id}/notes` | 点击「保存」 | Bearer token |
| 删除会话备注 | DELETE | `/conversation/api/v1/sessions/{id}/notes/{noteId}` | 点击「删除」确认 | Bearer token |
| 获取标签字典 | GET | `/conversation/api/v1/admin/tags` | 右栏加载 | Bearer token |
| 获取访客标签 | GET | `/conversation/api/v1/sessions/{id}/visitor/tags` | 右栏加载 | Bearer token |
| 添加访客标签 | POST | `/conversation/api/v1/sessions/{id}/visitor/tags` | 选择标签后确认 | Bearer token |
| 移除访客标签 | DELETE | `/conversation/api/v1/sessions/{id}/visitor/tags/{tagId}` | 点击标签 ✕ | Bearer token |
| 获取会话标签 | GET | `/conversation/api/v1/sessions/{id}/tags` | 右栏加载 | Bearer token |
| 添加会话标签 | POST | `/conversation/api/v1/sessions/{id}/tags` | 选择标签后确认 | Bearer token |
| 移除会话标签 | DELETE | `/conversation/api/v1/sessions/{id}/tags/{tagId}` | 点击标签 ✕ | Bearer token |
| 坐席 WebSocket | WS | `/ws/agent?token=`（单连接多路复用） | 布局初始化 / 接入会话 | token 在 URL |

### 4.3 SSE 事件类型（坐席队列 SSE）

| type | 触发条件 | 前端处理 |
|---|---|---|
| `ENQUEUE` | 新访客入队（WAITING 或 AI_CHAT） | 添加到 `sessions` 列表，`antMessage.info` 通知 |
| `ACCEPTED` | 某坐席接入该会话 | 原地更新 `status → ACTIVE` |
| `CLOSED` | 会话被关闭 | 原地更新 `status → CLOSED`，触发 `closedHandlers`（中栏关闭提示） |
| `TRANSFER` | 会话转交 | 从 `sessions` 中移除，触发 `transferHandlers` |

### 4.4 坐席 WebSocket 消息类型

| type | 方向 | 说明 |
|---|---|---|
| `MESSAGE` + `role:user` | 服务端→坐席 | 访客文字消息，含 `seq` |
| `TYPING` | 服务端→坐席 | 访客输入中信号（3s 无信号自动清除） |
| `PING` | 坐席→服务端 | 心跳保活 |

坐席端采用**单连接多路复用**架构：一个 WS 连接（`/ws/agent`）承载所有活跃会话的消息，通过消息中的 `sessionId` 字段区分路由。

### 4.5 localStorage 键说明（坐席侧）

| 键名 | 含义 | 清除时机 |
|---|---|---|
| `agent_last_seq_{sid}` | 每个会话的消息序号游标 | 断线重连时自动更新 |

### 4.6 关键业务规则

1. **最大并发数限制**：`MAX_CONCURRENT = 5`，接入或接收转入会话时检查，超过则提示「已达最大并发数（5）」。

2. **接入流程**：调用 `POST /sessions/{id}/accept` → 乐观从队列移除 → 调用 `GET /chat/history` 加载历史 → 写 `lastSeq` → 建立 WS 订阅 → 切换到「接待中」Tab。

3. **会话切换**：左栏点击会话项 → 中栏切换消息展示 → 清除未读数 → 清除 AI 回复建议 → 触发新会话的建议预加载。

4. **草稿隔离**：每个 sessionId 独立保存草稿（`drafts: Map<string, string>`），切换会话时输入框内容自动保存/恢复，不串台。

5. **未读消息计数**：非当活跃会话收到新消息时，该会话的 `unread` 计数 +1，切换到该会话时归零。

6. **访客输入中状态**：收到 WS `TYPING` 信号时，左栏或中栏显示「正在输入…」，3s 无新信号自动清除（timer 机制）。

7. **断线补偿**：WS 重连成功后，调用 `GET /chat/history?sinceSeq=N` 补齐离线期间漏消息，按 seq 去重（`seenSeqBySession` Map），避免实时消息与补偿消息重复。

8. **已结束会话查看**：左栏「已结束」Tab 点击会话项 → 调用 `GET /chat/history?sinceSeq=0` 全量拉取 → 中栏只读展示（不可发消息，不可使用快捷回复）。

9. **AI 旁观预览**：左栏「AI 对话」Tab 点击会话项 → 全量拉取历史 → 中栏只读预览，显示「接管」按钮可一键转为人工接入。

10. **转交流程**：
    - 打开转交 Modal 时 `GET /sessions/agents/online` 拉在线坐席列表
    - 排除自身（`id !== currentAgentId`）和已满（`sessions >= 5`）的坐席
    - 按当前会话数排序（空闲优先）
    - 确认后 `POST /sessions/{id}/transfer`，本地移除该会话，切换到其他活跃会话
    - 被转入方收到 SSE `TRANSFER` 事件后自动接入

11. **AI 回复建议刷新策略**：
    - 切换会话时立即触发（`delay=0`）
    - 收到访客新消息后延迟 800ms 触发（避免消息未到位就请求）
    - 建议包含 KB（知识库命中）和 CONTEXT（上下文推理）两种来源，含置信度
    - 支持「替换」（覆盖当前草稿）和「插入」（追加到草稿末尾）操作

12. **AI 摘要**：
    - 右栏历史工单抽屉中，每条工单可独立生成 AI 摘要（SSE 流式，打字光标动画）
    - 已生成的摘要可「重新生成」
    - 生成中显示脉冲光标，完成后显示完整文本

## 五、坐席工作台测试用例（队列、会话、消息）

### TC-A-001：页面初始化与会话列表加载（P0）

**前置**：坐席已登录后台，存在等待队列中的访客

**步骤**：
1. 导航到 `http://localhost:5670/customerservice/agent`

**预期**：
- `GET /sessions` 被调用，返回 AI_CHAT / WAITING / ACTIVE / CLOSED 四种状态的会话
- 左栏「等待中」Tab 显示 WAITING 状态会话列表（每页 5 条，含分页器）
- 左栏「AI 对话」Tab 显示 AI_CHAT 状态会话列表
- 左栏「接待中」Tab 显示 ACTIVE 状态会话（坐席刷新后恢复接待中会话）
- 左栏「已结束」Tab 显示最近 CLOSED 会话（最多 50 条）
- SSE 连接建立（`GET /sessions/events`），顶部无橙色断线横幅
- 等待队列每条显示：访客名、等待时长（实时刷新，每秒更新）、问题标签

---

### TC-A-002：SSE 新会话入队通知（P0）

**前置**：坐席在工作台页面，有访客新发起转人工请求

**预期**：
- 收到 SSE `ENQUEUE` 事件，「等待中」Tab 队列新增该访客条目
- `antMessage.info('新会话请求：{访客名}')` 消息通知出现
- 左栏若当前在其他 Tab，「等待中」计数自动更新（Badge 数字）
- 若当前 Tab 已在第 2 页，新入队会话插入时重置到第 1 页

---

### TC-A-003：接入等待队列会话（P0）

**步骤**：
1. 在「等待中」Tab 找到一个等待会话
2. 点击该条目右侧「接入」按钮

**预期**：
- `POST /sessions/{id}/accept` 被调用
- 乐观更新：该条目立即从「等待中」Tab 移除
- `GET /chat/history?sessionId={id}&sinceSeq=0` 被调用加载历史
- 中栏显示该访客的历史消息
- 左栏自动切换到「接待中」Tab，列表出现该访客条目
- WS 订阅建立（坐席端 channel subscribe）
- `message.success('已接入会话：{访客名}')` 提示

---

### TC-A-004：并发上限保护（P2）

**前置**：坐席已接入 5 个会话（`concurrent = MAX_CONCURRENT`）

**步骤**：
1. 尝试接入第 6 个等待队列会话

**预期**：
- `message.warning('已达最大并发数（5），请先结束其他会话')` 提示
- 不调用 `POST /sessions/{id}/accept`

---

### TC-A-005：SSE 断线横幅与重连（P1）

**步骤**：
1. 模拟 SSE 连接断开（如后端重启）

**预期**：
- 顶部出现橙色横幅「实时连接已断开，正在自动重连…」
- 横幅右侧有「立即重试」按钮
- 指数退避自动重连（1s→2s→4s…最大 30s，最多 10 次）
- 重连成功后横幅消失
- 点击「立即重试」手动触发立即重连（重置 retryCount）

---

### TC-A-006：SSE 超限后状态（P3）

**步骤**：
1. 持续断线超过 10 次重连上限

**预期**：
- `sseStatus` 变为 `'error'`，`sseConnected=false`
- 橙色横幅持续显示
- 点击「立即重试」仍可手动触发新一轮重连

---

### TC-A-007：多会话切换与草稿隔离（P0）

**前置**：坐席同时接待 2 个会话 A、B

**步骤**：
1. 在会话 A 的输入框输入「草稿内容A」（不发送）
2. 点击左栏切换到会话 B
3. 输入「草稿内容B」（不发送）
4. 再切换回会话 A

**预期**：
- 切换到 B 时，输入框内容变为空（B 无草稿）
- B 中输入后切回 A，A 的输入框恢复「草稿内容A」
- 两个会话草稿完全隔离，不相互污染

---

### TC-A-008：未读消息计数（P1）

**前置**：坐席正在会话 A（active），会话 B 在列表但非激活

**步骤**：
1. 访客 B 发送 3 条消息（通过 WS 到达坐席）

**预期**：
- 左栏会话 B 的条目显示红色数字徽章「3」
- 切换到会话 B 后徽章消失（`unread=0`）
- 会话 A 在激活期间收到消息，不显示未读计数

---

### TC-A-009：访客输入中状态显示（P1）

**前置**：坐席接入会话，访客开始输入

**预期**：
- 收到 WS `TYPING` 信号，中栏或左栏显示「{访客名} 正在输入…」
- 3 秒无新 TYPING 信号后自动消失
- 收到访客真实 MESSAGE 后立即清除输入中状态

---

### TC-A-010：坐席发送消息（P0）

**步骤**：
1. 在当前活跃会话的输入框输入回复内容
2. 点击发送（或按 Enter）

**预期**：
- WS `send` 调用，消息发到 `/ws/agent` 通道（`{"type":"MESSAGE","content":"...","sessionId":"..."}`）
- 中栏立即追加坐席消息气泡（agent 角色，右对齐样式）
- 输入框清空，对应 sessionId 的草稿清除
- WS 未连接时：`message.warning('WebSocket 未连接，请重新接入会话')` 提示

---

### TC-A-011：接收访客消息（P0）

**前置**：访客在聊天页发送消息

**预期**：
- 坐席中栏收到 WS MESSAGE（role=user），追加访客消息气泡（左对齐）
- 时间戳正确显示（`HH:MM` 格式）
- 若该会话非当前激活会话：unread+1，不强制切换
- 若该会话为当前激活会话：触发 AI 回复建议刷新（delay 800ms）

---

### TC-A-012：消息过滤器（P1）

**步骤**：
1. 中栏顶部选择「仅显示 AI 消息」

**预期**：
- 消息列表只显示 `role=ai` 和 `role=user` 的消息
- 切换到「仅显示坐席消息」：只显示 `role=agent` 和 `role=user`
- 切换回「全部」：恢复全量显示（含 system、tool 消息）

---

### TC-A-013：结束会话流程（P0）

**步骤**：
1. 点击中栏顶部「结束会话」按钮
2. 弹出确认 Modal
3. 点击「确认结束」

**预期**：
- Modal 显示「确认结束与 {访客名} 的会话吗？结束后访客端会话将关闭且不可恢复。」
- `POST /sessions/{id}/close` 被调用
- WS 取消订阅该 sessionId
- 左栏该会话条目从「接待中」移除
- `message.success('会话已结束，正在生成长期记忆摘要...')` 提示
- 若还有其他接待中会话，自动切换到第一个

---

### TC-A-014：结束会话确认弹窗取消（P2）

**步骤**：
1. 点击「结束会话」弹出 Modal
2. 点击「取消」

**预期**：
- Modal 关闭，会话继续正常接待
- 不调用 `POST /sessions/{id}/close`

---

### TC-A-015：SSE CLOSED 事件处理（P1）

**前置**：坐席正在接待，访客主动离开或后端触发关闭

**预期**：
- 收到 SSE `CLOSED` 事件，`closedHandlers` 触发
- 中栏该会话被关闭（从 sessions 移除）
- WS 取消订阅
- `message.warning('会话 {访客名} 已被关闭')` 提示
- 自动切换到其他活跃会话（若有）

---

### TC-A-016：转交会话 Modal 加载（P0）

**步骤**：
1. 点击中栏「转交」按钮

**预期**：
- Modal 弹出，标题「转交会话」，副文本含当前访客名
- `GET /sessions/agents/online` 被调用（加载中时显示 Spin）
- 结果中过滤掉自身（currentAgentId）和已达并发上限的坐席
- 剩余坐席按当前会话数升序排列（空闲优先）
- 每个坐席条目显示：头像首字、姓名、当前会话数、「空闲/忙碌」徽章

---

### TC-A-017：转交会话确认（P0）

**步骤**：
1. 打开转交 Modal
2. 选择一个目标坐席（单选，点击行高亮）
3. 点击「确认转交」

**预期**：
- `POST /sessions/{id}/transfer` body 含 `targetAgentId`
- `message.success('会话已成功转交给 {坐席名}')` 提示
- Modal 关闭，本地移除该会话条目
- WS 取消订阅该 sessionId
- 目标坐席收到 SSE `TRANSFER` 事件，自动接入会话（若未超并发）

---

### TC-A-018：转交未选择坐席（P2）

**步骤**：
1. 打开转交 Modal，不选择任何坐席
2. 点击「确认转交」

**预期**：
- `message.warning('请选择转交坐席')` 提示
- 不调用转交接口

---

### TC-A-019：无可用坐席时转交（P2）

**步骤**：
1. 打开转交 Modal（所有其他坐席离线或已满）

**预期**：
- 坐席列表区域显示空状态：「当前无可转交的座席」图标 + 说明文字
- 「其他座席离线或已达并发上限」说明
- 「确认转交」按钮可点击，但用户无法选中任何坐席，点击时提示「请选择转交坐席」

---

### TC-A-020：接收转入会话（P1）

**前置**：其他坐席将会话转交给当前坐席

**预期**：
- 收到 SSE `TRANSFER` 事件，`toAgentId === currentAgentId`
- 自动调用 `addSessionLocal` 加载历史消息、建立 WS 订阅
- `message.success('已自动接入转交会话：{访客名}')` 提示
- 自动切换到「接待中」Tab，新会话出现在列表中
- 若当前已达并发上限，显示警告提示，不接入

---

### TC-A-021：查看已结束会话（P1）

**步骤**：
1. 切换到左栏「已结束」Tab
2. 点击某个已结束会话条目

**预期**：
- `GET /chat/history?sessionId={id}&sinceSeq=0` 被调用（全量拉取）
- 中栏切换为只读视图（无输入框，无发送按钮）
- 历史消息全量展示（TYPING 信号过滤，不渲染）
- 右栏显示该会话的结束时间、问题标签（只读，无标签/备注编辑功能）
- 顶部显示「已结束」状态徽章

---

### TC-A-022：旁观 AI 对话（P1）

**步骤**：
1. 切换到左栏「AI 对话」Tab
2. 点击某个 AI_CHAT 状态的会话

**预期**：
- 全量拉取该会话历史消息
- 中栏显示只读 AI↔访客对话内容
- 右栏显示「AI 处理中」蓝色徽章
- 中栏顶部显示「接管」按钮

---

### TC-A-023：接管 AI 对话（P1）

**前置**：正在旁观 AI 对话视图

**步骤**：
1. 点击中栏「接管」按钮

**预**：
- 若该会话仍在 `aiQueue`：调用 `acceptQueue` 正常接入
- 若该会话已不在 AI 队列：`message.warning('该会话已不在 AI 对话队列，可能已升级或结束')` 提示
- 接管成功后 `closedView=null`，切换为正常接待模式

---

### TC-A-024：队列搜索过滤（P1）

**步骤**：
1. 在左栏搜索框输入访客名/标签/sessionCode

**预期**：
- 「等待中」Tab 实时过滤，仅显示匹配的条目
- 匹配范围：访客名、问题标签、sessionCode（`#sessionId`）、sessionId
- 搜索词变化时分页重置到第 1 页
- 清空搜索词后恢复全量显示

---

### TC-A-025：等待队列分页（P1）

**前置**：等待队列超过 5 条

**预期**：
- 显示分页器，每页 5 条
- 点击下一页加载第 2 页条目
- 新会话入队时自动重置到第 1 页
- 搜索词变化时重置到第 1 页

---

### TC-A-026：等待时长实时刷新（P1）

**预期**：
- 左栏每个队列条目的等待时长每秒实时更新
- CLOSED 状态的条目不刷新时长（节省计算）
- 时长格式：`Ns`（<60s）、`Nm Ss`（<1h）、`Nh Mm`（>=1h）

---

### TC-A-027：坐席 WS 断线重连（P3）

**步骤**：
1. 模拟坐席 WS 连接断开

**预期**：
- 中栏 WS 状态指示器变为红色「已断开」
- 顶部显示「WS 已断开」提示（或中栏显示重连按钮）
- 点击「重连」按钮，重新建立 WS 连接（`useAgentWsChannel.reconnect(token)`）
- 重连成功后按 `lastSeq` 补齐漏消息（去重）

---

### TC-A-028：WS 状态指示器（P1）

**预期**：
- 连接建立中：黄色「连接中」
- 连接正常：绿色「已连接」
- 连接断开：红色「已断开」
- 指示器位于中栏顶部，访客名旁边

---

### TC-A-029：会话历史加载时过滤 TYPING 信号（P2）

**前置**：历史数据中存在旧版遗留的 TYPING 消息（`{"type":"TYPING"}` 内容）

**预期**：
- 加载历史时 `isTypingSignal()` 过滤掉该条记录
- 不渲染为普通用户消息气泡
- 其他正常消息不受影响

---

### TC-A-030：坐席身份 ID 取值（P2）

**预期**：
- `currentAgentId` 从 `userStore.userInfo.userId` 获取（Sa-Token loginId）
- 不使用 accessToken 字符串（两者不同）
- SSE TRANSFER 事件的 `fromAgentId` / `toAgentId` 与 `userId` 对比，逻辑正确
- 转交 Modal 过滤自身时使用 `userId` 比较（排除自身）

## 六、坐席工作台测试用例（右栏功能：标签、备注、AI 建议、历史工单）

### TC-A-031：右栏会话信息卡片（P0）

**前置**：坐席已接入会话

**预期**：
- 右栏顶部「会话信息」卡片显示：访客姓名、会话编号（`#sessionId`）、问题标签（带颜色）
- Stats 行显示：接入时长（每秒实时刷新）、消息数（非 agent 角色消息数量）、接入状态（进行中）
- 转接原因区块显示橙色背景 + info 图标 + 原因文字（默认「用户主动请求转人工」）
- 问题标签颜色映射：投诉/损坏→红色，退款/订单→橙色，其他→蓝色

---

### TC-A-032：接入时长实时计时（P1）

**预期**：
- `acceptedAt` 为 epoch 秒，接入后每秒计算 `(now - acceptedAt * 1000)`
- 格式正确：`<60s` → `Ns`；`60s-3600s` → `Nm Ss`；`≥3600s` → `Nh Mm`；`≥86400s` → `Nd Hh`
- 组件卸载时 `clearInterval` 正确清理，不留泄漏

---

### TC-A-033：加载访客标签和会话标签（P0）

**前置**：右栏挂载，activeSession 存在

**预期**：
- 并行调用：`GET /sessions/{id}/visitor/tags`、`GET /sessions/{id}/tags`、`GET /sessions/{id}/notes`、`GET /admin/tags`
- 会话切换时清空旧标签/备注，触发新会话的加载
- 若请求期间会话切换（race condition），丢弃过期结果（`activeSession.id !== sessionId` guard）

---

### TC-A-034：添加访客标签（P0）

**步骤**：
1. 点击「访客标签」区域的「+ 添加」按钮
2. 下拉选择一个标签（已有标签不在列表中）

**预期**：
- 显示 Select 下拉框（宽 110px，size=small）
- 下拉选项中不包含已打的标签（`availableVisitorTags` 过滤）
- 选择后立即调用 `POST /sessions/{id}/visitor/tags`，body `{tagId}`
- 成功后新标签出现在标签列表中，Select 隐藏，「+ 添加」按钮恢复
- 失败时 `message.error('添加标签失败')` 提示

---

### TC-A-035：移除访客标签（P0）

**步骤**：
1. 点击访客标签 Tag 组件上的 ✕ 关闭图标

**预期**：
- `DELETE /sessions/{id}/visitor/tags/{tagId}` 被调用
- 该标签从 `visitorTags` 列表移除，UI 立即更新
- 失败时 `message.error('移除标签失败')` 提示

---

### TC-A-036：添加会话标签（P0）

**步骤**：
1. 点击「会话标签」区域的「+ 添加」按钮
2. 从下拉中选择标签

**预期**：
- 逻辑同 TC-A-034，调用路径为 `POST /sessions/{id}/tags`
- `availableSessionTags` 过滤掉已添加的标签

---

### TC-A-037：移除会话标签（P0）

**步骤**：
1. 点击会话标签 Tag 的 ✕

**预期**：
- `DELETE /sessions/{id}/tags/{tagId}` 被调用
- 立即从 `sessionTags` 中移除

---

### TC-A-038：添加内部备注（P0）

**步骤**：
1. 点击「内部备注」区域的「+ 添加」按钮
2. 弹出 Modal，输入备注内容
3. 点击「保存」

**预期**：
- Modal 标题「添加备注」，Textarea 4 行
- `POST /sessions/{id}/notes`，body `{content}`
- 成功后备注追加到列表，Modal 关闭，输入框清空
- 「保存」按钮在请求中显示 loading（`savingNote=true`）
- 失败时 `message.error('保存备注失败')` 提示

---

### TC-A-039：备注内容为空时保存（P2）

**步骤**：
1. 打开备注 Modal，不输入任何内容
2. 点击「保存」

**预期**：
- `!newNoteContent.value.trim()` 守卫阻止调用接口
- Modal 保持打开状态

---

### TC-A-040：删除内部备注（P0）

**步骤**：
1. 鼠标 hover 某备注条目（「删除」按钮 `opacity-0 → 1`）
2. 点击「删除」按钮

**预期**：
- 弹出确认 Modal（`Modal.confirm`）：「确定要删除这条备注吗？」，okType='danger'
- 确认后调用 `DELETE /sessions/{id}/notes/{noteId}`
- 备注从列表中移除
- 失败时 `message.error('删除备注失败')` 提示

---

### TC-A-041：备注列表空状态（P4）

**预期**：
- 无备注时显示「暂无备注」灰色文字（`text-[11px] text-[#9ca3af]`）
- 删除所有备注后正确切换到空状态显示

---

### TC-A-042：AI 回复建议面板触发（P0）

**前置**：坐席接入会话

**步骤**：
1. 点击右栏底部「⚡ AI 回复建议」悬浮按钮

**预期**：
- AI 建议悬浮层以淡入动画（`transition-all duration-200`）覆盖右栏
- 若建议已加载，按钮上显示数量徽章（如「3」）

---

### TC-A-043：AI 回复建议加载（P0）

**预期**：
- 切换到活跃会话时立即触发 `POST /sessions/{id}/reply-suggestions`（delay=0）
- 收到访客新消息后 800ms 触发刷新
- 建议列表展示：内容文本、来源（KB/CONTEXT）、置信度
- 加载中显示 loading spinner，失败显示错误状态 + 刷新按钮

---

### TC-A-044：AI 建议「替换」操作（P1）

**步骤**：
1. 打开 AI 建议面板
2. 点击某条建议的「替换」按钮

**预期**：
- 中栏输入框内容替换为该建议文本（`drafts.set(sid, content)`）
- AI 建议面板关闭（`aiPanelOpen=false`）
- 切换其他会话不影响已替换的草稿

---

### TC-A-045：AI 建议「插入」操作（P1）

**步骤**：
1. 输入框已有内容「前缀文字」
2. 点击建议的「插入」按钮

**预期**：
- 输入框内容变为「前缀文字{建议内容}」（追加，不覆盖）
- AI 建议面板关闭

---

### TC-A-046：AI 建议手动刷新（P1）

**步骤**：
1. 在 AI 建议面板点击刷新按钮

**预期**：
- 立即调用 `POST /sessions/{id}/reply-suggestions`
- 旧建议列表清空，显示 loading
- 新建议加载完成后展示

---

### TC-A-047：AI 建议面板关闭（P4）

**步骤**：
1. 点击 AI 建议面板右上角 ✕

**预期**：
- 面板以淡出动画（`duration-150 ease-in`）退出
- 右栏恢复展示会话信息、标签、备注等内容
- 建议内容保留（重新打开时仍显示之前的结果，不重新加载）

---

### TC-A-048：右栏历史工单预览（P1）

**预期**：
- 右栏「历史会话」区显示最新 2 条历史工单（预览，带标签、原因、结束日期）
- 显示「N 条记录」计数徽章
- 访客无历史工单时显示空状态：「该访客此前未发起过会话」

---

### TC-A-049：历史工单抽屉（P0）

**步骤**：
1. 点击「查看全部会话」按钮

**预期**：
- 右侧抽屉弹出（宽 440px），标题「历史工单记录」
- `GET /sessions/visitor-history?visitorName={name}&excludeSessionId={currentId}` 被调用
- 抽屉中每条工单以手风琴面板展示（Collapse）
- 工单头部显示：标签（颜色）、转接原因（截断）、结束日期
- 展开后显示：开始日期、消息轮数、AI 总结区块

---

### TC-A-050：生成历史工单 AI 摘要（P0）

**步骤**：
1. 展开历史工单抽屉中某条记录
2. 点击「生成总结」按钮

**预期**：
- 按钮变为「生成中…」+ loading 状态
- `EventSource /sessions/{id}/ai-summary/stream?token=` 连接建立
- 摘要文字以流式打字机效果逐字显示，气泡右下角有脉冲光标
- 流结束后按钮变为「重新生成」
- 失败时回退到初始状态

---

### TC-A-051：重新生成 AI 摘要（P1）

**步骤**：
1. 已生成摘要的工单，点击「重新生成」

**预期**：
- 重新建立 SSE 连接，旧摘要文本被清空
- 新摘要以流式方式填充

---

### TC-A-052：已结束会话右栏只读状态（P1）

**前置**：左栏点击「已结束」Tab 中的会话，中栏进入只读视图

**预期**：
- 右栏显示「会话信息」卡片，状态徽章为灰色「已结束」
- 显示结束时间字段（进行中会话无此字段）
- 不显示标签编辑（访客标签、会话标签的「+ 添加」按钮）
- 不显示内部备注编辑入口
- 不显示「AI 回复建议」悬浮按钮

---

### TC-A-053：AI 对话旁观视图右栏（P1）

**前置**：左栏点击「AI 对话」Tab 的会话，中栏进入旁观预览

**预期**：
- 右栏状态徽章为蓝色「AI 处理中」
- 无结束时间字段
- 其余同只读状态（无编辑入口）

---

### TC-A-054：切换会话时右栏标签/备注重新加载（P1）

**步骤**：
1. 坐席接待会话 A，右栏显示 A 的标签
2. 切换到会话 B

**预期**：
- 切换时立即清空：`visitorTags=[]`、`sessionTags=[]`、`notes=[]`
- 新调用 `Promise.all([listVisitorTags(B), listSessionTags(B), listNotes(B), listTags()])`
- B 的数据加载完成后显示，不残留 A 的数据

---

### TC-A-055：右栏在无活跃会话时不显示（P1）

**前置**：坐席无任何接待中会话，也无 closedView

**预期**：
- 右栏（`AgentRightPanel`）被 `v-if="activeSession || closedView"` 条件隐藏
- 布局自动收缩为左栏 + 中栏两栏

## 七、端到端集成场景与边界条件

### 7.1 完整端到端流程测试

#### TC-E2E-001：访客从 AI 对话到人工接待完整链路（P0）

**角色**：浏览器 Tab A（访客）+ 浏览器 Tab B（坐席后台）

**步骤**：
1. Tab B：坐席登录，进入 `/customerservice/agent`，SSE 已连接
2. Tab A：打开 `/chat`，发送普通问题，AI 正常回答
3. Tab A：点击「转人工」按钮
4. Tab B：观察「等待中」Tab
5. Tab B：点击接入该会话
6. Tab A：观察会话状态变化
7. 双向发送若干条消息
8. Tab B：点击「结束会话」
9. Tab A：观察会话结束状态

**预期**：
- Step 3：`POST /chat/transfer` 成功，Tab A 顶栏变「👤 人工服务中」，WS 建立
- Step 4：Tab B 左栏收到 SSE `ENQUEUE`，新条目出现，等待时长开始计时
- Step 5：`POST /sessions/{id}/accept` 成功，Tab B 切到「接待中」Tab
- Step 6：Tab A 收到 WS `AGENT_JOINED`，`agentJoined=true`，后续输入触发 TYPING 信号
- Step 7：
  - 访客消息在坐席中栏右对齐显示，坐席消息在访客聊天页左对齐「👤 人工客服」
  - 坐席收到访客 TYPING 信号时中栏显示「正在输入…」
- Step 8：`POST /sessions/{id}/close` 成功
- Step 9：Tab A 收到 WS close(1000)，出现「本次会话已结束」分隔条，输入区变「开始新对话」按钮，CSAT 卡片出现（若后端推送评价邀请）

---

#### TC-E2E-002：AI 工具触发转人工流程（P0）

**步骤**：
1. 访客发送触发 AI 工具转接的消息（如「我要投诉」）
2. SSE 流返回 `event:transfer`

**预期**：
- 前端收到 `event:transfer` 后：`transfer.markTransferred()` + `ws.connect()`
- **不**再调用 `POST /chat/transfer`（防二次入队）
- 坐席端收到 SSE `ENQUEUE`，与手动转人工流程相同
- Tab A 顶栏变为「👤 人工服务中」

---

#### TC-E2E-003：坐席间转交完整链路（P0）

**角色**：坐席 A（当前接待）+ 坐席 B（接收转交）

**步骤**：
1. 坐席 A 打开转交 Modal，选择坐席 B
2. 坐席 A 确认转交
3. 坐席 B 观察

**预期**：
- `POST /sessions/{id}/transfer {targetAgentId: B.id}` 成功
- 坐席 A：会话从「接待中」移除，WS 取消订阅
- 坐席 B：收到 SSE `TRANSFER`（`toAgentId === B.userId`），自动调用 `addSessionLocal`，消息成功提示，会话出现在「接待中」
- 访客端：WS 不中断，消息继续正常收发（后端透明转交）

---

#### TC-E2E-004：页面刷新后完整状态恢复（P3）

**前置**：访客正在 WS 人工会话中（ACTIVE 状态），坐席接待中

**步骤**：
1. 访客刷新页面

**预期**：
- `POST /chat/session/init` 返回已有 sessionId（`isNew: false`）
- 从 localStorage 恢复历史消息
- `GET /chat/state` 返回 ACTIVE → `markTransferred()` + `ws.connect()`
- `GET /chat/auth/state` 恢复认证态（若之前已认证）
- `GET /chat/csat/pending` 恢复 CSAT 邀请（若有）
- 重连成功后收到 WS `AGENT_JOINED`（若座席仍在线），`agentJoined=true`

---

### 7.2 并发与竞争条件

#### TC-RACE-001：多次点击「接入」防重入（P2）

**步骤**：
1. 快速连续点击同一等待队列条目的「接入」按钮 2 次

**预期**：
- 第一次点击后条目已从队列乐观移除
- 第二次点击找不到该条目，不重复调用 `POST /sessions/{id}/accept`
- 不出现重复的会话条目

---

#### TC-RACE-002：并发初始化 session 幂等性（P2）

**步骤**：
1. 同一 anonymousId 在两个标签页同时打开 `/chat`

**预期**：
- 两个标签页均调用 `POST /chat/session/init`（同一 X-Anonymous-Id）
- 后端分布式锁保证返回同一 sessionId（`isNew: false` 对后发请求）
- 两个标签页共享同一 sessionId，但 WS 连接被 KICKED_OUT 处理（最后一个连接胜出）

---

#### TC-RACE-003：切换会话时 reply-suggestions 请求竞争（P2）

**步骤**：
1. 快速切换会话 A → B → C

**预期**：
- 切换时使用 AbortSignal 取消进行中的请求
- 最终只展示会话 C 的建议结果
- 不出现旧会话建议覆盖新会话的情况

---

#### TC-RACE-004：加载标签期间切换会话（P2）

**步骤**：
1. 切换到会话 A，触发标签/备注加载请求（网络较慢）
2. 在请求返回前切换到会话 B

**预期**：
- `loadTagsAndNotes` 内的 guard `if (props.activeSession?.id !== sessionId) return` 生效
- 会话 A 的响应数据被丢弃，不覆盖会话 B 的数据
- 会话 B 的标签正常加载显示

---

### 7.3 网络异常与降级

#### TC-NET-001：会话初始化接口失败降级（P3）

**步骤**：
1. 模拟 `POST /chat/session/init` 超时或 500 错误
2. 打开 `/chat`

**预期**：
- 从 localStorage 读取 `chat_session_id` 作为兜底
- 若无本地缓存，生成临时 `guest-{timestamp}-{uuid}` sid
- 聊天页仍可正常渲染，用户可输入消息
- 网络恢复后下次刷新重新走后端 init

---

#### TC-NET-002：发送消息时 SSE 连接失败（P3）

**步骤**：
1. 发送消息，`POST /chat/stream` 返回网络错误

**预期**：
- AI 气泡显示「抱歉，AI 服务暂时不可用，请点击重试。」橙色错误样式
- 下方出现「🔄 重新生成」按钮
- 不再继续尝试流式连接
- 点击重试后正常发起新请求

---

#### TC-NET-003：标签/备注加载失败（P3）

**步骤**：
1. `GET /sessions/{id}/visitor/tags`（或 notes / tags）返回 5xx

**预期**：
- `message.error('加载标签和备注失败')` 提示
- 标签/备注列表为空，不崩溃
- 其他功能（消息发送、建议、历史）不受影响

---

#### TC-NET-004：添加/移除标签失败（P3）

**步骤**：
1. 添加访客标签，接口返回 4xx/5xx

**预期**：
- `message.error('添加标签失败')` 提示
- 标签列表不更新（无乐观更新，防止 UI 与后端不一致）
- Select 下拉关闭，「+ 添加」按钮恢复

---

### 7.4 边界条件

#### TC-EDGE-001：消息历史超过 100 条（P2）

**预期**：
- `saveHistory` 仅保存最近 100 条（`msgs.value.slice(-HISTORY_MAX_SIZE)`）
- 第 101+ 条消息超出范围，旧消息被截断
- 不因 localStorage 超限崩溃（try/catch 静默处理）

---

#### TC-EDGE-002：lastSeq 防回退机制（P2）

**预期**：
- `writeLastSeq` 只在新值 > 当前值时更新
- 乱序消息（seq 较小）不会回退游标
- 断线重连后拉取的历史消息 seq ≤ lastSeq 时被跳过（`seqNum <= sinceSeqSnapshot` 条件）

---

#### TC-EDGE-003：CSAT 邀请过期处理（P2）

**前置**：localStorage 中有 CSAT 邀请，但 `expiresAt` 已过期

**步骤**：
1. 刷新页面

**预期**：
- `readCsatInvite` 检测到过期，返回 null，移除 localStorage 键
- 不展示过期的 CSAT 卡片
- 服务端 `GET /chat/csat/pending` 也返回空，双重兜底

---

#### TC-EDGE-004：历史记录中存在 TYPING 信号过滤（P2）

**前置**：后端历史数据中存在旧版遗留的 `{"type":"TYPING"}` 消息

**预期**：
- `isTypingSignal(content)` 返回 true，该消息被 filter 过滤
- 不渲染为普通用户消息气泡
- 仅过滤 content 以 `{` 开头且 `type === "TYPING"` 的消息，不误杀正常 JSON 内容

---

#### TC-EDGE-005：inputText 空输入防发送（P2）

**步骤**：
1. 输入框为空时点击发送按钮（或按 Enter）

**预期**：
- `sendMsg` 中 `!text` 守卫生效，不发送任何请求
- 发送按钮保持 disabled（`:disabled="!inputText.trim()"`）

---

#### TC-EDGE-006：坐席输入框为空防发送（P2）

**步骤**：
1. 坐席输入框为空时点击发送

**预期**：
- `sendAgent` 中 `!text` 守卫生效，不调用 WS send
- 不追加空消息气泡

---

#### TC-EDGE-007：快速开始新对话（P2）

**步骤**：
1. 连续点击「开始新对话」按钮 2 次

**预期**：
- `sessionInitializing.value = true` 防止重入（第二次点击被 `:disabled` 阻止）
- 仅调用一次 `POST /chat/session/init`
- 页面不出现双重 session_start 分隔条

---

### 7.5 布局与视觉

#### TC-UI-001：聊天页响应式最小宽度（P4）

**预期**：
- 聊天页最大宽度 672px（`max-w-2xl`），居中显示
- 高度 90vh，最大 800px
- 消息气泡 `max-w-sm` 约束，长文本自动换行（`overflow-wrap: break-word`）

---

#### TC-UI-002：坐席工作台三栏布局（P4）

**预期**：
- 左:中:右 = 2:6:2，flex 布局，`min-w-0` 防止溢出
- 内容高度 `h-full min-h-0`，各栏独立滚动
- 窗口缩小时各栏内容不溢出布局容器

---

#### TC-UI-003：消息区自动滚动到底部（P1）

**预期**：
- 新消息追加后自动滚动到底部（`scrollIntoView({ behavior: 'smooth' })`）
- 坐席端：仅在贴近底部时自动滚动（向上翻阅历史时不强制拽回）
- 访客端：每次新消息/AI token 追加后 `scrollBottom()` 调用

---

#### TC-UI-004：访客消息与坐席消息气泡对齐（P4）

**预期**：
- 访客发送的消息：右对齐，蓝紫色背景（`#4f46e5`）
- AI 消息：左对齐，浅灰背景（`#f8fafc`）
- 坐席消息：左对齐，浅蓝背景（`#f0f9ff`），含「👤 人工客服」标签
- 失败消息：对应角色气泡背景变红色/橙色

---

### 7.6 测试数据清单

执行测试前建议准备以下数据：

| 数据项 | 说明 | 用途 |
|---|---|---|
| 坐席账号 × 2 | 用于转交测试（坐席 A 转给坐席 B） | TC-A-017、TC-E2E-003 |
| 标签字典 ≥ 3 条 | 含不同颜色（红/橙/蓝） | TC-A-034～037 |
| 快捷回复 ≥ 1 条 | 中栏输入框快捷回复面板 | CannedResponsePicker 测试 |
| 历史工单 ≥ 2 条（同访客） | 测试右栏历史工单预览和抽屉 | TC-A-049 |
| 测试手机号 | 可收到短信验证码的真实号码 | TC-C-008 |
| 知识库文档 ≥ 1 篇 | 可触发 `event:sources` 溯源 | TC-C-004 |
| AI 工具配置 | 配置转接工具（用于 TC-E2E-002） | TC-C-005、TC-E2E-002 |

---

### 7.7 已知潜在风险点

| 风险 | 描述 | 关注测试点 |
|---|---|---|
| WS 长连接稳定性 | Nginx proxy_read_timeout 默认 60s，心跳 25s 应足够但需验证 | TC-C-015 |
| localStorage 配额 | 每域 5-10MB，消息历史存 100 条可能超限 | TC-EDGE-001 |
| SSE EventSource token 泄露 | token 在 URL query 参数中，可能被代理日志记录 | 安全审查项 |
| 多标签 KICKED_OUT 无限循环 | 旧标签页不重连，已用 kickedOut 标志处理 | TC-C-017 |
| seq 类型不一致 | 后端 Long 序列化为 string，前端需 Number() 归一化 | TC-EDGE-002 |
| race condition 旧请求覆盖 | 标签加载、建议加载均有 guard/AbortSignal 保护 | TC-RACE-003、TC-RACE-004 |
| CSAT 孤儿记录 | 开新对话时旧 CSAT 未提交/跳过会调 skip，但网络失败静默忽略 | TC-C-022 |
