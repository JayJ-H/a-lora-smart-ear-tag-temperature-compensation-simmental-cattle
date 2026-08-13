# Container deployment

```bash
cp .env.prod.example .env.prod
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Create `.env.prod` locally. The public package provides placeholders only and
contains no live credentials or domain.
