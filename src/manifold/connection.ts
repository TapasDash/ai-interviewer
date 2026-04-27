import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import logger from '../utils/logger.js';
import { mastra } from '../mastra/index.js';

/**
 * [ARCHITECT PROTOCOL - THE MANIFOLD UPLINK]
 * 
 * The Closure Physics:
 * Manages the transition from binary audio to agentic intelligence. State is entirely 
 * isolated within the closure bubble per connection, ensuring instant GC on socket close.
 * 
 * The Pipe Mechanics:
 * Gemini WebSocket -> STT (Transcript) -> Mastra Workflow -> Client WebSocket
 */
export const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const candidateId = url.searchParams.get("candidateId") || "unknown_candidate";
  
  logger.info({ candidateId }, '[🤝 SESSION]: Candidate connected. Initializing Manifold.');

  // Gemini Live WebSocket Upstream (v1beta)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error('[FATAL]: GEMINI_API_KEY is missing.');
    ws.close(1011, 'Server misconfiguration');
    return;
  }

  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  const geminiWs = new WebSocket(geminiWsUrl);

  // Barge-in / Interruption handling
  let isGenerating = false;
  let abortController = new AbortController();

  const resetManifold = () => {
    abortController.abort();
    abortController = new AbortController();
    isGenerating = false;
  };

  /**
   * Gemini Upstream Setup Message
   */
  geminiWs.on('open', () => {
    logger.info({ candidateId }, '[🔌 GEMINI_UPLINK]: Connected to Gemini v1beta Live.');
    const setupMsg = {
      setup: {
        model: "models/gemini-2.5-flash",
        generationConfig: {
          responseModalities: ["TEXT"] // Expecting STT out
        }
      }
    };
    geminiWs.send(JSON.stringify(setupMsg));
  });

  /**
   * Gemini Downstream Data (Text Transcripts)
   */
  geminiWs.on('message', async (data) => {
    try {
      const response = JSON.parse(data.toString());
      
      if (response.serverContent?.modelTurn?.parts) {
        const textParts = response.serverContent.modelTurn.parts.filter((p: any) => p.text);
        const transcript = textParts.map((p: any) => p.text).join(' ').trim();
        
        if (transcript) {
          logger.info({ candidateId, transcript }, '[🎤 EAR]: Transcript received from Gemini.');
          
          resetManifold(); // Barge-in behavior: new speech cancels ongoing thought
          isGenerating = true;

          logger.info({}, '[🧠 DIRECTOR]: Routing to Mastra Workflow.');
          
          const workflow = mastra.getWorkflow('interviewFlow');
          
          if (!workflow) {
            logger.error('[FATAL]: interviewFlow workflow not found in Mastra instance');
            return;
          }

          // Execute Mastra Workflow as the central brain
          const run = await workflow.createRun();
          const result = await run.start({ inputData: { input: transcript } });
          
          if (abortController.signal.aborted) return; // Dropped if barged in

          // Extract output from the workflow results
          if (result.status !== 'success') {
            logger.error({ status: result.status }, '[🧠 DIRECTOR]: Workflow failed or suspended.');
            isGenerating = false;
            return;
          }

          const outputData = (result.result as { output?: string })?.output;
          
          if (outputData && isGenerating) {
            logger.info({ candidateId }, '[💬 MOUTH]: Sending response to Client.');
            // Send back down the client websocket
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'text', content: outputData }));
            }
          }
          isGenerating = false;
        }
      }
    } catch (err) {
      logger.error({ err }, '[❌ GEMINI_ERROR]: Failed to parse Gemini response.');
    }
  });

  geminiWs.on('error', (err) => logger.error({ err }, '[🔌 GEMINI_UPLINK_ERROR]'));
  geminiWs.on('close', () => logger.info({}, '[🔌 GEMINI_UPLINK_CLOSE]: Gemini socket closed.'));

  /**
   * Client Upstream Data (Binary PCM -> Gemini)
   */
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Memory Safety: The 16KB Rule
      const buffer = data as Buffer;
      if (buffer.length > 16384) {
        logger.warn({ candidateId }, '[⚠️ MEMORY_SAFETY]: Chunk exceeded 16KB. Dropping.');
        return;
      }
      
      // Pipe raw PCM chunk directly to Gemini
      if (geminiWs.readyState === WebSocket.OPEN) {
        const clientContent = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "audio/pcm;rate=16000",
                data: buffer.toString('base64')
              }
            ]
          }
        };
        geminiWs.send(JSON.stringify(clientContent));
      }
    } else {
      // Handle JSON control frames (Start/Stop)
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'START_INTERVIEW') {
            logger.info({ candidateId }, '[🔥 IGNITION]: System Ready.');
        } else if (msg.type === 'STOP_AI') {
            resetManifold();
        }
      } catch (e) {
        logger.error({ e }, 'Invalid text frame from client');
      }
    }
  });

  ws.on('close', () => {
    logger.info({ candidateId }, '[👋 EXIT]: Candidate disconnected. Destroying closure.');
    resetManifold();
    if (geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });

  ws.on('error', (err) => {
    logger.error({ candidateId, err }, '[❌ MANIFOLD_ERROR]: Client WebSocket error.');
  });
};
