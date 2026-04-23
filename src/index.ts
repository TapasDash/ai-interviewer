import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { handleConnection } from './handlers/connection.js';
import logger from './utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Project Cerberus - High-Throughput Entry Point
 * 
 * EVENT LOOP ARCHITECTURE:
 * This server acts as a low-latency gateway for real-time audio streams. By utilizing 
 * Node's native 'http' and 'ws' libraries, we maintain a thin abstraction layer over 
 * the TCP stack. This minimizes syscall overhead and ensures that the primary 
 * event loop remains focused on WebSocket frame switching and heartbeat management.
 */

const PORT = Number(process.env.PORT) || 8080;

// HTTP Upgrade Layer: Handles the initial handshake before switching protocols.
const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('Project Cerberus - Audio Ingestion Server Active\n');
});

/**
 * WebSocket Server Initialization:
 * Optimized for massive concurrency. 'ws' is chosen for its compliance with 
 * RFC 6455 and its performance profile on Buffer-heavy workloads (STT/TTS chunks).
 */
const wss = new WebSocketServer({ server });

/**
 * Global Connection Handler:
 * Delegates socket-level events to the closure-based orchestration layer.
 * This separation ensures that the global listener does not hold references to 
 * individual session states, preventing memory leaks at the server root.
 */
wss.on('connection', (ws, req) => {
  handleConnection(ws, req);
});

server.listen(PORT, () => {
  console.log(`
  🛡️  Project Cerberus Phase 2: Active
  🚀 Audio Ingestion Server running on port ${PORT}
  🛠️  Architecture: Functional / Closure-based
  ⚖️  Strict Memory Safety: Enabled (16KB Chunks)
  `);
});

/**
 * SIGTERM Orchestration:
 * Implements a drainage pattern. We close the WSS first to stop new connections, 
 * then allow existing sessions to trigger their internal AbortControllers 
 * before terminating the process heap.
 */
process.on('SIGTERM', () => {
  logger.warn({ phase: 'TEARDOWN' }, 'SIGTERM received. Draining connections...');
  wss.close(() => {
    server.close(() => {
      logger.info({ phase: 'TEARDOWN' }, 'Server process terminated safely.');
      process.exit(0);
    });
  });
});


