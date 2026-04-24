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
  let binaryChunkCount = 0; // Closure-scoped sequence counter

  logger.info({ candidateId, phase: 'HANDSHAKE' }, `[👤 USER_JOINED]: Candidate ${candidateId} connected.`);

  const handleMessage = async (data: any, isBinary: boolean) => {
    if (isBinary) {
      /**
       * [ARCHITECT PROTOCOL - FORENSIC INGESTION]
       * We treat every binary chunk as a high-frequency temporal event.
       */
      const buffer = data as Buffer;
      binaryChunkCount++;

      // THE 16KB LAW
      if (buffer.length > MAX_CHUNK_SIZE) {
        logger.warn({ 
          candidateId, 
          phase: 'INGEST', 
          bytes: buffer.length 
        }, `[⚠️ MEM_VIOLATION]: Dropping chunk #${binaryChunkCount}. Size ${buffer.length} exceeds 16KB limit.`);
        return;
      }

      const estimatedMs = Math.round(buffer.length / BYTES_PER_MS);
      state.totalBytesReceived += buffer.length;
      state.lastChunkTimestamp = Date.now();

      logger.debug({ 
        candidateId, 
        phase: 'INGEST', 
        bytes: buffer.length,
        seq: binaryChunkCount 
      }, `[📥 INGRESS_BINARY]: Chunk #${binaryChunkCount} received.`);

      logger.debug({
        candidateId,
        phase: 'INGEST',
        estMs: estimatedMs,
        totalBytes: state.totalBytesReceived
      }, `[📊 AUDIO_STATS]: Received ~${estimatedMs}ms of audio. Total: ${state.totalBytesReceived} bytes.`);

      // TODO: [PHASE 1 - THE EAR]
      // Pipe raw buffer to Sarvam Saaras STT WebSocket here.
      // saarasSocket.send(buffer);

    } else {
      // TEXT PATH: Testing/Probe Path
      const text = data.toString();
      logger.debug({ candidateId, phase: 'INGEST' }, `[📥 USER_SAID]: ${candidateId} -> ${text}`);

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
