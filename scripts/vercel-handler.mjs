// Vercel function entry (see scripts/vercel-build.mjs): start the Next.js
// standalone server once per instance and forward every request to it, so all
// pages and API routes share the same in-memory demo database.
import http from 'node:http';
import net from 'node:net';

const PORT = 3100;
let ready;

function waitForPort(deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(PORT, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline)
          reject(new Error('The Next.js server did not start.'));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

function start() {
  ready ??= (async () => {
    process.env.PORT = String(PORT);
    process.env.HOSTNAME = '127.0.0.1';
    await import(new URL('./server.js', import.meta.url).href);
    await waitForPort(Date.now() + 30_000);
  })().catch((e) => {
    ready = undefined;
    throw e;
  });
  return ready;
}

export default async function handler(req, res) {
  try {
    await start();
  } catch {
    res.statusCode = 503;
    res.end('The server is starting. Please retry.');
    return;
  }
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.statusCode = 502;
    res.end();
  });
  req.pipe(upstream);
}
