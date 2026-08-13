# NZH-control 数据库重构 · 实时进度

> **目标**: 完全重构数据库设计，解决导出困难、数据链路断裂等所有问题
> **开始时间**: 2026-06-01

---

## 总体进度: ██████░░░░░░░░░░ 30%

---

## Phase 1: 统一事件模型 cow_events ✅ 已完成

- [x] 分析 5 张旧事件表的字段差异
- [x] 创建 cow_events 统一事件表（database-model.ts）
- [x] 添加 events 类型定义（types/cow.ts）
- [ ] 数据迁移脚本（旧表 → 新表）
- [ ] 更新所有页面引用（event-entry 5 页 + 导出页 + 统计页）

## Phase 2: 传感器长表化 sensor_readings ⬜ 未开始

- [ ] 创建 sensor_readings 长表
- [ ] 数据迁移脚本
- [ ] 更新所有页面引用

## Phase 3: 完整繁殖链条 ⬜ 未开始

- [ ] reproduction_cycles 完整周期表
- [ ] breeding_bulls 种公牛表
- [ ] reproduction_kpis 表
- [ ] 添加妊检/产犊/干奶事件类型

## Phase 4: 页面适配 ⬜ 未开始

- [ ] 更新 event-entry 5 个页面
- [ ] 更新 data-export 2 个页面
- [ ] 更新 statistics 7 个页面
- [ ] 更新 reproduction-tracking 页面
- [ ] 更新 dashboard/board 页面

## Phase 5: 通用导出组件 ⬜ 未开始

- [ ] 创建通用导出组件
- [ ] 嵌套对象自动扁平化
- [ ] 所有表导出入口

---

## 当前正在进行

**Phase 1 · 统一事件模型**
