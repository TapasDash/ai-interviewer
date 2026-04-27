import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { routerAgent } from '../agents/routerAgent.js';
import { techGrillAgent } from '../agents/techGrillAgent.js';
import { systemDesignAgent } from '../agents/systemDesignAgent.js';
import logger from '../../utils/logger.js';

const receiveTextStep = createStep({
  id: 'receiveText',
  inputSchema: z.object({
    input: z.string(),
  }),
  outputSchema: z.object({
    transcript: z.string(),
  }),
  execute: async ({ inputData }) => {
    logger.info({ phase: 'ROUTER' }, '[🧠 DIRECTOR]: Received text, routing...');
    return { transcript: inputData.input };
  }
});

const routerStep = createStep({
  id: 'router',
  inputSchema: z.object({
    transcript: z.string(),
  }),
  outputSchema: z.object({
    phase: z.enum(['TECH_GRILL', 'SYSTEM_DESIGN']),
    transcript: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { transcript } = inputData;
    const result = await routerAgent.generate(
      `Analyze this candidate input and determine if we should drill down into code/Node internals (TECH_GRILL) or high-level architecture (SYSTEM_DESIGN). Input: "${transcript}"`
    );
    const decisionText = result.text.toUpperCase();
    const phase = decisionText.includes('SYSTEM_DESIGN') ? 'SYSTEM_DESIGN' : 'TECH_GRILL';
    logger.info({ phase }, '[🧠 DIRECTOR]: Routing to specialized agent');
    return { phase, transcript };
  }
});

const techGrillStep = createStep({
  id: 'techGrill',
  inputSchema: z.object({
    phase: z.string(),
    transcript: z.string(),
  }),
  outputSchema: z.object({
    output: z.string(),
  }),
  execute: async ({ inputData }) => {
    logger.info({}, '[🧠 DIRECTOR]: Firing TechGrill Agent...');
    const response = await techGrillAgent.generate(inputData.transcript);
    return { output: response.text };
  }
});

const systemDesignStep = createStep({
  id: 'systemDesign',
  inputSchema: z.object({
    phase: z.string(),
    transcript: z.string(),
  }),
  outputSchema: z.object({
    output: z.string(),
  }),
  execute: async ({ inputData }) => {
    logger.info({}, '[🧠 DIRECTOR]: Firing SystemDesign Agent...');
    const response = await systemDesignAgent.generate(inputData.transcript);
    return { output: response.text };
  }
});

export const interviewFlow = createWorkflow({
  id: 'interview-flow',
  inputSchema: z.object({
    input: z.string(),
  }),
})
  .then(receiveTextStep)
  .then(routerStep)
  .branch([
    [async ({ inputData }) => inputData.phase === 'TECH_GRILL', techGrillStep],
    [async ({ inputData }) => inputData.phase === 'SYSTEM_DESIGN', systemDesignStep]
  ])
  .commit();
