# 水牛育种平台 v2 数据库全量开发计划

## 1. 开发目标

本次重构的目标不是新增几张演示表，而是把平台的数据底座改成可支撑牧场生产、育种科研、组学分析、表型采集、奶厅生产、繁殖管理、药品库存、预警工单和科研导出的完整数据库。所有核心数据最终都要能追溯到牛只 `animal_id`，同时支持群体、圈舍、周期、胎次、泌乳期、繁殖周期、自定义窗口和一天多次记录。

交付后，前端“数据台账”页面应可以直接看到这些表，并能进行基础操作：刷新、查询、新增、编辑、删除和导出。

## 2. 核心设计原则

1. 牛只是主轴：表型、泌乳、繁殖、用药、传感器、组学样本、育种值、选配推荐、预警、导出快照都要能追溯到 `animal_id`。
2. 明细不丢：一天两次或多次观测、配种、用药、采奶、传感器记录不能被聚合表覆盖，聚合表只能作为派生事实表。
3. 周期可扩展：日、月、年、胎次、泌乳期、繁殖周期、妊娠期、干奶期、自定义滚动窗口都作为标准周期体系处理。
4. 自定义域可生产化：表型、事件、药品、字段、字典、导出口径、统计口径都支持自定义一级/二级分类和字段。
5. 科研导出可复现：科研项目、队列、变量集、筛选条件、数据快照、字典快照、导出文件必须保留版本和操作人。
6. 不把核心业务塞进 JSON：JSON 只用于参数、快照、扩展字段；核心索引字段必须结构化。
7. 前端可操作：数据库页面不是只读表格，要能做通用 CRUD 和导出。

## 3. 数据域和表结构范围

### 3.1 牛只与系谱

- `animal`：牛只主档，保存牛号、耳标、品种、性别、阶段、群组、圈舍、状态、出生日期、入场日期。
- `animal_identifier`：耳标、电子耳标、奶厅号、组学样本编号等多编号体系。
- `animal_parentage`：父母关系、系谱来源、置信度、验证方法。

### 3.2 牛群、阶段、圈舍

- `stage_definition`：犊牛、育成、育肥、公牛、泌乳、干奶、淘汰等阶段定义。
- `herd_group`：育种核心群、泌乳高产群、青年母牛群等业务群。
- `farm_unit`：牧场、牛舍、圈栏、奶厅、实验室、库房等组织/空间单元。
- `animal_group_membership`：牛只入群、出群、当前群历史。
- `animal_pen_assignment`：牛只圈舍分配历史。
- `group_pen_policy`：不同阶段/群体对应圈舍策略。
- `group_transfer_request`：转群申请、审批和执行闭环。
- `unit_capacity_snapshot`：圈舍容量、存栏、利用率快照。

### 3.3 周期体系

- `business_calendar`：生产日历。
- `production_day_rule`：生产日切换规则，例如奶厅凌晨班是否算前一生产日。
- `production_shift`：早/中/晚班次。
- `time_day`、`time_month`、`time_year`：标准时间维表。
- `time_period`：可统一描述日、月、年、胎次、泌乳期、繁殖周期、自定义窗口。
- `rolling_window_definition`：7 日、30 日、305 天、最近一胎等窗口定义。
- `animal_time_index`：牛只和周期的关联索引，用于导出和聚合。

### 3.4 表型与泌乳

- `trait_category`：表型一级/二级分类，例如体尺、体重、DHI、产奶、质量性状。
- `trait_definition`：具体性状定义，支持单位、数据类型、值域、适用阶段、是否质量性状。
- `trait_method`：采集方法、仪器、DHI、奶厅、人工测定、传感器导入。
- `trait_observation_batch`：采集批次，记录人员、设备、来源、质控状态。
- `trait_observation`：所有表型明细，包括一天多次记录，支持胎次、泌乳期、繁殖周期、采集时间、班次。
- `trait_aggregation_rule`：最大、最小、平均、次数、总和、305 天、按胎次、按月、按年等导出口径。
- `fact_cow_trait_day/month/year/parity/lactation`：派生聚合事实表。
- `fact_lactation_305`：305 天泌乳统计。

### 3.5 事件、繁殖和周期

- `animal_event`：统一事件主表，疾病、免疫、配种、妊检、分娩、流产、转群、淘汰、生产事件都可纳入。
- `event_reproduction_detail`：发情、输精、公牛、冻精、妊检、分娩结果等繁殖明细。
- `event_health_detail`：疾病、诊断、症状、处理。
- `event_movement_detail`：转群、转舍、离场、淘汰。
- `event_production_detail`：生产操作事件。
- `event_medicine_detail`：用药事件明细。
- `parity_episode`：胎次。
- `reproduction_cycle`：从发情/配种到妊娠/分娩/失败的繁殖周期。
- `lactation_episode`：泌乳期。
- `gestation_episode`：妊娠期。
- `dry_period_episode`：干奶期。
- `fact_event_count_day/month/year/cycle/parity/lactation`：事件次数聚合。

### 3.6 自定义字典和字段

- `dictionary_category`、`dictionary_item`：所有可配置字典。
- `custom_field_definition`：任意业务域的字段定义，包含数据类型、单位、约束、是否必填、是否可筛选、是否可导出。
- `custom_field_value`：字段值，支持挂接到牛、事件、表型、药品、组学样本、导出等实体。
- `field_promotion_request`：将临时自定义字段提升为标准字段的申请。
- `duplicate_detection_rule`：导入去重规则。

### 3.7 药品、库存和休药

- `medicine`、`medicine_batch`：药品和批次。
- `medication_order`：治疗/用药医嘱。
- `medication_administration`：单次给药记录。
- `withdrawal_tracking`：休药期跟踪。
- `residue_test`：残留检测。
- `inventory_ledger`：药品、耗材、饲料等库存流水。

### 3.8 奶厅、设备和传感器

- `device`、`device_channel`：设备和通道。
- `animal_device_assignment`：设备和牛只绑定历史。
- `milking_session`：挤奶班次/场次。
- `milking_visit`：单牛进厅/离厅记录。
- `milk_measurement`：产奶、流速、电导率、乳温、乳成分等测量。
- `sensor_reading`：传感器长表，支持一天多次、多指标。
- `data_quality_issue`：数据质量问题。

### 3.9 科研导出

- `research_project`：科研项目。
- `research_cohort_definition`：队列定义。
- `research_variable_set`：变量集。
- `research_extract_job`：抽取任务。
- `research_extract_filter`：筛选条件。
- `research_extract_variable`：导出变量。
- `research_dataset_snapshot`：数据快照。
- `research_dataset_artifact`：导出文件。
- `data_dictionary_snapshot`：字典快照。

### 3.10 组学和育种

- `omics_sample`、`omics_dataset`、`omics_dataset_sample`、`omics_feature`：组学样本、数据集和特征。
- `omics_module_run`、`omics_workflow_run`、`omics_artifact`：组学模块和工作流运行结果。
- `omics_trait_link`：组学特征与表型性状关联。
- `breeding_value_run`、`breeding_value`：育种值运行和结果。
- `selection_index`：选择指数。
- `mating_recommendation`：选配推荐。

### 3.11 预警、工单、报表和审计

- `alert_rule`、`alert_case`、`work_order`：预警规则、预警事件、处理工单。
- `report_template`、`report_metric_definition`、`report_run`、`report_run_item`：报表体系。
- `export_file`、`export_scope_definition`、`report_period_filter`、`report_data_scope`：导出和筛选口径。
- `permission_policy`、`role_permission`、`approval_workflow`：权限和审批。
- `operation_audit_log`：操作审计。
- `correction_request`、`derivation_recompute_job`：数据修正和派生数据重算。

## 4. 前端操作范围

数据库页面本轮至少支持：

- 按业务分类查看 v2 表。
- 搜索台账名称。
- 刷新当前表和全部表。
- 新增记录：通用 JSON 表单，默认带 `id`、`createdAt`、`updatedAt`。
- 编辑记录：选择记录后弹窗编辑 JSON。
- 删除记录：二次确认后删除。
- 导出当前表：JSON 文件。

后续可以再按业务域做专用录入页面，但本轮必须先保证 v2 库可以从前端直接看见和操作。

## 5. 后端开发范围

- 新增 `database/mysql/migrations/020_v2_full_rebuild_schema.sql`。
- 后端启动时读取并执行本地迁移文件。
- v2 表加入 `DEFAULT_TABLES`，使统计、重置、RPC 可覆盖。
- v2 实体加入 `ENTITY_TABLE_MAP`，使通用实体 API 能路由。
- 避免 v2 表被 `ensureGenericTable` 退化为 `id + payload`。

## 6. 验证计划

1. 文件级验证：确认迁移文件、任务文件、开发计划文件存在。
2. 代码级验证：搜索 v2 表名，确认 SQL、后端、前端三层均出现。
3. 构建验证：执行 `npm run build`。
4. 运行验证：启动后端后检查 `/api/db/rpc getDataStats` 能返回 v2 表计数。
5. 前端验证：进入 `/database` 页面，可看到 v2 表卡片，能新增、编辑、删除并导出。

## 7. 当前本轮交付顺序

1. 创建详细计划和任务追踪。
2. 写入完整 v2 schema 迁移。
3. 后端启动自动迁移并接表映射。
4. 前端 Dexie 与数据库页接 v2 表。
5. 构建/静态验证。
6. 记录结果和剩余风险。
