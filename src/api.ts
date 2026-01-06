import * as http from 'http';

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/api/hello' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'hello' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
  });
}

export default server;
