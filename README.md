# FlyRank Internship Projects

This repository hosts a minimalist Node.js backend server with a layered architecture, running inside Docker containers (PostgreSQL and Redis) and integrated with LLM APIs for AI-powered features.

---

## Milestone 3 (Week 4): Connect to an AI API

We added a provider-agnostic AI wrapper to perform structured data classification on user messages.

### AI Robustness Features
1. **Provider Seam**: Switching from `gemini` to `groq` or `ollama` touches only **one environment variable** (`AI_PROVIDER`) in your `.env`. All provider-specific endpoint URLs, request formats, response schemas, and token usage parsing are handled inside [src/services/AIService.js](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/src/services/AIService.js).
2. **Schema-Validated Output**: The response from the LLM is validated using a **Zod** schema. If the model outputs malformed JSON or invalid types, the service logs a warning, retries once by feeding the validation error back to the model for self-correction, and returns a clean error if validation fails a second time. It will **never crash** on bad JSON.
3. **Timeout & Retries**: Every request is bounded by a **10-second timeout**. Temporary failures (status `429` rate-limits or `5xx` server issues) are retried twice using exponential backoff (e.g. 1s, then 2s). Client errors (status `400` / `401`) are failed immediately without wasting API rate-limits.
4. **Usage & Cost Logging**: Each completed call extracts token usage metadata from the provider response, estimates the exact USD cost using the provider's public pricing list, and prints it to the console (e.g., `[AI Cost Log] ...`).
5. **Prompt Caching (Stretch Goal)**: Identical prompts (system + user + model combination) are cached in-memory. Second calls return instantly, bypass network requests, and log a `$0.00000000` cost.

---

## Setup & Configuration

### 1. Prerequisite: Local Environment
Rename [.env.example](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/.env.example) to `.env` and fill in your settings:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:mysecretpassword@localhost:5432/todos_db

# AI API Configurations
AI_PROVIDER=gemini
AI_MODEL=gemini-1.5-flash
AI_API_KEY=your_actual_gemini_api_key
```

### 2. Prerequisite: Docker Desktop
Docker Desktop is required to run the containerized stack. To install on Windows:
```powershell
winget install Docker.DockerDesktop
```

---

## Running the Stack

To build and run the entire environment (App + Postgres + Redis):
```bash
docker compose up --build -d
```

Check the health status of the services:
```bash
curl http://localhost:3000/status
```
**Example Response:**
```json
{
  "status": "ok",
  "uptime": 22,
  "storage": "postgres",
  "redis": "PONG"
}
```

---

## AI Feedback Classifier Endpoint

- **URL**: `/ai/classify`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "text": "The app crashes when I click the submit button!"
  }
  ```
- **Example Curl**:
  ```bash
  curl -X POST -H "Content-Type: application/json" -d "{\"text\":\"The app crashes when I click the submit button!\"}" http://localhost:3000/ai/classify
  ```
- **Response**:
  ```json
  {
    "type": "bug",
    "summary": "App crashes on submit",
    "priority": "high",
    "reasoning": "The user is reporting an application crash, which is categorized as a high-priority bug."
  }
  ```

---

## Milestone 4 (Week 4): PDF Report Generator

We implemented a background job processing pipeline to generate PDF performance reports on-demand and on a schedule.

### Pipeline Details
1. **Background Job Queue**: Uses Redis Lists (`LPUSH`/`RPOP`) to queue and manage job state transitions (`pending` -> `processing` -> `completed` / `failed`) with an in-memory array fallback if Redis is not configured.
2. **On-Demand & Scheduled Jobs**:
   - **On-Demand**: Triggered via `POST /reports` which enqueues a job and instantly returns a `202 Accepted` status with the `jobId`.
   - **Scheduled (Stretch)**: Runs automated reports periodically using `node-cron`. The schedule can be configured in `.env` via `REPORT_CRON` (defaults to every 10 minutes).
3. **SQL Aggregation**: Performs analytical queries directly on Postgres (e.g. counting totals, completion rates, and sorting items) with a clean JS array fallback in memory mode.
4. **PDF rendering**: Renders structured reports using `pdfkit` featuring styling, header layout, stats summary boxes, and a bulleted list of tasks.
5. **Streaming Artifacts**: Downloads are served using streams (`fs.createReadStream().pipe(res)`), guaranteeing that large PDF files are never buffered in server RAM.

### Endpoints
- **POST /reports**: Trigger a report job. Returns `202 Accepted` with a `jobId`.
- **GET /reports/status/:jobId**: Check job progress. Returns status, creation timestamp, and completion download link.
- **GET /reports/download/:jobId**: Streams and downloads the compiled PDF report.

---

## Verification & Testing

To run the verification test suites locally (which verify the Database repositories, AI retries/caching, and background PDF report generation pipelines):

```bash
# Verify DB repositories
node scratch/test-db.js

# Verify AI integration (timeouts, retries, cost logging, schema validations, caching)
node scratch/test-ai.js

# Verify PDF Report Generator pipeline (queue, worker, PDF rendering, filesystem)
node scratch/test-reports.js
```
