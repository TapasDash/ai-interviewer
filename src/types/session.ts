/**
 * Project Cerberus - Phase 2
 * Session Type Definitions
 */

export interface SessionState {
  candidateId: string;
  startTime: number;
  isActive: boolean;
  isLLMGenerating: boolean; // Traffic light: Blocking state for inference pipeline
  isTTSPlaying: boolean;    // Traffic light: Blocking state for audio playback loop
  totalBytesReceived: number;
  lastChunkTimestamp: number;
  abortController: AbortController; // Barge-in primitive: Signals immediate interruption of downstream AI tasks
}

export interface ConnectionHandlerOptions {
  maxChunkSize: number; // e.g., 16384 (16KB)
}
