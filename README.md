# Resume Generator

Node.js REST API + Next.js web UI for generating tailored resumes and cover letters. See [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) for the full specification.

## Prerequisites

- Node.js 20+
- (Optional) Docker and Docker Compose for running services

## Quick start (full stack with Docker)

1. **Clone and start services**
   ```bash
   docker compose up -d
   ```
   Brings up: MongoDB, RabbitMQ, MinIO, Reactive Resume (with Postgres + printer), API, and Web UI.

2. **Provide DeepSeek API key** (required for AI: job extract, tailored summary, cover letter, bullet enhancement)
   - Set `DEEPSEEK_API_KEY` when starting:
     ```bash
     DEEPSEEK_API_KEY=sk-your-key docker compose up -d
     ```
   - Or add to a `.env` file in the project root and run `docker compose up -d` (Compose loads `.env` by default).

3. **Open the app**
   - Web UI: http://localhost:3001  
   - API: http://localhost:4000  
   - Reactive Resume (local dev): http://localhost:3002  

4. **Test the flow**
   - Register a user at http://localhost:3001/register
   - Log in at http://localhost:3001/login
   - Create a resume, add a job description, run extract (needs DeepSeek key), then generate resume/cover letter and export PDF.

## Running locally (without Docker)

- **API:** MongoDB and RabbitMQ must be reachable. Set `MONGODB_URI`, `RABBITMQ_URL`, and `DEEPSEEK_API_KEY` in env. Then:
  ```bash
  cd api && npm install && npm run dev
  ```
  API: http://localhost:4000

- **Web:** Point at the API:
  ```bash
  cd web && npm install
  NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_USE_STUB_API=false npm run dev
  ```
  Web: http://localhost:3000

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DEEPSEEK_API_KEY` | **Required for AI.** DeepSeek public API key (https://api.deepseek.com). Provide when running API. |
| `MONGODB_URI` | MongoDB connection string (default in Compose: `mongodb://mongodb:27017/resumegen`) |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Auth signing secrets (set in production) |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | Per-user rate limit (default 200) |
| `RABBITMQ_URL` | For async export jobs |
| `RXRESUME_BASE_URL`, `RXRESUME_API_KEY` | Self-hosted Reactive Resume (PDF export). In Docker Compose, RR runs in Compose; in K8s, point at your existing RR. |
| `AWS_*` / MinIO | S3-compatible storage for PDFs (Compose uses MinIO) |

## Kubernetes deployment

The cluster is expected to **already run Reactive Resume**. This repo does not include an RR container; the API is configured to use your existing RR instance.

- See **[k8s/README.md](k8s/README.md)** for steps: namespace, ConfigMap, Secret, API/Web/Worker deployments.
- Set `RXRESUME_BASE_URL` in ConfigMap to your RR service URL (e.g. `http://reactive-resume.default.svc.cluster.local:3000`).
- Provide `DEEPSEEK_API_KEY` (and optionally `RXRESUME_API_KEY`) via Secret.

## Tests

- **API:** `cd api && npm test` — uses in-memory MongoDB; all tests must pass.
- **Web:** `cd web && npm run build` — production build; `npm run test` — smoke test.

## Phase summary

- **Phase 0:** Web UI shell (Next.js, stub/real API).
- **Phase 1:** API foundation (auth, rate limit, User/Resume CRUD).
- **Phase 2–4:** Jobs, AI (DeepSeek), generation, export (Reactive Resume + S3), idempotency.
- **Web auth:** Login/register store JWT; all API requests send Bearer token; 401 triggers refresh or redirect to login.
