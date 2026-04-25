import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { SessionState } from '../types/session.js';
import logger from '../utils/logger.js';
import { initGeminiLive } from '../pipeline/2_llm_brain_gemini.js';

// We only let users send up to 16KB at a time to stay safe.
const MAX_CHUNK_SIZE = 16 * 1024;

/**
 * This helper creates a fresh "session box" to keep track of a user.
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
 * This is the main function that handles a new user connecting to us.
 */
export const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const candidateId = url.searchParams.get('candidateId');

  // If we don't know who you are, we can't start the chat!
  if (!candidateId) {
    logger.warn('Oops! Someone tried to join without an ID.');
    ws.close(1008, 'Missing candidateId');
    return;
  }

  // We set up a new box for this user's data.
  const state = createSession(candidateId);
  let voiceChunkCount = 0; 
  
  // We wake up the brain so it's ready to listen to this user.
  const gemini = initGeminiLive(
    candidateId,
    (sentence) => {
      // If the brain has something to say, we send it back to the user.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text', content: sentence }));
      }
    },
    (transcript) => {
      // The brain is writing down what you said!
    }
  );

  logger.info({ candidateId }, `[👋 HI]: A new person just joined the chat!`);

  /**
   * This part handles every message (voice or text) the user sends us.
   */
  const handleMessage = async (data: any, isBinary: boolean) => {
    if (isBinary) {
      // If it's voice data, we make sure it's not too big.
      if (data.length > MAX_CHUNK_SIZE) {
        logger.warn({ candidateId }, `[⚠️ WHOA]: That voice message was a bit too large!`);
        return;
      }

      voiceChunkCount++;
      state.totalBytesReceived += data.length;
      state.lastChunkTimestamp = Date.now();

      // Every 10 chunks, we let you know we're still listening.
      if (voiceChunkCount % 10 === 0) {
        logger.info({ candidateId }, `[🎤 LISTENING]: I'm still hearing you loud and clear...`);
      }

      // We pass your voice straight to the brain.
      gemini.sendAudio(data);

    } else {
      // If it's a text message, we try to read what it says.
      let text = '';
      try {
        const payload = JSON.parse(data.toString());
        text = payload.content || '';
      } catch (err) {
        logger.warn({ candidateId }, 'I had trouble reading that text message.');
        return;
      }

      if (!text) return;

      // If the user clicks "Start", we tell the brain to say hello.
      if (text === 'START_INTERVIEW') {
        logger.info({ candidateId }, `[🔥 KICKSTART]: Ready! Starting the interview now.`);
        gemini.sendText("The candidate has joined. Introduce yourself as Cerberus and ask the first system design question.");
        return;
      }

      logger.info({ candidateId }, `[💬 SAID]: User said: "${text}"`);
      gemini.sendText(text);
    }
  };

  /**
   * This part cleans everything up when the user leaves.
   */
  const handleClose = () => {
    if (!state.isActive) return;
    state.isActive = false;
    
    // We tell the brain we're done for now.
    state.abortController.abort(); 
    gemini.close();

    (async () => {
      try {
        logger.info({ candidateId }, `[💾 SAVING]: Just taking a quick note of our chat before we close.`);
        await Promise.resolve();
        logger.info({ candidateId }, `[✅ BYE]: All finished! Session is now closed.`);
      } catch (err) {
        logger.error({ candidateId, err }, 'I had a little trouble finishing the cleanup.');
      }
    })();
  };

  ws.on('message', (data, isBinary) => handleMessage(data, isBinary));
  ws.on('close', handleClose);
  ws.on('error', (err) => {
    logger.error({ candidateId, err }, 'There was a little trouble with the connection.');
    handleClose();
  });
};
