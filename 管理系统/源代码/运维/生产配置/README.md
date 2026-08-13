# 容器部署

```bash
cp .env.prod.example .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

`.env.prod` 由使用者在本地创建。公开包仅提供占位配置，不包含真实凭据或域名。
