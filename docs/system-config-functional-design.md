# 系统配置（客服配置 / 系统配置）功能设计文档

> 版本：v3.0 ｜ 视角：**以后端（ai-auth / cs_auth）为主**，前端为消费方
> 状态：待评审
> 关联文档：[技术设计文档](./system-config-technical-design.md)

---

## 1. 文档定位

本文档讲清楚「做什么、为什么、影响面、配置项含义」，供产品/研发/测试评审。
**后端是主视角**：配置表、增删改查、权限、种子数据均落在 `ai-auth` 模块（`cs_auth` schema）。
前端不单独持有一份配置真相，只是**消费方**——登录后通过 `/admin/system-config/map` 拉取配置，用于界面展示和前端辅助校验；**后端是所有参数的真正执行方**。

---

## 2. 背景与问题

系统里存在大量**后端写死的运行参数**，散落在业务逻辑中。问题集中在三点：

- **运维不可控**：座席并发上限、知识库检索 TopK、欢迎语、AI 提示词等，要调整必须改代码、发版；运营/管理员无法自助修改。
- **缺乏归类与入口**：客服业务参数与平台级参数混在一起，没有统一的后台维护入口。
- **易错**：同一语义多处使用时易不同步，如并发上限前后端各自维护一份。

**明确不在本范围**：

- **纯前端 UI 参数**（分页大小、防抖延迟、定时器超时、localStorage 限制等）保持前端硬编码，与后端无关，不进配置表。
- **WS/SSE 连接参数**（重连延迟、心跳间隔、最大重试次数）属基础设施常量，保留在 `application.yml` + 环境变量管理，不开放后台修改（误改会导致座席全线断连）。

**结论**：在 `ai-auth` 建一张 `system_config` 表，仅收录**由后端逻辑执行的**运行参数，并作为管理员功能开放后台自助维护。

---

## 3. 目标

1. 在 `cs_auth` 建一张 `system_config` 表，用 `config_type` 区分**客服配置 / 系统配置**两个固定类型。
2. 提供**客服配置**、**系统配置**两个独立菜单，作为管理员功能。
3. 将**后端执行的**写死参数全量接入配置表；纯前端 UI 参数不纳入，继续写死在前端代码中。
4. 后端提供标准 CRUD + 消费接口（`/map`），前端仅做展示消费与辅助校验。

---

## 4. 关键决策与理由

| # | 决策 | 方案 | 为什么 |
|---|---|---|---|
| D1 | 存储形态 | **单表 + `config_type`**，非两张表 | 两类字段结构完全一致，单表 + 类型过滤即可，扩展成本最低。 |
| D2 | 值类型 | 增加 `value_type`（NUMBER/STRING/BOOLEAN/JSON） | `config_value` 统一以 `text` 存储，但执行层必须按真实类型解析，避免把数字 `5` 当字符串处理。 |
| D3 | 内置保护 | `is_system` 标识 | 内置参数（如并发上限）是系统运行基础值，允许改但不允许误删。 |
| D4 | 启用开关 | `is_enabled` 标识 | 单行可停用而不删除；后端执行时对停用项回退兜底默认值，便于灰度与回退。 |
| D5 | 菜单/页面 | 两个独立菜单，后端用同一 `system-config` 资源靠 `config_type` 过滤 | 后端一套 CRUD 服务两页面，无重复代码。 |
| D6 | 归属服务 | 建在 `ai-auth`（`cs_auth` schema） | 菜单、角色、权限、系统参数本就归认证服务；前端代理已把 `/api/v1/admin/**` 兜底转发到 auth-service，无需改网关。 |
| D7 | 落地方式 | **`docs/sql/` 快照（pg_dump）**，非 Flyway | Flyway 仅声明依赖、从未启用，**不要**新建 `Vx__*.sql`。 |
| D8 | 权限模型 | 数据驱动：`sys_permission` + `sys_role_permission` | 与现有 `AdminAiModelController` 一致，无需改 Java 权限代码。 |
| D9 | 类型守卫 | 后端限制 kf_manager 只能管理 `CUSTOMER_SERVICE` | Service 层加守卫：非 super_admin 拒绝操作 `SYSTEM` 类型，防止越权。 |
| D10 | 消费边界 | 后端 `/map` 按类型返回解析后的 `{key: value}` | 后端是配置真相源和执行方；`/map` 接口供前端展示/辅助校验，不是前端替换写死值的手段。 |
| D11 | 纯前端参数排除 | 分页大小、防抖延迟、定时器等纯 UI 参数**不纳入**配置表 | 这类参数与后端无关，存数据库再由前端拉取是绕路，维持前端硬编码即可。 |
| D12 | 连接参数排除 | WS/SSE 重连/心跳参数**不纳入**配置表 | 底层连接参数误改风险高，应由 `application.yml` + 环境变量管理。 |

---

## 5. 功能点详解

### 5.1 统一系统配置表
- **为什么**：给所有后端执行的运行参数一个唯一载体，支持管理员自助运维，且与菜单/权限体系打通。
- **影响**：新增 `cs_auth.system_config` 表 + 一个后端 CRUD 模块。种子值等于原写死值，**后端行为不变**，仅取值来源变化。

### 5.2 客服配置菜单（类型 = CUSTOMER_SERVICE）
- **为什么**：客服管理员需自助调整座席并发上限、欢迎语、知识库检索参数、AI 提示词，无需研发发版。
- **挂载**：`智能客服`（id=100）目录下，可见角色 `super_admin` + `kf_manager`，path=`/customerservice/config`。
- **受限**：kf_manager 受 D9 守卫，只能操作 `CUSTOMER_SERVICE` 类型。

### 5.3 系统配置菜单（类型 = SYSTEM）
- **为什么**：平台级运营参数仅超级管理员可动，与客服配置物理隔离。
- **挂载**：`系统管理`（id=200）目录下，仅 `super_admin` 可见，path=`/system/config`。

### 5.4 提示词配置（多模型 / 多场景）
- **为什么**：AI 辅助功能依赖提示词，同一场景在不同大模型下需要不同话术。收口进配置表后，运营/算法可在后台调优，无需改代码发版。
- **消费方**：**后端** conversation 服务调用 AI 模型时读取，前端不直接消费提示词内容。
- **多模型格式**：值为 JSON Map（含 `default` 兜底），后端按 `当前模型 → default` 取值。模板使用 `{占位符}`，由后端在调用模型前替换运行时变量。
- **编辑体验**：v1 裸 JSON 编辑，建议 v2 再做专属编辑器（占位符高亮/模型分 tab）。

### 5.5 前端消费定位
前端通过 `/map` 接口读取配置，**主要用途**：
- 在管理页面展示当前生效值（只读预览）
- 辅助前端侧校验（如文件上传提示文案与后端限制保持一致）

前端**不**通过配置表驱动自身的 UI 行为（分页、防抖、定时器等继续写死）。

---

## 6. 配置项清单

> 本表仅收录**后端逻辑直接执行**的参数。

### 6.1 客服配置类（CUSTOMER_SERVICE，4 项业务参数）

| config_key | value_type | 默认值 | 后端执行点 |
|---|---|---|---|
| `agent.maxConcurrent` | NUMBER | 5 | 座席接受会话时校验当前活跃会话数，超限拒绝并转排队 |
| `agent.welcomeMessage` | STRING | 您好！请问有什么可以帮您？ | 会话创建时后端插入首条系统消息 |
| `knowledge.searchTopK` | NUMBER | 5 | RAG 检索时向量库查询的 `LIMIT` 参数 |
| `knowledge.uploadMaxFileSizeMb` | NUMBER | 50 | 后端文件上传接口校验文件大小，超限返回 400 |

### 6.2 系统配置类（SYSTEM，1 项）

| config_key | value_type | 默认值 | 后端执行点 |
|---|---|---|---|
| `dashboard.recentLimit` | NUMBER | 10 | 仪表盘最近会话查询 SQL 的 `LIMIT` 参数 |

> WS/SSE 连接参数（重连延迟、心跳、最大重试次数）保留在 `application.yml`，不进配置表。见 D12。

### 6.3 提示词类（CUSTOMER_SERVICE，config_group='提示词'，5 项）

多模型场景 `value_type=JSON`，值为 `{"default": "...", "gpt-4": "...", "claude": "..."}`；模板含 `{占位符}`，由**后端 conversation 服务**在调用 AI 模型前替换（占位符清单见技术文档第 3.5 节）。

| config_key | 后端执行点 | 默认模板要点 |
|---|---|---|
| `prompt.agent.suggestion` | 座席辅助·回复建议生成 | 含 {history}{query}{kb_context}{agent_name} |
| `prompt.kb.qa` | 知识库问答 | 含 {kb_context}{query}{language} |
| `prompt.visitor.autoReply` | 访客自动回复 | 含 {visitor_name}{current_time} |
| `prompt.session.summary` | 会话小结生成 | 含 {history}{agent_name} |
| `prompt.intent.classify` | 意图识别 | 含 {query}{history} |

> 提示词项默认 `is_system=true`（可改不可删）；新增场景由管理员新增 `config_group='提示词'` 的行即可。

---

## 7. 菜单与权限落地

| 菜单 | id（建议） | 父目录 | path | component | 可见角色 | 权限码 |
|---|---|---|---|---|---|---|
| 客服配置 | 140 | 100（智能客服） | `/customerservice/config` | `customer-service-config/index` | super_admin(10)、kf_manager(11) | `system:config:*` |
| 系统配置 | 206 | 200（系统管理） | `/system/config` | `system-config/index` | super_admin(10) | `system:config:*` |

- 权限码：`system:config:{list,create,update,delete}` 写入 `sys_permission`，关联角色 10、11。
- `sys_role_menu`：super_admin→全部菜单(140/206 及各自按钮)；kf_manager→仅客服配置(140 及按钮)。
- **id 实施前必须 grep `data.sql` 核对当前最大值**，避免冲突。
- **类型守卫（D9）**：kf_manager 拥有 `system:config:*` 但受后端守卫限制，只能维护 `CUSTOMER_SERVICE` 类型。

---

## 8. 影响分析

### 8.1 后端改动（主，ai-auth）
- 新增模块：`SystemConfigDO` / `SystemConfigMapper` / `SystemConfigService` / `SystemConfigRequest` / `SystemConfigVO` / `AdminSystemConfigController`。
- SQL 变更（追加，非 Flyway）：新增表 + 触发器 + 唯一索引；种子数据共 **10 条**（4 条业务参数 + 1 条系统参数 + 5 条提示词）+ 4 个权限 + 2 个菜单及按钮 + 角色关联。
- **后端业务代码改造**：会话创建、文件上传、RAG 检索、仪表盘查询、AI 调用等模块，将写死值改为通过 `SystemConfigService` 读取（带兜底默认值）。

### 8.2 前端改动（次，消费方）
- 新增：`api/system-config/index.ts`、`store/system-config.ts`、两个管理页面、共用表格/表单组件。
- 可选：文件上传组件读 `knowledge.uploadMaxFileSizeMb` 用于提示文案与前端预校验，确保与后端一致。
- **不替换**前端写死的 UI 参数（分页大小、防抖延迟、定时器等保持硬编码）。

### 8.3 风险与回退

| 风险点 | 缓解措施 |
|---|---|
| 后端取值失败（配置缺失/解析错误） | 每个读取点保留原值为兜底，行为与原版完全一致 |
| 内置项误删 | `is_system=true` 的删除接口直接拒绝（422） |
| 运营误改关键参数（如并发上限设为 0） | 配置是数据库行，单条改回原值即可立即恢复 |
| 提示词 JSON 格式错误 | 后端解析失败时回退 `default` 模板，不影响主流程 |

---

## 9. 待确认事项

1. **菜单/权限 id** 实施前核对 `data.sql` 当前最大值（建议值见技术文档，以仓库现状为准）。
2. **`isSuperAdmin()` 实现**：若 ai-auth 的 `StpInterfaceImpl` 仅走 `sys_role_permission` 数据授权、未向 Sa-Token 注册角色列表，`StpUtil.hasRole("super_admin")` 会返回 false，D9 守卫失效。实施前需对着 `StpInterfaceImpl.getRoleList()` 确认。
3. **kf_manager 是否保留「删除」权限**：当前设计授予，但 `is_system` 行拒绝删除，且守卫限制其只能动 CUSTOMER_SERVICE。可视需求收紧。
4. **`knowledge.uploadMaxFileSizeMb`**：当前仅后端校验，是否同步在前端上传组件显示一致的文案提示。
5. **提示词编辑体验**：v1 裸 JSON 编辑，运营用户出错率较高，是否 v1 只读展示、v2 再做编辑器。
