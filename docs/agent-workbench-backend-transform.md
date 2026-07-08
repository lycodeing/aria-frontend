# 座席工作台后端改造技术文档

> 版本：v1.0 | 日期：2026-07-08  
> 关联文档：`docs/agent-workbench-gap-analysis.md`、`docs/agent-workbench-frontend-transform.md`  
> 改造范围：`ai-conversation/conversation-service`（主要）、`ai-auth/auth-service`（少量）

---

## 一、概述与改造范围

### 1.1 改造背景

根据功能缺口分析，后端需要支撑以下新能力：

| 缺口编号 | 需要后端新增/修改 |
|---|---|
| P1-1 | 座席在线状态主动上报接口（`PUT /api/v1/agent/status`） |
| P1-2 | 快捷回复管理模块（全新，数据库 + 接口） |
| P1-4 | 无需后端改动（前端 + 现有 WS） |
| P2-1 | WS 新增 `TYPING` / `STOP_TYPING` 事件广播 |
| P2-3 | 会话内部备注持久化（`POST /api/v1/sessions/:id/notes`） |
| P2-4 | 转交接口新增 `note` 字段，SSE 事件携带备注 |
| P2-5 | `GET /api/v1/sessions/active` 响应新增 `acceptedAt` 字段 |
| P2-6 | `POST /api/v1/sessions/:id/close` 新增 `reason` 字段，按 reason 触发 CSAT |
| P2-7 | 用户 profile 接口新增 `maxConcurrent` 字段 |

### 1.2 涉及模块

```
ai-conversation/conversation-service/
├── interfaces/rest/
│   ├── SessionQueueController.java        (修改：close、transfer 接口扩展)
│   ├── QuickReplyController.java          (新建)
│   └── AgentProfileController.java        (新建)
├── application/service/
│   ├── SessionQueueService.java           (修改：close、transfer 逻辑扩展)
│   ├── QuickReplyService.java             (新建)
│   └── AgentStatusService.java            (新建)
├── domain/model/
│   ├── SessionQueueItem.java              (修改：新增 acceptedAt、transferNote)
│   └── QuickReply.java                    (新建)
├── infrastructure/
│   ├── persistence/
│   │   ├── ConversationPersistRepository.java  (修改：close reason、notes 存储)
│   │   ├── QuickReplyMapper.java               (新建)
│   │   └── entity/
│   │       ├── ConversationMessageEntity.java  (修改：新增 note 类型)
│   │       └── QuickReplyEntity.java           (新建)
│   ├── websocket/
│   │   └── ChatWebSocketHandler.java      (修改：TYPING 广播)
│   └── repository/
│       └── AgentOnlineRegistry.java       (修改：新增 status 字段)
└── resources/db/migration/
    ├── V5__add_quick_reply.sql            (新建)
    ├── V6__add_session_notes.sql          (新建)
    └── V7__add_conversation_close_reason.sql (新建)
```

### 1.3 技术栈与约定

- **框架**：Spring Boot 3.3.5，MyBatis-Plus 3.5.7，Sa-Token 1.39.0
- **数据库**：PostgreSQL，Schema `cs_conversation`，Flyway 迁移
- **消息**：RabbitMQ Fanout exchange `cs.conversation.events`
- **缓存**：Redis（Sa-Token session + 业务队列）
- **代码规范**：Lombok，沿用现有 `@RestController` + `R<T>` 响应体模式

### 1.4 改造优先级

```
Sprint 1（阻塞前端）：
  - AgentProfile 接口（maxConcurrent）
  - AgentStatus PUT 接口

Sprint 2（业务功能）：
  - 快捷回复模块（完整 CRUD）
  - close 接口扩展（reason + CSAT）
  - transfer 接口扩展（note）
  - session notes 接口

Sprint 3（体验细节）：
  - WS TYPING 事件
  - active 列表增加 acceptedAt
```

## 二、Sprint 1 — 座席 Profile 接口 + 状态同步（P2-7 & P1-1）

### 2.1 座席 Profile 接口

前端 `onMounted` 时调用该接口获取 `maxConcurrent`，替代前端硬编码的 `MAX_CONCURRENT = 5`。

#### 2.1.1 响应 VO

**文件：`interfaces/rest/vo/AgentProfileVO.java`（新建）**

```java
package com.aria.conversation.interfaces.rest.vo;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class AgentProfileVO {
    /** 座席 ID */
    private String agentId;

    /** 显示名称 */
    private String name;

    /** 最大并发会话数，默认 5，可按角色/租户配置 */
    private int maxConcurrent;
}
```

#### 2.1.2 Controller

**文件：`interfaces/rest/AgentProfileController.java`（新建）**

```java
@RestController
@RequestMapping("/api/v1/agent")
@RequiredArgsConstructor
public class AgentProfileController {

    private final SessionQueueService sessionQueueService;

    /**
     * 获取当前登录座席的 profile（含 maxConcurrent）
     */
    @GetMapping("/profile")
    public R<AgentProfileVO> getProfile() {
        String agentId = (String) StpUtil.getLoginId();
        String name = StpUtil.getTokenSession().getString("displayName");
        // maxConcurrent 暂时从配置读取，后续可按角色动态化
        int maxConcurrent = agentProfileConfig.getMaxConcurrent();
        return R.ok(AgentProfileVO.builder()
                .agentId(agentId)
                .name(name)
                .maxConcurrent(maxConcurrent)
                .build());
    }
}
```

#### 2.1.3 配置项

**`application.yml`（conversation-service）新增：**

```yaml
agent:
  profile:
    max-concurrent: 5   # 默认并发上限，后续可从数据库按角色读取
```

```java
// config/AgentProfileConfig.java（新建）
@ConfigurationProperties(prefix = "agent.profile")
@Configuration
@Data
public class AgentProfileConfig {
    private int maxConcurrent = 5;
}
```

---

### 2.2 座席状态主动上报（P1-1）

当前 `AgentOnlineRegistry` 通过 SSE 连接的建立/断开来感知座席在线，无法处理座席主动切换状态（"忙碌"）或页面关闭时的即时感知。

#### 2.2.1 请求体 DTO

**文件：`interfaces/rest/dto/UpdateAgentStatusRequest.java`（新建）**

```java
@Data
public class UpdateAgentStatusRequest {

    /**
     * ONLINE：上线接单<br>
     * OFFLINE：下线<br>
     * BUSY：暂停接单（现有会话不受影响，不再接新会话）
     */
    @NotNull(message = "status 不能为空")
    private AgentStatus status;
}

// 枚举
public enum AgentStatus { ONLINE, OFFLINE, BUSY }
```

#### 2.2.2 AgentOnlineRegistry 扩展

**文件：`infrastructure/repository/AgentOnlineRegistry.java`（修改）**

在现有 Redis Hash `agent:online` 的 `AgentInfo` 中新增 `status` 字段：

```java
// 原有
public record AgentInfo(String agentId, String name, long connectedAt) {}

// 改为（向后兼容，status 默认 ONLINE）
public record AgentInfo(
    String agentId,
    String name,
    long connectedAt,
    String status   // "ONLINE" | "BUSY"，OFFLINE 时直接删除 key
) {}
```

新增方法：

```java
/**
 * 更新座席状态（不改变引用计数）
 * @param agentId  座席 ID
 * @param status   新状态（ONLINE / BUSY）
 */
public void updateStatus(String agentId, AgentStatus status) {
    String key = ONLINE_KEY;   // "agent:online"
    String raw = (String) redisTemplate.opsForHash().get(key, agentId);
    if (raw == null) return;   // 未注册，忽略

    AgentInfo info = JsonUtil.parse(raw, AgentInfo.class);
    AgentInfo updated = new AgentInfo(
        info.agentId(), info.name(), info.connectedAt(), status.name()
    );
    redisTemplate.opsForHash().put(key, agentId, JsonUtil.toJson(updated));
}

/**
 * OFFLINE：直接调用现有 deregister，引用计数清零并删除
 */
public void forceOffline(String agentId) {
    // 清除所有引用计数，强制下线
    redisTemplate.opsForHash().delete(ONLINE_KEY, agentId);
    redisTemplate.opsForHash().delete(COUNT_KEY, agentId);
}
```

#### 2.2.3 AgentStatusService

**文件：`application/service/AgentStatusService.java`（新建）**

```java
@Service
@RequiredArgsConstructor
public class AgentStatusService {

    private final AgentOnlineRegistry agentOnlineRegistry;
    private final SessionEventPublisher eventPublisher;

    public void updateStatus(String agentId, AgentStatus status) {
        if (status == AgentStatus.OFFLINE) {
            agentOnlineRegistry.forceOffline(agentId);
            // 广播 AGENT_OFFLINE 事件，通知其他座席/管理后台
            eventPublisher.publishAgentOffline(agentId);
        } else {
            agentOnlineRegistry.updateStatus(agentId, status);
            eventPublisher.publishAgentStatusChange(agentId, status.name());
        }
    }
}
```

#### 2.2.4 Controller 端点

**SessionQueueController.java（修改，新增端点）：**

```java
/**
 * 座席主动上报在线状态
 * 场景：前端切换「在线/暂停/下线」开关，或页面卸载时静默下线
 */
@PutMapping("/agent/status")
public R<Void> updateAgentStatus(
        @RequestBody @Validated UpdateAgentStatusRequest req) {
    String agentId = (String) StpUtil.getLoginId();
    agentStatusService.updateStatus(agentId, req.getStatus());
    return R.ok();
}
```

> **注意**：前端 `navigator.sendBeacon` 无法携带 Authorization header，推荐前端改用 `fetch` + `keepalive: true`；或后端新增一个 `@SaIgnore` + token query param 的下线快速通道：`POST /api/v1/agent/offline?token=xxx`。

#### 2.2.5 接单过滤

`accept()` 方法新增状态校验：

```java
// SessionQueueService.java accept() 方法顶部新增
AgentInfo agentInfo = agentOnlineRegistry.findById(agentId);
if (agentInfo == null || "BUSY".equals(agentInfo.status())) {
    throw new BusinessException("座席当前不可接单");
}
```

## 三、Sprint 2 — 快捷回复模块（P1-2，全新）

### 3.1 数据库迁移

**文件：`resources/db/migration/V5__add_quick_reply.sql`（新建）**

```sql
-- ============================================================
-- V5: 快捷回复管理表
-- ============================================================
CREATE TABLE cs_conversation.cs_quick_reply (
    id           BIGSERIAL PRIMARY KEY,
    category     VARCHAR(64)  NOT NULL DEFAULT '通用',     -- 分组名称
    content      TEXT         NOT NULL,                    -- 回复内容
    sort_order   INT          NOT NULL DEFAULT 0,          -- 组内排序，升序
    scope        VARCHAR(16)  NOT NULL DEFAULT 'TEAM',     -- TEAM | PERSONAL
    creator_id   VARCHAR(64),                              -- PERSONAL 时关联座席 ID
    enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quick_reply_category ON cs_conversation.cs_quick_reply(category);
CREATE INDEX idx_quick_reply_creator  ON cs_conversation.cs_quick_reply(creator_id);

COMMENT ON TABLE  cs_conversation.cs_quick_reply             IS '快捷回复库';
COMMENT ON COLUMN cs_conversation.cs_quick_reply.scope       IS 'TEAM=团队共享, PERSONAL=个人专属';
COMMENT ON COLUMN cs_conversation.cs_quick_reply.creator_id  IS '仅 PERSONAL 类型有值';

-- 初始化示例数据
INSERT INTO cs_conversation.cs_quick_reply (category, content, sort_order, scope) VALUES
('订单类',  '已核实您的订单信息，请稍等。',           1, 'TEAM'),
('订单类',  '已为您安排补发处理，预计 3-5 个工作日到达。', 2, 'TEAM'),
('物流类',  '已为您提交快递投诉，编号已记录。',        1, 'TEAM'),
('退款类',  '您的退款申请已受理，预计 3-7 个工作日退回。', 1, 'TEAM'),
('通用',    '感谢您的耐心等待！',                    1, 'TEAM'),
('通用',    '非常抱歉给您带来不便，我们会尽快处理。',   2, 'TEAM');
```

### 3.2 实体类

**文件：`infrastructure/persistence/entity/QuickReplyEntity.java`（新建）**

```java
@Data
@TableName(value = "cs_conversation.cs_quick_reply", schema = "cs_conversation")
public class QuickReplyEntity {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String category;

    private String content;

    private Integer sortOrder;

    /** TEAM | PERSONAL */
    private String scope;

    private String creatorId;

    private Boolean enabled;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
```

### 3.3 Mapper

**文件：`infrastructure/persistence/QuickReplyMapper.java`（新建）**

```java
@Mapper
public interface QuickReplyMapper extends BaseMapper<QuickReplyEntity> {

    /**
     * 查询对当前座席可见的快捷回复：
     * TEAM 的全部 + 该座席自己的 PERSONAL
     */
    @Select("""
        SELECT * FROM cs_conversation.cs_quick_reply
        WHERE enabled = true
          AND (scope = 'TEAM' OR (scope = 'PERSONAL' AND creator_id = #{agentId}))
          AND (#{keyword} IS NULL OR content ILIKE '%' || #{keyword} || '%')
        ORDER BY category, sort_order
        """)
    List<QuickReplyEntity> findVisibleByAgent(
            @Param("agentId") String agentId,
            @Param("keyword") String keyword);
}
```

### 3.4 VO / DTO

```java
// VO（响应）
@Data @Builder
public class QuickReplyVO {
    private Long id;
    private String category;
    private String content;
    private int sortOrder;
    private String scope;     // TEAM | PERSONAL
}

// DTO（管理端创建/更新）
@Data
public class SaveQuickReplyRequest {
    @NotBlank private String category;
    @NotBlank @Size(max = 500) private String content;
    private int sortOrder;
    @NotNull private String scope;  // TEAM | PERSONAL
}
```

### 3.5 Service

**文件：`application/service/QuickReplyService.java`（新建）**

```java
@Service
@RequiredArgsConstructor
public class QuickReplyService {

    private final QuickReplyMapper quickReplyMapper;

    /** 座席侧：查询可用快捷回复（TEAM + 自己的 PERSONAL） */
    public List<QuickReplyVO> listForAgent(String agentId, String keyword) {
        return quickReplyMapper.findVisibleByAgent(agentId, StringUtils.hasText(keyword) ? keyword : null)
                .stream()
                .map(this::toVO)
                .toList();
    }

    /** 管理端：创建快捷回复 */
    public Long create(String operatorId, SaveQuickReplyRequest req) {
        QuickReplyEntity entity = new QuickReplyEntity();
        BeanUtils.copyProperties(req, entity);
        entity.setEnabled(true);
        // PERSONAL 类型自动绑定操作者 ID
        if ("PERSONAL".equals(req.getScope())) {
            entity.setCreatorId(operatorId);
        }
        quickReplyMapper.insert(entity);
        return entity.getId();
    }

    /** 管理端：更新 */
    public void update(Long id, SaveQuickReplyRequest req) {
        QuickReplyEntity entity = quickReplyMapper.selectById(id);
        if (entity == null) throw new BusinessException("快捷回复不存在");
        BeanUtils.copyProperties(req, entity);
        quickReplyMapper.updateById(entity);
    }

    /** 管理端：软删除（enabled = false） */
    public void delete(Long id) {
        QuickReplyEntity entity = quickReplyMapper.selectById(id);
        if (entity == null) return;
        entity.setEnabled(false);
        quickReplyMapper.updateById(entity);
    }

    private QuickReplyVO toVO(QuickReplyEntity e) {
        return QuickReplyVO.builder()
                .id(e.getId())
                .category(e.getCategory())
                .content(e.getContent())
                .sortOrder(e.getSortOrder())
                .scope(e.getScope())
                .build();
    }
}
```

### 3.6 Controller

**文件：`interfaces/rest/QuickReplyController.java`（新建）**

```java
@RestController
@RequestMapping("/api/v1/quick-replies")
@RequiredArgsConstructor
public class QuickReplyController {

    private final QuickReplyService quickReplyService;

    /**
     * 座席侧：获取可用快捷回复列表
     * 支持 keyword 关键词过滤，支持 category 分组过滤
     */
    @GetMapping
    public R<List<QuickReplyVO>> list(
            @RequestParam(required = false) String keyword) {
        String agentId = (String) StpUtil.getLoginId();
        return R.ok(quickReplyService.listForAgent(agentId, keyword));
    }

    /**
     * 管理端：新增快捷回复
     */
    @PostMapping
    @SaCheckPermission("system:quick-reply:create")
    public R<Long> create(@RequestBody @Validated SaveQuickReplyRequest req) {
        String operatorId = (String) StpUtil.getLoginId();
        return R.ok(quickReplyService.create(operatorId, req));
    }

    /**
     * 管理端：更新快捷回复
     */
    @PutMapping("/{id}")
    @SaCheckPermission("system:quick-reply:update")
    public R<Void> update(
            @PathVariable Long id,
            @RequestBody @Validated SaveQuickReplyRequest req) {
        quickReplyService.update(id, req);
        return R.ok();
    }

    /**
     * 管理端：删除快捷回复（软删除）
     */
    @DeleteMapping("/{id}")
    @SaCheckPermission("system:quick-reply:delete")
    public R<Void> delete(@PathVariable Long id) {
        quickReplyService.delete(id);
        return R.ok();
    }
}
```

### 3.7 权限初始化 SQL

**随 V5 迁移追加：**

```sql
-- 快捷回复管理权限
INSERT INTO cs_auth.sys_permission (permission_key, module) VALUES
('system:quick-reply:create', 'quick-reply'),
('system:quick-reply:update', 'quick-reply'),
('system:quick-reply:delete', 'quick-reply');

-- 授予 kf_manager 角色
INSERT INTO cs_auth.sys_role_permission (role_id, permission_key)
SELECT r.id, p.permission_key
FROM cs_auth.sys_role r
CROSS JOIN (
    VALUES ('system:quick-reply:create'),
           ('system:quick-reply:update'),
           ('system:quick-reply:delete')
) AS p(permission_key)
WHERE r.role_key = 'kf_manager';
```

## 四、Sprint 2 — 会话内部备注（P2-3）

### 4.1 数据库迁移

**文件：`resources/db/migration/V6__add_session_notes.sql`（新建）**

```sql
-- ============================================================
-- V6: 会话内部备注
-- 备注本质上是 role='note' 的特殊消息，复用消息表，
-- 通过 role 字段区分，不向访客端下发
-- ============================================================

-- cs_conversation_message 表的 role 字段原有枚举式约束（注释中）：
-- user | assistant | agent | system | tool
-- 新增 'note' 值，PostgreSQL CHECK 约束如下（若有则修改）：
ALTER TABLE cs_conversation.cs_conversation_message
    ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN cs_conversation.cs_conversation_message.is_internal
    IS 'TRUE 表示内部消息（备注），不向访客端推送';

-- 为内部消息查询加索引
CREATE INDEX IF NOT EXISTS idx_msg_internal
    ON cs_conversation.cs_conversation_message(session_id, is_internal);
```

> **设计说明**：不新建独立备注表，而是在现有消息表中新增 `is_internal` 标记列。这样备注消息可以跟随会话历史一起查询和转交，且代码改动最小。

### 4.2 实体类修改

**文件：`infrastructure/persistence/entity/ConversationMessageEntity.java`（修改）**

```java
// 在现有字段末尾新增
/** 是否为内部消息（备注）。TRUE 时不向访客端推送 */
private Boolean isInternal;
```

### 4.3 DTO

**文件：`interfaces/rest/dto/AddSessionNoteRequest.java`（新建）**

```java
@Data
public class AddSessionNoteRequest {
    @NotBlank(message = "备注内容不能为空")
    @Size(max = 1000, message = "备注不超过 1000 字")
    private String content;
}
```

### 4.4 Service 新增方法

**SessionQueueService.java 新增：**

```java
/**
 * 添加会话内部备注
 * 备注以 role='note', is_internal=true 持久化，不推送给访客
 *
 * @param sessionId 会话 ID
 * @param agentId   操作座席 ID
 * @param content   备注内容
 */
public void addNote(String sessionId, String agentId, String content) {
    // 校验会话存在且座席有权操作
    if (!isActive(sessionId)) {
        throw new BusinessException("会话不存在或已结束");
    }

    // 构建消息实体
    long seq = generateNextSeq(sessionId);
    ConversationMessageEntity note = new ConversationMessageEntity();
    note.setSessionId(sessionId);
    note.setRole("note");
    note.setContent(content);
    note.setSeq(seq);
    note.setIsInternal(true);
    note.setTimestamp(Instant.now().toEpochMilli());

    // 仅持久化，不推送给访客
    conversationPersistRepository.saveMessages(List.of(note));

    // 通过 WS notifyAgent 让座席侧实时看到备注（可选，也可由前端乐观更新）
    // notifyAgent 消息体中加 isInternal=true，前端过滤展示
    WsChatMessage wsNote = WsChatMessage.builder()
            .type("MESSAGE")
            .sessionId(sessionId)
            .role("note")
            .content(content)
            .seq(String.valueOf(seq))
            .timestamp(System.currentTimeMillis())
            .isInternal(true)
            .build();
    chatWebSocketHandler.notifyAgent(sessionId, JsonUtil.toJson(wsNote));
}
```

### 4.5 Controller 端点

**SessionQueueController.java 新增：**

```java
/**
 * 添加会话内部备注（仅对座席可见，不推送给访客）
 */
@PostMapping("/{sessionId}/notes")
public R<Void> addNote(
        @PathVariable String sessionId,
        @RequestBody @Validated AddSessionNoteRequest req) {
    String agentId = (String) StpUtil.getLoginId();
    sessionQueueService.addNote(sessionId, agentId, req.getContent());
    return R.ok();
}
```

### 4.6 历史记录查询过滤

`getSessionHistoryApi` 拉取历史时，备注应对座席可见，对访客不可见。修改历史查询 SQL：

**ConversationPersistRepository 现有查询逻辑调整：**

```java
/**
 * @param includeInternal true=座席视角（包含备注），false=访客视角（排除备注）
 */
public List<ChatHistoryItem> getHistory(String sessionId, Long sinceSeq, boolean includeInternal) {
    LambdaQueryWrapper<ConversationMessageEntity> wrapper =
        Wrappers.<ConversationMessageEntity>lambdaQuery()
            .eq(ConversationMessageEntity::getSessionId, sessionId)
            .gt(sinceSeq != null, ConversationMessageEntity::getSeq, sinceSeq)
            .eq(!includeInternal, ConversationMessageEntity::getIsInternal, false)
            .orderByAsc(ConversationMessageEntity::getSeq);
    return mapper.selectList(wrapper).stream().map(this::toChatHistoryItem).toList();
}
```

`GET /api/v1/chat/history` 接口通过 Sa-Token 角色判断调用方：

```java
// ChatHistoryController.java 修改
boolean includeInternal = StpUtil.hasRole("kf_agent") || StpUtil.hasRole("kf_manager");
List<ChatHistoryItem> history = persistRepo.getHistory(sessionId, sinceSeq, includeInternal);
```

### 4.7 WsChatMessage 扩展

```java
// WsChatMessage.java 新增字段
/** 是否为内部消息（前端据此决定展示样式，访客端收不到此字段为 true 的消息） */
@JsonInclude(JsonInclude.Include.NON_NULL)
private Boolean isInternal;
```

**ChatWebSocketHandler `handleTextMessage` 修改**：转发消息给访客前检查 `isInternal`：

```java
// 座席 → 访客转发逻辑
if (Boolean.TRUE.equals(parsedMsg.getIsInternal())) {
    // 内部消息不转发给访客，只持久化
    persistMessage(sessionId, parsedMsg);
    return;
}
// 原有转发逻辑...
```

## 五、Sprint 2 — 结束会话扩展（reason + CSAT）& 转交备注（P2-4 & P2-6）

### 5.1 数据库迁移

**文件：`resources/db/migration/V7__add_conversation_close_reason.sql`（新建）**

```sql
-- ============================================================
-- V7: 会话结束原因 + 转交备注
-- ============================================================

-- 结束原因
ALTER TABLE cs_conversation.cs_conversation
    ADD COLUMN IF NOT EXISTS close_reason VARCHAR(32);

COMMENT ON COLUMN cs_conversation.cs_conversation.close_reason
    IS 'RESOLVED | UNRESOLVED | FOLLOW_UP，结束时由座席选择';

-- 转交备注（存于会话表，转交时更新）
ALTER TABLE cs_conversation.cs_conversation
    ADD COLUMN IF NOT EXISTS transfer_note TEXT;

COMMENT ON COLUMN cs_conversation.cs_conversation.transfer_note
    IS '转交时座席填写的交接备注，供接手方参考';
```

---

### 5.2 结束会话接口扩展（P2-6）

#### 5.2.1 请求 DTO 修改

**`interfaces/rest/dto/CloseSessionRequest.java`（新建，原 close 无 body）**

```java
@Data
public class CloseSessionRequest {
    /**
     * RESOLVED   — 问题已解决（触发 CSAT 邀请）<br>
     * UNRESOLVED — 问题未解决（不触发 CSAT）<br>
     * FOLLOW_UP  — 转单跟进（触发 CSAT 邀请）
     */
    @NotNull(message = "close reason 不能为空")
    private String reason;
}
```

#### 5.2.2 SessionQueueService.close() 修改

```java
// 原方法签名
public void close(String sessionId)

// 改为
public void close(String sessionId, String reason) {
    // 原有逻辑不变：更新 Redis 状态、关闭访客 WS、发布 SESSION_END 事件

    // 新增：持久化 close_reason
    conversationPersistRepository.closeConversation(sessionId, reason);

    // 新增：CSAT 触发逻辑
    if ("RESOLVED".equals(reason) || "FOLLOW_UP".equals(reason)) {
        triggerCsatInvitation(sessionId);
    }
}
```

#### 5.2.3 CSAT 触发实现

```java
/**
 * 向访客端推送满意度评分邀请
 * 通过现有 WS notifyVisitor 机制实现，访客端收到后展示评分 UI
 */
private void triggerCsatInvitation(String sessionId) {
    String payload = JsonUtil.toJson(Map.of(
        "type", "CSAT_INVITE",
        "sessionId", sessionId,
        "message", "本次服务已结束，请为本次服务评分"
    ));
    // notifyVisitor 内部会检查 WS 连接是否仍存在
    chatWebSocketHandler.notifyVisitor(sessionId, payload);
}
```

#### 5.2.4 ConversationPersistRepository.closeConversation() 修改

```java
// 原方法签名
public void closeConversation(String sessionId)

// 改为
public void closeConversation(String sessionId, String reason) {
    conversationMapper.update(null,
        Wrappers.<ConversationEntity>lambdaUpdate()
            .eq(ConversationEntity::getSessionId, sessionId)
            .set(ConversationEntity::getStatus, "CLOSED")
            .set(ConversationEntity::getEndedAt, LocalDateTime.now())
            .set(reason != null, ConversationEntity::getCloseReason, reason)
    );
}
```

#### 5.2.5 Controller 修改

```java
// SessionQueueController.java
@PostMapping("/{sessionId}/close")
public R<Void> close(
        @PathVariable String sessionId,
        @RequestBody(required = false) CloseSessionRequest req) {
    // 兼容旧调用（无 body）：reason 可为 null
    String reason = req != null ? req.getReason() : null;
    sessionQueueService.close(sessionId, reason);
    return R.ok();
}
```

---

### 5.3 转交接口扩展（P2-4）

#### 5.3.1 TransferRequest DTO 修改

**`interfaces/rest/dto/TransferRequest.java`（修改）**

```java
@Data
public class TransferRequest {
    @NotBlank
    private String targetAgentId;

    /** 可选：向接手座席说明当前问题进展 */
    @Size(max = 500)
    private String note;
}
```

#### 5.3.2 SessionQueueService.transfer() 修改

```java
public void transfer(String sessionId, String fromAgentId, String targetAgentId, String note) {
    // 原有 CAS 转交逻辑不变

    // 新增：持久化 transfer_note
    if (StringUtils.hasText(note)) {
        conversationPersistRepository.updateTransferNote(sessionId, note);
    }

    // 新增：SSE TRANSFER 事件中携带 note 字段
    SessionSseEvent event = SessionSseEvent.builder()
            .type("TRANSFER")
            .item(updatedItem)
            .fromAgentId(fromAgentId)
            .toAgentId(targetAgentId)
            .note(note)          // 新增字段
            .build();
    sessionEventPublisher.publish(event);
}
```

#### 5.3.3 SessionSseEvent 扩展

```java
// domain/event/SessionSseEvent.java（修改）
@Data @Builder
public class SessionSseEvent {
    private String type;
    private SessionQueueItem item;
    private String fromAgentId;
    private String toAgentId;

    /** 转交时的交接备注，接手座席通过 SSE 接收后展示 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String note;
}
```

#### 5.3.4 SessionQueueItem 扩展

```java
// domain/model/SessionQueueItem.java（修改）
@Data @Builder
public class SessionQueueItem {
    // ...原有字段...

    /** 接入时间（epoch 秒），前端用于计算会话时长 */
    private Long acceptedAt;

    /** 转交备注 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String transferNote;
}
```

`accept()` 方法中设置 `acceptedAt`：

```java
public SessionQueueItem accept(String sessionId, String agentId) {
    // ...CAS 逻辑...
    SessionQueueItem updated = SessionQueueItem.builder()
            // ...原有字段...
            .status(SessionStatus.ACTIVE)
            .agentId(agentId)
            .acceptedAt(Instant.now().getEpochSecond())   // 新增
            .build();
    repository.save(updated);
    return updated;
}
```

## 六、Sprint 3 — WS TYPING 事件广播（P2-1）

### 6.1 设计思路

访客端在输入框按键时，通过现有 WS 连接（`/ws/chat/*`）向后端发送 `TYPING` 类型消息，后端转发给对应座席。考虑到打字状态是高频低价值事件，后端只做透传，不持久化。

### 6.2 WS 消息类型扩展

**访客端发送（入站）：**

```json
{ "type": "TYPING",      "sessionId": "xxx" }
{ "type": "STOP_TYPING", "sessionId": "xxx" }
```

**后端转发给座席（出站）：**

```json
{ "type": "TYPING",      "sessionId": "xxx", "role": "user" }
{ "type": "STOP_TYPING", "sessionId": "xxx", "role": "user" }
```

### 6.3 ChatWebSocketHandler 修改

**文件：`infrastructure/websocket/ChatWebSocketHandler.java`（修改）**

在 `handleTextMessage` 的访客消息处理分支中新增 TYPING 透传逻辑：

```java
@Override
protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
    WsChatMessage msg = JsonUtil.parse(message.getPayload(), WsChatMessage.class);
    String sessionId = extractSessionId(session);

    // 判断消息来源：访客 or 座席
    if (visitorSessions.containsKey(sessionId)) {
        handleVisitorMessage(session, sessionId, msg);
    } else if (agentSessions.containsKey(sessionId)) {
        handleAgentMessage(session, sessionId, msg);
    }
}

private void handleVisitorMessage(WebSocketSession session,
                                   String sessionId,
                                   WsChatMessage msg) {
    // === 新增：TYPING / STOP_TYPING 透传 ===
    if ("TYPING".equals(msg.getType()) || "STOP_TYPING".equals(msg.getType())) {
        // 不持久化，直接透传给座席
        WsChatMessage forward = WsChatMessage.builder()
                .type(msg.getType())
                .sessionId(sessionId)
                .role("user")
                .build();
        notifyAgent(sessionId, JsonUtil.toJson(forward));
        return;  // 不走后续持久化逻辑
    }

    // === 原有：普通文本消息处理 ===
    // 1. 存入 Redis 历史
    // 2. 触发 AI 处理流程
    // 3. notifyAgent 转发
    // ...（原有逻辑不变）
}
```

### 6.4 节流保护

TYPING 事件高频发送可能打爆后端，在 `handleVisitorMessage` 入口加简单节流：

```java
// 每个 session 的最后一次 TYPING 转发时间
private final ConcurrentHashMap<String, Long> lastTypingForwardMs = new ConcurrentHashMap<>();

private void handleVisitorMessage(...) {
    if ("TYPING".equals(msg.getType()) || "STOP_TYPING".equals(msg.getType())) {
        long now = System.currentTimeMillis();
        // TYPING 类型：500ms 内只转发一次；STOP_TYPING 不节流
        if ("TYPING".equals(msg.getType())) {
            Long last = lastTypingForwardMs.get(sessionId);
            if (last != null && now - last < 500) return;
            lastTypingForwardMs.put(sessionId, now);
        } else {
            lastTypingForwardMs.remove(sessionId);
        }
        // 转发逻辑...
        return;
    }
    // ...
}
```

### 6.5 访客端改造说明（对前端访客 SDK 的要求）

访客端（`/ws/chat/*`）需在用户输入时发送 TYPING 事件，停止输入 1.5s 后发送 STOP_TYPING 事件。这属于访客端 JS SDK 的改动，不在本次座席工作台改造范围内，但需与访客端团队对齐接口协议。

---

### 6.6 AgentHandshakeInterceptor Token 验证补全

**当前问题**：`validateToken()` 是 Phase-1 stub，只校验 token 非空，未做真实验证。  
**修复**：补全 Sa-Token 验证逻辑。

**文件：`infrastructure/websocket/AgentHandshakeInterceptor.java`（修改）**

```java
@Override
public boolean beforeHandshake(ServerHttpRequest request,
                                ServerHttpResponse response,
                                WebSocketHandler wsHandler,
                                Map<String, Object> attributes) {
    String token = extractToken(request);
    if (!StringUtils.hasText(token)) {
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }

    // Phase-2：真实 Sa-Token 验证（原为 stub）
    try {
        Object loginId = StpUtil.getLoginIdByToken(token);
        if (loginId == null) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put("token", token);
        attributes.put("agentId", loginId.toString());
        return true;
    } catch (Exception e) {
        log.warn("[AgentWS] token validation failed: {}", e.getMessage());
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }
}
```

`ChatWebSocketHandler` 中从 session attributes 取 agentId，不再重复解析 token：

```java
private String extractAgentId(WebSocketSession session) {
    return (String) session.getAttributes().get("agentId");
}
```

## 七、并发冲突防御 + active 列表 acceptedAt 字段

### 7.1 并发接入同一会话的防御（T3-3）

当前 `accept()` 已使用 Redis CAS（`compareAndSetStatus`），但存在以下边界问题：

#### 7.1.1 现有 CAS 逻辑回顾

```java
// SessionQueueRepository.java
public boolean compareAndSetStatus(String sessionId, SessionQueueItem newItem) {
    // 读取 → 比对 status == WAITING → 写入
    // 问题：非原子操作，Redis 单线程保证一定程度安全，但 Lua 脚本更可靠
}
```

#### 7.1.2 改造为 Lua 原子脚本

```java
private static final String CAS_ACCEPT_SCRIPT = """
    local raw = redis.call('HGET', KEYS[1], ARGV[1])
    if not raw then return 0 end
    local item = cjson.decode(raw)
    if item['status'] ~= 'WAITING' then return 0 end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    return 1
    """;

public boolean atomicAccept(String sessionId, SessionQueueItem newItem) {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>(CAS_ACCEPT_SCRIPT, Long.class);
    Long result = redisTemplate.execute(
        script,
        List.of(QUEUE_KEY),           // KEYS[1]
        sessionId,                     // ARGV[1]
        JsonUtil.toJson(newItem)       // ARGV[2]
    );
    return Long.valueOf(1L).equals(result);
}
```

#### 7.1.3 接入失败响应

```java
// SessionQueueService.accept()
boolean acquired = repository.atomicAccept(sessionId, updatedItem);
if (!acquired) {
    throw new BusinessException("该会话已被其他座席接入，请刷新队列");
}
```

HTTP 响应：`400 Bad Request`，前端展示 toast 错误提示。

---

### 7.2 active 列表增加 acceptedAt 字段（P2-5）

前端会话时长计算依赖 `acceptedAt`，需在 `getActiveSessions()` 返回的数据中包含此字段。

#### 7.2.1 SessionQueueItem 已在 Sprint 2 扩展

`acceptedAt` 字段在 `accept()` 时写入 Redis Hash，`getActiveSessions()` 从 Redis 读取时自动包含。

#### 7.2.2 数据补偿（历史数据）

已有的 ACTIVE 会话在 Redis 中没有 `acceptedAt` 字段（迁移前接入的），需从 DB 的 `started_at` 字段补偿：

```java
// SessionQueueService.getActiveSessions()
public List<SessionQueueItem> getActiveSessions() {
    List<SessionQueueItem> items = repository.findByStatus(SessionStatus.ACTIVE);

    // 补偿：acceptedAt 为空时从 DB 读取 activated_at
    List<String> missing = items.stream()
            .filter(i -> i.getAcceptedAt() == null)
            .map(SessionQueueItem::getSessionId)
            .toList();

    if (!missing.isEmpty()) {
        Map<String, Long> dbTimes = conversationPersistRepository
                .getActivatedAtByIds(missing);
        items.forEach(i -> {
            if (i.getAcceptedAt() == null) {
                i.setAcceptedAt(dbTimes.getOrDefault(i.getSessionId(),
                        Instant.now().getEpochSecond()));
            }
        });
    }
    return items;
}
```

```java
// ConversationPersistRepository 新增
public Map<String, Long> getActivatedAtByIds(List<String> sessionIds) {
    if (sessionIds.isEmpty()) return Map.of();
    List<ConversationEntity> entities = conversationMapper.selectList(
        Wrappers.<ConversationEntity>lambdaQuery()
            .in(ConversationEntity::getSessionId, sessionIds)
            .select(ConversationEntity::getSessionId, ConversationEntity::getStartedAt)
    );
    return entities.stream().collect(Collectors.toMap(
        ConversationEntity::getSessionId,
        e -> e.getStartedAt().toInstant(ZoneOffset.UTC).getEpochSecond()
    ));
}
```

---

### 7.3 会话标签实时更新接口（P3-6）

前端支持座席修改会话标签，后端新增对应端点：

```java
// DTO
@Data
public class UpdateSessionTagRequest {
    @NotBlank @Size(max = 32)
    private String tag;
}

// Controller（SessionQueueController.java 新增）
@PatchMapping("/{sessionId}/tag")
public R<Void> updateTag(
        @PathVariable String sessionId,
        @RequestBody @Validated UpdateSessionTagRequest req) {
    String agentId = (String) StpUtil.getLoginId();
    sessionQueueService.updateTag(sessionId, agentId, req.getTag());
    return R.ok();
}

// Service
public void updateTag(String sessionId, String agentId, String tag) {
    // 更新 Redis 中 SessionQueueItem 的 tag 字段
    SessionQueueItem item = repository.findById(sessionId)
            .orElseThrow(() -> new BusinessException("会话不存在"));
    item.setTag(tag);
    repository.save(item);
    // 同步更新 DB
    conversationPersistRepository.updateTag(sessionId, tag);
}
```

```java
// ConversationPersistRepository 新增
public void updateTag(String sessionId, String tag) {
    conversationMapper.update(null,
        Wrappers.<ConversationEntity>lambdaUpdate()
            .eq(ConversationEntity::getSessionId, sessionId)
            .set(ConversationEntity::getTag, tag)
    );
}
```

## 八、后端测试策略

### 8.1 单元测试

#### 8.1.1 SessionQueueService 新增方法测试

**文件：`conversation-service/src/test/java/com/aria/conversation/application/service/SessionQueueServiceTest.java`（新增用例）**

```java
@ExtendWith(MockitoExtension.class)
class SessionQueueServiceTest {

    @Mock SessionQueueRepository repository;
    @Mock ConversationPersistRepository persistRepository;
    @Mock ChatWebSocketHandler wsHandler;
    @Mock SessionEventPublisher eventPublisher;

    @InjectMocks SessionQueueService service;

    // ── close() 扩展测试 ──────────────────────────────────────

    @Test
    void close_withResolvedReason_shouldPersistReasonAndTriggerCsat() {
        String sessionId = "sess-1";
        SessionQueueItem item = buildActiveItem(sessionId);
        when(repository.findById(sessionId)).thenReturn(Optional.of(item));

        service.close(sessionId, "RESOLVED");

        verify(persistRepository).closeConversation(sessionId, "RESOLVED");
        // CSAT 触发：notifyVisitor 应被调用一次
        verify(wsHandler).notifyVisitor(eq(sessionId), contains("CSAT_INVITE"));
    }

    @Test
    void close_withUnresolvedReason_shouldNotTriggerCsat() {
        String sessionId = "sess-2";
        when(repository.findById(sessionId)).thenReturn(Optional.of(buildActiveItem(sessionId)));

        service.close(sessionId, "UNRESOLVED");

        verify(wsHandler, never()).notifyVisitor(any(), contains("CSAT_INVITE"));
    }

    @Test
    void close_withNullReason_shouldStillCloseSuccessfully() {
        String sessionId = "sess-3";
        when(repository.findById(sessionId)).thenReturn(Optional.of(buildActiveItem(sessionId)));

        assertDoesNotThrow(() -> service.close(sessionId, null));
        verify(persistRepository).closeConversation(sessionId, null);
    }

    // ── addNote() 测试 ────────────────────────────────────────

    @Test
    void addNote_onActiveSession_shouldPersistAndNotifyAgent() {
        String sessionId = "sess-4";
        when(service.isActive(sessionId)).thenReturn(true);

        service.addNote(sessionId, "agent-1", "已联系仓库确认");

        verify(persistRepository).saveMessages(argThat(msgs ->
            msgs.size() == 1
            && Boolean.TRUE.equals(msgs.get(0).getIsInternal())
            && "note".equals(msgs.get(0).getRole())
        ));
        verify(wsHandler).notifyAgent(eq(sessionId), contains("note"));
    }

    @Test
    void addNote_onClosedSession_shouldThrowBusinessException() {
        when(service.isActive("sess-5")).thenReturn(false);
        assertThrows(BusinessException.class,
            () -> service.addNote("sess-5", "agent-1", "备注内容"));
    }

    // ── transfer() 扩展测试 ───────────────────────────────────

    @Test
    void transfer_withNote_shouldPersistNoteAndIncludeInSseEvent() {
        String sessionId = "sess-6";
        String note = "已确认订单，等待仓库回复";
        // ... setup ...

        service.transfer(sessionId, "agent-1", "agent-2", note);

        verify(persistRepository).updateTransferNote(sessionId, note);
        verify(eventPublisher).publish(argThat(event ->
            note.equals(event.getNote())
        ));
    }

    // ── atomicAccept() 并发测试 ───────────────────────────────

    @Test
    void accept_whenAlreadyAccepted_shouldThrowBusinessException() {
        String sessionId = "sess-7";
        when(repository.atomicAccept(eq(sessionId), any())).thenReturn(false);

        assertThrows(BusinessException.class,
            () -> service.accept(sessionId, "agent-1"));
    }
}
```

#### 8.1.2 QuickReplyService 测试

**文件：`QuickReplyServiceTest.java`（新建）**

```java
@ExtendWith(MockitoExtension.class)
class QuickReplyServiceTest {

    @Mock QuickReplyMapper mapper;
    @InjectMocks QuickReplyService service;

    @Test
    void listForAgent_shouldReturnTeamAndPersonalReplies() {
        String agentId = "agent-1";
        List<QuickReplyEntity> entities = List.of(
            buildEntity(1L, "订单类", "已核实", "TEAM", null),
            buildEntity(2L, "通用",   "感谢",   "PERSONAL", agentId)
        );
        when(mapper.findVisibleByAgent(agentId, null)).thenReturn(entities);

        List<QuickReplyVO> result = service.listForAgent(agentId, null);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getCategory()).isEqualTo("订单类");
    }

    @Test
    void create_personalScope_shouldSetCreatorId() {
        SaveQuickReplyRequest req = new SaveQuickReplyRequest();
        req.setCategory("通用"); req.setContent("测试"); req.setScope("PERSONAL");

        service.create("agent-1", req);

        verify(mapper).insert(argThat(e -> "agent-1".equals(e.getCreatorId())));
    }

    @Test
    void create_teamScope_shouldNotSetCreatorId() {
        SaveQuickReplyRequest req = new SaveQuickReplyRequest();
        req.setCategory("订单类"); req.setContent("测试"); req.setScope("TEAM");

        service.create("agent-1", req);

        verify(mapper).insert(argThat(e -> e.getCreatorId() == null));
    }

    @Test
    void delete_shouldSetEnabledFalse() {
        when(mapper.selectById(1L)).thenReturn(buildEntity(1L, "通用", "测试", "TEAM", null));
        service.delete(1L);
        verify(mapper).updateById(argThat(e -> Boolean.FALSE.equals(e.getEnabled())));
    }
}
```

#### 8.1.3 AgentStatusService 测试

```java
@Test
void updateStatus_offline_shouldForceOfflineAndPublishEvent() {
    agentStatusService.updateStatus("agent-1", AgentStatus.OFFLINE);
    verify(agentOnlineRegistry).forceOffline("agent-1");
    verify(eventPublisher).publishAgentOffline("agent-1");
}

@Test
void updateStatus_busy_shouldUpdateStatusOnly() {
    agentStatusService.updateStatus("agent-1", AgentStatus.BUSY);
    verify(agentOnlineRegistry).updateStatus("agent-1", AgentStatus.BUSY);
    verify(agentOnlineRegistry, never()).forceOffline(any());
}
```

---

### 8.2 集成测试

#### 8.2.1 Redis CAS 并发测试

```java
@SpringBootTest
@EmbeddedRedis  // 使用 embedded-redis 测试
class SessionQueueRepositoryIT {

    @Autowired SessionQueueRepository repository;

    @Test
    void atomicAccept_concurrent_onlyOneThreadShouldSucceed() throws Exception {
        String sessionId = "it-sess-1";
        repository.save(buildWaitingItem(sessionId));

        int threads = 10;
        CountDownLatch latch = new CountDownLatch(threads);
        AtomicInteger successCount = new AtomicInteger(0);

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        for (int i = 0; i < threads; i++) {
            final String agentId = "agent-" + i;
            pool.submit(() -> {
                latch.countDown();
                try { latch.await(); } catch (InterruptedException ignored) {}
                boolean ok = repository.atomicAccept(sessionId, buildActiveItem(sessionId, agentId));
                if (ok) successCount.incrementAndGet();
            });
        }
        pool.shutdown();
        pool.awaitTermination(5, TimeUnit.SECONDS);

        assertThat(successCount.get()).isEqualTo(1);
    }
}
```

#### 8.2.2 API 集成测试

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class QuickReplyControllerIT {

    @Test
    void listQuickReplies_withValidToken_shouldReturn200() {
        // 使用测试 token 调用 GET /api/v1/quick-replies
        // 验证返回 200 且结构正确
    }

    @Test
    void createQuickReply_withoutPermission_shouldReturn403() {
        // 普通座席角色尝试创建，验证 403
    }
}
```

## 九、数据库迁移汇总 + 部署注意事项

### 9.1 Flyway 迁移文件清单

| 版本 | 文件名 | 内容 | Sprint |
|---|---|---|---|
| V5 | `V5__add_quick_reply.sql` | 新建 `cs_quick_reply` 表 + 权限初始化 | S2 |
| V6 | `V6__add_session_notes.sql` | `cs_conversation_message` 新增 `is_internal` 列 | S2 |
| V7 | `V7__add_conversation_close_reason.sql` | `cs_conversation` 新增 `close_reason`、`transfer_note` 列 | S2 |

> **Flyway 版本号说明**：当前 codebase 已有 V1-V4（根据现有 schema 推断），V5 开始顺序递增。执行前确认已有最高版本号，避免序号冲突。

### 9.2 V5 完整迁移脚本

```sql
-- V5__add_quick_reply.sql
SET search_path = cs_conversation;

CREATE TABLE cs_quick_reply (
    id           BIGSERIAL    PRIMARY KEY,
    category     VARCHAR(64)  NOT NULL DEFAULT '通用',
    content      TEXT         NOT NULL,
    sort_order   INT          NOT NULL DEFAULT 0,
    scope        VARCHAR(16)  NOT NULL DEFAULT 'TEAM'
                              CHECK (scope IN ('TEAM', 'PERSONAL')),
    creator_id   VARCHAR(64),
    enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_category   ON cs_quick_reply(category);
CREATE INDEX idx_qr_creator    ON cs_quick_reply(creator_id) WHERE creator_id IS NOT NULL;
CREATE INDEX idx_qr_scope_enabled ON cs_quick_reply(scope, enabled);

-- 权限数据（在 cs_auth schema）
SET search_path = cs_auth;

INSERT INTO sys_permission (permission_key, module) VALUES
  ('system:quick-reply:create', 'quick-reply'),
  ('system:quick-reply:update', 'quick-reply'),
  ('system:quick-reply:delete', 'quick-reply')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sys_role_permission (role_id, permission_key)
SELECT r.id, v.pk
FROM sys_role r
CROSS JOIN (VALUES
  ('system:quick-reply:create'),
  ('system:quick-reply:update'),
  ('system:quick-reply:delete')
) AS v(pk)
WHERE r.role_key = 'kf_manager'
ON CONFLICT DO NOTHING;

-- 初始化示例数据
SET search_path = cs_conversation;
INSERT INTO cs_quick_reply (category, content, sort_order, scope) VALUES
  ('订单类', '已核实您的订单信息，请稍等。', 1, 'TEAM'),
  ('订单类', '已为您安排补发处理，预计 3-5 个工作日到达。', 2, 'TEAM'),
  ('物流类', '已为您提交快递投诉，编号已记录。', 1, 'TEAM'),
  ('退款类', '您的退款申请已受理，预计 3-7 个工作日退回。', 1, 'TEAM'),
  ('通用',   '感谢您的耐心等待！', 1, 'TEAM'),
  ('通用',   '非常抱歉给您带来不便，我们会尽快处理。', 2, 'TEAM');
```

### 9.3 V6 完整迁移脚本

```sql
-- V6__add_session_notes.sql
SET search_path = cs_conversation;

ALTER TABLE cs_conversation_message
    ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_msg_internal
    ON cs_conversation_message(session_id, is_internal)
    WHERE is_internal = TRUE;

COMMENT ON COLUMN cs_conversation_message.is_internal
    IS 'TRUE 表示内部备注，不向访客端推送';
```

### 9.4 V7 完整迁移脚本

```sql
-- V7__add_conversation_close_reason.sql
SET search_path = cs_conversation;

ALTER TABLE cs_conversation
    ADD COLUMN IF NOT EXISTS close_reason  VARCHAR(32),
    ADD COLUMN IF NOT EXISTS transfer_note TEXT;

COMMENT ON COLUMN cs_conversation.close_reason
    IS 'RESOLVED | UNRESOLVED | FOLLOW_UP';
COMMENT ON COLUMN cs_conversation.transfer_note
    IS '转交时座席填写的交接说明';
```

---

### 9.5 Redis Key 变更

| Key | 变更类型 | 说明 |
|---|---|---|
| `agent:online` Hash | 字段扩展 | `AgentInfo` JSON 新增 `status` 字段，旧数据缺少该字段时视为 `ONLINE` |
| `agent:session:queue` Hash | 字段扩展 | `SessionQueueItem` JSON 新增 `acceptedAt`、`transferNote` 字段 |

**向后兼容处理**：Java 反序列化时对新字段设置默认值：

```java
// SessionQueueItem.java
@JsonIgnoreProperties(ignoreUnknown = true)  // 已有，确保不报错

// AgentInfo record 改为 class，支持默认值
public class AgentInfo {
    // 反序列化时 status 默认为 "ONLINE"
    @JsonProperty(defaultValue = "ONLINE")
    private String status = "ONLINE";
}
```

---

### 9.6 部署步骤

#### 9.6.1 标准部署顺序

```
1. 数据库迁移（Flyway 自动执行）
   - 部署新版 conversation-service 时 Flyway 自动运行 V5/V6/V7
   - 确保 DB 用户有 ALTER TABLE 权限

2. 重启 conversation-service
   - 新接口生效
   - Redis 中旧的 SessionQueueItem 无 acceptedAt 字段 → 服务内补偿逻辑处理

3. 重启 auth-service（无代码变更，可选）

4. 前端部署
   - 依赖后端新接口就绪后再部署，避免 API 404
```

#### 9.6.2 回滚方案

| 迁移版本 | 回滚操作 |
|---|---|
| V5 | `DROP TABLE cs_conversation.cs_quick_reply` + 删除权限数据 |
| V6 | `ALTER TABLE cs_conversation_message DROP COLUMN is_internal` |
| V7 | `ALTER TABLE cs_conversation DROP COLUMN close_reason, DROP COLUMN transfer_note` |

> Flyway 默认不支持自动回滚，需手动执行。建议在预发布环境完整验证后再上生产。

#### 9.6.3 灰度注意事项

- `PUT /api/v1/agent/status` 是新接口，旧前端不会调用，无影响
- `POST /api/v1/sessions/:id/close` 新增 body 参数，`required = false` 兼容旧调用
- `POST /api/v1/sessions/:id/transfer` 新增 `note` 字段，为可选，旧调用兼容
- Redis `AgentInfo`/`SessionQueueItem` 新字段均有默认值，滚动升级期间不影响读取

## 十、后端改造实施清单与接口汇总

### 10.1 完整改造文件清单

| 文件 | 操作 | Sprint |
|---|---|---|
| `interfaces/rest/AgentProfileController.java` | 新建 | S1 |
| `interfaces/rest/QuickReplyController.java` | 新建 | S2 |
| `interfaces/rest/dto/UpdateAgentStatusRequest.java` | 新建 | S1 |
| `interfaces/rest/dto/CloseSessionRequest.java` | 新建 | S2 |
| `interfaces/rest/dto/AddSessionNoteRequest.java` | 新建 | S2 |
| `interfaces/rest/dto/UpdateSessionTagRequest.java` | 新建 | S3 |
| `interfaces/rest/dto/SaveQuickReplyRequest.java` | 新建 | S2 |
| `interfaces/rest/vo/AgentProfileVO.java` | 新建 | S1 |
| `interfaces/rest/vo/QuickReplyVO.java` | 新建 | S2 |
| `interfaces/rest/SessionQueueController.java` | 修改：新增 4 个端点 | S1/S2/S3 |
| `application/service/AgentStatusService.java` | 新建 | S1 |
| `application/service/QuickReplyService.java` | 新建 | S2 |
| `application/service/SessionQueueService.java` | 修改：close/transfer/addNote/updateTag | S2/S3 |
| `domain/model/SessionQueueItem.java` | 修改：新增 acceptedAt/transferNote | S2 |
| `domain/event/SessionSseEvent.java` | 修改：新增 note 字段 | S2 |
| `infrastructure/repository/AgentOnlineRegistry.java` | 修改：AgentInfo 新增 status，forceOffline/updateStatus | S1 |
| `infrastructure/repository/SessionQueueRepository.java` | 修改：atomicAccept Lua 脚本 | S2 |
| `infrastructure/persistence/ConversationPersistRepository.java` | 修改：close/transfer/notes/tag | S2/S3 |
| `infrastructure/persistence/QuickReplyMapper.java` | 新建 | S2 |
| `infrastructure/persistence/entity/QuickReplyEntity.java` | 新建 | S2 |
| `infrastructure/persistence/entity/ConversationMessageEntity.java` | 修改：新增 isInternal | S2 |
| `infrastructure/persistence/entity/ConversationEntity.java` | 修改：新增 closeReason/transferNote | S2 |
| `infrastructure/websocket/ChatWebSocketHandler.java` | 修改：TYPING 透传、isInternal 过滤 | S3 |
| `infrastructure/websocket/AgentHandshakeInterceptor.java` | 修改：补全 Sa-Token 验证 | S1 |
| `infrastructure/websocket/WsChatMessage.java` | 修改：新增 isInternal 字段 | S2 |
| `config/AgentProfileConfig.java` | 新建 | S1 |
| `resources/db/migration/V5__add_quick_reply.sql` | 新建 | S2 |
| `resources/db/migration/V6__add_session_notes.sql` | 新建 | S2 |
| `resources/db/migration/V7__add_conversation_close_reason.sql` | 新建 | S2 |
| `resources/application.yml` | 修改：新增 agent.profile.max-concurrent | S1 |

---

### 10.2 新增接口汇总

| HTTP 方法 | 路径 | 描述 | Sprint | 权限 |
|---|---|---|---|---|
| `GET` | `/api/v1/agent/profile` | 获取座席 profile（含 maxConcurrent） | S1 | 登录即可 |
| `PUT` | `/api/v1/agent/status` | 座席主动上报在线状态 | S1 | 登录即可 |
| `GET` | `/api/v1/quick-replies` | 查询快捷回复列表 | S2 | 登录即可 |
| `POST` | `/api/v1/quick-replies` | 创建快捷回复 | S2 | `system:quick-reply:create` |
| `PUT` | `/api/v1/quick-replies/{id}` | 更新快捷回复 | S2 | `system:quick-reply:update` |
| `DELETE` | `/api/v1/quick-replies/{id}` | 软删除快捷回复 | S2 | `system:quick-reply:delete` |
| `POST` | `/api/v1/sessions/{id}/notes` | 添加会话内部备注 | S2 | 登录即可 |
| `PATCH` | `/api/v1/sessions/{id}/tag` | 更新会话标签 | S3 | 登录即可 |

### 10.3 现有接口修改汇总

| 接口 | 变更内容 | 兼容性 |
|---|---|---|
| `POST /api/v1/sessions/:id/close` | 新增可选 body `{ reason }` | ✅ 向后兼容（body 可为空） |
| `POST /api/v1/sessions/:id/transfer` | 新增可选字段 `note` | ✅ 向后兼容（字段可为空） |
| `GET /api/v1/sessions/active` | 响应中 `SessionQueueItem` 新增 `acceptedAt` 字段 | ✅ 新增字段，不影响旧字段 |
| `GET /api/v1/chat/history` | 座席视角包含 `isInternal=true` 的备注消息 | ✅ 座席可查看更多，访客侧不变 |
| WS `MESSAGE` 事件 | 新增 `isInternal` 字段 | ✅ 可选字段，前端按需处理 |
| WS 新增 `TYPING` / `STOP_TYPING` 事件类型 | 访客→后端→座席的透传 | ✅ 新事件类型，不影响现有 |
| SSE `TRANSFER` 事件 | `SessionSseEvent` 新增 `note` 字段 | ✅ 可选字段 |

---

### 10.4 关键实施注意事项

**① Flyway 版本号确认**  
部署前执行 `SELECT version FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1;` 确认当前最高版本，V5/V6/V7 需严格递增，不能有跳号或重复。

**② Redis AgentInfo 字段默认值**  
`AgentInfo` 新增 `status` 字段后，Redis 中存量数据缺少该字段。反序列化时务必使用 `@JsonIgnoreProperties(ignoreUnknown = true)` 并设置默认值 `"ONLINE"`，避免 NPE。

**③ TYPING 节流参数调优**  
`lastTypingForwardMs` 的 500ms 节流阈值可根据实测调整。过短（<200ms）会导致高频事件，过长（>1s）会让打字指示器响应迟钝，500ms 是经验值。

**④ `sendBeacon` 下线认证问题**  
前端 `navigator.sendBeacon` 无法携带 `Authorization` header，建议后端新增快速下线端点：  
```
POST /api/v1/agent/offline?token={saToken}
@SaIgnore，token 从 query param 手动验证
```  
与现有 SSE events 端点的认证方式一致。

**⑤ CSAT 访客端 UI**  
后端通过 `notifyVisitor` 推送 `CSAT_INVITE` 类型 WS 消息，访客端需实现对应的评分 UI。本文档仅覆盖后端推送机制，访客端 SDK 改动需另立任务。

**⑥ 快捷回复缓存**  
快捷回复数据变更频率低，可在 `QuickReplyService.listForAgent()` 前加 Redis 缓存（TTL 5 分钟），减少 DB 查询。缓存 key 建议为 `quick_reply:agent:{agentId}`，管理端执行 CUD 操作时失效对应 key。

---

### 10.5 前后端联调检查点

| 检查点 | 前端验证 | 后端验证 |
|---|---|---|
| 座席状态同步 | 切换开关后刷新页面，状态保持 | Redis `agent:online` Hash 中 status 字段正确 |
| 快捷回复动态加载 | 管理端新增后前端立即可用 | `GET /api/v1/quick-replies` 返回新数据 |
| 内部备注不泄露 | 访客端 WS 不收到 `isInternal=true` 消息 | `ChatWebSocketHandler` 日志确认过滤 |
| 转交备注传递 | 接手座席右侧面板展示备注 | SSE TRANSFER event payload 含 note |
| 会话时长计算 | 右侧面板会话时长实时递增 | `active` 列表响应中 `acceptedAt` 有值 |
| 结束原因持久化 | 结束后在管理后台可查询到 reason | DB `cs_conversation.close_reason` 有值 |
| 并发接入保护 | 10 个标签页同时接入，只有 1 个成功 | Redis Lua 脚本日志 + DB 只有 1 条 ACTIVE |
| TYPING 透传 | 访客输入时座席侧展示「正在输入...」 | WS 日志确认 TYPING 事件转发 |

---

*本文档覆盖座席工作台后端改造的完整技术方案，建议配合前端文档 `docs/agent-workbench-frontend-transform.md` 对照阅读。*
---

## 十一（后端）、历史工单查询 + AI 总结接口

### BE-11.1 历史工单查询接口

#### 数据库查询

`cs_conversation` 表已存储所有历史会话，按 `visitor_name` 关联查询即可，无需新增表。

**ConversationPersistRepository 新增方法：**

```java
/**
 * 查询同一访客的历史已结束会话（排除当前会话）
 *
 * @param visitorName      访客名称
 * @param excludeSessionId 当前会话 ID（排除自身）
 * @param limit            最多返回条数，默认 20
 */
public List<ConversationEntity> getVisitorHistory(
        String visitorName, String excludeSessionId, int limit) {
    return conversationMapper.selectList(
        Wrappers.<ConversationEntity>lambdaQuery()
            .eq(ConversationEntity::getVisitorName, visitorName)
            .ne(ConversationEntity::getSessionId, excludeSessionId)
            .eq(ConversationEntity::getStatus, "CLOSED")
            .orderByDesc(ConversationEntity::getEndedAt)
            .last("LIMIT " + Math.min(limit, 50))
    );
}
```

**VO：**

```java
@Data @Builder
public class VisitorHistoryVO {
    private String sessionId;
    private String tag;
    private String transferReason;
    private String status;
    private String startedAt;   // ISO 8601
    private String endedAt;
    private int msgCount;
    private String aiSummary;   // null 表示未生成
}
```

**Controller 端点（SessionQueueController 新增）：**

```java
/**
 * 查询当前访客的历史工单列表
 */
@GetMapping("/visitor-history")
public R<List<VisitorHistoryVO>> getVisitorHistory(
        @RequestParam String visitorName,
        @RequestParam String excludeSessionId) {
    List<ConversationEntity> entities =
            persistRepository.getVisitorHistory(visitorName, excludeSessionId, 20);

    List<VisitorHistoryVO> vos = entities.stream().map(e -> {
        // 消息轮数：从 DB 聚合查询（单次批量，不循环查）
        int msgCount = persistRepository.countMessages(e.getSessionId());
        // AI 总结：从 Redis 缓存查（无则 null）
        String summary = aiSummaryCache.get(e.getSessionId());
        return VisitorHistoryVO.builder()
                .sessionId(e.getSessionId())
                .tag(e.getTag())
                .transferReason(e.getTransferReason())
                .status(e.getStatus())
                .startedAt(e.getStartedAt().toString())
                .endedAt(e.getEndedAt().toString())
                .msgCount(msgCount)
                .aiSummary(summary)
                .build();
    }).toList();

    return R.ok(vos);
}
```

**批量查 msgCount（避免 N+1）：**

```java
// ConversationPersistRepository 新增
public Map<String, Integer> countMessagesBatch(List<String> sessionIds) {
    if (sessionIds.isEmpty()) return Map.of();
    // MyBatis-Plus 原生 SQL
    return conversationMessageMapper.countBySessionIds(sessionIds);
}

// ConversationMessageMapper 新增
@Select("""
    SELECT session_id, COUNT(*) AS cnt
    FROM cs_conversation.cs_conversation_message
    WHERE session_id IN (${sessionIds})
      AND is_internal = false
    GROUP BY session_id
    """)
Map<String, Integer> countBySessionIds(@Param("sessionIds") String sessionIds);
```

---

### BE-11.2 AI 总结接口

AI 总结基于 LangChain4j（项目已引入 1.1.0 BOM），对会话历史调用大模型生成摘要，结果持久化到 Redis 缓存（TTL 7 天）。

#### 11.2.1 AI 总结缓存

```java
// infrastructure/cache/AiSummaryCache.java（新建）
@Component
@RequiredArgsConstructor
public class AiSummaryCache {

    private static final String KEY_PREFIX = "ai:summary:";
    private static final Duration TTL = Duration.ofDays(7);

    private final StringRedisTemplate redisTemplate;

    public String get(String sessionId) {
        return redisTemplate.opsForValue().get(KEY_PREFIX + sessionId);
    }

    public void set(String sessionId, String summary) {
        redisTemplate.opsForValue().set(KEY_PREFIX + sessionId, summary, TTL);
    }

    public boolean exists(String sessionId) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(KEY_PREFIX + sessionId));
    }
}
```

#### 11.2.2 AI 总结 Service

```java
// application/service/AiSummaryService.java（新建）
@Service
@RequiredArgsConstructor
@Slf4j
public class AiSummaryService {

    private final ConversationPersistRepository persistRepository;
    private final AiSummaryCache summaryCache;
    private final ChatLanguageModel chatModel;   // LangChain4j，注入已配置的模型 Bean

    private static final String SUMMARY_PROMPT = """
        你是一位专业的客服质检员。请根据以下客服会话记录，生成一份简洁的工单总结，包含：
        1. 用户问题（一句话）
        2. 处理经过（2-3 句）
        3. 最终结果
        
        会话记录：
        {messages}
        
        请用中文输出，总字数控制在 150 字以内。
        """;

    /**
     * 查询已缓存的 AI 总结
     */
    public String getCached(String sessionId) {
        return summaryCache.get(sessionId);
    }

    /**
     * 流式生成 AI 总结，通过 SseEmitter 推送给前端
     */
    public void generateStream(String sessionId, SseEmitter emitter) {
        // 检查缓存
        String cached = summaryCache.get(sessionId);
        if (cached != null) {
            try {
                emitter.send(SseEmitter.event()
                        .data(JsonUtil.toJson(Map.of("delta", cached))));
                emitter.send(SseEmitter.event().data("[DONE]"));
                emitter.complete();
            } catch (IOException e) {
                emitter.completeWithError(e);
            }
            return;
        }

        // 加载会话消息
        List<ChatHistoryItem> msgs = persistRepository.getHistory(sessionId, null, false);
        if (msgs.isEmpty()) {
            try {
                emitter.send(SseEmitter.event().data("[DONE]"));
                emitter.complete();
            } catch (IOException ignored) {}
            return;
        }

        String messagesText = msgs.stream()
                .map(m -> "[%s]: %s".formatted(m.getRole(), m.getContent()))
                .collect(Collectors.joining("\n"));

        String prompt = SUMMARY_PROMPT.replace("{messages}", messagesText);

        // 使用 LangChain4j StreamingChatLanguageModel 流式输出
        // 注入 StreamingChatLanguageModel（与 ChatLanguageModel 同一 provider）
        streamingChatModel.generate(prompt, new StreamingResponseHandler<>() {
            private final StringBuilder buffer = new StringBuilder();

            @Override
            public void onNext(String token) {
                buffer.append(token);
                try {
                    emitter.send(SseEmitter.event()
                            .data(JsonUtil.toJson(Map.of("delta", token))));
                } catch (IOException e) {
                    log.warn("[AiSummary] SSE send error: {}", e.getMessage());
                }
            }

            @Override
            public void onComplete(Response<AiMessage> response) {
                summaryCache.set(sessionId, buffer.toString());
                try {
                    emitter.send(SseEmitter.event().data("[DONE]"));
                    emitter.complete();
                } catch (IOException ignored) {}
            }

            @Override
            public void onError(Throwable error) {
                log.error("[AiSummary] stream error for {}: {}", sessionId, error.getMessage());
                emitter.completeWithError(error);
            }
        });
    }
}
```

#### 11.2.3 Controller 端点

```java
// SessionQueueController 新增

/**
 * 查询已缓存的 AI 总结（非流式，用于列表预加载）
 */
@GetMapping("/{sessionId}/ai-summary")
public R<Map<String, String>> getAiSummary(@PathVariable String sessionId) {
    String summary = aiSummaryService.getCached(sessionId);
    return R.ok(Map.of("summary", summary != null ? summary : ""));
}

/**
 * 流式生成 AI 总结（SSE）
 * @SaIgnore + token query param，与 events 端点认证方式一致
 */
@GetMapping("/{sessionId}/ai-summary/stream")
@SaIgnore
public SseEmitter generateAiSummaryStream(
        @PathVariable String sessionId,
        @RequestParam String token) {
    // 手动验证 token
    Object loginId = StpUtil.getLoginIdByToken(token);
    if (loginId == null) throw new BusinessException(HttpStatus.UNAUTHORIZED.value(), "未授权");

    SseEmitter emitter = new SseEmitter(120_000L);  // 2 分钟超时
    // 异步执行，不阻塞 HTTP 线程
    CompletableFuture.runAsync(() ->
            aiSummaryService.generateStream(sessionId, emitter));
    return emitter;
}
```

#### 11.2.4 StreamingChatLanguageModel Bean 配置

项目已有 `ai_model_config` 表管理模型配置，AI 总结功能复用现有 `CHAT` 类型模型的 StreamingChatLanguageModel Bean：

```java
// 在现有 AiModelConfigService 中新增 streaming 版本的 Bean 创建逻辑
// 具体实现参考项目已有 ChatLanguageModel Bean 的构建方式，加 .streaming() 即可
```
---

## 十二（后端）、AI 回复建议接口

### BE-12.1 设计思路

回复建议结合两个来源：
1. **知识库（KB）**：从 `cs_knowledge` 服务检索与当前会话最后一条用户消息语义相似的知识条目，直接作为候选回复
2. **上下文推理（CONTEXT）**：将最近 5 轮对话发给大模型，让模型基于上下文生成 2-3 条自然语言回复建议

两路并行执行，合并去重后返回，KB 命中结果优先排列。

---

### BE-12.2 数据库与依赖

无需新建表。依赖：
- `cs_conversation.cs_conversation_message`：读取最近 N 条消息
- `ai-knowledge/knowledge-service`：通过 `knowledge-client` 调用向量检索
- LangChain4j `ChatLanguageModel`：生成上下文建议

---

### BE-12.3 VO / DTO

```java
// vo/ReplySuggestionVO.java（新建）
@Data @Builder
public class ReplySuggestionVO {
    /** 唯一标识，前端 v-for key */
    private String id;
    /** 建议回复内容 */
    private String content;
    /** 置信度 0.0-1.0 */
    private double confidence;
    /** KB=知识库命中, CONTEXT=上下文推理 */
    private String source;
}
```

---

### BE-12.4 ReplySuggestionService

**文件：`application/service/ReplySuggestionService.java`（新建）**

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class ReplySuggestionService {

    private final ConversationPersistRepository persistRepository;
    private final KnowledgeClient knowledgeClient;      // knowledge-client Feign 客户端
    private final ChatLanguageModel chatModel;

    private static final int RECENT_MSG_LIMIT = 5;

    private static final String SUGGEST_PROMPT = """
        你是一位专业客服座席助手。根据以下客服会话记录，生成 2-3 条合适的回复建议。
        要求：
        - 每条建议独立成行，以「-」开头
        - 语气专业、简洁、友善
        - 基于对话上下文，针对用户最后一条消息作出回应
        - 总字数不超过 200 字

        会话记录（最近 %d 轮）：
        %s

        请直接输出建议列表，不要有额外说明。
        """;

    /**
     * 生成当前会话的回复建议
     * KB 检索和上下文推理并行执行，合并后返回
     */
    public List<ReplySuggestionVO> generate(String sessionId) {
        // 1. 加载最近消息
        List<ChatHistoryItem> recentMsgs = persistRepository
                .getRecentMessages(sessionId, RECENT_MSG_LIMIT);

        if (recentMsgs.isEmpty()) return List.of();

        String lastUserMsg = recentMsgs.stream()
                .filter(m -> "user".equals(m.getRole()))
                .reduce((a, b) -> b)  // 最后一条用户消息
                .map(ChatHistoryItem::getContent)
                .orElse("");

        // 2. 并行执行两路检索
        CompletableFuture<List<ReplySuggestionVO>> kbFuture =
                CompletableFuture.supplyAsync(() -> fetchKbSuggestions(lastUserMsg));

        CompletableFuture<List<ReplySuggestionVO>> contextFuture =
                CompletableFuture.supplyAsync(() -> fetchContextSuggestions(recentMsgs));

        List<ReplySuggestionVO> kbResults = List.of();
        List<ReplySuggestionVO> contextResults = List.of();

        try {
            kbResults = kbFuture.get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.warn("[ReplySuggestion] KB retrieval failed for {}: {}", sessionId, e.getMessage());
        }
        try {
            contextResults = contextFuture.get(8, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.warn("[ReplySuggestion] context inference failed for {}: {}", sessionId, e.getMessage());
        }

        // 3. 合并：KB 优先，去重，最多返回 3 条
        List<ReplySuggestionVO> merged = new ArrayList<>(kbResults);
        for (ReplySuggestionVO ctx : contextResults) {
            boolean duplicate = merged.stream()
                    .anyMatch(kb -> similarity(kb.getContent(), ctx.getContent()) > 0.85);
            if (!duplicate) merged.add(ctx);
        }

        return merged.stream()
                .sorted(Comparator.comparingDouble(ReplySuggestionVO::getConfidence).reversed())
                .limit(3)
                .toList();
    }

    // ── KB 检索 ──────────────────────────────────────────────

    private List<ReplySuggestionVO> fetchKbSuggestions(String query) {
        if (!StringUtils.hasText(query)) return List.of();
        try {
            // knowledge-client 向量检索接口，返回相似度 > 0.75 的知识条目
            List<KnowledgeSearchResult> hits = knowledgeClient.search(
                    KnowledgeSearchRequest.builder()
                            .query(query)
                            .topK(2)
                            .minScore(0.75)
                            .build()
            );
            return hits.stream()
                    .map(h -> ReplySuggestionVO.builder()
                            .id(UUID.randomUUID().toString())
                            .content(h.getAnswer())       // 知识条目的标准答案
                            .confidence(h.getScore())
                            .source("KB")
                            .build())
                    .toList();
        } catch (Exception e) {
            log.warn("[ReplySuggestion] KB search error: {}", e.getMessage());
            return List.of();
        }
    }

    // ── 上下文推理 ───────────────────────────────────────────

    private List<ReplySuggestionVO> fetchContextSuggestions(List<ChatHistoryItem> msgs) {
        String history = msgs.stream()
                .map(m -> "[%s]: %s".formatted(
                        "user".equals(m.getRole()) ? "访客" : "客服",
                        m.getContent()))
                .collect(Collectors.joining("\n"));

        String prompt = SUGGEST_PROMPT.formatted(RECENT_MSG_LIMIT, history);

        try {
            String response = chatModel.generate(prompt);
            // 解析「- 」开头的每行
            return Arrays.stream(response.split("\n"))
                    .map(String::trim)
                    .filter(line -> line.startsWith("- ") && line.length() > 2)
                    .map(line -> line.substring(2).trim())
                    .filter(StringUtils::hasText)
                    .limit(3)
                    .map(content -> ReplySuggestionVO.builder()
                            .id(UUID.randomUUID().toString())
                            .content(content)
                            .confidence(0.7)   // 上下文推理固定置信度
                            .source("CONTEXT")
                            .build())
                    .toList();
        } catch (Exception e) {
            log.warn("[ReplySuggestion] context inference error: {}", e.getMessage());
            return List.of();
        }
    }

    /** 简单字符串相似度（Jaccard），用于去重判断 */
    private double similarity(String a, String b) {
        Set<String> setA = new HashSet<>(Arrays.asList(a.split("")));
        Set<String> setB = new HashSet<>(Arrays.asList(b.split("")));
        Set<String> intersection = new HashSet<>(setA);
        intersection.retainAll(setB);
        Set<String> union = new HashSet<>(setA);
        union.addAll(setB);
        return union.isEmpty() ? 0 : (double) intersection.size() / union.size();
    }
}
```

**ConversationPersistRepository 新增：**

```java
/** 获取最近 N 条非内部消息（用于建议生成，排除 note 类型） */
public List<ChatHistoryItem> getRecentMessages(String sessionId, int limit) {
    return conversationMessageMapper.selectList(
        Wrappers.<ConversationMessageEntity>lambdaQuery()
            .eq(ConversationMessageEntity::getSessionId, sessionId)
            .eq(ConversationMessageEntity::getIsInternal, false)
            .in(ConversationMessageEntity::getRole, List.of("user", "agent", "assistant"))
            .orderByDesc(ConversationMessageEntity::getSeq)
            .last("LIMIT " + limit)
    ).stream()
     .sorted(Comparator.comparing(ConversationMessageEntity::getSeq))  // 恢复正序
     .map(this::toChatHistoryItem)
     .toList();
}
```

---

### BE-12.5 Controller 端点

```java
// SessionQueueController 新增

/**
 * 生成当前会话的 AI 回复建议
 * 基于最近 5 轮上下文 + 知识库向量检索，并行生成后合并返回
 */
@PostMapping("/{sessionId}/reply-suggestions")
public R<List<ReplySuggestionVO>> getReplySuggestions(
        @PathVariable String sessionId) {
    String agentId = (String) StpUtil.getLoginId();
    // 校验座席是否有权操作该会话
    if (!sessionQueueService.isActive(sessionId)) {
        throw new BusinessException("会话不存在或已结束");
    }
    return R.ok(replySuggestionService.generate(sessionId));
}
```

---

### BE-12.6 KnowledgeClient 接口约定

**文件：`ai-knowledge/knowledge-client` 中新增检索接口（如未存在）：**

```java
// knowledge-client/KnowledgeClient.java
@FeignClient(name = "knowledge-service", url = "${knowledge.service.url}")
public interface KnowledgeClient {

    @PostMapping("/internal/api/v1/knowledge/search")
    List<KnowledgeSearchResult> search(@RequestBody KnowledgeSearchRequest request);
}

@Data @Builder
class KnowledgeSearchRequest {
    private String query;
    private int topK;          // 返回前 K 条
    private double minScore;   // 最低相似度阈值
}

@Data
class KnowledgeSearchResult {
    private String knowledgeId;
    private String question;
    private String answer;    // 标准答案，直接作为建议回复
    private double score;     // 相似度 0-1
}
```

---

### BE-12.7 新增接口汇总（补充到后端文档 10.2 节）

| HTTP 方法 | 路径 | 描述 | Sprint |
|---|---|---|---|
| `GET` | `/api/v1/sessions/visitor-history` | 查询访客历史工单列表 | S2 |
| `GET` | `/api/v1/sessions/:id/ai-summary` | 获取已缓存的 AI 总结 | S2 |
| `GET` | `/api/v1/sessions/:id/ai-summary/stream` | SSE 流式生成 AI 总结 | S2 |
| `POST` | `/api/v1/sessions/:id/reply-suggestions` | 生成 AI 回复建议（KB+上下文） | S2 |

---

### BE-12.8 性能与限流建议

| 问题 | 建议方案 |
|---|---|
| 回复建议请求频繁（每次访客发消息触发） | 前端 800ms 防抖；后端对同一 sessionId 加 2s 内幂等缓存（Redis，TTL 2s） |
| AI 总结生成慢（LLM 响应 3-10s） | 流式 SSE 输出，用户感知首 token 即可；后台异步持久化 |
| KB 检索超时 | 独立 5s 超时，失败不影响上下文建议返回 |
| 并发大量 SSE 连接 | 使用虚拟线程（Spring Boot 3.3 + Java 21）或设置最大并发数限制 |

---

*本节补充历史工单与 AI 辅助功能的后端实现，与前端文档「十一、十二章」对应。*
