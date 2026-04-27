import OpenAI from 'openai';
import logger from '../utils/logger.js';

/**
 * [ARCHITECT PROTOCOL - THE CASCADE MOUTH]
 * Version: v1 | Model: OpenAI TTS-1
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * generateSpeechStream: Pure functional wrapper for OpenAI TTS.
 * Streams raw binary audio chunks to the onAudio callback.
 */
export const generateSpeechStream = async (
  candidateId: string,
  text: string,
  onAudio: (chunk: Buffer) => void,
  abortSignal?: AbortSignal
) => {
  if (!process.env.OPENAI_API_KEY) {
    logger.error({ candidateId }, '[FATAL] OPENAI_API_KEY is missing!');
    return;
  }

  logger.info({ candidateId }, `[🎙️ TTS_START]: Vocalizing sentence: "${text.substring(0, 30)}..."`);
  const startTime = Date.now();
  let firstByte = true;

  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy", // "Cerberus" style voice
      input: text,
      response_format: "pcm" // Raw PCM 24kHz
    }, { signal: abortSignal });

    // The response.body is a readable stream in Node.js
    const reader = response.body;

    if (!reader) {
      throw new Error('Response body is null');
    }

    for await (const chunk of reader) {
      if (firstByte) {
        const ttfab = Date.now() - startTime;
        logger.info({ candidateId, ttfab }, `[⚡️ TTFAB]: First audio byte generated in ${ttfab}ms.`);
        firstByte = false;
      }
      
      // Emit raw binary chunk
      onAudio(chunk as Buffer);
    }

    logger.info({ candidateId }, '[🎙️ TTS_COMPLETE]: Vocalization finished.');

  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.info({ candidateId }, '[🛑 TTS_ABORT]: Audio generation killed (Barge-in).');
    } else {
      logger.error({ candidateId, err }, 'OpenAI TTS Error');
    }
  }
};
