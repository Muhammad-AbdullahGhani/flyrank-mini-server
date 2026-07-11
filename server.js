const http = require('http');
const url = require('url');

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  res.setHeader('Content-Type', 'application/json');

  if (parsedUrl.pathname === '/status' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) }));
  } else if (parsedUrl.pathname === '/hello' && req.method === 'GET') {
    const name = parsedUrl.query.name || 'Intern';
    res.writeHead(200);
    res.end(JSON.stringify({ message: `Hello, ${name}! Welcome to your internship.` }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
