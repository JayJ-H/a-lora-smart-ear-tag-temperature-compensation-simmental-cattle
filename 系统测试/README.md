# 系统检查

```bash
python 系统测试/run_system_tests.py
```

检查内容包括：

- 3-byte 协议固定向量与边界往返；
- 耳标和网关无线参数一致性；
- ESP-IDF 源码入口与固件常量；
- 硬件、固件和平台资产哈希；
- 完整平台源码入口、MySQL 初始化链和部署模板；
- 全部 JavaScript/MJS/CJS 文件语法；
- TH-SHRC 运行时在 UTC 与 Asia/Shanghai 时区下的一致性；
- `package.json` 本地脚本路径。
