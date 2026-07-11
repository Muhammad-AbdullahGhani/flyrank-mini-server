require('dotenv').config();
const http = require('http');
const url = require('url');
const { Pool } = require('pg');
const { createClient } = require('redis');

const InMemoryTodoRepository = require('./src/repositories/InMemoryTodoRepository');
const PostgresTodoRepository = require('./src/repositories/PostgresTodoRepository');
const TodoService = require('./src/services/TodoService');
const AIService = require('./src/services/AIService');

// Initialize repository based on environment
let repository;
let dbPool = null;

if (process.env.DATABASE_URL) {
  console.log('Database URL detected. Using Postgres Repository...');
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  repository = new PostgresTodoRepository(dbPool);
} else {
  console.log('No Database URL detected. Using In-Memory Repository...');
  repository = new InMemoryTodoRepository();
}

const todoService = new TodoService(repository);

// Initialize Redis Client (Stretch goal)
let redisClient = null;
if (process.env.REDIS_URL) {
  console.log('Redis URL detected. Initializing client...');
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', err => console.error('Redis Client Error:', err));
  redisClient.connect()
    .then(() => console.log('Connected to Redis successfully.'))
    .catch(err => console.error('Failed to connect to Redis:', err.message));
}

// Helper function to read request body
const getRequestBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  res.setHeader('Content-Type', 'application/json');

  try {
    // 1. Health Status endpoint
    if (pathname === '/status' && req.method === 'GET') {
      let redisStatus = 'not configured';
      if (redisClient && redisClient.isOpen) {
        try {
          redisStatus = await redisClient.ping(); // PONG
        } catch (e) {
          redisStatus = `error: ${e.message}`;
        }
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ 
        status: 'ok', 
        uptime: Math.floor(process.uptime()),
        storage: process.env.DATABASE_URL ? 'postgres' : 'memory',
        redis: redisStatus
      }));
    }

    // 2. Hello Greeting endpoint
    if (pathname === '/hello' && req.method === 'GET') {
      const name = parsedUrl.query.name || 'Intern';
      res.writeHead(200);
      return res.end(JSON.stringify({ message: `Hello, ${name}! Welcome to your internship.` }));
    }

    // 3. GET /todos - Fetch all
    if (pathname === '/todos' && req.method === 'GET') {
      const todos = await todoService.getAllTodos();
      res.writeHead(200);
      return res.end(JSON.stringify(todos));
    }

    // 4. POST /todos - Create a todo
    if (pathname === '/todos' && req.method === 'POST') {
      const body = await getRequestBody(req);
      const newTodo = await todoService.createTodo(body.title);
      res.writeHead(201);
      return res.end(JSON.stringify(newTodo));
    }

    // 5. GET /todos/:id - Fetch one by id
    if (pathname.startsWith('/todos/') && req.method === 'GET') {
      const idStr = pathname.substring(7);
      const id = parseInt(idStr);
      if (isNaN(id)) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Invalid ID format' }));
      }

      const todo = await todoService.getTodoById(id);
      if (!todo) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Todo not found' }));
      }

      res.writeHead(200);
      return res.end(JSON.stringify(todo));
    }

    // 6. DELETE /todos/:id - Delete one by id
    if (pathname.startsWith('/todos/') && req.method === 'DELETE') {
      const idStr = pathname.substring(7);
      const id = parseInt(idStr);
      if (isNaN(id)) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Invalid ID format' }));
      }

      const success = await todoService.deleteTodo(id);
      if (!success) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Todo not found' }));
      }

      res.writeHead(200);
      return res.end(JSON.stringify({ message: 'Todo deleted successfully', id }));
    }

    // 7. POST /ai/classify - Classify feedback message (AI API feature)
    if (pathname === '/ai/classify' && req.method === 'POST') {
      const body = await getRequestBody(req);
      const text = body.text;
      if (!text || typeof text !== 'string' || text.trim() === '') {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Text field is required and must be a non-empty string' }));
      }

      const result = await AIService.classifyFeedback(text);
      res.writeHead(200);
      return res.end(JSON.stringify(result));
    }

    // Catch-all 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));

  } catch (err) {
    console.error('Request Error:', err.message);
    res.writeHead(err.message.includes('required') ? 400 : 500);
    res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});

// Handle graceful shutdown
const shutdown = async () => {
  console.log('Shutting down server...');
  server.close(async () => {
    if (dbPool) {
      await dbPool.end();
      console.log('Database pool closed');
    }
    if (redisClient) {
      await redisClient.quit();
      console.log('Redis client closed');
    }
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
