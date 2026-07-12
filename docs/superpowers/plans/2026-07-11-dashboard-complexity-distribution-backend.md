# Dashboard 复杂度分布接口 后端实现

> 版本：v1.0 | 日期：2026-07-11
> 关联：前端 `apps/src/api/dashboard/index.ts` 的 `getComplexityDistributionApi`、卡片 `complexity-trend-card.vue`
> 后端服务：`ai-conversation/conversation-service`（Spring Boot 3.3.5 + MyBatis-Plus 3.5.7 + Sa-Token 1.39.0 + PostgreSQL + Flyway）
> 约定：沿用 `@RestController` + `R<T>` 响应体、包名 `com.aria.conversation`、`cs_conversation` schema

---

## 一、接口契约（与前端对齐）

```
GET /api/v1/dashboard/complexity-distribution
```

- 无请求参数（快照数据，与状态分布 / 标签分布一致，不受时间范围影响）。
- 响应：`R<List<ComplexityDistributionVO>>`

```json
{
  "code": 0,
  "msg": "ok",
  "data": [
    { "level": "SIMPLE",  "count": 684, "percent": 68.4 },
    { "level": "MEDIUM",  "count": 241, "percent": 24.1 },
    { "level": "COMPLEX", "count": 75,  "percent": 7.5 }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `level` | `String` | `SIMPLE` / `MEDIUM` / `COMPLEX` |
| `count` | `long` | 该等级会话数 |
| `percent` | `double` | 占比（0-100，保留一位小数），按 `count / 总有效数` 计算 |

前端映射：`SIMPLE→简单问题(#10B981)`、`MEDIUM→中等问题(#F59E0B)`、`COMPLEX→复杂问题(#EF4444)`。

---

## 二、数据模型决策

`cs_conversation` 表新增一列 `complexity`，会话结束时由规则落库（AI 分类可后续作为增强替换该规则）。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `complexity` | `VARCHAR(16)` | `CHECK (complexity IN ('SIMPLE','MEDIUM','COMPLEX'))`，可空 | 历史数据 / 未结束会话为 NULL，统计时排除 |

复杂度判定规则（与前端视觉语义一致）：

| 条件 | 等级 |
|---|---|
| 被转交过（`transfer_reason IS NOT NULL`）**或** 消息数 ≥ 15 **或** 处理时长 > 10 分钟 | `COMPLEX` |
| 消息数 ≥ 6 **或** 处理时长 > 3 分钟 | `MEDIUM` |
| 其他 | `SIMPLE` |

> 注：列名 `transfer_reason` / `message_count` / `accepted_at` / `ended_at` 请对齐实际 schema；若字段名不同，同步调整下方 SQL 与 `close()` 取值。

---

## 三、改动文件清单（conversation-service）

| 文件 | 操作 |
|---|---|
| `resources/db/migration/V8__add_conversation_complexity.sql` | 新建（加列 + 历史回填） |
| `interfaces/rest/vo/ComplexityDistributionVO.java` | 新建 |
| `infrastructure/persistence/DashboardStatsMapper.java` | 修改（新增统计 SQL） |
| `infrastructure/persistence/DashboardStatsRepository.java` | 修改（封装新方法） |
| `application/service/DashboardAppService.java` | 修改（计算占比） |
| `interfaces/rest/DashboardController.java` | 修改（新增端点） |
| `application/service/SessionQueueService.java` | 修改（`close()` 落库复杂度） |
| `infrastructure/persistence/ConversationPersistRepository.java` | 修改（`closeConversation` 重载） |

---

## 四、实现代码

### 4.1 Flyway 迁移 `V8__add_conversation_complexity.sql`

```sql
-- ============================================================
-- V8: 会话复杂度等级
-- ============================================================
SET search_path = cs_conversation;

ALTER TABLE cs_conversation
    ADD COLUMN IF NOT EXISTS complexity VARCHAR(16)
    CHECK (complexity IN ('SIMPLE', 'MEDIUM', 'COMPLEX'));

COMMENT ON COLUMN cs_conversation.complexity
    IS '会话复杂度等级：SIMPLE(简单)/MEDIUM(中等)/COMPLEX(复杂)，结束时由规则落库';

-- 历史已结束会话回填（按既定规则），避免上线后分布为空
UPDATE cs_conversation
SET complexity = CASE
    WHEN transfer_reason IS NOT NULL
      OR message_count >= 15
      OR EXTRACT(EPOCH FROM (ended_at - accepted_at)) > 600 THEN 'COMPLEX'
    WHEN message_count >= 6
      OR EXTRACT(EPOCH FROM (ended_at - accepted_at)) > 180 THEN 'MEDIUM'
    ELSE 'SIMPLE'
END
WHERE status = 'CLOSED'
  AND complexity IS NULL
  AND ended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_complexity
    ON cs_conversation(complexity);
```

### 4.2 VO `interfaces/rest/vo/ComplexityDistributionVO.java`

```java
package com.aria.conversation.interfaces.rest.vo;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ComplexityDistributionVO {
    /** SIMPLE | MEDIUM | COMPLEX */
    private String level;
    /** 该等级会话数 */
    private long count;
    /** 占比，0-100，保留一位小数 */
    private double percent;
}
```

### 4.3 Mapper `DashboardStatsMapper.java`

```java
package com.aria.conversation.infrastructure.persistence;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Select;

public interface DashboardStatsMapper extends BaseMapper<ConversationEntity> {

    // 复杂度等级 → 数量（仅统计已打标会话）
    @Select("""
        SELECT complexity AS level, COUNT(*) AS cnt
        FROM cs_conversation.cs_conversation
        WHERE complexity IS NOT NULL
        GROUP BY complexity
        """)
    List<ComplexityCountRow> countByComplexity();

    /** Mapper 内嵌结果类 */
    class ComplexityCountRow {
        private String level;
        private long cnt;

        public String getLevel() { return level; }
        public void setLevel(String level) { this.level = level; }
        public long getCnt() { return cnt; }
        public void setCnt(long cnt) { this.cnt = cnt; }
    }
}
```

### 4.4 Repository `DashboardStatsRepository.java`

```java
// 在现有 DashboardStatsRepository 中新增
public List<DashboardStatsMapper.ComplexityCountRow> countByComplexity() {
    return dashboardStatsMapper.countByComplexity();
}
```

### 4.5 AppService `DashboardAppService.java`

```java
// 在现有 DashboardAppService 中新增
public List<ComplexityDistributionVO> getComplexityDistribution() {
    List<DashboardStatsMapper.ComplexityCountRow> rows =
            dashboardStatsRepository.countByComplexity();
    long total = rows.stream()
            .mapToLong(DashboardStatsMapper.ComplexityCountRow::getCnt)
            .sum();
    if (total == 0) {
        return List.of();   // 前端回退占位数据
    }
    return rows.stream().map(r -> ComplexityDistributionVO.builder()
            .level(r.getLevel())
            .count(r.getCnt())
            // 占比保留一位小数：round(cnt * 1000 / total) / 10.0
            .percent(Math.round(r.getCnt() * 1000.0 / total) / 10.0)
            .build()).toList();
}
```

### 4.6 Controller `DashboardController.java`

```java
// 在现有 DashboardController 中新增端点
/**
 * 会话复杂度分布（简单/中等/复杂 三项占比），快照数据。
 */
@GetMapping("/complexity-distribution")
public R<List<ComplexityDistributionVO>> getComplexityDistribution() {
    return R.ok(dashboardAppService.getComplexityDistribution());
}
```

### 4.7 复杂度落库（会话结束时）

`SessionQueueService.close()` 在关闭会话时计算复杂度并写入：

```java
// SessionQueueService.close(String sessionId, String reason) 内
ConversationEntity conv = conversationPersistRepository.getBySessionId(sessionId);
String complexity = deriveComplexity(
        conv.getTransferReason(),
        conv.getMessageCount(),
        conv.getAcceptedAt(),
        conv.getEndedAt());
conversationPersistRepository.closeConversation(sessionId, reason, complexity);
```

```java
// 复杂度规则（与 V8 回填 SQL 保持一致）
private String deriveComplexity(String transferReason,
                                Integer messageCount,
                                LocalDateTime acceptedAt,
                                LocalDateTime endedAt) {
    long msg = messageCount == null ? 0 : messageCount;
    long handleSec = 0;
    if (acceptedAt != null && endedAt != null) {
        handleSec = java.time.Duration.between(acceptedAt, endedAt).getSeconds();
    }
    if (transferReason != null || msg >= 15 || handleSec > 600) {
        return "COMPLEX";
    }
    if (msg >= 6 || handleSec > 180) {
        return "MEDIUM";
    }
    return "SIMPLE";
}
```

`ConversationPersistRepository.closeConversation` 增加重载：

```java
public void closeConversation(String sessionId, String reason, String complexity) {
    conversationMapper.update(null,
        Wrappers.<ConversationEntity>lambdaUpdate()
            .eq(ConversationEntity::getSessionId, sessionId)
            .set(ConversationEntity::getStatus, "CLOSED")
            .set(reason != null, ConversationEntity::getCloseReason, reason)
            .set(complexity != null, ConversationEntity::getComplexity, complexity)
    );
}
```

> 旧调用 `closeConversation(sessionId, reason)` 保留，避免其它引用断裂；新调用传复杂度。

---

## 五、联调与验证

1. 部署 `conversation-service` 触发 V8 Flyway 迁移（历史数据自动回填）。
2. 用 `curl` / Postman 验证：
   ```
   GET /api/v1/dashboard/complexity-distribution
   ```
   应返回三项（SIMPLE/MEDIUM/COMPLEX）且 `percent` 之和≈100。
3. 前端：`/dashboard/analysis` 中间行「复杂度趋势」卡片在接口就绪后展示真实占比；
   接口异常时自动回退占位数据（68.4 / 24.1 / 7.5）。

## 六、后续增强（可选）

- 用现有 LangChain4j AI 总结链路对会话内容做复杂度分类，覆盖规则判定不准的长尾场景；
  分类结果写回 `complexity` 列即可，前端与统计 SQL 无需改动。
