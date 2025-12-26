import * as http from 'http';
import { handleGreeting } from './greeting';

const PORT = process.env.PORT || 3000;

/**
 * Simple Node.js HTTP server to serve the greeting API
 */
const server = http.createServer((req, res) => {
  const baseURL = `http://${req.headers.host || 'localhost'}`;
  const url = new URL(req.url || '', baseURL);
  const pathname = url.pathname;

  // Set default response headers
  res.setHeader('Content-Type', 'application/json');

  // Route: GET /api/greet
  if (req.method === 'GET' && pathname === '/api/greet') {
    const name = url.searchParams.get('name') || undefined;
    const response = handleGreeting(name);
    
    res.statusCode = response.status === 'success' ? 200 : 400;
    res.end(JSON.stringify(response));
    return;
  }

  // Default: 404 Not Found
  res.statusCode = 404;
  res.end(JSON.stringify({
    error: 'Not Found',
    message: `Cannot ${req.method} ${pathname}`,
    status: 'error'
  }));
});

// Only start the server if this file is run directly
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Greeting API server running at http://localhost:${PORT}/api/greet`);
  });
}

export default server;
