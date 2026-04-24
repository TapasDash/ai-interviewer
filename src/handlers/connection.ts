import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SessionState } from '../types/session.js';
import logger from '../utils/logger.js';
import { streamGeminiResponse } from '../pipeline/2_llm_brain_gemini.js';

/**
 * [ARCHITECT PROTOCOL - THE CONNECTION MANIFOLD]
 * All session state is trapped in the closure below. V8 treats this as a 
 * single island of memory that is reclaimed instantly upon socket drop.
 */

const MAX_CHUNK_SIZE = 16 * 1024; // 16KB strict MTU limit

/**
 * INTENT: Create a fresh session state primitive.
 * LOGIC: Initialize atomic traffic lights and the barge-in AbortController.
 */
const createSession = (candidateId: string): SessionState => ({
  candidateId,
  startTime: Date.now(),
  isActive: true,
  isLLMGenerating: false,
  isTTSPlaying: false,
  totalBytesReceived: 0,
  lastChunkTimestamp: Date.now(),
  abortController: new AbortController(),
});

/**
 * INTENT: Orchestrate binary and text streams for a single candidate session.
 * LOGIC:
 * 1. Initialize session closure.
 * 2. Handle [📥 USER_SAID] for both raw audio (binary) and testing frames (text).
 * 3. Link triggers to the Gemini Brain.
 * 4. Implement [🛑 STOP_AI] logic for instant barge-in handling.
 */
export const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const candidateId = url.searchParams.get('candidateId');

  if (!candidateId) {
    logger.warn({ phase: 'HANDSHAKE' }, 'Connection rejected: Missing candidateId');
    ws.close(1008, 'Missing candidateId');
    return;
  }

  const state = createSession(candidateId);
  logger.info({ candidateId, phase: 'HANDSHAKE' }, `[👤 USER_JOINED]: Candidate ${candidateId} connected.`);

  const handleMessage = async (data: any, isBinary: boolean) => {
    const content = isBinary ? `${data.length} bytes of audio` : data.toString();
    logger.debug({ candidateId, phase: 'INGEST' }, `[📥 USER_SAID]: ${candidateId} -> ${content}`);

    if (isBinary) {
      if (data.length > MAX_CHUNK_SIZE) {
        logger.warn({ candidateId, phase: 'INGEST', bytes: data.length }, 'MTU Violation: Killing session');
        ws.close(1009, 'Chunk size limit exceeded');
        return;
      }
      state.totalBytesReceived += data.length;
      state.lastChunkTimestamp = Date.now();
      // TODO: Pipe to STT Pipeline
    } else {
      // TEXT PATH: Testing/Probe Path
      const text = data.toString();

      // [BARGE-IN HANDLING]
      if (state.isLLMGenerating) {
        logger.warn({ candidateId, phase: 'BARGE_IN' }, `[🛑 STOP_AI]: Interrupted by ${candidateId}. Aborting current reply.`);
        state.abortController.abort();
        state.abortController = new AbortController();
      }

      state.isLLMGenerating = true;

      try {
        const brainStream = streamGeminiResponse(text, candidateId, state.abortController.signal);

        for await (const sentence of brainStream) {
          ws.send(JSON.stringify({ type: 'text', content: sentence }));
        }
      } catch (err) {
        // Logged in pipeline
      } finally {
        state.isLLMGenerating = false;
      }
    }
  };

  const handleClose = () => {
    if (!state.isActive) return;
    state.isActive = false;
    
    state.abortController.abort(); // Kill all pending AI tasks

    (async () => {
      try {
        logger.info({ candidateId, phase: 'TEARDOWN' }, `[💾 SAVING_WORK]: Closing session for ${candidateId}.`);
        // Mocking performEvaluation for stability
        await Promise.resolve();
        logger.info({ candidateId, phase: 'TEARDOWN' }, `[✅ DONE]: Cleanup complete for ${candidateId}. Memory released.`);
      } catch (err) {
        logger.error({ candidateId, phase: 'TEARDOWN', err }, 'Teardown failure');
      }
    })();
  };

  ws.on('message', (data, isBinary) => handleMessage(data, isBinary));
  ws.on('close', handleClose);
  ws.on('error', (err) => {
    logger.error({ candidateId, phase: 'HANDSHAKE', err }, 'Stream error');
    handleClose();
  });
};
