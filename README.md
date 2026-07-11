# Task BE-04: Containerize Your Stack

This project implements a Node.js backend server with a layered architecture, running alongside PostgreSQL and Redis inside Docker containers managed by Docker Compose.

---

## Architecture (Layered Design)

This codebase uses a layered architecture, proving that swapping the storage layer (from in-memory to Postgres) has **zero impact** on business logic and routing code.

1. **Routing Layer** ([server.js](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/server.js)): Automatically determines which repository implementation to instantiate based on environment variables, defines HTTP endpoints, and routes incoming JSON requests.
2. **Service Layer** ([src/services/TodoService.js](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/src/services/TodoService.js)): Coordinates business logic (e.g. validating todo title parameter). It communicates exclusively through the Repository interface. **This file remained 100% unchanged.**
3. **Repository Layer** ([src/repositories/](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/src/repositories/)):
   - [InMemoryTodoRepository.js](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/src/repositories/InMemoryTodoRepository.js): Stores todos in RAM (ideal for fast local testing).
   - [PostgresTodoRepository.js](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/src/repositories/PostgresTodoRepository.js): Persists todos in a Postgres database using SQL queries.

---

## Setup & Prerequisites

### 1. Install Docker Desktop
Docker is required to run the containerized database and server. If you don't have Docker Desktop installed, you can install it on Windows by running this command in PowerShell:

```powershell
winget install Docker.DockerDesktop
```
*Note: A system restart might be required after installation.*

### 2. Configure Environment Variables
Copy [.env.example](file:///C:/Users/i222683AbdullahGhani/Desktop/flyrank/.env.example) to `.env`:

```bash
cp .env.example .env
```
- In development/local testing outside Docker, use `localhost` in the connection string.
- Inside Docker Compose, the app service automatically resolves `db` to the Postgres container, overriding `localhost`.

---

## How to Run the Stack

To build the application container and start the entire stack (Postgres + Redis + Node Server):

```bash
docker compose up --build -d
```

Verify that all services started correctly by calling the status endpoint:
```bash
curl http://localhost:3000/status
```
**Expected Response:**
```json
{
  "status": "ok",
  "uptime": 5,
  "storage": "postgres",
  "redis": "PONG"
}
```

---

## Proof of Persistence

Follow these steps to verify that data survives a container/app restart:

1. **Create a Todo**:
   Send a `POST` request to add a todo:
   ```bash
   curl -X POST -H "Content-Type: application/json" -d "{\"title\":\"Verify Docker Volume Persistence\"}" http://localhost:3000/todos
   ```
   *Expected output: The created todo item with a unique database `id`.*

2. **Retrieve Todos**:
   Confirm the item is saved:
   ```bash
   curl http://localhost:3000/todos
   ```

3. **Restart the Stack**:
   Stop and destroy the containers (this mimics a container/app crash or update):
   ```bash
   docker compose down
   ```
   Start the containers back up:
   ```bash
   docker compose up -d
   ```

4. **Verify the Todo persists**:
   Retrieve the list of todos again:
   ```bash
   curl http://localhost:3000/todos
   ```
   **Result**: The todo created in Step 1 is still returned because PostgreSQL stores its data inside the persistent Docker volume (`postgres_data`), proving that the data survived the restart.

---

## Endpoints

### 1. Health & Status
- **URL**: `/status`
- **Method**: `GET`
- **Response**: Details on database storage used and Redis ping status.

### 2. Get All Todos
- **URL**: `/todos`
- **Method**: `GET`
- **Response**: List of all todos in the store.

### 3. Create Todo
- **URL**: `/todos`
- **Method**: `POST`
- **Body**: `{"title": "your todo text"}`
- **Response**: The newly created todo object with ID and created timestamp.

### 4. Delete Todo
- **URL**: `/todos/:id`
- **Method**: `DELETE`
- **Response**: Message confirming deletion.
