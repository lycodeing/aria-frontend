# 系统配置（客服配置 / 系统配置）技术设计文档

> 版本：v3.0 ｜ 视角：**后端（ai-auth / cs_auth）为主**，前端消费端仅末尾简述
> 状态：待评审
> 关联文档：[功能设计文档](./system-config-functional-design.md)
> 代码基线：Spring Boot 3.3.5 / MyBatis-Plus 3.5.7 / Sa-Token 1.39.0 / Java 17 / PostgreSQL（schema `cs_auth`）
> 模板参照：`AdminAiModelController`（ai-auth 模块同款管理员 CRUD）

---

## 1. 文档定位

本文档是**后端落地手册**：给出可直接执行的 DDL、种子 SQL、接口契约、以及完整 Java 代码结构。
所有约定对齐 `ai-auth` 现有模块（实体注解、软删、审计字段、统一响应 `R<T>`、分页 `PageQuery/PageResult`、Sa-Token 权限）。

> **范围说明**：本文档仅涵盖**由后端逻辑执行的**参数（并发上限、欢迎语、知识库检索、仪表盘限制、AI 提示词）。
> 纯前端 UI 参数（分页、防抖、定时器等）和 WS/SSE 连接参数（重连延迟、心跳、最大重试次数）均不在本文档范围；前者保持前端硬编码，后者保留在 `application.yml` + 环境变量管理。

---

## 2. 数据模型（DDL）

追加到 `docs/sql/ai_customerservice-schema.sql` 的 `cs_auth` 段（**注意：不是 Flyway 脚本**，见第 7 节）。

```sql
-- ============ 系统配置表 ============
CREATE TABLE cs_auth.system_config (
    id           bigint NOT NULL,
    config_key   character varying(100) NOT NULL,
    config_value text,
    config_type  character varying(30) NOT NULL,   -- CUSTOMER_SERVICE | SYSTEM
    value_type   character varying(20) NOT NULL,   -- NUMBER | STRING | BOOLEAN | JSON
    config_name  character varying(100),
    config_group character varying(50) DEFAULT 'default',
    remark       text,
    is_enabled   boolean DEFAULT true NOT NULL,
    is_system    boolean DEFAULT false NOT NULL,    -- true=内置项，不可删除
    created_by   bigint,
    created_at   timestamp without time zone DEFAULT now() NOT NULL,
    updated_at   timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at   timestamp without time zone        -- 逻辑删除
);

CREATE SEQUENCE cs_auth.system_config_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE cs_auth.system_config_id_seq OWNED BY cs_auth.system_config.id;

-- 软删后 config_key 仍可复用，故唯一约束排除已删除行
CREATE UNIQUE INDEX uk_system_config_key ON cs_auth.system_config (config_key) WHERE deleted_at IS NULL;

-- updated_at 自动维护（函数 cs_auth.set_updated_at() 已存在于 schema.sql）
CREATE TRIGGER trg_system_config_updated BEFORE UPDATE ON cs_auth.system_config
    FOR EACH ROW EXECUTE FUNCTION cs_auth.set_updated_at();
```

字段要点：
- `config_key` 代码按此 key 读取，唯一（排除软删行）。
- `config_type` 仅两个值，驱动两个菜单与列表过滤。
- `value_type` 决定编辑控件与解析逻辑（见第 4、6 节）。
- 审计字段：`created_at/updated_at` DB 默认值 `now()` + 触发器；软删用 `deleted_at`。

## 3. 种子数据（完整 INSERT）

追加到 `docs/sql/ai_customerservice-data.sql`。**id 实施前务必 grep 当前最大值核对**（建议值：权限 54-57、菜单 140/141-143/206/241-243，实际以仓库现状为准）。

### 3.1 配置项种子（10 条，全部 `is_system=true`）

```sql
-- 客服配置类 CUSTOMER_SERVICE：4 条业务参数
INSERT INTO cs_auth.system_config (id, config_key, config_value, config_type, value_type, config_name, config_group, is_enabled, is_system, created_at, updated_at) VALUES
 (1, 'agent.maxConcurrent',           '5',    'CUSTOMER_SERVICE', 'NUMBER', '座席最大并发服务人数', '座席', true, true, now(), now()),
 (2, 'agent.welcomeMessage',          '您好！请问有什么可以帮您？', 'CUSTOMER_SERVICE', 'STRING', '座席侧欢迎语', '座席', true, true, now(), now()),
 (3, 'knowledge.searchTopK',          '5',    'CUSTOMER_SERVICE', 'NUMBER', '知识检索TopK', '知识库', true, true, now(), now()),
 (4, 'knowledge.uploadMaxFileSizeMb', '50',   'CUSTOMER_SERVICE', 'NUMBER', '知识库上传上限(MB)', '知识库', true, true, now(), now());

-- 系统配置类 SYSTEM：1 条
-- 注：WS/SSE 连接参数（重连延迟、心跳、最大重试等）保留在 application.yml，不进配置表
INSERT INTO cs_auth.system_config (id, config_key, config_value, config_type, value_type, config_name, config_group, is_enabled, is_system, created_at, updated_at) VALUES
 (5, 'dashboard.recentLimit', '10', 'SYSTEM', 'NUMBER', '仪表盘最近会话条数', '仪表盘', true, true, now(), now());

-- 提示词类（CUSTOMER_SERVICE，config_group='提示词'，5 条）
-- 多模型格式：{"default":"...","gpt-4":"...","claude":"..."}；消费方后端按「当前模型→default」取值
INSERT INTO cs_auth.system_config (id, config_key, config_value, config_type, value_type, config_name, config_group, is_enabled, is_system, created_at, updated_at) VALUES
 (6,  'prompt.agent.suggestion', '{"default":"你是一名专业的客服助手。请基于历史对话与知识为座席生成简洁的回复建议。\n历史对话：{history}\n用户问题：{query}\n参考知识：{kb_context}\n座席：{agent_name}","gpt-4":"你是专业客服助手，回复控制在3条内、语气专业。历史：{history}\n问题：{query}\n知识：{kb_context}","claude":"你是耐心亲切的客服助手。历史：{history}\n问题：{query}\n知识：{kb_context}"}', 'CUSTOMER_SERVICE', 'JSON', '座席辅助·回复建议', '提示词', true, true, now(), now()),
 (7,  'prompt.kb.qa',            '{"default":"你是一个客服助手，仅依据以下知识回答，不知道就说不知道。知识：{kb_context}\n问题：{query}\n语言：{language}","gpt-4":"严格依据知识回答并标注来源编号。知识：{kb_context}\n问题：{query}"}', 'CUSTOMER_SERVICE', 'JSON', '知识库问答', '提示词', true, true, now(), now()),
 (8,  'prompt.visitor.autoReply','{"default":"您好{visitor_name}，我是您的智能客服助手，请问有什么可以帮您？当前时间：{current_time}"}', 'CUSTOMER_SERVICE', 'JSON', '访客自动回复', '提示词', true, true, now(), now()),
 (9,  'prompt.session.summary',  '{"default":"请总结以下会话的关键信息与待办。座席：{agent_name}\n对话：{history}"}', 'CUSTOMER_SERVICE', 'JSON', '会话小结', '提示词', true, true, now(), now()),
 (10, 'prompt.intent.classify',  '{"default":"判断用户意图，仅输出意图标签。问题：{query}\n历史：{history}"}', 'CUSTOMER_SERVICE', 'JSON', '意图识别', '提示词', true, true, now(), now());
```

### 3.2 权限码（4 个，module='system'）

```sql
INSERT INTO cs_auth.sys_permission (id, permission_key, permission_name, module, description, created_at) VALUES
 (54, 'system:config:list',   '系统配置列表', 'system', NULL, now()),
 (55, 'system:config:create', '新增系统配置', 'system', NULL, now()),
 (56, 'system:config:update', '编辑系统配置', 'system', NULL, now()),
 (57, 'system:config:delete', '删除系统配置', 'system', NULL, now());
```

### 3.3 菜单（2 个 MENU + 各自 3 个 BUTTON）

```sql
-- 客服配置（挂在智能客服 100 下）
INSERT INTO cs_auth.sys_menu (id, parent_id, menu_type, menu_name, menu_key, path, component, icon, sort_order, is_visible, is_cache, is_external, redirect, permission_key, status, remark, created_by, created_at, updated_at) VALUES
 (140, 100, 'MENU',   '客服配置', 'CustomerServiceConfig', '/customerservice/config', 'customer-service-config/index', 'lucide:settings-2', 6, true, true, false, NULL, NULL, 'active', NULL, NULL, now(), now()),
 (141, 140, 'BUTTON', '新增配置', 'system:config:create', NULL, NULL, NULL, 1, false, false, false, NULL, 'system:config:create', 'active', NULL, NULL, now(), now()),
 (142, 140, 'BUTTON', '编辑配置', 'system:config:update', NULL, NULL, NULL, 2, false, false, false, NULL, 'system:config:update', 'active', NULL, NULL, now(), now()),
 (143, 140, 'BUTTON', '删除配置', 'system:config:delete', NULL, NULL, NULL, 3, false, false, false, NULL, 'system:config:delete', 'active', NULL, NULL, now(), now());

-- 系统配置（挂在系统管理 200 下）
INSERT INTO cs_auth.sys_menu (id, parent_id, menu_type, menu_name, menu_key, path, component, icon, sort_order, is_visible, is_cache, is_external, redirect, permission_key, status, remark, created_by, created_at, updated_at) VALUES
 (206, 200, 'MENU',   '系统配置', 'SystemConfig', '/system/config', 'system-config/index', 'lucide:settings', 6, true, true, false, NULL, NULL, 'active', NULL, NULL, now(), now()),
 (241, 206, 'BUTTON', '新增配置', 'system:config:create', NULL, NULL, NULL, 1, false, false, false, NULL, 'system:config:create', 'active', NULL, NULL, now(), now()),
 (242, 206, 'BUTTON', '编辑配置', 'system:config:update', NULL, NULL, NULL, 2, false, false, false, NULL, 'system:config:update', 'active', NULL, NULL, now(), now()),
 (243, 206, 'BUTTON', '删除配置', 'system:config:delete', NULL, NULL, NULL, 3, false, false, false, NULL, 'system:config:delete', 'active', NULL, NULL, now(), now());
```

### 3.4 角色关联

```sql
INSERT INTO cs_auth.sys_role_permission (role_id, permission_id) VALUES
 (10, 54), (10, 55), (10, 56), (10, 57);   -- super_admin
INSERT INTO cs_auth.sys_role_menu (role_id, menu_id, created_at) VALUES
 (10, 140, now()), (10, 141, now()), (10, 142, now()), (10, 143, now()),
 (10, 206, now()), (10, 241, now()), (10, 242, now()), (10, 243, now());

INSERT INTO cs_auth.sys_role_permission (role_id, permission_id) VALUES
 (11, 54), (11, 55), (11, 56), (11, 57);   -- kf_manager（受 D9 守卫，只能动 CUSTOMER_SERVICE）
INSERT INTO cs_auth.sys_role_menu (role_id, menu_id, created_at) VALUES
 (11, 140, now()), (11, 141, now()), (11, 142, now()), (11, 143, now());
```

### 3.5 提示词占位符约定

| 占位符 | 含义 | 填充方 |
|---|---|---|
| `{visitor_name}` | 访客昵称 | 后端会话上下文 |
| `{agent_name}` | 座席姓名 | 同上 |
| `{history}` | 最近 N 条对话历史 | 同上 |
| `{query}` | 访客当前消息/问题 | 同上 |
| `{kb_context}` | 知识库检索片段 | 知识库检索结果 |
| `{language}` | 语言偏好（zh/en） | 会话/租户设置 |
| `{current_time}` | 当前时间 | 运行时 |
| `{intent}` | 意图标签（若已识别） | 意图识别结果 |

- 消费方（后端 conversation 服务）遇到未知占位符时原样保留或填空，不抛异常，保证主流程可用。

---

## 4. 接口契约

基础前缀 `/api/v1/admin/system-config`，统一返回 `R<T>`（`code/msg/data/traceId`，成功 code=200）。
分页请求 `PageQuery`（`page` 0-based、`size`，上限 200）；分页结果 `PageResult<T>`（`total/page/size/items`）。

### 4.1 列表（按类型过滤）

```
GET /api/v1/admin/system-config?configType=CUSTOMER_SERVICE&keyword=&page=0&size=20
```
- `configType`：`CUSTOMER_SERVICE` | `SYSTEM`（必填）。
- `keyword`：模糊匹配 `config_key` / `config_name`（可选）。

响应示例：
```json
{
  "code": 200, "msg": "success",
  "data": {
    "total": 9, "page": 0, "size": 20,
    "items": [
      { "id": 1, "configKey": "agent.maxConcurrent", "configValue": "5",
        "configType": "CUSTOMER_SERVICE", "valueType": "NUMBER",
        "configName": "座席最大并发服务人数", "configGroup": "座席",
        "remark": null, "isEnabled": true, "isSystem": true }
    ]
  }
}
```

### 4.2 新增

```
POST /api/v1/admin/system-config
@SaCheckPermission("system:config:create")
```
```json
{ "configKey": "agent.xxx", "configValue": "10", "configType": "CUSTOMER_SERVICE",
  "valueType": "NUMBER", "configName": "xxx", "configGroup": "座席", "remark": "" }
```
- kf_manager 传 `configType=SYSTEM` 将被 D9 守卫拒绝（403）。
- `configKey` 唯一（软删除外），重复报 422。

### 4.3 编辑

```
PUT /api/v1/admin/system-config/{id}
@SaCheckPermission("system:config:update")
```
请求体同新增（`configKey`/`configType`/`valueType` 不可变，Service 层忽略此三字段的变更）。

### 4.4 删除（内置项拒绝）

```
DELETE /api/v1/admin/system-config/{id}
@SaCheckPermission("system:config:delete")
```
- `is_system=true` → 返回 `422 内置配置不可删除`。
- 否则软删（`deleted_at = now()`）。

### 4.5 消费接口（后端业务模块 + 前端展示用）

```
GET /api/v1/admin/system-config/map?configType=CUSTOMER_SERVICE
```
按 `value_type` 解析后返回扁平 Map：
```json
{
  "code": 200, "msg": "success",
  "data": {
    "agent.maxConcurrent": 5,
    "agent.welcomeMessage": "您好！请问有什么可以帮您？",
    "knowledge.searchTopK": 5,
    "prompt.kb.qa": { "default": "你是一个客服助手...", "gpt-4": "严格依据知识..." }
  }
}
```
解析规则（`ConfigValueParser`）：
- `NUMBER` → `Long/Double`；`STRING` → `String`；`BOOLEAN` → `Boolean`；`JSON` → `Object/Array`。
- `is_enabled=false` 的项不纳入 map，消费端按兜底值处理。

---

## 5. 权限与类型守卫小结

- 4 个权限码 `system:config:{list,create,update,delete}` 已写入 `sys_permission` 并关联 super_admin(10)、kf_manager(11)。
- super_admin `isSuperAdmin()=true`，不受 D9 限制，可管理全部类型。
- kf_manager 虽拥有权限，但 `assertTypeScope` 拒绝其操作 `SYSTEM` 类型——即使直接调 API 传 `configType=SYSTEM` 也返回 403。
- 两个菜单通过 `sys_role_menu` 控制可见性：kf_manager 仅见「客服配置」，从 UI 层进一步隔离。

> ⚠️ **实施前必须确认**：`isSuperAdmin()` 使用 `StpUtil.hasRole("super_admin")`。若 ai-auth 的 `StpInterfaceImpl` 仅走 `sys_role_permission` 数据授权、未向 Sa-Token 注册角色列表，此方法会返回 false，导致 D9 守卫对所有人失效。需对照 `StpInterfaceImpl.getRoleList()` 实现确认，必要时改为自定义角色检查。

---

## 6. 后端代码结构（完整，照 AdminAiModelController 落地）

包名沿用 `com.aria.auth`。以下为可直接创建的 7 个文件。

### 6.1 DO —— `infrastructure/persistence/config/SystemConfigDO.java`

```java
package com.aria.auth.infrastructure.persistence.config;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

@Getter @Setter
@TableName("cs_auth.system_config")
public class SystemConfigDO {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String configKey;
    private String configValue;
    private String configType;     // CUSTOMER_SERVICE | SYSTEM
    private String valueType;      // NUMBER | STRING | BOOLEAN | JSON
    private String configName;
    private String configGroup;
    private String remark;
    private Boolean isEnabled;
    private Boolean isSystem;
    private Long createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime deletedAt;
}
```

### 6.2 Mapper —— `infrastructure/persistence/config/SystemConfigMapper.java`

```java
package com.aria.auth.infrastructure.persistence.config;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SystemConfigMapper extends BaseMapper<SystemConfigDO> { }
```

### 6.3 Request DTO —— `interfaces/dto/SystemConfigRequest.java`

```java
package com.aria.auth.interfaces.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SystemConfigRequest {
    @NotBlank(message = "配置键不能为空")
    private String configKey;
    private String configValue;
    @NotBlank(message = "配置类型不能为空")
    private String configType;
    @NotBlank(message = "值类型不能为空")
    private String valueType;
    private String configName;
    private String configGroup;
    private String remark;
}
```

### 6.4 VO —— `interfaces/rest/vo/SystemConfigVO.java`

```java
package com.aria.auth.interfaces.rest.vo;

import lombok.Builder;
import lombok.Data;

@Data @Builder
public class SystemConfigVO {
    private Long id;
    private String configKey;
    private String configValue;
    private String configType;
    private String valueType;
    private String configName;
    private String configGroup;
    private String remark;
    private Boolean isEnabled;
    private Boolean isSystem;
}
```

### 6.5 值解析工具 —— `application/service/ConfigValueParser.java`

```java
package com.aria.auth.application.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

public final class ConfigValueParser {
    private static final ObjectMapper OM = new ObjectMapper();

    public static Object parse(String valueType, String raw) {
        if (raw == null) return null;
        try {
            return switch (valueType) {
                case "NUMBER"  -> raw.contains(".") ? Double.parseDouble(raw) : Long.parseLong(raw);
                case "BOOLEAN" -> Boolean.parseBoolean(raw);
                case "JSON"    -> OM.readValue(raw, new TypeReference<Object>() {});
                default        -> raw; // STRING
            };
        } catch (Exception e) {
            return raw; // 解析失败回退原字符串，消费端再决定兜底
        }
    }
}
```

### 6.6 Service —— `application/service/SystemConfigService.java`

```java
package com.aria.auth.application.service;

import com.aria.auth.infrastructure.persistence.config.SystemConfigDO;
import com.aria.auth.infrastructure.persistence.config.SystemConfigMapper;
import com.aria.auth.interfaces.dto.SystemConfigRequest;
import com.aria.common.core.exception.BusinessException;
import com.aria.common.core.page.PageQuery;
import com.aria.common.core.page.PageResult;
import com.aria.common.core.page.PageUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service @RequiredArgsConstructor
public class SystemConfigService {

    private final SystemConfigMapper mapper;
    private static final String SYSTEM_TYPE = "SYSTEM";

    public PageResult<SystemConfigDO> page(PageQuery q, String configType, String keyword) {
        LambdaQueryWrapper<SystemConfigDO> w = new LambdaQueryWrapper<SystemConfigDO>()
                .isNull(SystemConfigDO::getDeletedAt)
                .orderByDesc(SystemConfigDO::getCreatedAt);
        if (configType != null && !configType.isBlank())
            w.eq(SystemConfigDO::getConfigType, configType);
        if (keyword != null && !keyword.isBlank())
            w.and(k -> k.like(SystemConfigDO::getConfigKey, keyword)
                        .or().like(SystemConfigDO::getConfigName, keyword));
        Page<SystemConfigDO> r = mapper.selectPage(PageUtil.toMpPage(q), w);
        return PageUtil.toPageResult(r, q);
    }

    @Transactional
    public SystemConfigDO create(SystemConfigRequest req, Long operatorId, boolean isSuperAdmin) {
        assertTypeScope(req.getConfigType(), isSuperAdmin);
        if (mapper.selectOne(new LambdaQueryWrapper<SystemConfigDO>()
                .eq(SystemConfigDO::getConfigKey, req.getConfigKey())
                .isNull(SystemConfigDO::getDeletedAt)) != null)
            throw new BusinessException(422, "配置键已存在: " + req.getConfigKey());
        SystemConfigDO d = new SystemConfigDO();
        d.setConfigKey(req.getConfigKey());   d.setConfigValue(req.getConfigValue());
        d.setConfigType(req.getConfigType()); d.setValueType(req.getValueType());
        d.setConfigName(req.getConfigName()); d.setConfigGroup(req.getConfigGroup());
        d.setRemark(req.getRemark());         d.setIsEnabled(true);
        d.setIsSystem(false);                 d.setCreatedBy(operatorId);
        d.setCreatedAt(LocalDateTime.now());  d.setUpdatedAt(LocalDateTime.now());
        mapper.insert(d);
        return d;
    }

    @Transactional
    public void update(Long id, SystemConfigRequest req, boolean isSuperAdmin) {
        SystemConfigDO e = getOrThrow(id);
        assertTypeScope(e.getConfigType(), isSuperAdmin);
        e.setConfigValue(req.getConfigValue()); e.setConfigName(req.getConfigName());
        e.setConfigGroup(req.getConfigGroup()); e.setRemark(req.getRemark());
        e.setUpdatedAt(LocalDateTime.now());
        mapper.updateById(e);
    }

    @Transactional
    public void delete(Long id) {
        SystemConfigDO e = getOrThrow(id);
        if (Boolean.TRUE.equals(e.getIsSystem()))
            throw new BusinessException(422, "内置配置不可删除");
        SystemConfigDO u = new SystemConfigDO();
        u.setId(id); u.setDeletedAt(LocalDateTime.now());
        mapper.updateById(u);
    }

    /** 消费接口：按类型返回解析后的 Map（is_enabled=false 的项不纳入） */
    public Map<String, Object> mapByType(String configType) {
        List<SystemConfigDO> list = mapper.selectList(new LambdaQueryWrapper<SystemConfigDO>()
                .eq(SystemConfigDO::getConfigType, configType)
                .eq(SystemConfigDO::getIsEnabled, true)
                .isNull(SystemConfigDO::getDeletedAt));
        Map<String, Object> map = new LinkedHashMap<>();
        for (SystemConfigDO d : list)
            map.put(d.getConfigKey(), ConfigValueParser.parse(d.getValueType(), d.getConfigValue()));
        return map;
    }

    private void assertTypeScope(String configType, boolean isSuperAdmin) {
        if (SYSTEM_TYPE.equals(configType) && !isSuperAdmin)
            throw new BusinessException(403, "无权限管理系统配置类型");
    }

    private SystemConfigDO getOrThrow(Long id) {
        SystemConfigDO r = mapper.selectOne(new LambdaQueryWrapper<SystemConfigDO>()
                .eq(SystemConfigDO::getId, id).isNull(SystemConfigDO::getDeletedAt));
        if (r == null) throw new BusinessException(404, "系统配置不存在: id=" + id);
        return r;
    }
}
```

### 6.7 Controller —— `interfaces/rest/AdminSystemConfigController.java`

```java
package com.aria.auth.interfaces.rest;

import cn.dev33.satoken.annotation.SaCheckLogin;
import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.dev33.satoken.stp.StpUtil;
import com.aria.auth.application.service.SystemConfigService;
import com.aria.auth.infrastructure.persistence.config.SystemConfigDO;
import com.aria.auth.interfaces.dto.SystemConfigRequest;
import com.aria.auth.interfaces.rest.vo.SystemConfigVO;
import com.aria.common.core.page.PageQuery;
import com.aria.common.core.page.PageResult;
import com.aria.common.web.response.R;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/system-config")
@SaCheckLogin
@RequiredArgsConstructor
public class AdminSystemConfigController {

    private final SystemConfigService service;

    @GetMapping
    @SaCheckPermission("system:config:list")
    public R<PageResult<SystemConfigVO>> list(PageQuery q,
            @RequestParam String configType,
            @RequestParam(required = false) String keyword) {
        PageResult<SystemConfigDO> r = service.page(q, configType, keyword);
        List<SystemConfigVO> vos = r.items().stream().map(this::toVO).toList();
        return R.ok(PageResult.of(r.total(), r.page(), r.size(), vos));
    }

    @PostMapping
    @SaCheckPermission("system:config:create")
    public R<SystemConfigVO> create(@RequestBody @Valid SystemConfigRequest req) {
        return R.ok(toVO(service.create(req, StpUtil.getLoginIdAsLong(), isSuperAdmin())));
    }

    @PutMapping("/{id}")
    @SaCheckPermission("system:config:update")
    public R<Void> update(@PathVariable Long id, @RequestBody @Valid SystemConfigRequest req) {
        service.update(id, req, isSuperAdmin());
        return R.ok();
    }

    @DeleteMapping("/{id}")
    @SaCheckPermission("system:config:delete")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }

    @GetMapping("/map")
    @SaCheckPermission("system:config:list")
    public R<Map<String, Object>> map(@RequestParam String configType) {
        return R.ok(service.mapByType(configType));
    }

    private boolean isSuperAdmin() {
        // ⚠️ 实施前确认：StpInterfaceImpl.getRoleList() 是否向 Sa-Token 注册了角色列表。
        // 若仅走 sys_role_permission 数据授权，需改为自定义角色判断逻辑。
        return StpUtil.hasRole("super_admin");
    }

    private SystemConfigVO toVO(SystemConfigDO d) {
        return SystemConfigVO.builder()
                .id(d.getId()).configKey(d.getConfigKey()).configValue(d.getConfigValue())
                .configType(d.getConfigType()).valueType(d.getValueType())
                .configName(d.getConfigName()).configGroup(d.getConfigGroup())
                .remark(d.getRemark()).isEnabled(d.getIsEnabled()).isSystem(d.getIsSystem())
                .build();
    }
}
```

---

## 7. 落地与迁移方式（重要：用快照，不是 Flyway）

1. 将第 2 节 DDL **追加**到 `docs/sql/ai_customerservice-schema.sql`（cs_auth 段）。
2. 将第 3 节种子 SQL **追加**到 `docs/sql/ai_customerservice-data.sql`，**先 grep 当前最大 id**。
3. **不要**新建 `Vx__*.sql`：Flyway 仅声明依赖、未启用，仓库靠 pg_dump 快照还原。
4. 按 `docs/sql/README.md` 流程重新导出快照并导入开发库：
   ```bash
   pg_dump ... > ai_customerservice-schema.sql    # 结构
   pg_dump ... --data-only ... > ai_customerservice-data.sql  # 数据
   ```
5. 创建第 6 节 7 个 Java 文件，启动 auth-service 验证接口。

---

## 8. 后端业务代码接入约定

以下模块在实现中有写死参数，需改为从 `SystemConfigService.mapByType()` 读取，并**保留原硬编码值为兜底**：

| 业务模块 | 参数 | 兜底值 |
|---|---|---|
| 会话创建服务 | `agent.maxConcurrent` | 5 |
| 会话创建服务 | `agent.welcomeMessage` | 您好！请问有什么可以帮您？ |
| 文件上传接口 | `knowledge.uploadMaxFileSizeMb` | 50 |
| RAG 检索服务 | `knowledge.searchTopK` | 5 |
| 仪表盘查询 | `dashboard.recentLimit` | 10 |
| AI 调用（各场景） | `prompt.*`（5 条） | 各自 `default` 模板 |

**建议封装**：在 `SystemConfigService` 新增 `getNumberConfig(String key, long fallback)` / `getStringConfig(String key, String fallback)` / `getJsonConfig(String key, Object fallback)` 等便捷方法，避免每个调用点重复解析。

---

## 9. 前端消费端约定（简要）

前端消费主要用于**管理页面展示**和**辅助前端校验**，不驱动 UI 行为参数。

### 9.1 新增文件

- `apps/src/api/system-config/index.ts`：封装 `listSystemConfigsApi`、`createSystemConfigApi`、`updateSystemConfigApi`、`deleteSystemConfigApi`、`getSystemConfigMapApi`。
- `apps/src/store/system-config.ts`：Pinia store；登录后拉取 `/map?configType=CUSTOMER_SERVICE` 与 `=SYSTEM`，提供 `getConfig<T>(key, fallback): T`。
- 两个页面共用同一表格/表单组件（`configType` prop 区分）：
  - `views/customer-service-config/index.vue`
  - `views/system-config/index.vue`

### 9.2 可选：前端辅助校验

文件上传组件可从 store 读 `knowledge.uploadMaxFileSizeMb`，用于前端提示文案与预校验，确保与后端限制一致：

```ts
const maxFileSizeMb = systemConfigStore.getConfig('knowledge.uploadMaxFileSizeMb', 50)
```

### 9.3 注意事项

- **不替换**前端写死的 UI 参数（分页大小、防抖延迟、定时器等保持硬编码）。
- **不替换** WS/SSE 连接常量（`useAgentWsChannel`、`useVisitorWs`、`useSessionQueueChannel` 中的重连/心跳值保持不变）。

---

## 10. 实施步骤与验证

### 10.1 后端

1. 追加 DDL + 种子 → 重新 pg_dump 快照 → 导入开发库。
2. 创建 7 个 Java 文件。
3. 启动 auth-service，用 curl 验证：

```bash
# 客服配置列表（应返回 9 条：4 业务参数 + 5 提示词）
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8080/api/v1/admin/system-config?configType=CUSTOMER_SERVICE&page=0&size=20"

# SYSTEM Map（应返回 {"dashboard.recentLimit": 10}）
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8080/api/v1/admin/system-config/map?configType=SYSTEM"

# 客服配置 Map（提示词应返回解析后的 JSON Map 对象，数字类型正确）
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8080/api/v1/admin/system-config/map?configType=CUSTOMER_SERVICE"

# 内置项删除应返回 422
curl -X DELETE -H "Authorization: Bearer <token>" \
  "http://localhost:8080/api/v1/admin/system-config/1"

# kf_manager 传 SYSTEM 类型应返回 403
curl -X POST -H "Authorization: Bearer <kf_manager_token>" \
  -H "Content-Type: application/json" \
  -d '{"configKey":"test","configValue":"1","configType":"SYSTEM","valueType":"NUMBER"}' \
  "http://localhost:8080/api/v1/admin/system-config"
```

### 10.2 前端

1. 新增 API 文件 + store。
2. 实现共用组件 + 两个管理页面。
3. 静态路由注册。

### 10.3 联调验证

- super_admin 可见两个菜单，kf_manager 仅见「客服配置」。
- 修改 `agent.welcomeMessage` 后，新开会话首条消息即时生效。
- 修改 `agent.maxConcurrent` 后，后端接受会话时的并发校验按新值执行。
- 修改 `knowledge.searchTopK` 后，RAG 检索返回条数变化。
- 修改提示词后，AI 辅助建议使用新模板（需后端 conversation 服务已接入）。

### 10.4 收尾

联调通过后重新导出 `data.sql` 快照，保持仓库与运行库一致。
