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

## Milestone 5 (Week 4): The Polite Scraper

We implemented a web crawler that extracts data from a practice website to build a structured JSON corpus, while enforcing strict bot politeness guidelines.

### Scraper Pipeline
1. **Identification**: Sends a custom `User-Agent` string with contact details to allow site administrators to identify or contact the runner of the bot.
2. **Robots.txt Adherence**: Dynamically fetches and parses the target site's `/robots.txt` file on startup. It extracts all disallowed routes and obeys the specific `Crawl-delay` constraint.
3. **Pacing / Rate Limiting**: Introduces an asynchronous sleep delay between successive page fetches based on the parsed crawl delay (or a default 1000ms pause) to avoid server load.
4. **Cheerio Parsing**: Parses target elements (quotes, authors, tags) cleanly, strips excessive formatting, and maps them to a consistent data structure.
5. **Structured Storage**: Saves results as a clean JSON database at [data/scraped_quotes.json](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/data/scraped_quotes.json), serving as the foundational corpus for semantic search and RAG indexing.

### Endpoints
- **POST /scraper/run**: Triggers the crawler run (supports an optional `maxPages` parameter in JSON body, defaults to 3).
- **GET /scraper/quotes**: Returns the stored scraped JSON data array directly.

---

## Milestone 6: Real Authentication & Tenant Isolation

We added user identity management and security layers to protect client resources. Every database operation now runs within the context of the currently authenticated user, guaranteeing complete tenant data isolation.

### Security Implementation
1. **Password Hashing**: Uses the built-in, secure `crypto.scrypt` algorithm to hash passwords with a unique salt for each user before storing them, safeguarding credentials against leakages.
2. **JWT Session Management**: Registers token issuance and validation using `jsonwebtoken`. Logged-in users receive a JWT signed with a private key (`JWT_SECRET`).
3. **Route Protections (401 Unauthorized)**: Checks the `Authorization` header (`Bearer <token>`) on `/todos` and `/reports` endpoints. Missing or invalid signatures reject requests immediately.
4. **Tenant Data Scoping (403 Forbidden)**:
   - Database operations (inserting, deleting, selecting) filter by `user_id` context.
   - Cross-user actions (e.g. attempting to fetch or delete another tenant's todos, or checking/downloading another user's compiled PDF report) fail with an honest `403 Forbidden` response.
   - Background worker processes dynamically limit data aggregation queries to the requesting user ID.

### Endpoints
- **POST /auth/register**: Registers a new username/password pair.
- **POST /auth/login**: Authenticates username/password and issues a JWT token.
- **GET /todos** & **POST /todos** & **DELETE /todos/:id**: Enforces JWT validation and filters operations strictly to the user's scope.
- **POST /reports** & **GET /reports/status/:jobId** & **GET /reports/download/:jobId**: Enforces JWT validation and confines background jobs and PDF downloads strictly to the job owner's scope.

---

## Milestone 7 (Week 5): AI Background Job Queue

We transitioned the slow-running AI feedback classification function from a synchronous request-response call into a background job pipeline.

### Job System Specifications
1. **Instant Response**: `POST /ai/classify` immediately validates client input, creates a background job with a unique `jobId`, queues it in Redis (with a RAM fallback), and returns `202 Accepted` with `status: "pending"`.
2. **Idempotency Guard**: Before a worker processes a job, it asserts that the status is not already `completed`. If it is, the job is skipped to avoid double runs.
3. **Smart Retries**: If the AI API fails, the worker catches the error and retries the job up to 3 times, restoring its state to pending and re-queuing it.
4. **Critical Alerting**: If a job fails permanently after exhausting all 3 attempts, the worker raises a critical console alert (`[ALERT] AI Classification Job ... FAILED permanently`) and flags the job status as `failed` with `alerted: true` in storage.
5. **Polling Status**: Exposes `GET /ai/classify/status/:jobId` to check progress. Once completed, it returns the final schema-validated structured response.

### Endpoints
- **POST /ai/classify**: Queues user text for classification. Returns `202 Accepted` with a `jobId`.
- **GET /ai/classify/status/:jobId**: Returns job progress, attempts count, error messages, and final results.

---

## Verification & Testing

To run the verification test suites locally (which verify the Database repositories, AI retries/caching, background PDF reports, polite web scraper, user authentication/isolation, and AI background job queue):

```bash
# Verify DB repositories
node scratch/test-db.js

# Verify AI integration (timeouts, retries, cost logging, schema validations, caching)
node scratch/test-ai.js

# Verify PDF Report Generator pipeline (queue, worker, PDF rendering, filesystem)
node scratch/test-reports.js

# Verify Web Scraper (robots.txt, delay, HTML parsing, structured saving)
node scratch/test-scraper.js

# Verify Authentication & Tenant Isolation (hashing, JWT, cross-user block, scoped reports)
node scratch/test-auth.js

# Verify AI Background Job worker (instant 202, idempotency, retries, console alerts)
node scratch/test-ai-job.js
```
