import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SessionState } from '../types/session.js';
import logger from '../utils/logger.js';
import { initGeminiLive } from '../pipeline/2_llm_brain_gemini.js';

// We cap messages at 16KB to keep memory usage low and safe.
const MAX_CHUNK_SIZE = 16 * 1024;

/**
 * Creates a fresh session object to keep track of our user.
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
 * Handles a new user connecting over a WebSocket.
 */
export const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const candidateId = url.searchParams.get('candidateId');

  // We need an ID to know who we're talking to!
  if (!candidateId) {
    logger.warn('Someone tried to connect without an ID.');
    ws.close(1008, 'Missing candidateId');
    return;
  }

  const state = createSession(candidateId);
  let chunkCounter = 0; 
  
  // Connect to the Gemini 2.5 Flash brain.
  const gemini = initGeminiLive(
    candidateId,
    (sentence) => {
      // When the brain speaks, we send it back to the user's screen.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text', content: sentence }));
      }
    }
  );

  logger.info({ candidateId }, `[✅ READY]: Cerberus is awake and listening!`);

  const handleMessage = async (data: any, isBinary: boolean) => {
    if (isBinary) {
      // Memory safety check.
      if (data.length > MAX_CHUNK_SIZE) {
        logger.warn({ candidateId }, `A voice message was too big to handle.`);
        return;
      }

      chunkCounter++;
      state.totalBytesReceived += data.length;
      state.lastChunkTimestamp = Date.now();

      // We only log the mic pulse every 10 chunks to keep the terminal tidy.
      if (chunkCounter % 10 === 0) {
        logger.info({ candidateId }, `[🎤 MIC]: I can hear you talking...`);
      }

      // Pipe the voice data straight into the brain.
      gemini.sendAudio(data);

    } else {
      // Handle text messages coming from the tester page.
      let text = '';
      try {
        const payload = JSON.parse(data.toString());
        text = payload.content || '';
      } catch (err) {
        logger.warn({ candidateId }, 'Couldn\'t read that text message.');
        return;
      }

      if (!text) return;

      // Special 'Ignition' command to start the interview.
      if (text === 'START_INTERVIEW') {
        logger.info({ candidateId }, `[🚀 START]: Kickstarting the interview now.`);
        gemini.sendText("The candidate just joined. Say hello as Cerberus and ask them to explain how they handle heavy data loads in Node.js.");
        return;
      }

      logger.info({ candidateId }, `[🧠 BRAIN]: Cerberus is thinking about what you said...`);
      gemini.sendText(text);
    }
  };

  /**
   * Cleans up everything when the user disconnects.
   */
  const handleClose = () => {
    if (!state.isActive) return;
    state.isActive = false;
    
    state.abortController.abort(); 
    gemini.close();

    (async () => {
      try {
        logger.info({ candidateId }, `Saving the session before saying goodbye.`);
        await Promise.resolve();
        logger.info({ candidateId }, `[👋 BYE]: All finished for ${candidateId}.`);
      } catch (err) {
        logger.error({ candidateId, err }, 'Had a little trouble cleaning up the session.');
      }
    })();
  };

  ws.on('message', (data, isBinary) => handleMessage(data, isBinary));
  ws.on('close', handleClose);
  ws.on('error', (err) => {
    logger.error({ candidateId, err }, 'The connection had an unexpected error.');
    handleClose();
  });
};
