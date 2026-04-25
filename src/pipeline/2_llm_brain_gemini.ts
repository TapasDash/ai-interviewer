import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

// This is where we talk to the Gemini brain!
const MODEL = "models/gemini-2.0-flash-exp";
const HOST = "generativelanguage.googleapis.com";
const URL = `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

// Cerberus is our tough but fair interviewer persona.
const SYSTEM_PROMPT = "You are Cerberus, a brutal Principal Engineer. Grill the candidate on system design and memory leaks. Max 2 punchy sentences.";

/**
 * This function sets up a new connection to Gemini's live brain.
 */
export const initGeminiLive = (
  candidateId: string,
  onReply: (text: string) => void,
  onTranscript?: (text: string) => void
) => {
  const ws = new WebSocket(URL);
  let sentenceBuffer = '';

  // A simple helper to send messages to the brain.
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  // We use this to send text to the brain so it knows we're ready to chat.
  const sendText = (text: string) => {
    send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true
      }
    });
  };

  ws.on('open', () => {
    logger.info({ candidateId }, `[🧬 READY]: Connected to the Gemini brain!`);
    
    // First, we tell the brain who it should be (Cerberus).
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
      
      // We check what kind of message the brain just sent us.
      const messageType = Object.keys(response)[0];
      
      if (response.setupComplete) {
        logger.info({ candidateId }, `[✅ OK]: The brain is ready and waiting!`);
        return;
      }

      // If the brain is talking, we catch its words here.
      if (response.serverContent?.modelTurn?.parts) {
        const parts = response.serverContent.modelTurn.parts;
        const token = parts[0]?.text || '';

        if (token) {
          sentenceBuffer += token;
          // If we see a period or question mark, we know it finished a sentence.
          if (/[.!?\n]/.test(token)) {
            const cleanSentence = sentenceBuffer.trim();
            if (cleanSentence) {
              logger.info({ candidateId }, `[🧠 THINKING]: Cerberus said: ${cleanSentence}`);
              onReply(cleanSentence);
            }
            sentenceBuffer = '';
          }
        }
      }

      // If the brain heard you talking, it writes down what you said.
      if (response.serverContent?.interimResults?.[0]?.alternatives?.[0]?.transcript) {
        const transcript = response.serverContent.interimResults[0].alternatives[0].transcript;
        if (onTranscript) {
          logger.info({ candidateId }, `[📝 WRITING]: I think you said: "${transcript}"`);
          onTranscript(transcript);
        }
      }

    } catch (err) {
      logger.error({ candidateId, err }, 'Oops! Something went wrong reading the brain\'s message.');
    }
  });

  ws.on('error', (err) => {
    logger.error({ candidateId, err }, 'The connection to the brain had a little hiccup.');
  });

  // We return these tools so the rest of the app can use the brain.
  return {
    sendAudio: (buffer: Buffer) => {
      // We send your voice data to the brain here.
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
