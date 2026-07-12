# UI 自动化测试用例 · 增强设计（框架 · 覆盖 · 断言 · 边界）

> 本文档基于对前端功能页面与 TypeScript 代码的逐文件审查，对既有《UI自动化测试用例》系列文档进行**增强**：补全了原稿缺失的**测试框架细节、覆盖范围要求、断言期望、边界条件**，并为每个用例给出可直接落地的选择器与接口锚点。
>
> 代码审查范围：`apps/src/views/chat-widget`、`apps/src/views/customerservice/agent`、`apps/src/composables/*`、`apps/src/api/session`、`apps/playwright.config.ts`、`apps/tests/e2e/*`。

---

## 1. 测试框架与工程约定

### 1.1 技术栈

| 项 | 取值 | 来源 |
| --- | --- | --- |
| 框架 | Playwright + TypeScript（`@playwright/test`） | `apps/playwright.config.ts` |
| 被测前端 | Vite dev server，baseURL 默认 `http://localhost:5670` | `playwright.config.ts` `use.baseURL` |
| 浏览器 | Chromium（Desktop Chrome），`headless` 仅 CI 开启 | `projects` / `use.headless` |
| 并发 | `workers: 1`、`fullyParallel: false` | 多角色联动需串行保证时序 |
| 超时 | 用例 60s；`expect 8s`；`actionTimeout 10s`；CI `retries: 1` | `playwright.config.ts` |

### 1.2 运行方式

```bash
# 本地（需先启动前端 dev server 与后端 8082/8083）
cd apps
npx playwright test                 # 全量
npx playwright test tests/e2e/agent-session.spec.ts   # 单文件
npx playwright test -g "EDGE-01"   # 按用例名过滤

# 凭据通过 .env.test.local 注入（已被 .gitignore 忽略），CI 用 Secrets
E2E_SUPERADMIN_USER=superadmin
E2E_SUPERADMIN_PASSWORD=Test@123456
E2E_KFMANAGER_USER=kfmanager
E2E_KFMANAGER_PASSWORD=Test@123456
```

### 1.3 关键环境依赖（后端端口）

前端经 Vite proxy 转发，但 e2e 中**对后端直连**以编排状态：

| 服务 | 端口 | 用途 | 关键接口 |
| --- | --- | --- | --- |
| conversation-service | `:8082` | 对话/队列/WS/SSE | `POST /api/v1/sessions/{sid}/accept`、`/close`、`POST /api/v1/chat/transfer`、`GET /api/v1/chat/history?sessionId&sinceSeq`、`WS /ws/chat/{sid}`、`WS /ws/agent/{sid}?token=`、`SSE /api/v1/sessions/events?token=` |
| auth-service | `:8083` | 登录鉴权 | `POST /api/v1/auth/login` → `data.tokenValue` |

> 访客端 `/chat` 无需登录（公开接口走 `publicClient`）；座席端 `/customerservice/agent` 需登录守卫，token 注入无法绕过，必须走真实 UI 登录。

### 1.4 复用 Fixture 与辅助函数

`apps/tests/e2e/fixtures.ts` 已提供：

- `cleanStorage`（auto）：进入 `/chat` 并清空 `localStorage/sessionStorage`，避免遗留 `chat_session_id` 串扰。
- `superAdminLogin`：填充 `/auth/login` 用户名/密码并等待跳转至 `/customerservice` 或 `/analytics`。
- 常量：`E2E_SUPERADMIN_USER/PASSWORD`、`E2E_KFMANAGER_USER/PASSWORD`、`E2E_VBEN_NS_PREFIX`。

多角色联动用例（访客 + 座席）统一采用 **`browser.newContext()` × 2 + 各自 `newPage()`** 隔离会话，用 `request` API 编排后端状态（接入/结束/转交）。

```ts
// 复用的后端登录辅助（来自 agent-session.spec.ts）
async function apiLogin(req: APIRequestContext, username: string, password: string): Promise<string> {
  const resp = await req.post('http://localhost:8083/api/v1/auth/login', {
    data: { username, password },
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await resp.json();
  return body?.data?.tokenValue;
}
```

### 1.5 常用选择器速查（锚定真实 DOM）

**访客端 `/chat`（`chat-widget`）**
- 输入框：`getByRole('textbox', { name: '输入您的问题...' })`
- 发送按钮：`getByRole('button', { name: 'send' })`（图标按钮，建议用 Enter 触发更稳）
- 转人工：`getByRole('button', { name: '转人工' })`
- 人工服务中标识：`getByText('人工服务中')`（转接成功后 header 显示）
- 发送中：`getByText('发送中...')`；失败重试：`getByRole('button', { name: '重试' })`
- 会话结束态：`getByRole('button', { name: '开始新对话' })`（仅结束态渲染，唯一）
- 会话结束分隔条文本：`本次会话已结束`；新对话开始：`新对话开始`
- 身份验证 Modal：`getByText('身份验证')`、手机号 Input `:maxlength=11`、验证码 `:maxlength=6`、`发送验证码`、`立即验证`
- 溯源标签：`getByText(/📄/)`；工具状态：`🔄 查询中...` / `✅` / `❌`
- 反馈：`getByRole('button')` 内 `lucide:thumbs-up / thumbs-down`

**座席端 `/customerservice/agent`（`agent`）**
- 工作台标题：`locator('.text-lg.font-semibold', { hasText: '座席工作台' })`
- 队列 Tab：`AI 对话` / `等待人工` / `人工` / `结束`（`queueStateTabs`）
- 接入会话：`getByRole('button', { name: '接入会话' })`（等待队列项内）
- 回复输入框：`getByRole('textbox', { name: /输入回复内容/ })`
- 操作：`转交`、`结束会话`、`确认结束`
- WS 状态点：`已连接`(绿 #10b981) / `连接中`(琥珀) / `已断开`(红 #ef4444)
- SSE 断线横幅：`实时连接已断开，正在自动重连…` + `立即重试`
- 访客输入中：消息区底部「访客正在输入」动画（3s 自动消失）
- 已结束会话：Tab `结束` → 列表项 → 点击查看记录

---

## 2. 被测系统交互与数据流（代码梳理结论）

### 2.1 双向通信架构

```
访客 /chat ──SSE(/api/v1/chat/stream)──► AI 流式回复（token/tool_call/sources/transfer/done）
        │
        └──转人工──► POST /chat/transfer ──► 进等待队列 ──► SSE ENQUEUE 通知座席
                   └──WS /ws/chat/{sid}──► 与座席双向收发（role=agent/user，seq 单调递增）

座席 /customerservice/agent ──SSE(/sessions/events?token=)──► 队列变化(ENQUEUE/ACCEPTED/CLOSED/TRANSFER)
        └──WS /ws/agent/{sid}?token=──► 收访客消息(role=user)/TYPING；发消息(role=agent)
```

### 2.2 关键状态机与常量（断言依据）

| 维度 | 实现 | 断言可验证点 |
| --- | --- | --- |
| 访客 WS 重连 | `useVisitorWs`：最多 3 次，延迟 `[1000,3000,8000]ms`；`code=1000` 不重连 | 断线后提示「连接中断，Ns 后自动重连（x/3）」；耗尽提示「连接已断开，请重新点击转人工或刷新」 |
| 座席 WS 重连 | `useAgentWebSocket`：最多 10 次，指数退避 `min(30000, 1000*2^n)`，心跳 12s，监听 `offline` | 连接点 `已断开→连接中→已连接`；重连后 `fetchMissingForSession` 补齐离线消息 |
| 消息 seq 增量同步 | `lastSeq` 存 `localStorage`（`chat_last_seq_` / `agent_last_seq_`）；重连按 `sinceSeq` 拉增量，只渲染 `role=agent/user` | 断线期间座席回复在重连后被补齐且**不重复** |
| 消息状态（访客） | `sending`（转人工模式，250ms 后取消 loading）、`failed`（WS 未连/失败，显示「重试」）、`streaming`（SSE 进行中禁用发送） | 「发送中...」→ 消失；失败「重试」可点 |
| 并发上限 | `MAX_CONCURRENT = 5`（`agent/index.vue`） | 第 6 个会话被拒并 toast「已达最大并发数（5）」 |
| 转接幂等 | `useTransfer.requestTransfer`：`if (transferred.value) return true`；后端防二次入队 | 重复点击不重复入队（`SessionEnqueueException`） |
| 空消息拦截 | `sendMsg`：`const text = inputText.value.trim(); if (!text ...) return`；发送按钮 `:disabled="!inputText.trim()"` | 空/纯空格时按钮 disabled 且不产生气泡 |
| 身份验证关键词 | `AUTH_WORDS = ['订单','退款','投诉','账单','发票','快递','损坏','破损']` | 命中关键词且未登录 → 弹出身份验证 Modal |
| 标签订阅色 | `resolveTagColor`：投诉=red / 退款=orange / 订单·账单=blue | 队列项 Tag 颜色与文案一致 |

> **已知缺口（如实记录，作为断言边界）**：代码中**不存在独立的「已读」状态**。访客消息发出后仅有 `sending→（WS 入队成功即取消 loading）`，座席端收到即渲染，无回执「已读」。CONV-04 用例以「座席侧可见该消息」作为「已送达」等价断言，并在报告中标注该缺口。

---

## 3. 覆盖范围矩阵（Requirement → Case → Priority）

| 用户需求 | 用例 ID | 优先级 | 类型 |
| --- | --- | --- | --- |
| 1.对话功能全场景 | CONV-01~06 | P0 | 正常+异常 |
| 1.1 访客发起/客服接收回复 | CONV-01, LINK-01 | P0 | 正常 |
| 1.2 消息收发时序 | CONV-03 | P0 | 正常 |
| 1.3 消息状态(发送中/已送达/已读) | CONV-04 | P1 | 正常 |
| 1.4 异常断线重连 | CONV-05, EDGE-04/05 | P0 | 异常 |
| 1.5 历史消息加载 | CONV-06, AGT-10 | P1 | 正常 |
| 2.访客页面 | VIS-01~12 | P0/P1 | 正常+边界 |
| 3.客服页面 /customerservice/agent | AGT-01~14 | P0/P1 | 正常 |
| 4.多角色联动 | LINK-01~05 | P0 | 正常+异常 |
| 5.边界与异常 | EDGE-01~11 | P0/P1 | 边界+异常 |

**覆盖策略**：P0 = 冒烟/核心链路（每次回归必跑）；P1 = 功能细节与异常（每日回归）；P2 = 低频/视觉（可选）。

---

## 4. 测试用例详设

> 字段：用例名称 / 模块 / 优先级 / 前置条件 / 操作步骤 / 预期结果 / 断言点（含选择器或接口）。
> 用例间通用的「前置」若已在 fixtures 处理（cleanStorage），仅标注差异。

### A. 对话功能全场景（CONV）

#### CONV-01　访客发起对话 · AI 流式回复
- **模块**：对话-访客端
- **优先级**：P0
- **前置**：全新 `localStorage`（cleanStorage）；后端 AI 流可用。
- **步骤**：
  1. `visitorPage.goto('/chat')`
  2. 等待输入框可见，填入「产品标准版定价？」并按 Enter
  3. 等待 AI 气泡出现并完成流式（约 3~8s）
- **预期**：先出现「思考中」三点动画，随后文本逐字追加；结束后显示复制按钮与反馈（点赞/点踩）。
- **断言点**：
  - `expect(input).toBeVisible()`
  - 发送后 `expect(visitorPage.getByText('产品标准版定价？')).toBeVisible()`（用户气泡）
  - 流式结束：`expect(visitorPage.locator('.widget-ai-md')).toContainText(/定价|价格|版/)`（AI 已渲染 Markdown）
  - `expect(visitorPage.getByRole('button', { name: 'copy' })).toBeVisible()`（AI 非失败才显示复制）

#### CONV-02　访客转人工后 · 座席回复可见
- **模块**：对话-双向
- **优先级**：P0
- **前置**：访客已转人工（见 VIS-06），座席已接入（见 AGT-03）。
- **步骤**：座席在回复框输入「已为您核实」，点击发送。
- **预期**：访客端实时出现「👤 人工客服」气泡，内容一致。
- **断言点**：
  - 访客端：`expect(visitorPage.getByText('👤 人工客服')).toBeVisible()` 且 `getByText('已为您核实')` 可见
  - 座席端：该消息以 `role='agent'` 渲染（气泡背景 `#f0f9ff`）

#### CONV-03　消息收发时序正确性
- **模块**：对话-时序
- **优先级**：P0
- **前置**：双向已连通（LINK-01 前置）。
- **步骤**：访客依次发送 A、B、C；座席依次回复 X、Y。
- **预期**：访客端顺序为 用户A → 用户B → 用户C → 客服X → 客服Y（无乱序）。
- **断言点**：取消息列表 DOM 顺序，断言 `.last()` 为「客服Y」；用 `locator('...').nth(i)` 校验相对位置。

#### CONV-04　消息状态：发送中 / 已送达 /（已读-缺口）
- **模块**：对话-状态
- **优先级**：P1
- **前置**：访客转人工，WS 已连接。
- **步骤**：访客发送一条消息。
- **预期**：发送瞬间显示「发送中...」，约 250ms 后 loading 消失（WS 同步入队无法拿服务端确认，故无独立「已送达」态）；座席侧实时可见 = 已送达等价。
- **断言点**：
  - 发送后极短时间内 `expect(getByText('发送中...')).toBeVisible()`（轮询）
  - 1s 内 `expect(getByText('发送中...')).toHaveCount(0)`
  - 座席 `activeSession.msgs` 含该 `user` 消息（等价「已送达」）
  - ⚠️ 报告中标注：无「已读」回执，建议产品补充 `READ` 事件后再加断言。

#### CONV-05　异常断线 · 指数退避重连 + 增量补齐
- **模块**：对话-异常
- **优先级**：P0
- **前置**：访客转人工，WS 已连接；准备在测试中 kill 网络。
- **步骤**：
  1. 访客断网（`context.setOffline(true)` 或拦截 `/ws/chat/*`）
  2. 座席在此期间发送 2 条消息
  3. 访客恢复网络
- **预期**：访客出现「连接中断，Ns 后自动重连（x/3）」提示；重连成功后按 `lastSeq` 补齐座席离线消息，且无重复。
- **断言点**：
  - 断线提示：`expect(visitorPage.getByText(/连接中断.*自动重连/)).toBeVisible()`
  - 恢复后：`expect(visitorPage.getByText('座席离线消息1')).toBeVisible()` 且消息仅出现一次（`count === 1`）

#### CONV-06　历史消息加载（刷新后恢复）
- **模块**：对话-历史
- **优先级**：P1
- **前置**：已有若干对话（localStorage `chat_history_{sid}` 存在）。
- **步骤**：刷新 `/chat` 页面。
- **预期**：历史消息从 localStorage 恢复，新消息 id 不与历史冲突。
- **断言点**：
  - 刷新后 `expect(visitorPage.getByText('历史消息文本')).toBeVisible()`
  - 无重复渲染（`count === 1`）

---

### B. 访客页面（VIS）

#### VIS-01　打开对话窗口
- **优先级**：P0
- **步骤**：`goto('/chat')`。
- **预期**：渲染问候语「您好！我是智能客服助手」「无需登录可直接咨询」。
- **断言**：`expect(getByText('智能客服助手')).toBeVisible()`；欢迎语区块可见。

#### VIS-02　输入并发送消息（含空消息拦截）
- **优先级**：P0
- **步骤**：(a) 不输入直接点发送；(b) 输入空格后发送；(c) 输入有效文本发送。
- **预期**：(a)(b) 不产生气泡且按钮 disabled；(c) 产生用户气泡。
- **断言**：
  - (a) `expect(sendBtn).toBeDisabled()`
  - (b) `input.fill('   '); expect(sendBtn).toBeDisabled()`
  - (c) `input.fill('你好'); press Enter; expect(getByText('你好')).toBeVisible()`

#### VIS-03　接收客服回复（转人工模式）
- **优先级**：P0
- **前置**：已转人工（VIS-06）。
- **步骤**：座席发送回复。
- **断言**：`expect(getByText('👤 人工客服')).toBeVisible()`。

#### VIS-04　关闭对话（座席结束 → 访客结束态）
- **优先级**：P0
- **前置**：座席端结束会话（AGT-06）。
- **步骤**：观察访客端。
- **预期**：出现「本次会话已结束」分隔条 +「开始新对话」按钮，输入框被替换。
- **断言**：`expect(getByRole('button', { name: '开始新对话' })).toBeVisible()`；`expect(getByText(/本次会话已结束/)).toBeVisible()`。

#### VIS-05　身份验证（关键词触发）
- **优先级**：P1
- **前置**：未登录（cleanStorage）。
- **步骤**：输入含「订单」的消息（如「查询我的订单」）并发送。
- **预期**：弹出「身份验证」Modal，提示验证手机号。
- **断言**：
  - `expect(getByText('身份验证')).toBeVisible()`
  - 手机号输入 `maxlength=11`；验证码 `maxlength=6`
  - 发送验证码后进入倒计时「Ns 后重发」

#### VIS-06　转人工流程
- **优先级**：P0
- **步骤**：点击「转人工」。
- **预期**：header 切换为「👤 人工服务中」，建立 WS 连接；localStorage `chat_transferred_{sid}=1`。
- **断言**：
  - `expect(getByText('人工服务中')).toBeVisible()`
  - `expect(visitorPage.evaluate(() => localStorage.getItem('chat_transferred_' + sid))).resolves.toBe('1')`

#### VIS-07　快捷问题点击
- **优先级**：P2
- **步骤**：点击「产品标准版定价？」快捷问题。
- **断言**：`expect(getByText('产品标准版定价？')).toBeVisible()`（已自动发送）。

#### VIS-08　消息反馈（点赞/点踩）
- **优先级**：P2
- **步骤**：AI 回复完成后点 thumbs-up。
- **断言**：该按钮高亮（`color:#10b981`），`m.feedback==='up'`。

#### VIS-09　AI 工具调用状态展示
- **优先级**：P1
- **前置**：触发会调用工具的意图（如天气类问题）。
- **步骤**：发送问题，观察气泡内工具状态。
- **预期**：先 `🔄 查询中...`，后 `✅ xxms` 或 `❌`（错误）。
- **断言**：`expect(getByText(/查询中/)).toBeVisible()`；结束时 `getByText(/✅|❌/)` 存在。

#### VIS-10　知识库溯源标签
- **优先级**：P1
- **前置**：问题命中知识库。
- **断言**：`expect(getByText(/📄/)).toBeVisible()`（sources 标签渲染）。

#### VIS-11　清除历史
- **优先级**：P1
- **步骤**：点顶部垃圾桶「清除对话记录」。
- **预期**：消息清空，`chat_session_id` 被移除，重新生成新 session。
- **断言**：`expect(visitorPage.evaluate(() => localStorage.getItem('chat_session_id'))).resolves.toBeNull()`；消息区仅剩欢迎语。

#### VIS-12　开始新对话（保留历史）
- **优先级**：P1
- **前置**：会话已结束（VIS-04）。
- **步骤**：点「开始新对话」。
- **预期**：出现「新对话开始」分隔条，新 sessionId 生成，历史仍可见。
- **断言**：`expect(getByText('新对话开始')).toBeVisible()`；旧消息仍在 DOM 中。

---

### C. 客服页面 /customerservice/agent（AGT）

#### AGT-01　登录与进入工作台
- **优先级**：P0
- **步骤**：`superAdminLogin()` → `goto('/customerservice/agent')`。
- **断言**：`expect(locator('.text-lg.font-semibold', { hasText: '座席工作台' })).toBeVisible({ timeout: 30000 })`。

#### AGT-02　接访对话列表展示
- **优先级**：P0
- **前置**：等待队列有会话（可通过访客转人工制造）。
- **步骤**：切到「等待人工」Tab。
- **预期**：列表项含访客名、等待时长（每秒刷新）、问题标签（颜色正确）。
- **断言**：
  - `expect(getByText('等待人工')).toBeVisible()`
  - 列表项含 `等待 12秒` 类文案；Tag 文案与 `resolveTagColor` 一致（如「退款」橙色）

#### AGT-03　接入会话
- **优先级**：P0
- **步骤**：在等待项点「接入会话」。
- **预期**：Tab 切到「人工」，中栏展示对话，WS 状态点变「已连接」。
- **断言**：
  - `expect(getByRole('button', { name: '接入会话' })).toBeVisible()` → 点击
  - `expect(getByText('已连接')).toBeVisible()`

#### AGT-04　对话切换
- **优先级**：P1
- **前置**：≥2 个已接入会话（并发）。
- **步骤**：点左侧另一会话。
- **预期**：`active` 标记切换，中栏消息与输入框随之更新；`msgFilter` 重置为「全部」。
- **断言**：目标会话的高亮态变化；中栏出现该会话首条消息。

#### AGT-05　回复消息
- **优先级**：P0
- **步骤**：回复框输入「已核实订单信息」按 Enter。
- **预期**：本地立即追加 `agent` 气泡并 WS 发出。
- **断言**：
  - `expect(getByText('已核实订单信息')).toBeVisible()`
  - 若 WS 未连：`expect(getByText('WebSocket 未连接，请重新接入会话')).toBeVisible()`

#### AGT-06　结束会话（二次确认）
- **优先级**：P0
- **步骤**：点「结束会话」→ 点「确认结束」。
- **预期**：会话从列表移除，断开 WS，访客侧进入结束态。
- **断言**：
  - `expect(getByRole('button', { name: '确认结束' })).toBeVisible()` → 点击
  - 访客端 `expect(getByRole('button', { name: '开始新对话' })).toBeVisible({ timeout: 90000 })`

#### AGT-07　转交会话
- **优先级**：P1
- **前置**：存在其他在线座席。
- **步骤**：点「转交」→ 选目标座席 → 「确认转交」。
- **预期**：当前座席侧会话移除，目标座席收到 TRANSFER SSE 自动接入。
- **断言**：
  - Modal 标题 `转交会话` 可见；座席列表项含「空闲/忙碌」
  - 确认后 `expect(getByText(/已成功转交给/)).toBeVisible()`
  - 目标座席（另一 context）`activeSession` 出现该会话

#### AGT-08　WS 连接状态展示
- **优先级**：P1
- **步骤**：观察状态点；模拟断网。
- **断言**：正常 `已连接`（绿）；断网 → `已断开`（红）→ 重连中 `连接中`。

#### AGT-09　访客输入中提示
- **优先级**：P2
- **前置**：访客转人工且正在输入（访客端 `handleTypingInput` 发 TYPING，防抖 500ms）。
- **断言**：座席消息区底部出现「访客正在输入」动画；停止 3s 后消失。

#### AGT-10　已结束会话查看
- **优先级**：P1
- **步骤**：切「结束」Tab → 点列表项。
- **预期**：拉取历史记录渲染。
- **断言**：`expect(getByText('结束')).toBeVisible()`；点击项后记录消息可见；无记录时显示「暂无已结束会话」。

#### AGT-11　AI 回复建议
- **优先级**：P2
- **前置**：已接入会话。
- **步骤**：观察右栏建议。
- **预期**：基于上下文+知识库生成建议，点击可填入输入框。
- **断言**：建议列表非空（或 `suggestionsError` 时提示）；点击建议 → 回复框出现该文本。

#### AGT-12　历史工单 + AI 总结
- **优先级**：P2
- **步骤**：右栏「历史工单记录」→ 点「生成总结」。
- **预期**：SSE 流式生成摘要。
- **断言**：抽屉标题可见；点「生成总结」后 `summaryMap[sid].text` 流式填充；可「重新生成」。

#### AGT-13　消息筛选
- **优先级**：P2
- **步骤**：切换 `全部 / AI对话 / 人工`。
- **断言**：`filteredMsgs` 仅含对应角色（AI对话=ai+user；人工=agent+user）。

#### AGT-14　队列搜索
- **优先级**：P2
- **步骤**：搜索框输入关键词。
- **预期**：等待队列与已接入列表按 名称/标签/sessionId 过滤。
- **断言**：无匹配时 `未找到匹配"xxx"的会话`。

---

### D. 多角色联动（LINK）

#### LINK-01　双向实时通信
- **优先级**：P0
- **前置**：visitor context + agent context；访客已转人工，座席已接入。
- **步骤**：
  1. 访客发「请问退款进度」→ 断言座席实时收到
  2. 座席回「已为您加急」→ 断言访客实时收到
- **断言**：
  - 座席 `activeSession.msgs` 含 `用户: 请问退款进度`
  - 访客 `getByText('👤 人工客服')` 且 `getByText('已为您加急')` 可见

#### LINK-02　消息同步（断线补拉不重复）
- **优先级**：P0
- **步骤**：见 CONV-05；两侧同时校验。
- **断言**：两侧消息数一致、无重复（`seq` 去重）。

#### LINK-03　多会话并发处理
- **优先级**：P0
- **前置**：制造 ≥2 个等待会话。
- **步骤**：座席依次接入多个，观察并发数与上限。
- **断言**：`concurrent <= 5`；第 6 个接入时 `expect(getByText(/已达最大并发数（5）/)).toBeVisible()`。

#### LINK-04　座席间转交（自动接入）
- **优先级**：P1
- **前置**：kfmanager + superadmin 两个已登录 context，均在线。
- **步骤**：superadmin 将会话转给 kfmanager。
- **断言**：kfmanager 端 `activeSession` 自动出现该会话（`handleQueueTransfer`）；superadmin 端移除。

#### LINK-05　会话结束双向生效（既有 N-05 回归）
- **优先级**：P0
- **步骤**：座席「结束会话」→「确认结束」。
- **断言**：访客收到 `code=1000` 关闭 → 显示「开始新对话」；座席列表移除该项并 toast「会话 xxx 已被关闭」。

---

### E. 边界与异常（EDGE）

#### EDGE-01　空消息拦截
- **优先级**：P0
- **前置**：`/chat` 已打开。
- **步骤**：不输入 / 输入纯空格 / 输入若干空格后清除。
- **断言**：
  - `expect(sendBtn).toBeDisabled()`（`:disabled="!inputText.trim()"`）
  - 即便强制 `press Enter`：`expect(visitorPage.locator('.message-list').getByText('   ')).toHaveCount(0)`

#### EDGE-02　超长消息处理
- **优先级**：P1
- **步骤**：填入 5000 字符文本发送。
- **预期**：可正常发送（后端未截断前提下），前端 `white-space: pre-wrap; overflow-wrap: break-word` 不溢出。
- **断言**：用户气泡可见且文本完整（`toHaveText` 含首尾片段）；容器无横向滚动条（`scrollWidth <= clientWidth + 1`）。

#### EDGE-03　快速连续发送
- **优先级**：P1
- **步骤**：在 200ms 内连续发送 5 条不同消息。
- **预期**：5 条均按序出现，气泡不串、不丢。
- **断言**：`expect(visitorPage.getByText('消息1')).toBeVisible()` … 共 5 条；顺序与发送序一致。

#### EDGE-04　网络中断恢复（全链路）
- **优先级**：P0
- **步骤**：双向连通后 `context.setOffline(true)` → 等待 5s → `setOffline(false)`。
- **预期**：访客 WS 重连 + 座席 SSE 重连横幅消失；消息继续同步。
- **断言**：
  - 断网期间座席出现 `实时连接已断开，正在自动重连…`
  - 恢复后 `expect(getByText('实时连接已断开')).toHaveCount(0)`；继续发消息仍同步

#### EDGE-05　重连耗尽
- **优先级**：P1
- **前置**：强制 WS 永远失败（拦截 `/ws/chat/*` 返回 4xx）。
- **步骤**：访客转人工后触发断线。
- **预期**：3 次重试（1+3+8s）后停止，提示「连接已断开，请重新点击转人工或刷新」。
- **断言**：`expect(getByText(/连接已断开，请重新点击/)).toBeVisible()`；不再出现重连提示。

#### EDGE-06　并发上限拒绝
- **优先级**：P1
- **步骤**：接入满 5 个后尝试接入第 6 个。
- **断言**：`expect(getByText(/已达最大并发数（5）/)).toBeVisible()`；第 6 个未进入 `sessions`。

#### EDGE-07　转接幂等
- **优先级**：P1
- **步骤**：连续点击「转人工」3 次。
- **预期**：仅入队一次（`transferred` 标志防重）；后端不抛 `SessionEnqueueException`。
- **断言**：`localStorage chat_transferred_{sid}==='1'`；等待队列仅 1 条该访客。

#### EDGE-08　非法 SSE 数据格式
- **优先级**：P2
- **步骤**：Mock `/api/v1/chat/stream` 返回非 JSON 信封的 token 行。
- **预期**：`useSSEStream` 解析失败 → `onError('接收到非法的 SSE 数据格式')`，气泡显示失败态可重试。
- **断言**：`expect(getByText('接收到非法的 SSE 数据格式')).toBeVisible()`；`重试`/`重新生成` 按钮可见。

#### EDGE-09　刷新页面状态恢复
- **优先级**：P1
- **前置**：访客已转人工（transferred=1, lastSeq>0）。
- **步骤**：刷新 `/chat`。
- **预期**：`restoreTransferState` 快路径（localStorage）或兜底（后端 `getSessionStateApi` 返回 WAITING/ACTIVE）恢复 WS，无需重新点转人工。
- **断言**：刷新后 `expect(getByText('人工服务中')).toBeVisible()`（恢复转接态）。

#### EDGE-10　AI 流式中断（Abort）
- **优先级**：P2
- **前置**：正在 SSE 流式回复。
- **步骤**：流式未结束时发送新消息 / 切换会话。
- **预期**：`abortCtrl.abort()` 取消上一条流，新气泡独立，旧气泡不被污染（非失败则保留已生成文本）。
- **断言**：无「抱歉，AI 服务暂时不可用」误报；新消息气泡正确。

#### EDGE-11　结束后访客继续发言
- **优先级**：P1
- **前置**：会话已结束（VIS-04），显示「开始新对话」。
- **步骤**：在结束态尝试输入并发送。
- **预期**：输入框已被替换，无法发送（除非点「开始新对话」开新会话）。
- **断言**：`expect(input).toHaveCount(0)`（结束态无输入框）；点「开始新对话」后输入框恢复。

---

## 5. 断言点分类汇总

| 断言类型 | 示例选择器/接口 | 适用用例 |
| --- | --- | --- |
| 可见性 | `toBeVisible()` on 标题/按钮/状态点 | 全部 UI 用例 |
| 文本匹配 | `getByText('人工服务中')` / `toContainText(/定价/)` | CONV/VIS/AGT |
| 禁用态 | `expect(sendBtn).toBeDisabled()` | EDGE-01 |
| 计数唯一 | `toHaveCount(1)`（防重复渲染） | CONV-05/06, EDGE-07 |
| 状态色 | `已连接`(绿)/`已断开`(红) 文本 + 颜色 | AGT-08, EDGE-04/05 |
| localStorage | `evaluate(() => localStorage.getItem(...))` | VIS-06/11, EDGE-07/09 |
| 后端接口 | `request.post('.../accept')` / `close` | LINK, CONV-05 |
| 顺序 | `locator().nth(i)` | CONV-03, EDGE-03 |
| 网络模拟 | `context.setOffline(true)` / 路由拦截 | EDGE-04/05, CONV-05 |

---

## 6. 落地优先级与执行计划

**P0（冒烟，每次提交必跑）**：VIS-01/02/06、AGT-01/03/05/06、CONV-01/03/05、LINK-01/03/05、EDGE-01/04
**P1（每日回归）**：CONV-02/04/06、VIS-03/04/05/9/10/11/12、AGT-02/04/07/8/9/10、LINK-02/04、EDGE-02/03/05/06/07/09/11
**P2（可选/视觉）**：VIS-07/08、AGT-11/12/13/14、EDGE-08/10

**建议编排**：
1. 单角色用例（VIS/AGT 各自 context）可常规 `workers:1` 串行。
2. LINK 类必须双 context 且保证就绪顺序：先建访客转人工 → 座席接入 → 再发消息，用 `expect(...).toBeVisible()` 做同步屏障，避免轮询竞态。
3. EDGE-04/05 用 `page.route` 拦截 `/ws/chat/*` 与 `context.setOffline` 组合，断言后务必 `unroute` 复位。

---

## 7. 已知风险与待补断言（反馈给产品/研发）

1. **无「已读」状态**：CONV-04 仅能以「座席侧可见」等价「已送达」，建议补充 `READ` 回执事件。
2. **访客消息无服务端 ACK**：`sending` 仅 250ms 乐观取消，弱网真正失败才会 `failed`。建议补充 WS 服务端确认帧。
3. **超长消息**：前端未做长度上限校验，依赖后端；EDGE-02 需后端配合确认截断策略。
4. **SSE 重连与浏览器自动重连并存**：`useSessionQueue` 已用「先 close 旧连接」规避，但建议自动化覆盖「断网→恢复」全链路（EDGE-04）以回归该修复。
