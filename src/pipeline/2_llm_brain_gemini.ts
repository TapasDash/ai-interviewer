import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

/**
 * [ARCHITECT PROTOCOL - THE MULTIMODAL BRAIN]
 * Establishing a bi-directional WebSocket uplink to Gemini 2.0 Flash.
 * VERSION: v1beta (Corrected)
 */

const MODEL = "models/gemini-2.0-flash-exp";
const HOST = "generativelanguage.googleapis.com";
const URL = `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

const SYSTEM_PROMPT = "You are Cerberus, a brutal Principal Engineer. Grill the candidate on system design and memory leaks. Max 2 punchy sentences.";

/**
 * initGeminiLive: Factory function for the Multimodal Live Pipeline.
 * 
 * LOGIC:
 * 1. Open WSS to the BidiGenerateContent endpoint via v1beta.
 * 2. Transmit the 'setup' frame using the established camelCase schema.
 * 3. Handle binary audio (realtimeInput) and text turns (clientContent).
 */
export const initGeminiLive = (
  candidateId: string,
  onReply: (text: string) => void,
  onTranscript?: (text: string) => void
) => {
  const ws = new WebSocket(URL);
  let sentenceBuffer = '';

  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  ws.on('open', () => {
    logger.info({ candidateId, phase: 'REASONING' }, `[🧬 LIVE_UPLINK]: Handshake established with Gemini 2.0 Flash Exp.`);
    
    // THE SETUP FRAME
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

      // [📤 AI_REPLYING]: Parsing response tokens
      if (response.serverContent?.modelTurn?.parts) {
        const parts = response.serverContent.modelTurn.parts;
        const token = parts[0]?.text || '';

        if (token) {
          sentenceBuffer += token;
          if (/[.!?\n]/.test(token)) {
            const cleanSentence = sentenceBuffer.trim();
            if (cleanSentence) {
              logger.debug({ candidateId, phase: 'REASONING' }, `[📤 AI_REPLYING]: ${cleanSentence}`);
              onReply(cleanSentence);
            }
            sentenceBuffer = '';
          }
        }
      }

      // [📝 STT_FINAL]: Parsing user transcription
      if (response.serverContent?.interimResults?.[0]?.alternatives?.[0]?.transcript) {
        const transcript = response.serverContent.interimResults[0].alternatives[0].transcript;
        if (onTranscript) {
          logger.info({ candidateId, phase: 'STT' }, `[📝 STT_FINAL]: "${transcript}"`);
          onTranscript(transcript);
        }
      }

    } catch (err) {
      logger.error({ candidateId, phase: 'REASONING', err }, 'Failed to parse Gemini message');
    }
  });

  ws.on('error', (err) => {
    logger.error({ candidateId, phase: 'REASONING', err }, 'Gemini Live WebSocket error');
  });

  return {
    sendAudio: (buffer: Buffer) => {
      logger.debug({ candidateId, phase: 'INGEST', bytes: buffer.length }, `[🌊 AUDIO_IN]: ${buffer.length} bytes -> Brain.`);
      send({
        realtimeInput: {
          mediaChunks: [{
            mimeType: "audio/pcm;rate=16000",
            data: buffer.toString('base64')
          }]
        }
      });
    },
    sendText: (text: string) => {
      send({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true
        }
      });
    },
    close: () => ws.close()
  };
};
