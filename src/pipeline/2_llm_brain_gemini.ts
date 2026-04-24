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
      signal, // [BARGE-IN] Atomic kill-switch
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partialLine = '';

    logger.debug({ candidateId, phase: 'REASONING' }, 'Gemini stream connection established');

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
            sentenceBuffer += token;

            // [SENTENCE BOUNDARY DETECTION]
            // We only yield when the AI completes a thought. This prevents 
            // the TTS engine from stuttering on fragmented chunks.
            if (/[.!?\n]/.test(token)) {
              const cleanSentence = sentenceBuffer.trim();
              if (cleanSentence) {
                logger.debug({ 
                  candidateId, 
                  phase: 'REASONING', 
                  chunkSize: cleanSentence.length 
                }, 'Yielding sentence chunk');
                
                yield cleanSentence;
              }
              sentenceBuffer = ''; // Flush memory immediately
            }
          }
        } catch (e) {
          // SSE streams often have trailing noise or [DONE] markers
          continue;
        }
      }
    }

    // Final flush for any remaining text without a trailing punctuation
    if (sentenceBuffer.trim()) {
      yield sentenceBuffer.trim();
    }

  } catch (err: any) {
    if (err.name === 'AbortError') {
      logger.warn({ candidateId, phase: 'BARGE_IN' }, 'Gemini reasoning stream aborted mid-flight');
    } else {
      logger.error({ candidateId, phase: 'REASONING', err }, 'Gemini stream fatal error');
      throw err;
    }
  } finally {
    logger.info({ candidateId, phase: 'REASONING' }, 'Gemini Reasoning complete');
  }
}
