import http from 'node:http';
import { createApp } from './app.module.js';

const PORT = Number(process.env.PORT || 3001);

const server = http.createServer(createApp());
server.listen(PORT, () => {
  console.log(`users-api listening on http://localhost:${PORT}`);
});
