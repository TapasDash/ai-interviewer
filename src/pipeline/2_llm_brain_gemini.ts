import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

// We're using the brand new Gemini 2.5 Flash for faster responses!
const MODEL = "models/gemini-2.5-flash";
const HOST = "generativelanguage.googleapis.com";
const URL = `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

// This is how Cerberus should act during the interview.
const SYSTEM_PROMPT = "You are Cerberus, a brutal Principal Engineer. Grill the candidate on system design and memory leaks. Max 2 punchy sentences.";

/**
 * This sets up the connection to Gemini and gives us back some tools to use it.
 */
export const initGeminiLive = (
  candidateId: string,
  onReply: (text: string) => void,
  onTranscript?: (text: string) => void
) => {
  const ws = new WebSocket(URL);
  let sentenceBuffer = '';

  // Helper to send data to Gemini as a JSON string.
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  // Helper to send text messages (turns) to the brain.
  const sendText = (text: string) => {
    send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true
      }
    });
  };

  ws.on('open', () => {
    logger.info({ candidateId }, `[✅ READY]: Cerberus is awake and listening!`);
    
    // We send a 'setup' message first to tell Gemini which model and persona to use.
    send({
      setup: {
        model: MODEL,
        generationConfig: { responseModalities: ["TEXT"] },
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        }
      }
    });
  });

  ws.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());

      // If Gemini has finished setting up, we're good to go.
      if (response.setupComplete) {
        return;
      }

      // If the brain sends us back some text tokens, we build them into sentences.
      if (response.serverContent?.modelTurn?.parts) {
        const parts = response.serverContent.modelTurn.parts;
        const token = parts[0]?.text || '';

        if (token) {
          sentenceBuffer += token;
          // When we see a sentence-ending character, we send the whole thing back.
          if (/[.!?\n]/.test(token)) {
            const cleanSentence = sentenceBuffer.trim();
            if (cleanSentence) {
              logger.info({ candidateId }, `[💬 REPLY]: Cerberus says: ${cleanSentence}`);
              onReply(cleanSentence);
            }
            sentenceBuffer = '';
          }
        }
      }

      // If the brain transcribed what the user said, we can log it here.
      if (response.serverContent?.interimResults?.[0]?.alternatives?.[0]?.transcript) {
        const transcript = response.serverContent.interimResults[0].alternatives[0].transcript;
        if (onTranscript) onTranscript(transcript);
      }

    } catch (err) {
      logger.error({ candidateId, err }, 'Something went wrong while reading the brain\'s response.');
    }
  });

  ws.on('error', (err) => {
    logger.error({ candidateId, err }, 'The brain connection hit a snag.');
  });

  // We return these functions so we can send audio or text from outside.
  return {
    sendAudio: (buffer: Buffer) => {
      send({
        realtimeInput: {
          mediaChunks: [{
            mimeType: "audio/pcm;rate=16000",
            data: buffer.toString('base64')
          }]
        }
      });
    },
    sendText,
    close: () => ws.close()
  };
};
