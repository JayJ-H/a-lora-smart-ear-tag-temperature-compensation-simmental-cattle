# TH-SHRC运行时接入

平台源码包含TH-SHRC运行时文件`backend/source_code/scripts/assets/th-shrc/runtime-model-v2-exact.json`。MQTT温度接入流程调用该运行时，保存补偿元数据，并将补偿温度与对应传感器记录写入数据库。

`scripts/check-th-shrc-live.mjs`提供本地端到端核验，覆盖MQTT发布、API查询、MySQL传感器记录、补偿体温记录和MQTT消息日志。
