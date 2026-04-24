/**
 * ============================================================================
 * PROJECT CERBERUS: THE MENTAL SANDBOX
 * ARCHITECTURAL BREAKDOWN FOR SUB-1000MS STREAMING
 * ============================================================================
 *
 * Forget REST. Forget HTTP requests. You are no longer building a website; 
 * you are managing a live municipal water supply. Data never stops, and if 
 * a pipe backs up, the server drowns.
 *
 * 1. THE PLUMBING ANALOGY
 * ----------------------------------------------------------------------------
 * Think of the WebSocket connection as a massive, bidirectional water main 
 * hooked directly to the user's house. 
 * - `server.js` is the main pumping station. It accepts the raw water main 
 * connection and routes it to an isolated neighborhood.
 * - `session.js` is the manifold for that specific user. 
 * - The data chunks (binary arrays) are the water. 
 * - Streams are the pipes. They do not hold water; they just pass it along 
 * as fast as it arrives.
 * - The `AbortController` is an explosive shutoff valve. If the user interrupts, 
 * we detonate the valve, instantly stopping the flow of AI-generated water.
 *
 * 2. TRACING THE WORD "HELLO"
 * ----------------------------------------------------------------------------
 * The user speaks the word "Hello". The microphone does not wait for a full 
 * sentence. It immediately chops the raw soundwaves of the "H" into a binary 
 * array and fires it down the WebSocket.
 * * - INGRESS: The chunk hits `server.js` and gets handed to `session.js`.
 * - PASS-THROUGH: `handleAudioIngestion` grabs the chunk. It does NOT save it 
 * to a variable. It instantly pipes it into the Sarvam Saaras (STT) WebSocket.
 * - TRANSLATION: Saaras buffers the audio on its end. Once it hears the full 
 * "Hello", it fires a text string back down its pipe to Node.
 * - REASONING: Node catches the text "Hello" and immediately pushes it into 
 * the Sarvam 105b (LLM) HTTP stream.
 * - GENERATION: The LLM processes the text and streams back the word "Hi".
 * - VOCALIZATION: Node catches "Hi", throws it into the OpenAI TTS pipe. OpenAI 
 * fires back a binary audio chunk of a synthesized voice saying "Hi".
 * - EGRESS: Node catches that binary chunk and flushes it straight down the main 
 * user WebSocket. The user hears "Hi" in their ear. 
 * * Zero disk writes. Zero waiting for full responses. Pure kinetic momentum.
 *
 * 3. THE "WHY" OF THE CLOSURE BUBBLE (MEMORY PHYSICS)
 * ----------------------------------------------------------------------------
 * We strictly use pure functional programming here. Zero object-oriented classes. 
 * If you use `class Session { ... }`, the methods are bound to `this`. When you 
 * attach class methods to WebSocket event listeners (like `ws.on('message', this.handle)`), 
 * you create a permanent link in the V8 engine's memory heap. If the user's 
 * internet suddenly cuts out and the socket drops unexpectedly, that class 
 * instance remains trapped in memory. Over 10,000 calls, your server runs out 
 * of RAM and violently crashes.
 * * Instead, we use `const createSession = (ws) => { ... }`. 
 * This creates a "Closure Bubble". Every variable, every state, every function 
 * exists solely inside that specific function call. When the `ws` drops, there 
 * is no `this` holding the bubble down. The Node.js Garbage Collector sweeps 
 * through, sees an unattached bubble, and pops it. 100% of the memory is 
 * instantly freed.
 *
 * 4. THE TRAFFIC LIGHTS & PINO LOGGER
 * ----------------------------------------------------------------------------
 * Because data is constantly flowing asynchronously, the system can get confused. 
 * If the STT is listening while the TTS is speaking, the AI will hear itself 
 * and start hallucinating. 
 * * The boolean variables inside the closure (`isLLMGenerating`, `isTTSPlaying`) 
 * are our traffic lights. They lock down certain pipes while others are active. 
 * * Pino is the tracking dye in the water supply. A standard `console.log` tells 
 * you "Water flowed." That is useless. 
 * Pino forces you to inject the `candidateId` into every log:
 * `logger.debug({ candidateId: state.id, phase: 'INGEST' }, 'Chunk received');`
 * * Now, when the server is handling 500 simultaneous interviews, every single 
 * drop of water is stamped with a barcode. If Candidate #402 has a latency 
 * spike, you filter the logs for `cand_402` and see the exact millisecond flow 
 * of their entire pipeline. 
 */