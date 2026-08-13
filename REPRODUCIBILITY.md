# LoRa智能耳标与TH-SHRC复现仓库

本仓库包含520条匿名质控配对测温记录、TH-SHRC复现代码、33模型基准、机制消融、
稳健性分析、条件SHAP、论文图源，以及配套硬件、固件和管理平台源码。

## 参考结果

- 记录：30头匿名牛的520条记录；来源S01；SourceWeight=1.0
- 验证：按测量单元分组的同牛内五折OOF；五个固定种子
- TH-SHRC：R2=0.849451603205801；RMSE=0.295958360438717 ℃；MAE=0.161020758345253 ℃
- 绝对误差不超过0.5 ℃：92.31%
- 基准：33个模型，每个模型520条OOF预测
- 条件SHAP：四个输入域，覆盖520条记录

## 快速验证

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

## 完整复现

```bash
python -m pip install -r environment/requirements-full.txt
python run_analysis_pipeline.py --full
python plot_manuscript_panels.py
```

Fig.1-19最终文件位于`分析/论文图源/图源文件/`，出图数据、代码和23张程序小图位于
`分析/论文图源/图源复现/`。

`管理系统/源代码/`包含完整牛场管理平台，论文数据路径和运行时模型接口见
`管理系统/reference/`。

# 复现命令

在仓库根目录运行：

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

完整重跑：

```bash
python -m pip install -r environment/requirements-full.txt
python run_analysis_pipeline.py --full
python plot_manuscript_panels.py
```
