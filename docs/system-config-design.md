# 系统配置（客服配置 / 系统配置）文档索引

> v2.0 起拆分为两份文档，本文档仅作索引。

- **功能设计文档（做什么/为什么/影响/配置项含义）**：[system-config-functional-design.md](./system-config-functional-design.md)
- **技术设计文档（后端 DDL/种子 SQL/接口契约/完整 Java 代码）**：[system-config-technical-design.md](./system-config-technical-design.md)

## 与设计 v1.0 的主要差异（v2.0 修正）

1. **视角改为后端为主**：配置表、CRUD、权限、种子数据均落在 `ai-auth`/`cs_auth`；前端仅消费方。
2. **修正迁移机制**：原 v1.0 误写为「Flyway V4 脚本」，实测 Flyway 仅声明依赖未启用，真实机制是 `docs/sql/` 的 pg_dump 快照。v2.0 改为追加到 `schema.sql`/`data.sql` 并按 README 重新导出。
3. **强化类型区分**：后端按 `config_type`（CUSTOMER_SERVICE / SYSTEM）过滤，两个菜单各传一个类型；并新增类型守卫（kf_manager 只能管理 CUSTOMER_SERVICE）。
4. **新增提示词配置（v2.1）**：提示词作为 `CUSTOMER_SERVICE` 类配置项、`config_group='提示词'` 聚类；多模型场景用 JSON Map（default + 模型标识），模板支持 `{占位符}` 由消费方替换；详见两份文档第 6.3 / 3.5 节。
