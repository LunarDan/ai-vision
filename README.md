# AI Vision Conversation Assistant

AI vision conversation assistant for the competition prompt. The project uses a pnpm monorepo, React web UI, NestJS backend, PostgreSQL, Prisma, and OpenAI Realtime/vision APIs.

## Workspace

- `apps/web` - React + Vite desktop-style AI workstation.
- `apps/server` - NestJS API server for realtime session creation, vision analysis, and metrics.
- `packages/shared` - Shared TypeScript types for API contracts.
- `docs/design.md` - Design document required by the prompt.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

## Local MinIO

You can use a MinIO binary downloaded on drive D directly. Start it before calling the vision API:

```powershell
D:\path\to\minio.exe server D:\minio-data --console-address ":9001"
```

- API endpoint: `http://localhost:9000`
- Console: `http://localhost:9001`
- Default local credentials: `minioadmin` / `minioadmin`
- Default bucket used by the server: `ai-vision-assets`

The server stores analyzed camera keyframes in MinIO and keeps object metadata in PostgreSQL.

## Remote

This local repository is configured for:

```bash
git remote -v
```

Expected origin: `https://github.com/LunarDan/ai-vision.git`.
