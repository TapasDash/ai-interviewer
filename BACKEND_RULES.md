# BACKEND SYSTEM DIRECTIVE: PROJECT CERBERUS (REAL-TIME VOICE)

## 0. THE CORE DIRECTIVE (BEHAVIORAL PROTOCOL)
**MISSION: Sub-1000ms Latency. Zero Memory Leaks. No-BS Execution.**
This is not a standard REST API. This is a high-frequency binary streaming engine. Standard web development rules do not apply here.

* **SPEED IS GOD:** Every architectural decision must optimize for TTFAB (Time to First Audio Byte).
* **SIMPLICITY OVER ABSTRACTION:** Write the minimum amount of code required to pipe data from Point A to Point B.
* **FAIL FAST, RECOVER INSTANTLY:** If an audio stream drops or a socket hangs, kill the session immediately. Do not attempt complex retry loops that block the main Node event loop.

## 1. PROJECT OVERVIEW & TECH STACK
* **Environment:** Standalone Node.js (v22+ LTS) Container (AWS `ap-south-1`). Strictly NO Serverless/Vercel.
* **Language:** TypeScript (Strict Mode).
* **Ingress Protocol:** WebSockets (`ws` library).
* **The AI Cascade:**
    * **STT (Ear):** Sarvam Saaras v3 (WebSocket).
    * **LLM (Brain):** Sarvam 105b (Streaming).
    * **TTS (Mouth):** OpenAI `tts-1` (Streaming HTTP to Binary Pipe).
* **Database:** MongoDB (Pre-fetch candidate JSON, post-save evaluation scorecard).

## 2. CORE ARCHITECTURE: THE FUNCTIONAL CASCADE
We use a **Pure Functional Streaming Pipeline**. We do not use MVC or Domain Modules. The architecture is defined entirely by how binary audio flows through the system state closures.

```text
└── src/
    ├── index.ts                 // HTTP/WS Server Bootstrap
    ├── handlers/
    │   └── connection.ts        // Core WS lifecycle & Session State Closure
    ├── pipeline/
    │   ├── 1_stt_saaras.ts      // Pipes binary audio -> Text 
    │   ├── 2_llm_brain.ts       // Pipes Text -> Streaming AI response
    │   └── 3_tts_openai.ts      // Pipes AI text -> Binary Audio chunk -> Client
    └── db/
        └── mongo.ts             // Dumb DB driver (Fetch resume / Save score)
```

---

## 3. STRICT CODING RULES (NON-NEGOTIABLE)

1.  **PURE FUNCTIONAL PROGRAMMING (NO OOP):** Strictly ban `class`, `this`, and `new` for state management. State must be trapped in pure closures. Classes cause memory leaks when handling thousands of concurrent binary chunks. When the socket closes, the closure bubble must pop for instant V8 garbage collection.
2.  **NO BUFFER HOARDING:** NEVER wait for a full audio file or full LLM response to generate before acting. You must pipe streams natively. If a function waits for `done: true` before sending data to the client, it is an architectural failure.
3.  **MEMORY SAFETY (THE 16KB RULE):** Incoming WebSocket chunks must be validated. If `message.byteLength > 16384` (16KB), drop the chunk or kill the socket. This prevents malicious clients from blowing up the Node heap.
4.  **EXPLICIT BARGE-IN HANDLING (ABORT CONTROLLERS):** If the STT engine detects the candidate is speaking (`START_SPEECH` event), any active LLM generation or TTS playback MUST BE ABORTED IMMEDIATELY using `AbortController`. The AI must "shut up" when interrupted. Tear down the stream mid-flight asynchronously.
5.  **DUMB MONGODB USAGE:** Mongo is used for two things only: Fetching the candidate's JSON resume on connection (Context), and saving the final JSON scorecard on disconnection (Evaluation). Do not use complex Mongoose populations or middlewares. Use the native driver or ultra-lightweight schemas.

---

## 4. THE EXECUTION PIPELINE (THE DATA FLOW)

* **PHASE 1 (Handshake):** Client connects via WebSocket (`?candidateId=123`). Node establishes the closure state and asynchronously pulls the resume from MongoDB.
* **PHASE 2 (Ingest):** Client streams raw audio. Node validates chunk size and pipes directly to Sarvam Saaras without touching the disk.
* **PHASE 3 (Trigger):** Sarvam Saaras detects a complete thought/sentence and yields a text string.
* **PHASE 4 (Reasoning):** Node sends the text + candidate resume context to Sarvam 105b LLM.
* **PHASE 5 (Playback):** As the LLM yields text tokens, Node buffers them into complete sentences and fires them to OpenAI TTS. OpenAI yields audio buffers, which Node instantly pipes back down the WebSocket to the client.
* **PHASE 6 (Teardown):** On WS disconnect, trigger a background worker to summarize the transcript, grade the candidate, and push the JSON scorecard to MongoDB.

## 5. DEPLOYMENT & ENVIRONMENT RULES

1.  **NATIVE TYPESCRIPT EXECUTION:** We use Node's native TS execution (`--experimental-strip-types`) or ultra-fast transpilation (`tsx`). We do not use slow build steps like `tsc` for local dev.
2.  **CLOUD-NAKED PRINCIPLE:** Assume the AWS container is completely dumb. ALL API keys (Sarvam, OpenAI, Mongo) must be injected explicitly via the environment.
3.  **ZOMBIE SOCKET CLEANSING:** Implement a heartbeat (Ping/Pong) every 30 seconds. If a client drops connection without sending a close frame, the server must destroy the session closure and clear memory within 45 seconds to prevent ghost sessions from eating RAM.

---

## 6. THE ARCHITECT PROTOCOL (INTERNAL COMMENTING STANDARDS)

All code contributed by Antigravity must include **Principal Architect Commentary**. Every non-trivial block of code must explain:
*   **The Closure Physics:** Why a functional closure is used and how it aids V8 Garbage Collection.
*   **The Pipe Mechanics:** How binary data is being streamed and how backpressure is managed.
*   **Latency Rationale:** Why a logic block is prioritized to optimize for TTFAB (Time to First Audio Byte).
*   **Memory Safety:** Explicit justification for buffer limits and reclamation strategies.
*   **Abort Mechanics:** How the `AbortController` is propagated to kill AI streams during barge-ins.

**TONE:** High-performance, elite-tier engineering. Every line of code must justify its existence in a sub-1000ms environment.
