# LoRa 智能耳标与 TH-SHRC 复现仓库

本仓库对应论文 *A LoRa smart ear-tag system with a stacked
temperature-compensation model for ear-surface thermometry in Simmental cattle*，
包含匿名化研究数据、固定结果表、复现代码、硬件与固件文件、管理平台源码和论文图件源文件。

## 研究结果

- 30 个匿名 `CowKey` 的 503 条配对测温记录；
- 同牛随机五折 OOF 验证；
- TH-SHRC：R² `0.8551359051012453`，RMSE `0.25195565941200593 ℃`，
  MAE `0.1345534257161156 ℃`，绝对误差不超过 0.5 ℃的比例为
  `0.9423459244532804`；
- 4,000 个 LoRa 测试包，其中接收 3,751 个、丢失 249 个；
- 总体 PDR `0.93775`，200 m PDR `0.93875`，250 m PDR `0.83125`。

## 快速核验

```bash
python -m venv .venv
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

分析命令见 `REPRODUCE.md`。

## 平台源码

`管理系统/源代码/` 包含：

- Vue 3、TypeScript、Vite、Element Plus 和 ECharts 前端；
- Node.js/Express API 与 MySQL 持久化；
- MQTT 上行接入、牛只—耳标映射、温度和链路记录入库；
- TH-SHRC 运行时调用、预警处理和网关控制接口；
- MySQL 初始化脚本、迁移脚本、本地与容器部署配置；
- 环境变量示例、运行检查脚本和第三方许可证。

## 目录

- `数据/`：温度、LoRa、基准模型、消融和 SHAP 数据；
- `分析/` 与 `脚本/`：模型复现、结果核验和 Fig. 15–17 生图入口；
- `硬件/`：耳标和网关的 CAD、PCB、原理图与结构文件；
- `固件/`：耳标和网关 ESP-IDF 源码及 3-byte 协议；
- `管理系统/源代码/`：管理平台源码；
- `管理系统/reference/`：论文数据链路的接口与表结构；
- `输出/`：机器可读核验结果和分析输出。

## 图源文件与复现源的区别

图件材料分为“分析复现”和“手稿级组装源”两层：

- `分析/论文图源/图源复现/`：各图对应的数据、绘图脚本、组件素材和生成面板。
- `分析/论文图源/图源文件/`：最终 SVG、Illustrator 源文件、Fig. 11 Origin 工程及其他可编辑源文件。
- `分析/论文图源/figure_reproduction_manifest.csv`：各图的脚本、输入和输出映射。
- `分析/论文图源/editable_source_manifest.csv`：各图的可编辑源文件映射。

Fig. 1–19 的逐图说明位于 `分析/论文图源/图源复现/figXX/README.md`。
