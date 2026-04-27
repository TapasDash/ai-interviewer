import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import logger from '../utils/logger.js';
import { initGeminiAgent } from '../pipeline/2_llm_brain_gemini.js';
import { generateSpeechStream } from '../pipeline/3_tts_openai.js';

/**
 * handleConnection: The Agentic Orchestration Layer.
 * Manages the transition from Autonomous Thought to Vocalization.
 */
export const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const candidateId = url.searchParams.get("candidateId") || "unknown_candidate";
  
  logger.info({ candidateId }, '[🤝 SESSION]: New candidate joined. Agentic mode active.');

  // Cascade State
  let currentTtsController: AbortController | null = null;

  const killAudio = () => {
    if (currentTtsController) {
      currentTtsController.abort();
      currentTtsController = null;
    }
  };

  /**
   * [AGENT STAGE]: Initialize Gemini Autonomous Agent
   */
  const agent = initGeminiAgent(
    candidateId,
    (token) => {
      // Stream text tokens for UI visibility
      ws.send(JSON.stringify({ type: 'text', content: token }));
    },
    async (sentence) => {
      /**
       * [MOUTH STAGE]: Vocalize the Agent's thought
       */
      killAudio();
      currentTtsController = new AbortController();
      
      // Safety check: Don't attempt TTS if API key is missing
      if (!process.env.OPENAI_API_KEY) {
        logger.warn({ candidateId }, '[⚠️ TTS_DISABLED]: OPENAI_API_KEY missing. Text-only mode.');
        return;
      }

      await generateSpeechStream(
        candidateId,
        sentence,
        (audioChunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(audioChunk, { binary: true });
          }
        },
        currentTtsController.signal
      );
    }
  );

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Future STT integration
    } else {
      try {
        const payload = JSON.parse(data.toString());
        
        if (payload.type === 'text') {
          killAudio(); 

          if (payload.content === 'START_INTERVIEW') {
            logger.info({ candidateId }, '[🔥 IGNITION]: Starting agentic interrogation.');
            agent.processText("The candidate just joined. Start the interview. Evaluate their backend expertise.");
          } else if (payload.content === 'STOP_AI') {
            logger.info({ candidateId }, '[🛑 BARGE_IN]: Stopping vocalization.');
          } else {
            agent.processText(payload.content);
          }
        }
      } catch (err) {
        logger.error({ candidateId, err }, 'Failed to parse text frame.');
      }
    }
  });

  ws.on('close', () => {
    logger.info({ candidateId }, '[👋 EXIT]: Candidate disconnected.');
    killAudio();
  });

  ws.on('error', (err) => {
    logger.error({ candidateId, err }, 'WebSocket manifold error.');
  });
};
