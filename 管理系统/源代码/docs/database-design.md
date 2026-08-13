# NZH-control 数据库设计方案

> **设计原则**：以阿菲金为标杆，融合组学分析特色，统一数据模型，支持 IndexedDB + MySQL 双模式

---

## 一、架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    数据层架构                            │
─────────────────────────────────────────────────────────┤
│  IndexedDB (前端离线)   ←  同步  →   MySQL (后端生产)   │
│  Dexie.js 7版本          databaseService 双模式桥接      │
│  37张表 → 优化后 25张核心表 + 15张扩展表                │
├─────────────────────────────────────────────────────────┤
│  核心域: 牛只档案 | 事件流 | 传感器时序 | 繁殖链条         │
│  业务域: 产奶 | 饲料 | 健康 | 经济分析                    │
│  特色域: 组学 | 育种决策 | 预测模型                       │
│  运营域: 硬件 | 自动化 | 审计 | 权限                     │
└─────────────────────────────────────────────────────────┘
```

---

## 二、核心数据模型设计

### 域 1：牛只与身份 (Identity & Animal)

```sql
-- 牛只主档表（核心主表，所有关联的锚点）
-- 设计思路：参考阿菲金 cowID 模式，使用唯一编号体系
cows (
  id                 VARCHAR(36) PRIMARY KEY,      -- UUID，全局唯一
  cow_number         VARCHAR(20) UNIQUE NOT NULL,  -- 业务编号（用户可读）
  ear_tag_number     VARCHAR(20) UNIQUE,            -- 耳标号（RFID）
  breed_id           VARCHAR(36),                   -- 品种ID
  gender             ENUM('公', '母') NOT NULL,
  birth_date         DATE NOT NULL,
  birth_type         ENUM('自然', '人工'),
  type               ENUM('牛', '小育成', '大育成', '青年牛', '成母牛', '种公牛', '育成公牛'),
  current_pen_id     VARCHAR(36),                   -- 当前圈舍
  status             ENUM('健康', '异常', '发情', '预产', '混群', '离群', '干奶', '妊娠') NOT NULL,
  parity             INT DEFAULT 0,                  -- 胎次
  current_lactation  INT DEFAULT 0,                  -- 当前泌乳胎次
  days_in_milk       INT DEFAULT 0,                  -- 泌乳天数
  entry_date         DATE,                           -- 入场日期
  entry_reason       ENUM('出生', '购买', '他场转入'),
  death_date         DATE,                           -- 死亡日期（为空表示存活）
  death_reason       VARCHAR(100),
  notes              TEXT,
  
  -- 系谱字段（扁平化，支持3代追溯）
  sire_id            VARCHAR(36),                    -- 父牛ID
  dam_id             VARCHAR(36),                    -- 母牛ID
  sire_sire_id       VARCHAR(36),                    -- 祖父
  sire_dam_id        VARCHAR(36),                    -- 祖母
  dam_sire_id        VARCHAR(36),                    -- 外祖父
  dam_dam_id         VARCHAR(36),                    -- 外祖母
  
  inbreeding_coeff   DECIMAL(5,4),                   -- 近交系数
  
  created_at         DATETIME NOT NULL,
  updated_at         DATETIME NOT NULL,
  
  INDEX idx_cow_number (cow_number),
  INDEX idx_ear_tag (ear_tag_number),
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_pen (current_pen_id),
  INDEX idx_birth_date (birth_date),
  INDEX idx_sire (sire_id),
  INDEX idx_dam (dam_id)
)

-- 品种字典表
breed_types (
  id          VARCHAR(36) PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,          -- 品种代码
  name        VARCHAR(50) NOT NULL,
  category    ENUM('乳用', '肉用', '兼用'),
  origin      VARCHAR(50),
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  DATETIME,
  
  INDEX idx_category (category)
)

-- 圈舍表
pens (
  id          VARCHAR(36) PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,          -- 圈舍编码
  name        VARCHAR(50) NOT NULL,
  category    ENUM('牛区', '育成区', '种牛区', '待产区', '隔离区', '挤奶区'),
  capacity    INT,                                   -- 容量
  current_count INT DEFAULT 0,                      -- 当前牛只数
  notes       TEXT,
  created_at  DATETIME,
  
  INDEX idx_category (category)
)

-- 人员表
persons (
  id          VARCHAR(36) PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,          -- 工号
  name        VARCHAR(50) NOT NULL,
  department  ENUM('饲养部', '兽医部', '育种部', '管理', '外部'),
  role        VARCHAR(50),
  phone       VARCHAR(20),
  email       VARCHAR(100),
  hire_date   DATE,
  is_active   BOOLEAN DEFAULT true,
  notes       TEXT,
  created_at  DATETIME,
  updated_at  DATETIME
)
```

### 域 2：统一事件流 (Unified Event Stream)

```sql
-- 核心设计：统一事件表，参考阿菲金做法
-- 解决当前 5 张表字段不统一、导出困难的问题
cow_events (
  id              VARCHAR(36) PRIMARY KEY,
  cow_id          VARCHAR(36) NOT NULL,             -- 关联 cows.id
  cow_number      VARCHAR(20) NOT NULL,             -- 冗余存储，方便查询
  event_type      ENUM(
    'entry',          -- 入群
    'transfer',       -- 转群
    'exit',           -- 离场
    'breeding',       -- 配种
    'pregnancy_check',-- 妊检
    'calving',        -- 产犊
    'dry_off',        -- 干奶
    'veterinary',     -- 兽医
    'vaccination',    -- 疫苗
    'health_check',   -- 健康检查
    'death',          -- 死亡
    'weight',         -- 称重
    'group_change',   -- 组别变更
    'custom'          -- 自定义
  ) NOT NULL,
  event_time      DATETIME NOT NULL,                -- 统一时间字段
  operator_id     VARCHAR(36),                      -- 操作人ID
  operator_name   VARCHAR(50),                      -- 操作人姓名（冗余）
  
  -- 事件详情（JSON，不同 event_type 存不同字段）
  details         JSON NOT NULL,
  
  /*
   details JSON 结构示例：
   
   {
     // entry 事件:
     "entry_reason": "购买",
     "entry_weight": 250,
     "source_farm": "XX牧场"
     
     // transfer 事件:
     "from_pen_id": "pen-1",
     "from_pen_name": "A01",
     "to_pen_id": "pen-2",
     "to_pen_name": "B01",
     "transfer_reason": "断奶"
     
     // exit 事件:
     "exit_reason": "死亡",
     "exit_weight": 450,
     "destination": "无害化处理"
     
     // breeding 事件:
     "bull_id": "bull-1",
     "bull_number": "B001",
     "method": "人工授精",
     "semen_batch": "SB20240101",
     "technician_id": "person-1"
     
     // pregnancy_check 事件:
     "check_method": "B超",
     "result": "阳性",
     "expected_due_date": "2025-01-01"
     
     // calving 事件:
     "calf_count": 1,
     "calf_details": [{"gender": "母", "weight": 35, "status": "存活"}],
     "delivery_method": "顺产",
     "gestation_days": 280
     
     // dry_off 事件:
     "reason": "自然干奶",
     "last_milking_date": "2024-12-01",
     "expected_calving_date": "2025-03-01"
     
     // veterinary 事件:
     "disease_id": "disease-1",
     "diagnosis": "肺炎",
     "symptoms": "咳嗽、发热",
     "treatment": "抗生素注射",
     "medicine_ids": ["med-1", "med-2"],
     "cost": 500,
     "result": "好转"
     
     // vaccination 事件:
     "vaccine_name": "口蹄疫疫苗",
     "vaccine_batch": "VB202401",
     "dosage": "5ml",
     "next_vaccination_date": "2025-01-01"
   }
   */
  
  cost            DECIMAL(10,2) DEFAULT 0,          -- 事件费用
  notes           TEXT,
  
  created_at      DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE RESTRICT,
  FOREIGN KEY (operator_id) REFERENCES persons(id) ON DELETE SET NULL,
  
  INDEX idx_cow_event_time (cow_id, event_time),
  INDEX idx_event_type (event_type),
  INDEX idx_event_time (event_time),
  INDEX idx_operator (operator_id)
)

-- 辅助索引表：按事件类型快速查询
-- 注意：这些不是独立的数据表，而是 cow_events 的物化视图/查询封装

-- 入群事件查询封装
-- SELECT * FROM cow_events WHERE event_type = 'entry'

-- 转群事件查询封装
-- SELECT * FROM cow_events WHERE event_type = 'transfer'

-- 繁殖事件查询封装
-- SELECT * FROM cow_events WHERE event_type IN ('breeding', 'pregnancy_check', 'calving', 'dry_off')

-- 兽医事件查询封装
-- SELECT * FROM cow_events WHERE event_type IN ('veterinary', 'vaccination', 'health_check')
```

### 域 3：传感器时序数据 (Sensor Time-Series)

```sql
-- 核心设计：长表模式，参考阿菲金做法
-- 解决当前宽表 + 嵌套 JSON 无法导出的问题
sensor_readings (
  id              VARCHAR(36) PRIMARY KEY,
  cow_id          VARCHAR(36) NOT NULL,
  timestamp       DATETIME NOT NULL,                -- 采集时间
  metric          ENUM(
    -- 体温
    'temperature',           -- 体温(°C)
    -- 活动
    'steps',                 -- 步数
    'lying_time',            -- 躺卧时间(分钟)
    'standing_time',         -- 站立时间(分钟)
    'walking_distance',      -- 步行距离(米)
    'active_time',           -- 活跃时间(分钟)
    -- 反刍
    'rumination_count',      -- 反刍次数
    'rumination_duration',   -- 反时长(分钟)
    'rumination_efficiency', -- 反刍效率评分
    -- 进食
    'eating_time',           -- 采食时间(分钟)
    'estimated_intake',      -- 估算采食量(kg)
    'feeding_efficiency',    -- 采食效率评分
    -- 体征
    'heart_rate',            -- 心率(次/分钟)
    'respiration_rate',      -- 呼吸频率(次/分钟)
    'body_score',            -- 体况评分(1-5)
    -- 环境
    'ambient_temp',          -- 环境温度(°C)
    'humidity',              -- 湿度(%)
    'ammonia',               -- 氨气浓度(ppm)
    'light_level'            -- 光照强度(lux)
  ) NOT NULL,
  value           DECIMAL(10,4) NOT NULL,           -- 指标值
  unit            VARCHAR(20),                      -- 单位
  quality         ENUM('good', 'fair', 'poor') DEFAULT 'good', -- 数据质量
  
  created_at      DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  
  -- 复合索引：按牛+指标+时间查询（高频查询模式）
  INDEX idx_cow_metric_time (cow_id, metric, timestamp),
  INDEX idx_cow_time (cow_id, timestamp),
  INDEX idx_metric_time (metric, timestamp)
)

-- 传感器设备状态表
sensor_devices (
  id              VARCHAR(36) PRIMARY KEY,
  cow_id          VARCHAR(36),                      -- 绑定的牛只（可为空，表示通用传感器）
  device_code     VARCHAR(30) UNIQUE NOT NULL,       -- 设备编码
  device_type     ENUM('项圈', '耳标', '瘤胃胶囊', '腿带', '固定式', '环境'),
  brand           VARCHAR(50),
  model           VARCHAR(50),
  battery_level   INT,                               -- 电池电量(%)
  signal_strength INT,                               -- 信号强度(0-100)
  status          ENUM('online', 'offline', 'error', 'maintenance'),
  last_seen       DATETIME,
  firmware_version VARCHAR(20),
  location_pen_id VARCHAR(36),                       -- 安装位置（固定式）
  installed_at    DATETIME,
  notes           TEXT,
  
  INDEX idx_status (status),
  INDEX idx_cow (cow_id)
)

-- 数据质量检查表
data_quality_checks (
  id              VARCHAR(36) PRIMARY KEY,
  cow_id          VARCHAR(36),
  timestamp       DATETIME NOT NULL,
  metric          VARCHAR(30) NOT NULL,
  original_value  DECIMAL(10,4),
  quality_score   DECIMAL(5,2),                     -- 质量评分(0-100)
  is_valid        BOOLEAN,
  issues          JSON,                              -- 问题列表
  corrected_value DECIMAL(10,4),
  correction_method VARCHAR(50),
  
  INDEX idx_cow_time (cow_id, timestamp),
  INDEX idx_quality (quality_score)
)

-- 传感器校准记录
sensor_calibrations (
  id              VARCHAR(36) PRIMARY KEY,
  device_id       VARCHAR(36) NOT NULL,
  calibration_type ENUM('offset', 'scale', 'linear', 'polynomial'),
  parameters      JSON,                              -- 校准参数
  calibration_date DATETIME NOT NULL,
  valid_until     DATETIME,
  accuracy        DECIMAL(5,3),                      -- 校准精度
  technician      VARCHAR(50),
  
  INDEX idx_device (device_id),
  INDEX idx_valid_until (valid_until)
)
```

### 域 4：繁殖链条 (Reproduction Chain)

```sql
-- 核心设计：完整的繁殖事件链
-- 解决当前缺少妊检表、产犊表、干奶记录的问题

-- 繁殖周期表（核心）
reproduction_cycles (
  id                    VARCHAR(36) PRIMARY KEY,
  cow_id                VARCHAR(36) NOT NULL,
  cycle_number          INT NOT NULL,               -- 第几个繁殖周期
  cycle_start_date      DATE NOT NULL,              -- 周期开始（上次产犊或干奶）
  
  -- 发情阶段
  heat_detected_date    DATETIME,
  heat_confidence       DECIMAL(5,2),               -- 发情置信度
  heat_source           ENUM('sensor', 'visual', 'both'),
  
  -- 配种阶段
  insemination_date     DATETIME,
  insemination_number   INT DEFAULT 1,              -- 第几次配种
  bull_id               VARCHAR(36),                -- 种公牛ID
  semen_batch           VARCHAR(50),
  insemination_method   ENUM('自然交配', '人工授精'),
  technician_id         VARCHAR(36),
  
  -- 妊检阶段
  pregnancy_check_date  DATETIME,
  pregnancy_check_method ENUM('B超', '直肠检查', '激素检测'),
  pregnancy_result      ENUM('阳性', '阴性', '可疑'),
  
  -- 妊娠阶段
  pregnancy_confirmed_date DATETIME,
  expected_due_date     DATE,
  actual_calving_date   DATE,
  gestation_days        INT,                        -- 妊娠天数
  
  -- 产犊阶段
  calving_result        ENUM('顺产', '难产', '流产', '死胎'),
  calf_count            INT DEFAULT 1,
  calf_details          JSON,                       -- 犊牛详情数组
  
  -- 干奶阶段
  dry_off_date          DATE,
  dry_off_reason        ENUM('自然干奶', '强制干奶', '疾病干奶'),
  last_milking_date     DATE,
  dry_period_days       INT,
  
  -- 周期结果
  cycle_result          ENUM('pregnant', 'not_pregnant', 'aborted', 'ongoing', 'dry'),
  cycle_length          INT,                        -- 周期长度(天)
  
  -- 繁殖效率指标
  days_open             INT,                        -- 空怀天数
  services_per_conception INT DEFAULT 1,            -- 每次受胎配种次数
  
  notes                 TEXT,
  created_at            DATETIME NOT NULL,
  updated_at            DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  FOREIGN KEY (bull_id) REFERENCES cows(id) ON DELETE SET NULL,
  FOREIGN KEY (technician_id) REFERENCES persons(id) ON DELETE SET NULL,
  
  INDEX idx_cow_cycle (cow_id, cycle_number),
  INDEX idx_insemination (insemination_date),
  INDEX idx_calving (actual_calving_date),
  INDEX idx_result (cycle_result)
)

-- 种公牛档案表
breeding_bulls (
  id                  VARCHAR(36) PRIMARY KEY,
  cow_id              VARCHAR(36) NOT NULL,         -- 关联 cows 表
  bull_number         VARCHAR(20) UNIQUE NOT NULL,
  
  -- 遗传评估
  genetic_merit       DECIMAL(8,4),                 -- 遗传评价值
  breeding_value_milk DECIMAL(8,4),                 -- 产奶量育种值
  breeding_value_fat  DECIMAL(8,4),                 -- 乳脂育种值
  breeding_value_protein DECIMAL(8,4),              -- 乳蛋白育种值
  breeding_value_fertility DECIMAL(8,4),            -- 繁殖力育种值
  
  -- 精液信息
  semen_available     BOOLEAN DEFAULT true,
  semen_inventory     INT DEFAULT 0,                -- 精液库存(支)
  semen_quality_score DECIMAL(5,2),
  
  -- 使用统计
  total_inseminations INT DEFAULT 0,                -- 总配种次数
  conception_rate     DECIMAL(5,2),                 -- 受胎率
  daughters_count     INT DEFAULT 0,                -- 女儿数量
  
  is_active           BOOLEAN DEFAULT true,
  retirement_date     DATE,
  notes               TEXT,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  
  INDEX idx_bull_number (bull_number),
  INDEX idx_genetic_merit (genetic_merit DESC)
)

-- 繁殖效率 KPI 表
reproduction_kpis (
  id                  VARCHAR(36) PRIMARY KEY,
  period              VARCHAR(20) NOT NULL,          -- 统计周期(月度/季度/年度)
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  
  -- 发情指标
  heat_detection_rate DECIMAL(5,2),                  -- 发情检测率(%)
  avg_heat_interval   DECIMAL(5,2),                  -- 平均发情间隔(天)
  
  -- 配种指标
  conception_rate     DECIMAL(5,2),                  -- 受胎率(%)
  avg_services_per_conception DECIMAL(5,2),          -- 平均配种次数
  first_service_conception_rate DECIMAL(5,2),        -- 一次性受胎率(%)
  
  -- 妊娠指标
  pregnancy_rate      DECIMAL(5,2),                  -- 妊娠率(%)
  abortion_rate       DECIMAL(5,2),                  -- 流产率(%)
  
  -- 分娩指标
  avg_calving_interval DECIMAL(6,2),                 -- 平均分娩间隔(天)
  calving_rate        DECIMAL(5,2),                  -- 分娩率(%)
  calf_survival_rate  DECIMAL(5,2),                  -- 犊牛成活率(%)
  twinning_rate       DECIMAL(5,2),                  -- 双胞胎率(%)
  
  -- 综合指标
  reproductive_efficiency DECIMAL(5,2),              -- 繁殖效率评分(0-100)
  target_achievement  DECIMAL(5,2),                  -- 目标达成率(%)
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_period (period),
  INDEX idx_period_dates (period_start, period_end)
)
```

### 域 5：产奶与泌乳 (Milk & Lactation)

```sql
-- 产奶记录表
milk_records (
  id                  VARCHAR(36) PRIMARY KEY,
  cow_id              VARCHAR(36) NOT NULL,
  milking_time        DATETIME NOT NULL,
  volume              DECIMAL(8,3) NOT NULL,          -- 产奶量(L)
  lactation_number    INT NOT NULL,                   -- 泌乳胎次
  days_in_milk        INT NOT NULL,                   -- 泌乳天数
  
  -- 乳成分
  fat_percent         DECIMAL(5,2),                   -- 乳脂率(%)
  protein_percent     DECIMAL(5,2),                   -- 乳蛋白率(%)
  lactose_percent     DECIMAL(5,2),                   -- 乳糖率(%)
  scc                   INT,                          -- 体细胞数(个/ml)
  urea_mgdl           DECIMAL(5,1),                   -- 尿素(mg/dl)
  freezing_point      DECIMAL(6,3),                   -- 冰点(°C)
  milk_grade          ENUM('A', 'B', 'C'),            -- 奶质等级
  
  -- 挤奶方式
  milking_method      ENUM('manual', 'automatic'),
  milker_id           VARCHAR(36),                    -- 挤奶员ID
  equipment_id        VARCHAR(36),                    -- 设备ID
  
  -- 挤奶效率
  milking_duration    INT,                            -- 挤奶时长(分钟)
  flow_rate_peak      DECIMAL(6,3),                   -- 峰值流速(kg/min)
  flow_rate_avg       DECIMAL(6,3),                   -- 平均流速(kg/min)
  
  notes               TEXT,
  created_at          DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  
  INDEX idx_cow_milk_time (cow_id, milking_time),
  INDEX idx_milk_time (milking_time),
  INDEX idx_lactation (cow_id, lactation_number)
)

-- 泌乳曲线表
lactation_curves (
  id                  VARCHAR(36) PRIMARY KEY,
  cow_id              VARCHAR(36) NOT NULL,
  lactation_number    INT NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE,
  
  -- 曲线参数（Wood 模型）
  peak_production     DECIMAL(8,3),                   -- 峰值产奶量
  peak_day            INT,                            -- 峰值天数
  peak_date           DATE,
  total_production    DECIMAL(10,3),                  -- 总产奶量(L)
  avg_production      DECIMAL(8,3),                   -- 日均产奶量
  persistency         DECIMAL(5,2),                   -- 泌乳持久性(%)
  
  -- 曲线拟合参数
  wood_a              DECIMAL(8,4),                   -- Wood 模型参数 a
  wood_b              DECIMAL(8,4),                   -- Wood 模型参数 b
  wood_c              DECIMAL(8,4),                   -- Wood 模型参数 c
  r_squared           DECIMAL(5,4),                   -- 拟合度
  
  curve_data          JSON,                           -- 每日产奶量曲线数据
  notes               TEXT,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  
  INDEX idx_cow_lactation (cow_id, lactation_number)
)

-- 奶质标准表
milk_quality_standards (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(20) UNIQUE NOT NULL,    -- 标准代码
  name                VARCHAR(50) NOT NULL,           -- 标准名称
  
  fat_min             DECIMAL(5,2),
  fat_max             DECIMAL(5,2),
  protein_min         DECIMAL(5,2),
  protein_max         DECIMAL(5,2),
  lactose_min         DECIMAL(5,2),
  lactose_max         DECIMAL(5,2),
  scc_max             INT,
  urea_max            DECIMAL(5,1),
  freezing_point_min  DECIMAL(6,3),
  freezing_point_max  DECIMAL(6,3),
  
  description         TEXT,
  is_active           BOOLEAN DEFAULT true,
  
  INDEX idx_code (code)
)
```

### 域 6：饲料与营养 (Feed & Nutrition)

```sql
-- 饲料配方表
feed_formulas (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(20) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  description         TEXT,
  target_group        ENUM('dry', 'fresh', 'lactating', 'heifer', 'calf'),
  
  -- 营养成分
  energy_mcal         DECIMAL(6,3),                   -- 能量(Mcal/kg)
  protein_percent     DECIMAL(5,2),                   -- 粗蛋白(%)
  fiber_percent       DECIMAL(5,2),                   -- 粗纤维(%)
  calcium_percent     DECIMAL(5,2),                   -- 钙(%)
  phosphorus_percent  DECIMAL(5,2),                   -- 磷(%)
  vitamins            JSON,                            -- 维生素含量
  minerals            JSON,                            -- 矿物质含量
  
  -- 配方组成
  ingredients         JSON NOT NULL,                   -- 配方成分数组
  /*
    [
      {"feed_id": "f1", "feed_name": "玉米青贮", "proportion": 40, "cost": 0.8},
      {"feed_id": "f2", "feed_name": "苜蓿草", "proportion": 15, "cost": 2.5}
    ]
  */
  
  total_cost          DECIMAL(8,2),                   -- 配方总成本(元/kg)
  expected_production DECIMAL(8,2),                   -- 预期产奶量提升(%)
  is_active           BOOLEAN DEFAULT true,
  created_at          DATETIME,
  updated_at          DATETIME
)

-- 饲喂记录表
feed_records (
  id                  VARCHAR(36) PRIMARY KEY,
  pen_id              VARCHAR(36) NOT NULL,           -- 圈舍ID
  formula_id          VARCHAR(36) NOT NULL,           -- 配方ID
  feeding_time        DATETIME NOT NULL,
  
  planned_amount      DECIMAL(10,2),                  -- 计划投喂量(kg)
  actual_amount       DECIMAL(10,2),                  -- 实际投喂量(kg)
  feeder_id           VARCHAR(36),                    -- 饲喂员ID
  
  -- 饲料质量
  moisture_percent    DECIMAL(5,2),                   -- 水分(%)
  contamination_score DECIMAL(3,1),                   -- 污染度(0-10)
  palatability_score  DECIMAL(3,1),                   -- 适口性(0-10)
  
  notes               TEXT,
  created_at          DATETIME NOT NULL,
  
  FOREIGN KEY (pen_id) REFERENCES pens(id) ON DELETE RESTRICT,
  FOREIGN KEY (formula_id) REFERENCES feed_formulas(id) ON DELETE RESTRICT,
  
  INDEX idx_pen_time (pen_id, feeding_time),
  INDEX idx_feeding_time (feeding_time)
)

-- 饲料库存表
feed_inventory (
  id                  VARCHAR(36) PRIMARY KEY,
  feed_code           VARCHAR(30) UNIQUE NOT NULL,
  feed_name           VARCHAR(100) NOT NULL,
  category            ENUM('粗饲料', '精饲料', '添加剂', '青贮'),
  
  current_stock       DECIMAL(12,2),                  -- 当前库存(kg)
  minimum_stock       DECIMAL(12,2),                  -- 最低库存(kg)
  unit_cost           DECIMAL(8,2),                   -- 单价(元/kg)
  
  supplier            VARCHAR(100),
  supplier_contact    VARCHAR(50),
  
  batch_number        VARCHAR(50),
  production_date     DATE,
  expiry_date         DATE,
  
  quality_grade       ENUM('A', 'B', 'C'),
  storage_location    VARCHAR(100),
  
  last_updated        DATETIME NOT NULL,
  created_at          DATETIME NOT NULL,
  
  INDEX idx_category (category),
  INDEX idx_expiry (expiry_date),
  INDEX idx_stock_level (current_stock)
)
```

### 域 7：健康与预警 (Health & Alert)

```sql
-- 健康评分表
health_scores (
  id                  VARCHAR(36) PRIMARY KEY,
  cow_id              VARCHAR(36) NOT NULL,
  timestamp           DATETIME NOT NULL,
  
  -- 综合评分
  overall_score       DECIMAL(5,2) NOT NULL,          -- 综合健康评分(0-100)
  risk_level          ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  
  -- 各维度评分
  temperature_score   DECIMAL(5,2),
  activity_score      DECIMAL(5,2),
  rumination_score    DECIMAL(5,2),
  feeding_score       DECIMAL(5,2),
  reproduction_score  DECIMAL(5,2),
  vital_signs_score   DECIMAL(5,2),
  
  -- 预警信息
  alert_ids           JSON,                            -- 关联的预警ID列表
  
  -- 建议措施
  recommendations     JSON,                            -- 建议措施列表
  
  -- 预测
  prediction_24h      DECIMAL(5,2),                    -- 24h健康趋势预测
  prediction_7d       DECIMAL(5,2),                    -- 7天健康趋势预测
  
  created_at          DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  
  INDEX idx_cow_time (cow_id, timestamp),
  INDEX idx_risk (risk_level),
  INDEX idx_score (overall_score)
)

-- 健康预警表
health_alerts (
  id                  VARCHAR(36) PRIMARY KEY,
  cow_id              VARCHAR(36) NOT NULL,
  
  alert_type          ENUM(
    'temperature', 'activity', 'rumination', 'feeding',
    'vital_signs', 'behavior', 'disease', 'custom'
  ) NOT NULL,
  severity            ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  
  trigger_value       DECIMAL(10,4),                  -- 触发值
  threshold           DECIMAL(10,4),                  -- 阈值
  
  status              ENUM('active', 'resolved', 'acknowledged'),
  acknowledged_by     VARCHAR(36),
  acknowledged_at     DATETIME,
  resolved_at         DATETIME,
  
  created_at          DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  
  INDEX idx_cow_alert (cow_id, status),
  INDEX idx_severity (severity),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
)

-- 健康阈值配置表
health_thresholds (
  id                  VARCHAR(36) PRIMARY KEY,
  metric              VARCHAR(50) NOT NULL,           -- 监测指标
  cow_type            VARCHAR(30),                     -- 牛只类型
  season              ENUM('spring', 'summer', 'autumn', 'winter'),
  physiological_stage VARCHAR(30),                     -- 生理阶段
  
  warning_low         DECIMAL(10,4),
  warning_high        DECIMAL(10,4),
  critical_low        DECIMAL(10,4),
  critical_high       DECIMAL(10,4),
  
  baseline_period     INT,                             -- 基准期(天)
  adaptation_rate     DECIMAL(5,3),                    -- 适应率
  sensitivity         DECIMAL(5,3),                    -- 敏感度
  
  is_active           BOOLEAN DEFAULT true,
  last_updated        DATETIME NOT NULL,
  
  INDEX idx_metric (metric),
  INDEX idx_active (is_active)
)

-- 疾病字典表
diseases (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  category            ENUM('呼吸系统', '消化系统', '繁殖系统', '代谢疾病', '传染病', '外伤', '其他'),
  description         TEXT,
  symptoms            TEXT,
  treatment_protocol  TEXT,
  prevention          TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_at          DATETIME
)

-- 药品字典表
medicines (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  category            ENUM('抗生素', '疫苗', '驱虫药', '营养补充剂', '外用药', '其他'),
  dosage_unit         VARCHAR(20),                     -- 剂量单位
  storage_requirement TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_at          DATETIME
)
```

### 域 8：组学与遗传 (Omics & Genetics)

```sql
-- 组学样本表
omics_samples (
  id                  VARCHAR(36) PRIMARY KEY,
  sample_code         VARCHAR(30) UNIQUE NOT NULL,
  cow_id              VARCHAR(36),
  cow_number          VARCHAR(20),
  sample_type         ENUM('blood', 'milk', 'hair_follicle', 'tissue', 'semen', 'rumen_fluid', 'other'),
  
  collection_date     DATE,
  received_date       DATE,
  storage_location    VARCHAR(100),
  source_tissue       VARCHAR(100),
  collector           VARCHAR(50),
  
  status              ENUM('planned', 'collected', 'processing', 'sequenced', 'archived'),
  quality_score       DECIMAL(5,2),
  integrity_score     DECIMAL(5,2),
  
  phenotype_links     JSON,                            -- 表型关联
  metadata            JSON,
  notes               TEXT,
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  INDEX idx_sample_code (sample_code),
  INDEX idx_cow (cow_id),
  INDEX idx_type (sample_type),
  INDEX idx_status (status)
)

-- 组学数据集表
omics_datasets (
  id                  VARCHAR(36) PRIMARY KEY,
  dataset_code        VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(200) NOT NULL,
  data_type           ENUM('genome', 'genotype', 'transcriptome', 'metabolome', 'microbiome', 'phenotype'),
  platform            ENUM('wgs', 'chip', 'rna_seq', 'lc_ms', '16s', 'custom'),
  reference_genome    VARCHAR(100),
  source_lab          VARCHAR(200),
  
  sample_ids          JSON,                            -- 样本ID列表
  sample_count        INT NOT NULL,
  record_count        INT,
  release_version     VARCHAR(20),
  quality_metrics     JSON,
  tags                JSON,                            -- 标签
  
  status              ENUM('draft', 'processing', 'ready', 'published'),
  generated_at        DATETIME,
  published_at        DATETIME,
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  INDEX idx_dataset_code (dataset_code),
  INDEX idx_data_type (data_type),
  INDEX idx_status (status)
)

-- 组学标记表
omics_markers (
  id                  VARCHAR(36) PRIMARY KEY,
  dataset_id          VARCHAR(36) NOT NULL,
  marker_code         VARCHAR(50) NOT NULL,
  marker_type         ENUM('snp', 'indel', 'gene', 'transcript', 'cnv', 'protein'),
  
  chromosome          VARCHAR(10),
  position_bp         BIGINT,
  gene_symbol         VARCHAR(50),
  reference_allele    VARCHAR(10),
  alternate_allele    VARCHAR(10),
  effect_type         VARCHAR(50),
  trait               VARCHAR(100),
  
  maf                 DECIMAL(6,4),                    -- 最小等位基因频率
  p_value             DECIMAL(20,18),
  effect_size         DECIMAL(10,6),
  evidence_level      ENUM('candidate', 'validated', 'reported'),
  
  payload             JSON,
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  FOREIGN KEY (dataset_id) REFERENCES omics_datasets(id) ON DELETE CASCADE,
  
  INDEX idx_dataset (dataset_id),
  INDEX idx_chromosome (chromosome),
  INDEX idx_trait (trait)
)

-- 多组学关联表
multi_omics_associations (
  id                  VARCHAR(36) PRIMARY KEY,
  title               VARCHAR(200) NOT NULL,
  trait               VARCHAR(100) NOT NULL,
  primary_dataset_id  VARCHAR(36) NOT NULL,
  secondary_dataset_id VARCHAR(36),
  association_type    ENUM('genome_transcriptome', 'genome_phenotype', 'transcriptome_phenotype', 'multi_trait'),
  
  method              VARCHAR(100),
  sample_size         INT,
  significance        DECIMAL(20,18),
  effect_size         DECIMAL(10,6),
  
  candidate_genes     JSON,                            -- 候选基因列表
  candidate_markers   JSON,                            -- 候选标记列表
  
  visualization_type  ENUM('network', 'heatmap', 'manhattan', 'scatter'),
  conclusion          TEXT,
  payload             JSON,
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  INDEX idx_trait (trait),
  INDEX idx_primary (primary_dataset_id)
)

-- 育种分析表
breeding_analyses (
  id                  VARCHAR(36) PRIMARY KEY,
  analysis_code       VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(200) NOT NULL,
  target_trait        VARCHAR(100) NOT NULL,
  dataset_ids         JSON NOT NULL,                   -- 数据集ID列表
  model_type          ENUM('gblup', 'ssgblup', 'bayes', 'random_forest', 'custom'),
  
  population_size     INT,
  heritability        DECIMAL(6,4),
  reliability         DECIMAL(6,4),
  predicted_gain      DECIMAL(8,4),
  selection_index     JSON,                            -- 选择指数
  
  top_candidates      JSON,                            -- 候选排名
  status              ENUM('draft', 'running', 'completed'),
  summary             TEXT,
  executed_at         DATETIME,
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  INDEX idx_analysis_code (analysis_code),
  INDEX idx_status (status)
)
```

### 域 9：经济与运营 (Economic & Operations)

```sql
-- 成本记录表
cost_items (
  id                  VARCHAR(36) PRIMARY KEY,
  category            ENUM('饲料', '兽医', '人工', '设备', '水电', '其他') NOT NULL,
  name                VARCHAR(200) NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  unit                VARCHAR(20),
  date                DATE NOT NULL,
  cow_id              VARCHAR(36),                     -- 关联牛只（可选）
  description         TEXT,
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_category_date (category, date),
  INDEX idx_date (date),
  INDEX idx_cow (cow_id)
)

-- 生产经营收入记录表
revenue_items (
  id                  VARCHAR(36) PRIMARY KEY,
  category            ENUM('鲜奶结算', '淘汰牛处置', '犊牛转出', '粪肥资源化', '其他') NOT NULL,
  name                VARCHAR(200) NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  unit                VARCHAR(20),
  quantity            DECIMAL(12,3),
  unit_price          DECIMAL(12,2),
  date                DATE NOT NULL,
  cow_id              VARCHAR(36),
  description         TEXT,
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_category_date (category, date),
  INDEX idx_date (date)
)

-- 经济分析汇总表
economic_analysis (
  id                  VARCHAR(36) PRIMARY KEY,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  period_type         ENUM('monthly', 'quarterly', 'yearly'),
  
  total_revenue       DECIMAL(14,2),
  total_cost          DECIMAL(14,2),
  gross_profit        DECIMAL(14,2),
  net_profit          DECIMAL(14,2),
  profit_margin       DECIMAL(6,2),                    -- 利润率(%)
  roi                 DECIMAL(6,2),                    -- 投资回报率(%)
  break_even_point    DECIMAL(14,2),
  
  cost_breakdown      JSON,                            -- 成本明细
  revenue_breakdown   JSON,                            -- 收入明细
  
  -- 关键指标
  cost_per_liter      DECIMAL(8,3),                    -- 每升奶成本
  revenue_per_cow     DECIMAL(10,2),                   -- 每头牛收入
  feed_cost_ratio     DECIMAL(5,2),                    -- 饲料成本占比
  vet_cost_ratio      DECIMAL(5,2),                    -- 兽医成本占比
  labor_cost_ratio    DECIMAL(5,2),                    -- 人工成本占比
  
  trends              JSON,                            -- 趋势数据
  benchmarks          JSON,                            -- 行业对标
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_period (period_start, period_end)
)

-- 预算计划表
budget_plans (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  
  budget_items        JSON NOT NULL,
  /*
    [
      {"category": "饲料", "planned_amount": 500000, "actual_amount": 480000},
      {"category": "兽医", "planned_amount": 100000, "actual_amount": 95000}
    ]
  */
  total_planned       DECIMAL(14,2) NOT NULL,
  total_actual        DECIMAL(14,2),
  status              ENUM('draft', 'approved', 'active', 'completed'),
  
  created_by          VARCHAR(36),
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL
)

-- KPI 指标定义表
kpi_metrics (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  display_name        VARCHAR(100),
  description         TEXT,
  category            ENUM('生产配置', 'reproduction', 'health', 'economic', 'efficiency'),
  unit                VARCHAR(30),
  
  target_value        DECIMAL(12,4),
  warning_threshold   DECIMAL(12,4),
  critical_threshold  DECIMAL(12,4),
  trend               ENUM('up', 'down', 'stable'),
  
  calculation_method  TEXT,                            -- 计算公式
  data_sources        JSON,                            -- 数据来源表
  
  update_frequency    ENUM('real-time', 'hourly', 'daily', 'weekly', 'monthly'),
  last_updated        DATETIME,
  
  INDEX idx_category (category),
  INDEX idx_code (code)
)

-- KPI 看板定义表
kpi_dashboards (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  category            ENUM('overview', '生产配置', 'reproduction', 'health', 'economic'),
  
  metric_ids          JSON NOT NULL,                   -- KPI指标ID列表
  layout              JSON,                            -- 布局配置
  
  is_public           BOOLEAN DEFAULT false,
  created_by          VARCHAR(36),
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  INDEX idx_category (category)
)
```

### 域 10：预测与 AI (Prediction & AI)

```sql
-- 预测模型表
predictive_models (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  type                ENUM('生产配置', 'health', 'economic', 'reproduction'),
  algorithm           ENUM('linear_regression', 'random_forest', 'neural_network', 'time_series'),
  target_variable     VARCHAR(100) NOT NULL,
  feature_variables   JSON NOT NULL,
  
  -- 训练信息
  training_start_date DATE,
  training_end_date   DATE,
  sample_size         INT,
  
  -- 性能指标
  accuracy            DECIMAL(5,4),
  precision           DECIMAL(5,4),
  recall              DECIMAL(5,4),
  f1_score            DECIMAL(5,4),
  mse                 DECIMAL(10,6),
  rmse                DECIMAL(10,6),
  
  status              ENUM('training', 'ready', 'failed'),
  last_trained        DATETIME,
  next_training       DATETIME,
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_type (type),
  INDEX idx_status (status)
)

-- 预测结果表
prediction_results (
  id                  VARCHAR(36) PRIMARY KEY,
  model_id            VARCHAR(36) NOT NULL,
  target_date         DATE NOT NULL,
  predicted_value     DECIMAL(12,4),
  
  -- 置信区间
  confidence_lower    DECIMAL(12,4),
  confidence_upper    DECIMAL(12,4),
  confidence_level    DECIMAL(4,2),                    -- 置信度(%)
  
  actual_value        DECIMAL(12,4),                   -- 实际值（回填）
  accuracy            DECIMAL(5,4),                    -- 预测准确度
  
  -- 影响因素
  factors             JSON,
  /*
    [
      {"variable": "temperature", "value": 38.5, "impact": 0.3, "contribution": 0.15},
      {"variable": "rumination", "value": 45, "impact": -0.2, "contribution": -0.1}
    ]
  */
  
  generated_at        DATETIME NOT NULL,
  
  FOREIGN KEY (model_id) REFERENCES predictive_models(id) ON DELETE CASCADE,
  
  INDEX idx_model_date (model_id, target_date)
)

-- 预测场景表
forecast_scenarios (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  base_date           DATE NOT NULL,
  time_horizon        INT NOT NULL,                    -- 预测天数
  
  assumptions         JSON NOT NULL,
  /*
    [
      {"variable": "feed_price", "current_value": 2.5, "assumed_value": 2.8, "change_percent": 12},
      {"variable": "milk_price", "current_value": 4.2, "assumed_value": 4.5, "change_percent": 7}
    ]
  */
  
  results             JSON,                            -- 预测结果时序
  risk_level          ENUM('low', 'medium', 'high'),
  recommendations     JSON,                            -- 建议措施
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_base_date (base_date)
)

-- 预测预警表
predictive_alerts (
  id                  VARCHAR(36) PRIMARY KEY,
  type                ENUM('production_drop', 'health_risk', 'economic_warning', 'reproduction_issue'),
  severity            ENUM('low', 'medium', 'high', 'critical'),
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  
  predicted_date      DATE,
  probability         DECIMAL(5,4),                    -- 发生概率
  
  -- 影响评估
  affected_cows       INT,
  potential_loss      DECIMAL(12,2),
  time_to_impact      INT,                             -- 距影响时间(天)
  
  recommendations     JSON,
  model_id            VARCHAR(36),
  
  status              ENUM('active', 'acknowledged', 'resolved'),
  acknowledged_at     DATETIME,
  resolved_at         DATETIME,
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_severity (severity),
  INDEX idx_status (status),
  INDEX idx_predicted (predicted_date)
)
```

### 域 11：硬件与集成 (Hardware & Integration)

```sql
-- 硬件设备表
hardware_devices (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  type                ENUM('milking_robot', 'feed_robot', 'temperature_sensor', 'activity_monitor', 'scale', 'gate', 'camera', 'other'),
  brand               VARCHAR(100),
  model               VARCHAR(100),
  serial_number       VARCHAR(100),
  
  location_pen_id     VARCHAR(36),
  location_coordinates JSON,                            -- GPS坐标
  
  status              ENUM('online', 'offline', 'maintenance', 'error'),
  last_seen           DATETIME,
  firmware_version    VARCHAR(30),
  
  capabilities        JSON,                            -- 设备能力
  configuration       JSON,
  
  installed_at        DATETIME,
  warranty_expiry     DATE,
  
  -- 维护计划
  maintenance_frequency ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly'),
  next_maintenance    DATE,
  maintenance_tasks   JSON,
  
  INDEX idx_status (status),
  INDEX idx_type (type)
)

-- 集成协议表
integration_protocols (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  type                ENUM('api', 'mqtt', 'modbus', 'opc_ua', 'custom'),
  version             VARCHAR(20),
  description         TEXT,
  
  endpoints           JSON,
  data_format         ENUM('json', 'xml', 'binary', 'csv'),
  supported_devices   JSON,
  
  is_active           BOOLEAN DEFAULT true,
  last_used           DATETIME,
  success_rate        DECIMAL(5,4),
  
  INDEX idx_type (type)
)

-- 数据同步记录表
data_synchronizations (
  id                  VARCHAR(36) PRIMARY KEY,
  protocol_id         VARCHAR(36),
  source_device       VARCHAR(200),
  target_system       VARCHAR(200),
  data_type           VARCHAR(100),
  
  sync_frequency      ENUM('real-time', 'per_shift', 'hourly', 'daily', 'weekly'),
  last_sync           DATETIME,
  next_sync           DATETIME,
  status              ENUM('active', 'paused', 'error', 'running', 'completed'),
  
  records_processed   INT,
  success_rate        DECIMAL(5,4),
  error_count         INT,
  
  configuration       JSON,
  
  INDEX idx_status (status),
  INDEX idx_last_sync (last_sync)
)

-- 设备维护记录表
device_maintenance (
  id                  VARCHAR(36) PRIMARY KEY,
  device_id           VARCHAR(36) NOT NULL,
  type                ENUM('preventive', 'corrective', 'predictive'),
  title               VARCHAR(200) NOT NULL,
  description         TEXT,
  
  scheduled_date      DATE,
  completed_date      DATE,
  technician          VARCHAR(100),
  
  parts_used          JSON,
  labor_hours         DECIMAL(6,2),
  total_cost          DECIMAL(10,2),
  
  status              ENUM('scheduled', 'in_progress', 'completed', 'cancelled'),
  priority            ENUM('low', 'medium', 'high', 'critical'),
  notes               TEXT,
  
  INDEX idx_device (device_id),
  INDEX idx_status (status),
  INDEX idx_scheduled (scheduled_date)
)
```

### 域 12：自动化与工作流 (Automation & Workflow)

```sql
-- 工作流模板表
workflow_templates (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  category            ENUM('health', 'reproduction', '生产配置', 'maintenance'),
  
  trigger_type        ENUM('manual', 'scheduled', 'event', 'condition'),
  trigger_condition   JSON,
  
  steps               JSON NOT NULL,
  /*
    [
      {
        "id": "step1",
        "name": "发送通知",
        "step_type": "notification",
        "config": {"recipients": ["张三"], "message": "牛只体温异常", "urgency": "high"},
        "timeout": 30,
        "retry_count": 2,
        "on_failure": "retry"
      }
    ]
  */
  
  is_active           BOOLEAN DEFAULT true,
  priority            ENUM('low', 'medium', 'high', 'critical'),
  
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  INDEX idx_category (category),
  INDEX idx_trigger (trigger_type)
)

-- 工作流实例表
workflow_instances (
  id                  VARCHAR(36) PRIMARY KEY,
  template_id         VARCHAR(36) NOT NULL,
  cow_id              VARCHAR(36),
  
  status              ENUM('pending', 'running', 'completed', 'failed', 'cancelled'),
  current_step        VARCHAR(36),
  step_status         JSON,                            -- 各步骤状态
  
  variables           JSON,                            -- 流程变量
  trigger_event       JSON,
  
  started_at          DATETIME,
  completed_at        DATETIME,
  
  created_at          DATETIME NOT NULL,
  
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE,
  
  INDEX idx_template (template_id),
  INDEX idx_status (status),
  INDEX idx_cow (cow_id)
)

-- 自动化动作表
automated_actions (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  action_type         ENUM('transfer', 'notification', 'treatment', 'feeding', 'inspection'),
  
  trigger_condition   JSON NOT NULL,
  target_config       JSON NOT NULL,
  
  is_active           BOOLEAN DEFAULT true,
  priority            ENUM('low', 'medium', 'high', 'critical'),
  cooldown            INT,                             -- 冷却时间(分钟)
  
  last_executed       DATETIME,
  execution_count     INT DEFAULT 0,
  success_rate        DECIMAL(5,4),
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_type (action_type),
  INDEX idx_active (is_active)
)

-- 智能转群规则表
smart_transfer_rules (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  
  trigger_event       ENUM('pregnancy_confirmed', 'calving_due', 'heat_detected', 'health_alert', 'production_drop'),
  trigger_parameters  JSON,
  
  source_pen_ids      JSON,                            -- 源圈舍列表
  target_pen_id       VARCHAR(36) NOT NULL,
  transfer_reason     VARCHAR(200),
  
  auto_execute        BOOLEAN DEFAULT false,
  requires_approval   BOOLEAN DEFAULT true,
  priority            ENUM('low', 'medium', 'high'),
  
  is_active           BOOLEAN DEFAULT true,
  execution_count     INT DEFAULT 0,
  last_executed       DATETIME,
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_trigger (trigger_event),
  INDEX idx_active (is_active)
)

-- 提醒规则表
reminder_rules (
  id                  VARCHAR(36) PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  reminder_type       ENUM('vaccination', 'pregnancy_check', 'dry_period', 'heat_cycle', 'treatment', 'inspection'),
  
  target_condition    JSON,
  schedule            JSON NOT NULL,
  notification        JSON NOT NULL,
  actions             JSON,
  
  is_active           BOOLEAN DEFAULT true,
  last_triggered      DATETIME,
  trigger_count       INT DEFAULT 0,
  
  created_at          DATETIME NOT NULL,
  
  INDEX idx_type (reminder_type),
  INDEX idx_active (is_active)
)
```

### 域 13：审计与系统 (Audit & System)

```sql
-- 导出审计日志表
export_audit_logs (
  id                  VARCHAR(36) PRIMARY KEY,
  operator            VARCHAR(100),
  action_type         VARCHAR(50) NOT NULL,
  status              ENUM('pending', 'running', 'completed', 'failed'),
  
  file_name           VARCHAR(500),
  file_hash           VARCHAR(64),                     -- SHA-256
  file_format         ENUM('xlsx', 'csv'),
  row_count           INT,
  
  filters_json        JSON,
  parameters_json     JSON,
  result_snapshot     JSON,
  
  cow_ids             JSON,
  relation_scope      JSON,
  source_record_ids   JSON,
  
  started_at          DATETIME,
  finished_at         DATETIME,
  duration_ms         INT,
  
  created_at          DATETIME,
  updated_at          DATETIME,
  
  INDEX idx_action (action_type),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
)

-- 操作审计日志表
operation_audit_logs (
  id                  VARCHAR(36) PRIMARY KEY,
  action_type         VARCHAR(50) NOT NULL,
  target_type         VARCHAR(50),
  target_id           VARCHAR(36),
  operator            VARCHAR(100),
  status              ENUM('success', 'failed'),
  
  request_payload     JSON,
  result_payload      JSON,
  cow_ids             JSON,
  relation_scope      JSON,
  source_record_ids   JSON,
  
  created_at          DATETIME,
  updated_at          DATETIME,
  
  INDEX idx_action (action_type),
  INDEX idx_operator (operator),
  INDEX idx_created (created_at)
)

-- 硬件命令日志表
hardware_command_logs (
  id                  VARCHAR(36) PRIMARY KEY,
  device_id           VARCHAR(36),
  command_type        VARCHAR(50),
  operator            VARCHAR(100),
  status              ENUM('sent', 'acknowledged', 'completed', 'failed'),
  
  command_payload     JSON,
  response_payload    JSON,
  
  requested_at        DATETIME,
  completed_at        DATETIME,
  
  INDEX idx_device (device_id),
  INDEX idx_status (status)
)

-- 育种决策运行记录表
breeding_decision_runs (
  id                  VARCHAR(36) PRIMARY KEY,
  run_type            VARCHAR(50),
  operator            VARCHAR(100),
  status              ENUM('running', 'completed', 'failed'),
  
  input_parameters    JSON,
  results             JSON,
  
  created_at          DATETIME,
  
  INDEX idx_run_type (run_type),
  INDEX idx_status (status)
)
```

### 域 14：表型与基础信息 (Phenotype & Base Info)

```sql
-- 表型性状定义表
phenotype_trait_definitions (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  category            ENUM('产奶性状', '体型性状', '繁殖性状', '健康性状', '饲料效率', '其他'),
  
  data_type           ENUM('数值', '等级', '布尔', '分类'),
  unit                VARCHAR(20),
  min_value           DECIMAL(12,4),
  max_value           DECIMAL(12,4),
  
  required_fields     JSON,
  linked_domains      JSON,
  
  description         TEXT,
  status              ENUM('active', 'deprecated'),
  
  INDEX idx_code (code),
  INDEX idx_category (category)
)

-- 表型记录表
phenotype_records (
  id                  VARCHAR(36) PRIMARY KEY,
  cow_id              VARCHAR(36) NOT NULL,
  cow_number          VARCHAR(20),
  trait_code          VARCHAR(30) NOT NULL,
  
  collection_date     DATE NOT NULL,
  value               DECIMAL(12,4),
  value_category      VARCHAR(50),                     -- 分类值
  
  measurement_method  VARCHAR(100),
  technician          VARCHAR(100),
  
  cow_age             INT,                             -- 测量时年龄(天)
  parity              INT,                             -- 测量时胎次
  days_in_milk        INT,                             -- 测量时泌乳天数
  
  pedigree_linked     BOOLEAN DEFAULT false,
  omics_linked        BOOLEAN DEFAULT false,
  
  notes               TEXT,
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  
  FOREIGN KEY (cow_id) REFERENCES cows(id) ON DELETE CASCADE,
  FOREIGN KEY (trait_code) REFERENCES phenotype_trait_definitions(code) ON DELETE RESTRICT,
  
  INDEX idx_cow_trait (cow_id, trait_code),
  INDEX idx_collection (collection_date),
  INDEX idx_trait (trait_code)
)

-- 表型导出方法表
phenotype_export_methods (
  id                  VARCHAR(36) PRIMARY KEY,
  code                VARCHAR(30) UNIQUE NOT NULL,
  name                VARCHAR(100) NOT NULL,
  group_by            ENUM('raw', 'daily', 'weekly', 'monthly', 'lactation'),
  time_granularity    VARCHAR(20),
  lactation_window_days INT DEFAULT 305,
  
  description         TEXT,
  status              ENUM('active', 'deprecated'),
  
  INDEX idx_code (code)
)

-- 基础信息分类表
base_info_categories (
  id                  VARCHAR(36) PRIMARY KEY,
  scope               VARCHAR(50) NOT NULL,             -- 所属模块
  name                VARCHAR(100) NOT NULL,
  description         TEXT,
  sort_order          INT DEFAULT 0,
  
  INDEX idx_scope (scope)
)
```

---

## 三、索引设计原则

### 高频查询索引
```sql
-- 牛只查询：按编号、状态、圈舍、类型
-- 传感器查询：按牛+指标+时间
-- 事件查询：按牛+时间、按类型
-- 产奶查询：按牛+时间、按泌乳胎次
-- 繁殖查询：按牛+周期、按配种日期
```

### 复合索引策略
```sql
-- (cow_id, timestamp) — 最常用，覆盖牛只时间序列查询
-- (cow_id, metric, timestamp) — 传感器指标查询
-- (event_type, event_time) — 事件类型时间查询
-- (cow_id, lactation_number) — 泌乳曲线查询
-- (cow_id, cycle_number) — 繁殖周期查询
```

---

## 四、Dexie IndexedDB 映射

```typescript
// Dexie 表定义（与 MySQL 一一对应）
const stores = {
  // 核心域
  cows: 'id, cowNumber, earTagNumber, status, breed, gender, currentPenId, birthDate, sireId, damId',
  breedTypes: 'id, code, name, category, isActive',
  pens: 'id, code, name, category',
  persons: 'id, code, name, department',
  
  // 事件域
  cowEvents: 'id, cowId, cowNumber, eventType, eventTime, operatorId',
  
  // 传感器域
  sensorReadings: 'id, cowId, timestamp, metric, [cowId+metric+timestamp]',
  sensorDevices: 'id, deviceCode, cowId, status',
  dataQualityChecks: 'id, cowId, timestamp, metric',
  sensorCalibrations: 'id, deviceId, calibrationDate',
  
  // 繁殖域
  reproductionCycles: 'id, cowId, cycleNumber, inseminationDate, calvingDate, cycleResult',
  breedingBulls: 'id, cowId, bullNumber, geneticMerit, isActive',
  reproductionKpis: 'id, period, periodStart, periodEnd',
  
  // 产奶域
  milkRecords: 'id, cowId, milkingTime, lactationNumber, daysInMilk, [cowId+milkingTime]',
  lactationCurves: 'id, cowId, lactationNumber, [cowId+lactationNumber]',
  milkQualityStandards: 'id, code, name',
  
  // 饲料域
  feedFormulas: 'id, code, name, targetGroup',
  feedRecords: 'id, penId, formulaId, feedingTime, [penId+feedingTime]',
  feedInventory: 'id, feedCode, feedName, category, expiryDate',
  
  // 健康域
  healthScores: 'id, cowId, timestamp, riskLevel, [cowId+timestamp]',
  healthAlerts: 'id, cowId, alertType, severity, status, [cowId+status]',
  healthThresholds: 'id, metric, cowType, season, isActive',
  diseases: 'id, code, name, category',
  medicines: 'id, code, name, category',
  
  // 组学域
  omicsSamples: 'id, sampleCode, cowId, sampleType, status, [cowId+sampleType]',
  omicsDatasets: 'id, datasetCode, name, dataType, platform, status',
  omicsMarkers: 'id, datasetId, markerCode, markerType, trait, [datasetId+markerCode]',
  multiOmicsAssociations: 'id, trait, primaryDatasetId, associationType',
  breedingAnalyses: 'id, analysisCode, name, targetTrait, modelType, status',
  
  // 经济域
  costItems: 'id, category, date, cowId, [category+date]',
  revenueItems: 'id, category, date, cowId, [category+date]',
  economicAnalysis: 'id, periodStart, periodEnd, periodType',
  budgetPlans: 'id, name, periodStart, periodEnd, status',
  kpiMetrics: 'id, code, name, category',
  kpiDashboards: 'id, code, name, category',
  
  // 预测域
  predictiveModels: 'id, name, type, algorithm, status',
  predictionResults: 'id, modelId, targetDate, [modelId+targetDate]',
  forecastScenarios: 'id, name, baseDate, timeHorizon',
  predictiveAlerts: 'id, type, severity, status, predictedDate',
  
  // 硬件域
  hardwareDevices: 'id, name, type, status, lastSeen',
  integrationProtocols: 'id, name, type, isActive',
  dataSynchronizations: 'id, protocolId, sourceDevice, status',
  deviceMaintenance: 'id, deviceId, type, scheduledDate, status',
  
  // 自动化域
  workflowTemplates: 'id, name, category, triggerType, isActive',
  workflowInstances: 'id, templateId, cowId, status',
  automatedActions: 'id, name, actionType, isActive',
  smartTransferRules: 'id, name, triggerEvent, isActive',
  reminderRules: 'id, name, reminderType, isActive',
  
  // 审计域
  exportAuditLogs: 'id, actionType, operator, status, createdAt',
  operationAuditLogs: 'id, actionType, operator, status, createdAt',
  hardwareCommandLogs: 'id, deviceId, commandType, status',
  breedingDecisionRuns: 'id, runType, operator, status',
  
  // 表型域
  phenotypeTraitDefinitions: 'id, code, name, category, status',
  phenotypeRecords: 'id, cowId, cowNumber, traitCode, collectionDate, [cowId+traitCode]',
  phenotypeExportMethods: 'id, code, groupBy, status',
  baseInfoCategories: 'id, scope, name'
}
```

---

## 五、数据库版本规划

```
Version 1: 核心基础表
  cows, breedTypes, pens, persons
  cowEvents (统一事件表)
  
Version 2: 传感器 + 繁殖
  sensorReadings, sensorDevices, dataQualityChecks, sensorCalibrations
  reproductionCycles, breedingBulls, reproductionKpis
  
Version 3: 产奶 + 饲料 + 健康
  milkRecords, lactationCurves, milkQualityStandards
  feedFormulas, feedRecords, feedInventory
  healthScores, healthAlerts, healthThresholds, diseases, medicines
  
Version 4: 组学 + 育种
  omicsSamples, omicsDatasets, omicsMarkers, multiOmicsAssociations
  breedingAnalyses
  
Version 5: 经济 + 预测 + KPI
  costItems, revenueItems, economicAnalysis, budgetPlans
  kpiMetrics, kpiDashboards
  predictiveModels, predictionResults, forecastScenarios, predictiveAlerts
  
Version 6: 硬件 + 自动化
  hardwareDevices, integrationProtocols, dataSynchronizations, deviceMaintenance
  workflowTemplates, workflowInstances, automatedActions
  smartTransferRules, reminderRules
  
Version 7: 审计 + 表型
  exportAuditLogs, operationAuditLogs, hardwareCommandLogs, breedingDecisionRuns
  phenotypeTraitDefinitions, phenotypeRecords, phenotypeExportMethods
  baseInfoCategories
```

---

## 六、与当前设计的对比

| 维度 | 当前设计 | 新设计 | 收益 |
|------|---------|--------|------|
| 事件表 | 5 张独立表，字段不统一 | 1 张统一表 + JSON 详情 | 导出统一，查询简化 |
| 传感器数据 | 宽表 + 嵌套 JSON | 长表模式 (cow_id, metric, value) | 扩展灵活，按指标导出 |
| 牛只关联 | 事件表用 cowNumber | 所有表用 cow_id (UUID) | 牛号变更不影响关联 |
| 繁殖链条 | 只有 breeding_events | 完整周期表（发情→配种→妊检→产犊→干奶） | 繁殖效率可计算 |
| 系谱追溯 | fatherNumber 字符串 | sire_id/dam_id 关联 cows 表 | 支持无限代追溯 |
| 导出能力 | 仅牛只和事件 2 个页面 | 所有表均可导出（统一导出组件） | 覆盖全表 |
| 表数量 | 58 张（含死表） | 40 张核心 + 扩展 | 减少 30% 死表 |
| 字段一致性 | camelCase vs snake_case 混用 | 统一 snake_case (MySQL) / camelCase (TS) | normalizeBackendRows 简化 |

---

## 七、实施路径

### Phase 1（1周）：核心表重构
- [ ] 创建 `cows` 新表（加 sire_id/dam_id）
- [ ] 创建 `cow_events` 统一事件表
- [ ] 数据迁移：5 张旧事件表 → 1 张新表
- [ ] 删除旧事件表

### Phase 2（1周）：传感器长表化
- [ ] 创建 `sensor_readings` 长表
- [ ] 数据迁移：宽表 → 长表（每行拆为多条 metric 记录）
- [ ] 更新所有引用传感器的页面

### Phase 3（1周）：繁殖链条完善
- [ ] 创建 `reproduction_cycles` 完整周期表
- [ ] 创建 `breeding_bulls` 种公牛表
- [ ] 添加妊检/产犊/干奶事件类型到 cow_events

### Phase 4（2周）：组学工作流集成
- [ ] 创建组学相关表
- [ ] 与 data-analysis 页面的 ModuleRunForm/WorkflowRunRecord 对接
- [ ] 建立 omics → phenotype → breeding 数据关联

### Phase 5（1周）：导出组件统一
- [ ] 创建通用导出组件
- [ ] 支持所有表导出
- [ ] 嵌套对象自动扁平化

---

## 八、设计决策说明

### 为什么用 UUID 而非自增 ID？
- 分布式场景下 UUID 不会冲突
- 前端可以直接生成 ID，不需要等后端返回
- 导出/审计日志中的 ID 不会被猜测

### 为什么事件表用 JSON details？
- 不同事件类型的字段差异大（配种 vs 疫苗 vs 产犊）
- JSON 可以灵活扩展，不需要频繁 ALTER TABLE
- 导出时可以自动扁平化为多列

### 为什么传感器用长表模式？
- 新指标（如新增"咀嚼次数"）只需加数据，不改表结构
- 可以按指标聚合查询（GROUP BY metric）
- 导出时每个指标占一列，而非 `[object Object]`

### 为什么保留冗余字段（如 cow_number）？
- 事件表同时存 cow_id 和 cow_number
- cow_id 用于关联完整性
- cow_number 用于显示和查询（避免 JOIN）
- 这是读多写少场景下的标准优化

---

**设计完成。** 这套数据库设计以阿菲金为标杆，解决了当前导出的所有痛点，同时保留了组学分析的特色能力。需要我开始实施吗？
