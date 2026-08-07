# 系统静态检查

总体：**PASS**

| 检查项 | 状态 | 说明 |
|---|---|---|
| `protocol_known_vectors` | PASS | 3 个固定向量一致 |
| `protocol_roundtrips` | PASS | 1715 次往返编码一致 |
| `radio_parameter_alignment` | PASS | 频率、带宽、扩频因子、编码率、同步字、前导码、报头和 CRC 一致 |
| `firmware_sources` | PASS | 耳标与网关 ESP-IDF 源码及配置常量验证通过 |
| `system_asset_manifest` | PASS | 562 个资产哈希验证通过 |
| `backend_reference` | PASS | 后台表结构及接口文件验证通过 |
| `backend_platform` | PASS | 12 个完整平台源码入口验证通过 |
| `mysql_bootstrap` | PASS | cattle_management 数据库初始化链验证通过 |
| `node_syntax` | PASS | 69 个文件通过 Node 语法检查 |
| `th_shrc_runtime_timezone` | PASS | TH-SHRC 运行时在 UTC 和 Asia/Shanghai 时区验证通过 |
| `package_script_paths` | PASS | 已检查 36 个 package 脚本 |
| `production_template` | PASS | 部署配置验证通过 |
