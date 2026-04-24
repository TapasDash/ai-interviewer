import logger from '../utils/logger.js';

/**
 * [ARCHITECT PROTOCOL - THE BRAIN]
 * We utilize Gemini 1.5 Flash via native SSE to minimize TTFAB (Time to First Audio Byte).
 * Memory Physics: All state is local to the generator execution context. 
 * Once the generator settles, the closure is released for instant V8 reclamation.
 */

/**
 * INTENT: Stream raw AI tokens and yield semantic sentence units.
 * 
 * LOGIC:
 * 1. Establish an SSE connection to Gemini using native fetch and an AbortSignal.
 * 2. Parse the stream line-by-line to extract tokenized text payloads.
 * 3. Buffer characters until a terminal boundary (., !, ?, \n) is detected.
 * 4. Yield the clean sentence and flush the buffer to prevent memory leaks.
 */
export async function* streamGeminiResponse(
  prompt: string,
  candidateId: string,
  signal: AbortSignal
): AsyncGenerator<string> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  
  let sentenceBuffer = '';


  try {
    logger.debug({ candidateId, phase: 'REASONING' }, `[⚡ BRAIN_INIT]: Calling Gemini 1.5 Flash...`);

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
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
            logger.debug({ candidateId, phase: 'REASONING' }, `[🌊 STREAM_RAW]: '${token.replace(/\n/g, '\\n')}'`);
            
            sentenceBuffer += token;
            logger.debug({ candidateId, phase: 'REASONING' }, `[🧩 BUFFERING]: '${sentenceBuffer.trim()}'`);

            // [SENTENCE BOUNDARY DETECTION]
            if (/[.!?\n]/.test(token)) {
              const cleanSentence = sentenceBuffer.trim();
              if (cleanSentence) {
                logger.debug({ candidateId, phase: 'REASONING' }, `[📤 SENTENCE_FLUSH]: '${cleanSentence}'`);
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

    // Final flush for remaining tokens
    if (sentenceBuffer.trim()) {
      logger.debug({ candidateId, phase: 'REASONING' }, `[📤 SENTENCE_FLUSH]: '${sentenceBuffer.trim()}'`);
      yield sentenceBuffer.trim();
    }

  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.warn({ candidateId, phase: 'BARGE_IN' }, `[🛑 ABORT]: Gemini stream killed.`);
    } else {
      logger.error({ candidateId, phase: 'REASONING', err }, 'Gemini stream fatal error');
      throw err;
    }
  }
}
