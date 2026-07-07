# 客服工作台（`/customerservice/agent`）UI 自动化测试用例 — 深度覆盖

> 配套文档：`docs/UI自动化测试用例.md`（总文档，426 条，覆盖全站）、`docs/UI自动化测试用例-对话全场景与多角色联动.md`（对话/多角色联动）。
> 本文件聚焦**座席工作台单页**的每一个可交互场景，逐用例给出：用例名称 / 前置条件 / 操作步骤 / 预期结果 / 断言点（含可直接落地的 Playwright 选择器）。
> 用例事实依据：已对照真实前端代码 `apps/src/views/customerservice/agent/index.vue`、composables `useSessionQueue.ts` / `useAgentWebSocket.ts` 与后端 `ai-conversation` 模块逆向得出。

---

## 0. 本次功能完善摘要（测试同学必读）

为让工作台"更丰富且可测"，本次基于**后端真实存在**的字段/接口落地了以下增强（不臆造后端没有的数据）：

| 增强点 | 落地位置 | 真实依据 |
|---|---|---|
| 右栏"会话信息"展示真实数据 | `index.vue` 右栏 | 后端 `SessionQueueItem` 提供 `userName / sessionId / tag / waitSince`；`waitSince` 派生"排队时长"，`tag` 经 `resolveTagColor` 着色 |
| 系统消息（SYSTEM 角色）居中渲染 | 消息列表 `v-if="m.role==='system'"` | 后端 `MessageRole.SYSTEM` 已定义，历史接口返回该角色 |
| 结束会话二次确认弹窗 | `closeConfirmVisible` + Modal（确认文案"确认结束"） | 防误关，纯前端 UX |
| 队列搜索（姓名/标签/会话编号） | `queueSearch` + `visiblePagedQueue` / `visibleSessions` | 客户端过滤已加载队列 |
| SSE 断线横幅 + 手动重连 | `!sseConnected` → Alert + `reconnectQueue()` | `useSessionQueue.reconnect()` 复用订阅回调 |
| 当前会话 WS 状态点 + 重连 | `activeWsStatus` / `reconnectActiveSession()` | `useAgentWebSocket` 暴露 `statusMap`/`getStatus` |

### 后端明确**未实现**、测试中不得臆造断言的能力
（来源：全仓检索 `ai-conversation` / `ai-auth`，无任何对应字段或接口）
- 消息**已送达 / 已读回执**（WS 仅 `MESSAGE/AGENT_JOINED/CONNECTED` 三种类型）
- **满意度评价（CSAT）**、**会话备注 / 标签编辑**（tag 为只读、单一自由文本）
- **座席忙碌/离开状态**（在线表仅二进制 online + 会话数）
- **客户来源渠道 / 富媒体消息（图片/文件）/ 话术库 / AI 会话摘要 / 会话搜索导出 / 客户画像**

> 因此"消息状态"真实只有 **发送中（WS 建连中）→ 已发送（WS open）**；"结束会话"的信号是 **WS code=1000 关闭**，不是消息体。

---

## 1. 测试环境与前置

| 项 | 值 |
|---|---|
| 前端 baseURL | `http://localhost:5670`（Playwright `baseURL`，可由 `BASE_URL` 覆盖） |
| 后端 API | `http://localhost:8082/api/v1/*`（会话/对话），`http://localhost:8083/api/v1/auth/*`（登录） |
| 鉴权 | 座席 token 经 `addInitScript` 注入 `core-access` Pinia 持久化 key（含 `accessToken`）与 `Authorization` cookie |
| 账号 | `fixtures.ts` 中 `E2E_SUPERADMIN_*`、`E2E_KFMANAGER_*`（经 `POST /api/v1/auth/login` 直取 token） |
| 实时通道 | SSE `/api/v1/sessions/events?token=`；WS `/ws/agent/{sid}?token=` |
| 运行 | `pnpm test:e2e`（Playwright）；座席相关用例见 `apps/tests/e2e/agent-*.spec.ts` |

**通用前置（座席侧）**：浏览器 `newContext` → `addInitScript` 注入 token → `goto /customerservice/agent` → 断言主标题"座席工作台"与描述"实时接待转接会话"可见 → 等待 SSE `onopen`（约 3–4s）确保后端将该座席注册为 online。

---

## 2. 用例分组与清单

| 分组 | 用例数 | 编号前缀 |
|---|---|---|
| 2.1 座席状态与并发上限 | 4 | TC-WB-STAT |
| 2.2 等待队列（等待人工 Tab） | 5 | TC-WB-QUEUE |
| 2.3 接入与接待中会话 | 5 | TC-WB-ACTIVE |
| 2.4 对话窗口与消息收发 | 6 | TC-WB-MSG |
| 2.5 消息类型筛选 | 3 | TC-WB-FILTER |
| 2.6 快捷回复 | 3 | TC-WB-QUICK |
| 2.7 转交（座席间） | 4 | TC-WB-TRANSFER |
| 2.8 结束会话（含确认） | 4 | TC-WB-CLOSE |
| 2.9 已结束会话只读回看 | 3 | TC-WB-CLOSED |
| 2.10 右栏上下文面板（强化） | 5 | TC-WB-CTX |
| 2.11 队列搜索 | 4 | TC-WB-SEARCH |
| 2.12 系统消息居中渲染 | 3 | TC-WB-SYS |
| 2.13 SSE / WS 连接与断线 | 5 | TC-WB-CONN |
| 2.14 边界与异常 | 5 | TC-WB-EDGE |
| **合计** | **59** | |

---

## 3. 逐用例详情

### 2.1 座席状态与并发上限（TC-WB-STAT）
**TC-WB-STAT-01 座席状态默认在线**
- 前置：座席以有效 token 进入工作台。
- 步骤：观察左上"座席状态"卡片中的 Switch。
- 预期：Switch 默认处于"在线"（checked-children="在线"），文案显示"X/5 会话接待中"。
- 断言：`Switch` 处于开启；右侧进度 `Progress` 文案匹配 `/^\d+\/5$/`。

**TC-WB-STAT-02 切换为"暂离"**
- 步骤：点击 Switch 切换为"暂离"。
- 预期：文案切换为"暂离"，不触发任何后端请求（当前 `agentOnline` 为本地态，断言网络无 `sessions` 写请求即可）。
- 断言：`Switch` 关闭；页面无报错。

**TC-WB-STAT-03 并发进度随接入实时增长**
- 前置：清空进行中会话。
- 步骤：通过 API `POST /sessions/{sid}/accept` 接入 3 个不同 sid，并刷新页面让 `onMounted` 重建。
- 预期：进度 `1/5 → 3/5`，颜色随阈值变化。
- 断言：`Progress` 文案依次匹配 `/^1\/5$/`、`/^3\/5$/`；达到上限时颜色为 `#ef4444`。

**TC-WB-STAT-04 达并发上限（5）后接入被拦截**
- 前置：已接入 5 个会话（MAX_CONCURRENT=5）。
- 步骤：在"等待人工"Tab 点击第 6 个会话的"接入会话"。
- 预期：弹出警告"已达最大并发数（5），请先结束其他会话"，会话不进入接待中。
- 断言：`message.warning` 文本可见；等待队列项未被移除（仍可见）。

### 2.2 等待队列（TC-WB-QUEUE）
**TC-WB-QUEUE-01 队列实时推入（SSE ENQUEUE）**
- 前置：座席在线监听。
- 步骤：访客端或 API `POST /chat/transfer` 触发新会话。
- 预期：约 1s 内左侧出现新卡片，toast"新会话请求：{userName}"，徽标计数 +1。
- 断言：卡片含 `Avatar`、姓名、`等待 mm:ss`、`Tag(标签)`、"接入会话"按钮；`Badge` 计数 = 当前队列长度。

**TC-WB-QUEUE-02 等待时长每秒刷新**
- 步骤：记录某卡片"等待 0:03"，静置 2 秒。
- 预期：文案变为"等待 0:05"。
- 断言：文本由 `0:03` 变为 `0:05`（允许 ±1s 误差）。

**TC-WB-QUEUE-03 接入会话成功**
- 步骤：点击"接入会话"。
- 预期：卡片从等待队列消失，跳到"人工接待中"Tab，右侧出现对话窗口，"接入会话"按钮变"结束会话/转交"。
- 断言：等待 Tab 该 `sid` 不再可见；`activeSession.name` 可见；SSE `ACCEPTED` 已从队列移除。

**TC-WB-QUEUE-04 分页（每页 5）**
- 前置：制造 ≥6 个等待会话。
- 步骤：滚动到底部，点击"下一页 →"。
- 预期：显示第 6+ 个会话，页码 `2 / N`。
- 断言：`queueTotalPages>1`；分页控件可见；新页 `v-for` 渲染不同 `sid`。

**TC-WB-QUEUE-05 空队列引导态**
- 前置：无等待会话且搜索为空。
- 步骤：停留在"等待人工"Tab。
- 预期：显示咖啡图标 + "暂无等待用户 / 轻松一下，队列空空如也" + "实时监听中"脉冲点。
- 断言：文案"暂无等待用户"可见。

### 2.3 接入与接待中会话（TC-WB-ACTIVE）
**TC-WB-ACTIVE-01 多会话并列切换**
- 前置：已接入 ≥2 个会话。
- 步骤：点击"人工接待中"Tab 中第二个会话。
- 预期：中栏对话与右栏上下文切换至该会话，左侧高亮项变更。
- 断言：中栏标题 = 被点击会话 `name`；右栏"会话编号"= `#{sid}`。

**TC-WB-ACTIVE-02 切换会话重置消息筛选**
- 前置：在某会话将筛选切到"人工回复"。
- 步骤：切换到另一会话。
- 预期：`msgFilter` 重置为"全部"。
- 断言：筛选胶囊中"全部"高亮。

**TC-WB-ACTIVE-03 接待中并发进度联动**
- 步骤：接入/结束会话，观察进度。
- 预期：进度 = 当前 `sessions.length`。
- 断言：`/^\d+\/5$/` 与实际会话数一致。

**TC-WB-ACTIVE-04 刷新页面恢复 ACTIVE 会话（onMounted 兜底）**
- 步骤：接入会话后 `page.reload()`。
- 预期：`getActiveSessionsApi` 返回 ACTIVE 会话，自动重建列表与 WS 连接。
- 断言：刷新后中栏仍显示该会话；历史消息已加载（非仅欢迎语）。

**TC-WB-ACTIVE-05 接入后自动加载历史消息**
- 前置：该 sid 在访客端已有若干消息。
- 步骤：点击"接入会话"。
- 预期：对话窗口渲染访客历史（user/ai），并写入 `lastSeq` 供增量补齐。
- 断言：消息区包含访客历史文本；`localStorage` 存在 `agent_last_seq_{sid}`。

### 2.4 对话窗口与消息收发（TC-WB-MSG）
**TC-WB-MSG-01 座席发送消息回显**
- 前置：处于某 ACTIVE 会话，WS 已连接。
- 步骤：输入框键入"已为您处理"，点击发送（或 Enter）。
- 预期：消息以橙色气泡（role=agent）立即回显在右侧。
- 断言：对话区出现文本"已为您处理"且位于 agent 气泡中。

**TC-WB-MSG-02 Enter 发送 / Shift+Enter 换行**
- 步骤：输入框输入"第一行"，按 `Shift+Enter`，再输入"第二行"，按 `Enter`。
- 预期：Shift+Enter 不发送（保留换行），Enter 发送整条。
- 断言：发送后消息含换行；未因 Shift+Enter 产生两条空消息。

**TC-WB-MSG-03 WS 未连接时发送被拦截**
- 前置：手动断网或当前会话 WS 断开（见 TC-WB-CONN）。
- 步骤：尝试发送。
- 预期：不回显，提示"WebSocket 未连接，请重新接入会话"。
- 断言：`message.warning` 文本可见；对话区无新气泡。

**TC-WB-MSG-04 收到访客消息实时渲染**
- 前置：座席 ACTIVE 某会话，访客在线。
- 步骤：访客端发送一条消息。
- 预期：座席侧约 1s 内出现紫色访客气泡，自动滚动到底部。
- 断言：对话区出现访客消息文本；滚动锚点 `data-msgs-end` 进入视口。

**TC-WB-MSG-05 消息复制**
- 前置：存在带文本且带时间的消息。
- 步骤：点击消息下方复制图标。
- 预期：toast"已复制"，剪贴板含该文本。
- 断言：`message.success('已复制')` 可见。

**TC-WB-MSG-06 AI 消息 Markdown 渲染**
- 前置：历史含 AI（assistant）消息且带 Markdown（如列表/代码）。
- 步骤：查看该消息。
- 预期：`v-html="marked.parse(...)"` 渲染为富文本（非纯文本源码）。
- 断言：消息内含 `<li>`/`<code>` 等元素；不包含字面量 `###` 源码。

### 2.5 消息类型筛选（TC-WB-FILTER）
**TC-WB-FILTER-01 全部**
- 步骤：点击"全部"。
- 预期：显示 user/ai/agent/system 所有消息。
- 断言：`filteredMsgs.length` = 全部。

**TC-WB-FILTER-02 AI 对话**
- 步骤：点击"AI 对话"。
- 预期：仅显示 user + ai（含 system 不在此视图）。
- 断言：对话区无 `role=agent` 气泡；保留 user/ai。

**TC-WB-FILTER-03 人工回复**
- 步骤：点击"人工回复"。
- 预期：仅显示 user + agent。
- 断言：对话区无 `role=ai` 气泡；保留 user/agent。

### 2.6 快捷回复（TC-WB-QUICK）
**TC-WB-QUICK-01 点击填充输入框**
- 步骤：点击某快捷回复 Tag（如"已核实订单信息"）。
- 预期：输入框被填入该文本，未自动发送。
- 断言：`Textarea` 值 = 该文本。

**TC-WB-QUICK-02 多条依次点击覆盖**
- 步骤：先点 A 再点 B。
- 预期：输入框为最后点击的 B。
- 断言：值为 B。

**TC-WB-QUICK-03 填充后可编辑再发送**
- 步骤：点快捷回复 → 修改文本 → 发送。
- 预期：发送修改后的文本。
- 断言：对话区出现修改后的文本。

### 2.7 转交（座席间）（TC-WB-TRANSFER）
**TC-WB-TRANSFER-01 打开转交 Modal 并列出在线座席**
- 前置：存在另一 online 座席（如 kfmanager）。
- 步骤：点击"转交"。
- 预期：Modal 标题"转交会话"，列出在线且未满并发的座席。
- 断言：Modal 可见；列表含目标座席 `name`；超出并发者不出现。

**TC-WB-TRANSFER-02 按会话数升序排序（引导低负载）**
- 预期：列表按 `sessions` 升序。
- 断言：第一个座席的 `sessions` ≤ 后续座席。

**TC-WB-TRANSFER-03 确认转交后本地移除 + 目标自动接入**
- 步骤：选择目标 → "确认转交"。
- 预期：本地立即移除该会话；目标座席收到 SSE `TRANSFER` 自动接入（见 N-03 闭环）。
- 断言：转出方 `sessions` 中 `sid` 消失；转入方 UI 出现 `#{sid}` 与 `/1\s*\/\s*5\s*会话接待中/`。

**TC-WB-TRANSFER-04 未选座席点击确认被拦截**
- 步骤：打开 Modal 不选择 → 点击"确认转交"。
- 预期：提示"请选择转交坐席"，不发起请求。
- 断言：`message.warning('请选择转交坐席')` 可见。

### 2.8 结束会话（含确认）（TC-WB-CLOSE）
**TC-WB-CLOSE-01 点击结束会话弹出确认**
- 步骤：在 ACTIVE 会话点击"结束会话"。
- 预期：弹出 Modal"结束会话"，含"确认结束/取消"。
- 断言：Modal 可见；"确认结束"按钮存在。

**TC-WB-CLOSE-02 取消不结束**
- 步骤：弹窗内点击"取消"。
- 预期：弹窗关闭，会话仍在。
- 断言：Modal 关闭；中栏仍显示该会话。

**TC-WB-CLOSE-03 确认结束 → 访客侧 code=1000 关闭（N-05 闭环）**
- 步骤：弹窗点击"确认结束"。
- 预期：调用 `POST /sessions/{sid}/close`；访客 WS 收 code=1000 → 显示"会话已结束"。
- 断言：访客页出现"会话已结束"；"转人工"按钮恢复。

**TC-WB-CLOSE-04 结束后本地清理 + 切到下一会话**
- 预期：该会话从 `sessions` 移除；若有其它会话则自动激活第一个。
- 断言：中栏标题切换；被结束 `sid` 不再在"人工接待中"列表。

### 2.9 已结束会话只读回看（TC-WB-CLOSED）
**TC-WB-CLOSED-01 切到"已结束"Tab 懒加载**
- 步骤：点击"已结束"Tab。
- 预期：首次进入触发 `getClosedSessionsApi()`，显示 `Spin` 后列表。
- 断言：列表项含姓名、`endedAt`、标签；空态显示"暂无已结束会话"。

**TC-WB-CLOSED-02 点击查看只读详情**
- 步骤：点击某已结束项。
- 预期：中栏切换为只读视图，渲染全部历史（含 user/ai/agent/system），不可输入。
- 断言：`Textarea`/发送按钮不可见；消息区含历史文本。

**TC-WB-CLOSED-03 离开 Tab 清空只读视图（省内存）**
- 步骤：切回其它 Tab。
- 预期：`closedView` 被清空。
- 断言：内存中 `closedView` 为 null（无报错）。

### 2.10 右栏上下文面板（强化）（TC-WB-CTX）
**TC-WB-CTX-01 会话信息：访客姓名 / 会话编号**
- 前置：处于 ACTIVE 会话。
- 步骤：查看右栏"会话信息" `Descriptions`。
- 预期：含"访客姓名 = name"、"会话编号 = #{sid}"。
- 断言：文本含 `name` 与 `#{sid}`。

**TC-WB-CTX-02 会话信息：问题标签着色**
- 预期：标签按 `resolveTagColor` 着色（投诉=red/退款=orange/订单·账单=blue）。
- 断言：`Tag` 的 `color` 与标签值匹配映射表。

**TC-WB-CTX-03 会话信息：排队时长**
- 前置：`waitSince>0`。
- 预期：显示"排队时长 = mm:ss"（由 `formatWaitTime(waitSince)` 派生）。
- 断言：文本匹配 `/^\d+:\d{2}$/`。

**TC-WB-CTX-04 会话信息：消息轮数 / 接入状态**
- 预期：显示非 agent 消息轮数；"接入状态 = 进行中"（processing 标签）。
- 断言：轮数为数字；"进行中"标签可见。

**TC-WB-CTX-05 转接原因展示**
- 预期："转接原因" `Alert` 显示 `transferReason`（缺省"用户主动请求转人工"）。
- 断言：`Alert` 文本 = 实际 `transferReason`。

### 2.11 队列搜索（TC-WB-SEARCH）
**TC-WB-SEARCH-01 按姓名过滤等待队列**
- 前置：等待队列含"赵测试""钱测试"。
- 步骤：在搜索框输入"赵"。
- 预期：等待列表仅显示含"赵"的项。
- 断言：可见卡片名含"赵"；"钱"卡片消失。

**TC-WB-SEARCH-02 按标签过滤**
- 步骤：输入标签名（如"投诉"）。
- 预期：仅显示该标签会话。
- 断言：可见项 `Tag` 文本 = "投诉"。

**TC-WB-SEARCH-03 按会话编号过滤 + 无匹配态**
- 步骤：输入完整/部分 `sid`；再输入不存在串。
- 预期：匹配时仅显示该会话；无匹配显示"未找到匹配"XXX"的会话"。
- 断言：无匹配时文案"未找到匹配"可见。

**TC-WB-SEARCH-04 搜索接待中列表 + 清空恢复**
- 步骤：切到"人工接待中"Tab，输入关键字；点清空图标。
- 预期：仅匹配项可见；清空后恢复全部。
- 断言：清空后列表长度 = 全部会话数。

### 2.12 系统消息居中渲染（TC-WB-SYS）
**TC-WB-SYS-01 SYSTEM 角色居中提示**
- 前置：历史含 `role=system` 消息（如接入通知/转交通知）。
- 步骤：查看对话区。
- 预期：该消息以居中灰色胶囊渲染，无头像气泡。
- 断言：消息 DOM 为 `justify-center` 的 `span` 胶囊；无 `Avatar`。

**TC-WB-SYS-02 系统消息不出现在"人工回复"筛选**
- 步骤：切到"人工回复"筛选。
- 预期：系统消息被隐藏（仅 user+agent）。
- 断言：系统胶囊不可见。

**TC-WB-SYS-03 已结束会话只读视图同样居中**
- 步骤：在已结束详情中查看 system 消息。
- 预期：同上居中样式。
- 断言：居中胶囊可见。

### 2.13 SSE / WS 连接与断线（TC-WB-CONN）
**TC-WB-CONN-01 SSE 连接状态点**
- 前置：正常在线。
- 预期：队列卡片标题处的 `Badge` 为 `processing`（绿点）。
- 断言：`Badge status='processing'`。

**TC-WB-CONN-02 SSE 断开横幅 + 立即重试**
- 步骤：模拟 SSE 断线（停后端 SSE 或网络）→ 断言横幅出现 → 点击"立即重试"。
- 预期：顶部出现"实时连接已断开，正在自动重连…"；点击后重新 `subscribeQueue`。
- 断言：Alert 可见；点击后状态点恢复 `processing`。

**TC-WB-CONN-03 当前会话 WS 状态点**
- 前置：ACTIVE 会话 WS 已连。
- 预期：中栏标题右侧状态点显示"已连接"（绿）。
- 断言：状态文本 = "已连接"；颜色 `#10b981`。

**TC-WB-CONN-04 WS 断开提示 + 重连按钮**
- 步骤：断开当前会话 WS。
- 预期：中栏出现红色 `Alert`（"当前会话连接已断开…"）+ "重连"按钮。
- 断言：Alert 可见；点击"重连"重新建连，状态变"已连接"。

**TC-WB-CONN-05 断线期间访客消息增量补齐**
- 前置：ACTIVE 会话；停 WS 期间访客发多条消息。
- 步骤：恢复 WS。
- 预期：`onReconnect` 触发 `fetchMissingForSession`，按 `lastSeq` 拉增量补齐漏收消息。
- 断言：恢复后对话区出现断连期间访客消息；`lastSeq` 单调递增。

### 2.14 边界与异常（TC-WB-EDGE）
**TC-WB-EDGE-01 空消息拦截**
- 步骤：输入框为空或全空格 → 发送。
- 预期：不发送、不回显。
- 断言：`sendAgent` 提前 return；无新气泡。

**TC-WB-EDGE-02 超长消息（≤64KB）**
- 步骤：发送 60KB 文本。
- 预期：正常发送（后端单条上限 64KB）。
- 断言：对话区出现该长文本气泡。

**TC-WB-EDGE-03 快速连续发送**
- 步骤：1s 内连点发送 10 条。
- 预期：全部回显，顺序正确，不丢条、不串序。
- 断言：对话区该会话气泡数 +10。

**TC-WB-EDGE-04 转交幂等（重复 TRANSFER 事件）**
- 前置：`onMounted` 已恢复 ACTIVE 会话，又收到 `TRANSFER` 指向自己。
- 预期：因 `sessions.some(s=>s.id===sid)` 幂等校验，不重复插入。
- 断言：左侧该 `sid` 仅出现一次。

**TC-WB-EDGE-05 刷新后 localStorage lastSeq 容错**
- 步骤：手动将 `agent_last_seq_{sid}` 改为非法值（如 "abc"）。
- 预期：`readLastSeq` 将其视为脏数据归 0，不崩溃。
- 断言：页面正常加载；不抛异常。

---

## 4. 与既有用例的关系与运行建议

- **N-05**（`agent-session.spec.ts`）：结束会话闭环，已随本次"二次确认"更新——点"结束会话"后需再点"确认结束"。
- **N-03**（`n03-transfer.spec.ts`）：座席间转交闭环，未受本次改动影响（仍用 API close）。
- 新增可运行用例见 `apps/tests/e2e/agent-workbench.spec.ts`（覆盖 TC-WB-SEARCH / TC-WB-CTX / TC-WB-CLOSE-01 / TC-WB-CONN-03 等代表性场景）。
- 运行：`pnpm test:e2e --grep "agent"`，需后端 8082/8083 与前端 `localhost:5670` 就绪。
- 设计原则：**断言只锚定后端真实字段**（姓名/编号/标签/排队时长/转接原因/状态），对后端未实现的满意度/备注/已读等**不写断言**，避免脆性与伪通过。

---

_本文档随 `index.vue` 功能完善同步产出，覆盖座席工作台全部交互场景，共 59 条用例。_
