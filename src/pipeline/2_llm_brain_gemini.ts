import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import logger from '../utils/logger.js';

/**
 * [ARCHITECT PROTOCOL - THE AGENTIC BRAIN]
 * Version: v3 (Agentic) | Model: Gemini 2.5 Flash
 * Objective: Autonomous Technical Interviewer with Function Calling
 */

const MODEL_ID = "gemini-2.5-flash";

/**
 * TOOL DEFINITIONS: The Agent's interactions with the interview state.
 */
const tools = [
  {
    functionDeclarations: [
      {
        name: "score_answer",
        description: "Evaluates the candidate's technical response for a specific topic.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            topic: { type: SchemaType.STRING, description: "The technical topic being evaluated (e.g., Event Loop, Memory Leaks)." },
            score: { type: SchemaType.NUMBER, description: "Score from 1 to 10." },
            reasoning: { type: SchemaType.STRING, description: "Brief justification for the score." }
          },
          required: ["topic", "score", "reasoning"]
        }
      },
      {
        name: "pivot_topic",
        description: "Changes the focus of the interview to a new technical area.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            new_topic: { type: SchemaType.STRING, description: "The new topic to transition to." }
          },
          required: ["new_topic"]
        }
      }
    ]
  }
];

const SYSTEM_PROMPT = `
You are Cerberus, an autonomous Agentic Technical Interviewer. 
Your objective is to exhaustively verify the candidate's backend depth.
RULES:
1. If an answer is weak, use score_answer to flag it and drill deeper.
2. If an answer is strong, use score_answer to escalate difficulty.
3. Use pivot_topic when a subject is exhausted.
4. Be brutal, punchy, and professional. Max 2 sentences per response.
`;

/**
 * initGeminiAgent: Factory for the Autonomous Agent Stage.
 */
export const initGeminiAgent = (
  candidateId: string,
  onToken: (token: string) => void,
  onSentence: (sentence: string) => void
) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error({ candidateId }, '[FATAL] GEMINI_API_KEY is missing!');
    throw new Error('GEMINI_API_KEY_UNDEFINED');
  }

  // Agent State via Closure
  const interviewState = {
    topicsCovered: [] as string[],
    scores: [] as any[],
    difficulty: 5
  };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: MODEL_ID,
    systemInstruction: SYSTEM_PROMPT,
    tools: tools as any
  });

  const chat = model.startChat();
  let sentenceBuffer = '';

  return {
    processText: async (text: string) => {
      logger.info({ candidateId }, '[🤖 AGENT_THINKING]: Evaluating input...');
      const startTime = Date.now();

      try {
        const result = await chat.sendMessageStream(text);
        
        for await (const chunk of result.stream) {
          // 1. Check for Tool Calls (Function Calls)
          const calls = chunk.functionCalls();
          if (calls) {
            for (const call of calls) {
              const { name, args } = call;
              logger.info({ candidateId, tool: name, args }, "[🛠️ AGENT_ACTION]: Executing autonomous tool...");
              
              // Handle tool logic asynchronously
              if (name === 'score_answer') {
                interviewState.scores.push(args);
                if ((args as any).score > 7) interviewState.difficulty++;
              } else if (name === 'pivot_topic') {
                interviewState.topicsCovered.push((args as any).new_topic);
              }
            }
          }

          // 2. Stream standard text tokens
          const token = chunk.text();
          if (token) {
            onToken(token);
            sentenceBuffer += token;

            if (/[.!?\n]/.test(token)) {
              const sentences = sentenceBuffer.split(/(?<=[.!?\n])/);
              sentenceBuffer = sentences.pop() || '';
              for (const s of sentences) {
                const clean = s.trim();
                if (clean) onSentence(clean);
              }
            }
          }
        }

        if (sentenceBuffer.trim()) {
          onSentence(sentenceBuffer.trim());
          sentenceBuffer = '';
        }

      } catch (err) {
        logger.error({ candidateId, err }, 'Agentic Stream Error');
      }
    }
  };
};
