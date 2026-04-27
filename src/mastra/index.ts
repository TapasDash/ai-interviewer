import { Mastra } from '@mastra/core';
import { interviewFlow } from './workflows/interviewFlow.js';
import logger from '../utils/logger.js';

export const mastra = new Mastra({
  workflows: { interviewFlow },
  logger: {
    info: (message: string) => logger.info({}, `[✅ MASTRA_CORE]: ${message}`),
    error: (message: string) => logger.error({}, `[✅ MASTRA_CORE]: ${message}`),
    warn: (message: string) => logger.warn({}, `[✅ MASTRA_CORE]: ${message}`),
    debug: (message: string) => logger.debug({}, `[✅ MASTRA_CORE]: ${message}`),
    trackException: (err: Error) => logger.error({ err }, `[❌ MASTRA_EXCEPTION]`),
    getTransports: () => new Map(),
    listLogs: async () => ({ logs: [], total: 0, page: 1, perPage: 10, hasMore: false }),
    listLogsByRunId: async () => ({ logs: [], total: 0, page: 1, perPage: 10, hasMore: false }),
  }
});
