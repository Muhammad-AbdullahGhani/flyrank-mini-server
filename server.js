require('dotenv').config();
const http = require('http');
const url = require('url');
const { Pool } = require('pg');
const { createClient } = require('redis');

// Repositories
const InMemoryTodoRepository = require('./src/repositories/InMemoryTodoRepository');
const PostgresTodoRepository = require('./src/repositories/PostgresTodoRepository');
const InMemoryUserRepository = require('./src/repositories/InMemoryUserRepository');
const PostgresUserRepository = require('./src/repositories/PostgresUserRepository');

// Services
const TodoService = require('./src/services/TodoService');
const AuthService = require('./src/services/AuthService');
const ReportService = require('./src/services/ReportService');
const AIService = require('./src/services/AIService');
const ScraperService = require('./src/services/ScraperService');

// Initialize database pool if configured
let dbPool = null;
if (process.env.DATABASE_URL) {
  console.log('Database URL detected. Connecting to Postgres...');
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
}

// Instantiate repositories based on environment
let todoRepository;
let userRepository;

if (dbPool) {
  todoRepository = new PostgresTodoRepository(dbPool);
  userRepository = new PostgresUserRepository(dbPool);
} else {
  console.log('No Database URL detected. Using In-Memory Storage...');
  todoRepository = new InMemoryTodoRepository();
  userRepository = new InMemoryUserRepository();
}

// Instantiate services
const todoService = new TodoService(todoRepository);
const authService = new AuthService(userRepository);

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

const reportService = new ReportService(todoService, dbPool, redisClient);

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

// Helper middleware for authentication
const authenticateRequest = (req) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing or invalid token format');
  }
  const token = authHeader.split(' ')[1];
  return authService.verifyToken(token); // Returns decoded payload: { userId, username }
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  res.setHeader('Content-Type', 'application/json');

  try {
    // --------------------------------------------------------
    // Public Auth Routes
    // --------------------------------------------------------
    
    // POST /auth/register
    if (pathname === '/auth/register' && req.method === 'POST') {
      const body = await getRequestBody(req);
      const user = await authService.register(body.username, body.password);
      res.writeHead(201);
      return res.end(JSON.stringify({ message: 'User registered successfully', user }));
    }

    // POST /auth/login
    if (pathname === '/auth/login' && req.method === 'POST') {
      const body = await getRequestBody(req);
      const result = await authService.login(body.username, body.password);
      res.writeHead(200);
      return res.end(JSON.stringify(result));
    }

    // --------------------------------------------------------
    // Public Info Routes
    // --------------------------------------------------------
    
    // GET /status
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
        storage: dbPool ? 'postgres' : 'memory',
        redis: redisStatus
      }));
    }

    // GET /hello
    if (pathname === '/hello' && req.method === 'GET') {
      const name = parsedUrl.query.name || 'Intern';
      res.writeHead(200);
      return res.end(JSON.stringify({ message: `Hello, ${name}! Welcome to your internship.` }));
    }

    // --------------------------------------------------------
    // Protected Todo Routes (Enforces Tenant Isolation)
    // --------------------------------------------------------
    
    if (pathname.startsWith('/todos')) {
      let user;
      try {
        user = authenticateRequest(req);
      } catch (authErr) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: authErr.message }));
      }

      // GET /todos - Fetch all for current user
      if (pathname === '/todos' && req.method === 'GET') {
        const todos = await todoService.getAllTodos(user.userId);
        res.writeHead(200);
        return res.end(JSON.stringify(todos));
      }

      // POST /todos - Create a todo for current user
      if (pathname === '/todos' && req.method === 'POST') {
        const body = await getRequestBody(req);
        const newTodo = await todoService.createTodo(body.title, user.userId);
        res.writeHead(201);
        return res.end(JSON.stringify(newTodo));
      }

      // GET /todos/:id - Fetch one by id (must belong to current user)
      if (pathname.startsWith('/todos/') && req.method === 'GET') {
        const idStr = pathname.substring(7);
        const id = parseInt(idStr);
        if (isNaN(id)) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid ID format' }));
        }

        const todo = await todoService.getTodoById(id, user.userId);
        if (!todo) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Todo not found or access denied' }));
        }

        res.writeHead(200);
        return res.end(JSON.stringify(todo));
      }

      // DELETE /todos/:id - Delete one by id (must belong to current user)
      if (pathname.startsWith('/todos/') && req.method === 'DELETE') {
        const idStr = pathname.substring(7);
        const id = parseInt(idStr);
        if (isNaN(id)) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid ID format' }));
        }

        const success = await todoService.deleteTodo(id, user.userId);
        if (!success) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Todo not found or access denied' }));
        }

        res.writeHead(200);
        return res.end(JSON.stringify({ message: 'Todo deleted successfully', id }));
      }
    }

    // --------------------------------------------------------
    // Protected PDF Report Routes (Enforces Tenant Isolation)
    // --------------------------------------------------------
    
    if (pathname.startsWith('/reports')) {
      let user;
      try {
        user = authenticateRequest(req);
      } catch (authErr) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: authErr.message }));
      }

      // POST /reports - Enqueue user-scoped report job
      if (pathname === '/reports' && req.method === 'POST') {
        const job = await reportService.createReportJob(user.userId);
        res.writeHead(202);
        return res.end(JSON.stringify({ jobId: job.id, status: job.status }));
      }

      // GET /reports/status/:jobId - Check progress (Must be the job owner)
      if (pathname.startsWith('/reports/status/') && req.method === 'GET') {
        const jobId = pathname.substring(16);
        const job = await reportService.getJobStatus(jobId);
        if (!job) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Job not found' }));
        }

        // Verify ownership
        if (job.userId !== user.userId) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Forbidden: You do not own this report' }));
        }

        res.writeHead(200);
        return res.end(JSON.stringify(job));
      }

      // GET /reports/download/:jobId - Download PDF (Must be the job owner)
      if (pathname.startsWith('/reports/download/') && req.method === 'GET') {
        const jobId = pathname.substring(18);
        const job = await reportService.getJobStatus(jobId);
        if (!job) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Job not found' }));
        }

        // Verify ownership
        if (job.userId !== user.userId) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Forbidden: You do not own this report' }));
        }

        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, 'public/reports', `${jobId}.pdf`);

        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Report PDF not found or still generating' }));
        }

        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="todo_report_${jobId}.pdf"`
        });
        const stream = fs.createReadStream(filePath);
        return stream.pipe(res);
      }
    }

    // --------------------------------------------------------
    // AI Feature & Scraper Routes (Public/Admin endpoints)
    // --------------------------------------------------------
    
    // POST /ai/classify
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

    // POST /scraper/run
    if (pathname === '/scraper/run' && req.method === 'POST') {
      const body = await getRequestBody(req).catch(() => ({}));
      const maxPages = parseInt(body.maxPages) || 3;
      const result = await ScraperService.runScraper(maxPages);
      res.writeHead(200);
      return res.end(JSON.stringify(result));
    }

    // GET /scraper/quotes
    if (pathname === '/scraper/quotes' && req.method === 'GET') {
      const quotes = ScraperService.getSavedQuotes();
      res.writeHead(200);
      return res.end(JSON.stringify(quotes));
    }

    // Catch-all 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));

  } catch (err) {
    console.error('Request Error:', err.message);
    res.writeHead(err.message.includes('required') || err.message.includes('exists') || err.message.includes('Invalid') ? 400 : 500);
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
