# 犇牛智能健康预警系统

技术栈：Vue 3/TypeScript、Node.js/Express、MySQL、MQTT和TH-SHRC温度补偿运行时。

## 环境

- Node.js 20.19 或更高版本；
- pnpm 8.15.9；
- MySQL 8.x；
- 本地容器启动可使用 Docker Compose。

## 本地启动

```bash
cp .env.example .env
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run db:local
corepack pnpm run dev:api
corepack pnpm run dev:web
```

Windows 可运行：

```powershell
脚本\start-local-platform.cmd
```

Linux 可运行：

```bash
bash 脚本/start-local-platform.sh
```

## TH-SHRC 运行时核验

```bash
node 脚本/validate-th-shrc-exact-reference.mjs
node 脚本/validate-th-shrc-runtime.mjs
```

## 前端构建

```bash
corepack pnpm run build
```

## 生产配置

```bash
cp 运维/生产配置/.env.prod.example 运维/生产配置/.env.prod
corepack pnpm run prod:up
```

## 目录

```text
src/                         Vue/TypeScript 前端
脚本/                     API、MQTT、模型运行时与维护脚本
脚本/assets/th-shrc/      匿名化 TH-SHRC 运行时资产
数据库/mysql/              MySQL 初始化与迁移
运维/生产配置/              容器部署配置
```
