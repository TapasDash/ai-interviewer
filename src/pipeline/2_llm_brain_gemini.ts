import logger from '../utils/logger.js';

/**
 * [ARCHITECT PROTOCOL - LLM BRAIN]
 * We utilize Gemini 1.5 Flash for its sub-second TBT (Time Between Tokens).
 * By using native fetch + SSE, we eliminate the 15MB overhead of the Google SDK.
 * The sentence-boundary buffer is the only 'hoarding' allowed, required to
 * provide semantic stability for the downstream TTS mouth.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

/**
 * INTENT: Execute a streaming inference call to Gemini and yield text in semantic sentence chunks./**
 * INTENT: Execute a streaming inference call to Gemini and yield text in semantic sentence chunks.
 * 
 * LOGIC:
 * 1. Initialize native fetch with AbortSignal for instant barge-in teardown.
 * 2. Process the ReadableStream line-by-line to extract SSE 'data:' payloads.
 * 3. Buffer text tokens until a sentence boundary (., !, ?, \n) is detected.
 * 4. Yield the sentence chunk and flush the buffer to maintain memory safety.
 */
export async function* streamGeminiResponse(
  prompt: string,
  candidateId: string,
  signal: AbortSignal
): AsyncGenerator<string> {
  let sentenceBuffer = '';

  try {
    logger.debug({ candidateId, phase: 'REASONING' }, `[⚡ BRAIN_INIT]: Calling Gemini 1.5 Flash for prompt: "${prompt.substring(0, 20)}..."`);

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7,
        },
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partialLine = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = (partialLine + chunk).split('\n');
      partialLine = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        try {
          const jsonStr = line.replace('data: ', '');
          const data = JSON.parse(jsonStr);
          const token = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

          if (token) {
            logger.debug({ candidateId, phase: 'REASONING' }, `[🌊 STREAM_RAW]: Received token: '${token.replace(/\n/g, '\\n')}'`);
            
            sentenceBuffer += token;
            logger.debug({ candidateId, phase: 'REASONING' }, `[🧩 BUFFERING]: Current Buffer: '${sentenceBuffer.trim()}'`);

            // [SENTENCE BOUNDARY DETECTION]
            if (/[.!?\n]/.test(token)) {
              const cleanSentence = sentenceBuffer.trim();
              if (cleanSentence) {
                logger.debug({ candidateId, phase: 'REASONING' }, `[📤 SENTENCE_FLUSH]: Sentence boundary found. Yielding: '${cleanSentence}'`);
                yield cleanSentence;
              }
              sentenceBuffer = ''; 
            }
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (sentenceBuffer.trim()) {
      logger.debug({ candidateId, phase: 'REASONING' }, `[📤 SENTENCE_FLUSH]: Final stream flush: '${sentenceBuffer.trim()}'`);
      yield sentenceBuffer.trim();
    }

  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.warn({ candidateId, phase: 'BARGE_IN' }, `[🛑 ABORT]: Gemini reasoning stream killed mid-flight.`);
    } else {
      logger.error({ candidateId, phase: 'REASONING', err }, 'Gemini stream fatal error');
      throw err;
    }
  }
}

