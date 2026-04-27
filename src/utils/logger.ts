import pino from 'pino';

/**
 * Project Cerberus - Forensic Logger Configuration
 * 
 * [ARCHITECT PROTOCOL - TELEMETRY]
 * We utilize 'pino' for sub-millisecond logging latency. By using structured JSON, 
 * we ensure that high-frequency audio metadata can be ingested by AWS CloudWatch 
 * or ELK stacks without the overhead of regex parsing. In production, we strip 
 * 'pino-pretty' to minimize CPU cycles.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // In development, pipe to pino-pretty for human readability
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

export default logger;
