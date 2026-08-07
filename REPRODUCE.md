# 复现命令

所有命令均在仓库根目录运行。

## 快速核验

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

该命令核验1129到503条的筛选链、最终堆叠、论文指标、机制消融、数据包编码、无线参数、资产哈希和仓库结构。

## 单项分析

```bash
python 脚本/verify_results.py
python 脚本/run_temperature_analysis.py --verify-docs
python 分析/消融/run_ablation.py
python 分析/消融/test_ablation.py
python 分析/基准模型/test_benchmark.py
python 分析/基准模型/replay_benchmark.py
python 分析/可解释性/run_native_stack_shap.py
python 分析/可解释性/verify_conditional_shap.py
python 分析/图件/plot_fig15_17_public.py
```

数值容差：最终堆叠为`1e-10 ℃`；w/o A、w/o B和w/o C为`1e-8 ℃`；PDR由4000条包级记录重新计算。

## 模型对比

```bash
python -m pip install -r environment/requirements-full.txt
python 分析/基准模型/run_benchmark.py
```

## R依赖流程

```bash
Rscript environment/install_r_packages.R
python run_analysis_pipeline.py --shap-mode smoke
```

503行条件SHAP使用`--shap-mode full`。运行环境和阶段结果写入`输出/`。

## 管理平台源码核验

```bash
cd 管理系统/源代码
node 脚本/validate-th-shrc-exact-reference.mjs
node 脚本/validate-th-shrc-runtime.mjs
node --check 脚本/mysql-backend-server.mjs
```

安装前端依赖后可运行：

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

MySQL、API、前端和 MQTT 的本地启动入口见 `管理系统/源代码/README.md`。
