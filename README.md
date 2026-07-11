# Mini HTTP Server

A super-minimalist backend server built in Node.js with no external dependencies. Developed as the first task of the FlyRank internship.

## Prerequisites
- [Node.js](https://nodejs.org/) (v12+ recommended)

## How to Run

Clone the repository and run:

```bash
node server.js
```

The server will start at `http://localhost:3000/`.

## Endpoints

### 1. Status Endpoint
- **URL**: `/status`
- **Method**: `GET`
- **Description**: Returns the server status and its uptime.
- **Example Curl**:
  ```bash
  curl http://localhost:3000/status
  ```
- **Response**:
  ```json
  {"status":"ok","uptime":5}
  ```

### 2. Hello/Greeting Endpoint
- **URL**: `/hello`
- **Method**: `GET`
- **Optional Query Parameter**: `name` (e.g. `/hello?name=Alice`)
- **Description**: Returns a friendly greeting.
- **Example Curl**:
  ```bash
  curl "http://localhost:3000/hello?name=Alice"
  ```
- **Response**:
  ```json
  {"message":"Hello, Alice! Welcome to your internship."}
  ```
