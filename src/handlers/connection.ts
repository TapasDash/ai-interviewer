import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SessionState } from '../types/session.js';
import logger from '../utils/logger.js';
import { initGeminiLive } from '../pipeline/2_llm_brain_gemini.js';

/**
 * [ARCHITECT PROTOCOL - THE CONNECTION MANIFOLD]
 * Pure functional orchestrator for the Cerberus Live Pipeline.
 */

const MAX_CHUNK_SIZE = 16 * 1024; // 16KB strict MTU limit

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

export const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const candidateId = url.searchParams.get('candidateId');

  if (!candidateId) {
    logger.warn({ phase: 'HANDSHAKE' }, 'Connection rejected: Missing candidateId');
    ws.close(1008, 'Missing candidateId');
    return;
  }

  const state = createSession(candidateId);
  
  /**
   * [🧬 GEMINI LIVE INITIALIZATION]
   * Establishes the bi-directional pipe immediately.
   */
  const gemini = initGeminiLive(
    candidateId,
    (sentence) => {
      // AI Reply Logic: Guarded against dropped sockets
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text', content: sentence }));
      }
    },
    (transcript) => {
      // User Transcript Logic
      // This is primarily for forensic logging in Phase 2
    }
  );

  logger.info({ candidateId, phase: 'HANDSHAKE' }, `[👤 USER_JOINED]: Candidate ${candidateId} connected.`);

  const handleMessage = async (data: any, isBinary: boolean) => {
    if (isBinary) {
      /** [📥 INGRESS_BINARY]: Direct Piping to Gemini Live */
      if (data.length > MAX_CHUNK_SIZE) {
        logger.warn({ candidateId, phase: 'INGEST', bytes: data.length }, `[⚠️ MEM_VIOLATION]: Dropping chunk.`);
        return;
      }

      state.totalBytesReceived += data.length;
      state.lastChunkTimestamp = Date.now();

      // [🌊 AUDIO_IN]: Stream to Brain
      gemini.sendAudio(data);

    } else {
      /** [📥 USER_SAID]: Text Probe Path */
      let text = '';
      try {
        const payload = JSON.parse(data.toString());
        text = payload.content || '';
      } catch (err) {
        logger.warn({ candidateId, phase: 'INGEST', err }, 'Malformed JSON ingress');
        return;
      }

      if (!text) return;
      logger.debug({ candidateId, phase: 'INGEST' }, `[📥 USER_SAID]: ${candidateId} -> ${text}`);
      
      // Text-based prompting for Gemini Live can be added here if needed
    }
  };

  const handleClose = () => {
    if (!state.isActive) return;
    state.isActive = false;
    
    state.abortController.abort(); 
    gemini.close(); // Sever the AI link

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
