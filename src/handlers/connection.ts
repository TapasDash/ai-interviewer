import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SessionState } from '../types/session.js';
import logger from '../utils/logger.js';
import { streamGeminiResponse } from '../pipeline/2_llm_brain_gemini.js';

/**
 * [ARCHITECT PROTOCOL - THE CONNECTION MANIFOLD]
 * Pure functional orchestrator for the AI interview lifecycle.
 */

const MAX_CHUNK_SIZE = 16 * 1024; // 16KB strict MTU limit
const BYTES_PER_MS = 32; // 16000Hz * 2 bytes (Int16) / 1000ms

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
  let binaryChunkCount = 0; 

  logger.info({ candidateId, phase: 'HANDSHAKE' }, `[👤 USER_JOINED]: Candidate ${candidateId} connected.`);

  const handleMessage = async (data: any, isBinary: boolean) => {
    if (isBinary) {
      /** [📥 INGRESS_BINARY]: Raw PCM Capture */
      const buffer = data as Buffer;
      binaryChunkCount++;

      if (buffer.length > MAX_CHUNK_SIZE) {
        logger.warn({ candidateId, phase: 'INGEST', bytes: buffer.length }, `[⚠️ MEM_VIOLATION]: Dropping chunk #${binaryChunkCount}. Size exceeds 16KB.`);
        return;
      }

      const estimatedMs = Math.round(buffer.length / BYTES_PER_MS);
      state.totalBytesReceived += buffer.length;
      state.lastChunkTimestamp = Date.now();

      logger.debug({ candidateId, phase: 'INGEST', bytes: buffer.length, seq: binaryChunkCount }, `[📥 INGRESS_BINARY]: Chunk #${binaryChunkCount} received.`);
      logger.debug({ candidateId, phase: 'INGEST', estMs: estimatedMs, totalBytes: state.totalBytesReceived }, `[📊 AUDIO_STATS]: Received ~${estimatedMs}ms of audio.`);

      // TODO: Pipe to Sarvam STT
    } else {
      /** [📥 USER_SAID]: Text Ingress & Orchestration */
      let text = '';
      try {
        const payload = JSON.parse(data.toString());
        text = payload.content || '';
      } catch (err) {
        logger.warn({ candidateId, phase: 'INGEST', err }, 'Failed to parse text ingress JSON');
        return;
      }

      if (!text) return;
      logger.debug({ candidateId, phase: 'INGEST' }, `[📥 USER_SAID]: ${candidateId} -> ${text}`);

      // BARGE-IN: Kill current stream and reset the valve
      if (state.isLLMGenerating) {
        logger.warn({ candidateId, phase: 'BARGE_IN' }, `[🛑 STOP_AI]: Interrupted by ${candidateId}. Aborting current reply.`);
        state.abortController.abort();
        state.abortController = new AbortController();
      }

      // [ATOMIC TRAFFIC LIGHT FIX]
      // Capture the current signal to prevent late-finishing aborted streams from turning off the active light.
      const currentSignal = state.abortController.signal;
      state.isLLMGenerating = true;

      try {
        const brainStream = streamGeminiResponse(text, candidateId, currentSignal);

        for await (const sentence of brainStream) {
          // [SOCKET SAFETY GUARD]: Prevent Node.js crash on dropped socket
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'text', content: sentence }));
          }
        }
      } catch (err) {
        // Traced in pipeline
      } finally {
        // Only turn off the light if we are the current active stream
        if (state.abortController.signal === currentSignal) {
          state.isLLMGenerating = false;
        }
      }
    }
  };

  const handleClose = () => {
    if (!state.isActive) return;
    state.isActive = false;
    state.abortController.abort(); 

    (async () => {
      try {
        logger.info({ candidateId, phase: 'TEARDOWN' }, `[💾 SAVING_WORK]: Closing session for ${candidateId}.`);
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
