# Benniu cattle health management system

This directory contains the complete management-platform source. The application
combines a Vue 3/TypeScript Web client, Node.js/Express API, MySQL, MQTT ingestion,
and the TH-SHRC temperature-compensation runtime.

## Requirements

- Node.js 20.19 or newer
- pnpm 8.15.9
- MySQL 8.x
- Docker Compose for the containerized local database or deployment templates

## Local startup

```bash
cp .env.example .env
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run db:local
corepack pnpm run dev:api
corepack pnpm run dev:web
```

Windows:

```powershell
scripts\start-local-platform.cmd
```

Linux:

```bash
bash scripts/start-local-platform.sh
```

## TH-SHRC runtime validation

```bash
node scripts/validate-th-shrc-exact-reference.mjs
node scripts/validate-th-shrc-runtime.mjs
```

## Web build

```bash
corepack pnpm run build
```

## Container deployment template

```bash
cp ops/production/.env.prod.example ops/production/.env.prod
corepack pnpm run prod:up
```

The public configuration uses environment-variable placeholders and contains no
production database, live domain, or credentials.

## Main directories

```text
src/                         Vue/TypeScript Web client
scripts/                     API, MQTT, runtime, validation, and maintenance tools
scripts/assets/th-shrc/      Anonymous TH-SHRC runtime assets
database/mysql/              MySQL initialization and migration files
ops/production/              Container deployment templates
```
