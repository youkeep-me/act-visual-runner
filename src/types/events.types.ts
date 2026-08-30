// Tipos do sistema de eventos — discriminated unions para type-safety total

import type { ExecutionStatus, JobStatus, StepStatus } from './execution.types';
import type { JobDefinition } from './workflow.types';

export interface ExecutionStartPayload {
  executionId: string;
  workflowPath: string;
  workflowName: string;
  jobs: JobDefinition[];
  triggeredAt: string;
}

export interface JobUpdatePayload {
  executionId: string;
  jobId: string;
  jobName: string;
  status: JobStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  /** Presente apenas para inner jobs de reusable workflows (3-level bracket) */
  outerJobId?: string;
}

export interface StepUpdatePayload {
  executionId: string;
  jobId: string;
  stepId: string;
  stepName: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
}

export interface LogPayload {
  executionId: string;
  jobId?: string;
  stepId?: string;
  line: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'notice';
  timestamp: string;
}

export interface ExecutionEndPayload {
  executionId: string;
  status: ExecutionStatus;
  duration: number;
  completedAt: string;
}

export interface ExecutionErrorPayload {
  executionId: string;
  error: string;
  code?: string;
}

export interface SummaryUpdatePayload {
  executionId: string;
  /** Conteúdo Markdown bruto do GITHUB_STEP_SUMMARY (acumulado de todos os steps/jobs) */
  content: string;
}

// Discriminated union — todos os eventos do backend
export type ActEvent =
  | { type: 'execution:start'; payload: ExecutionStartPayload }
  | { type: 'job:update';      payload: JobUpdatePayload }
  | { type: 'step:update';     payload: StepUpdatePayload }
  | { type: 'log';             payload: LogPayload }
  | { type: 'execution:end';   payload: ExecutionEndPayload }
  | { type: 'execution:error'; payload: ExecutionErrorPayload }
  | { type: 'summary:update';  payload: SummaryUpdatePayload };

export type ActEventType = ActEvent['type'];

// Extrai o payload de um evento pelo tipo
export type PayloadOf<T extends ActEventType> = Extract<ActEvent, { type: T }>['payload'];

// Mensagens trafegadas entre Extension Host e Webview
export type WebviewMessage =
  | ActEvent
  | { type: 'navigate';       payload: { view: string } }
  | { type: 'state:snapshot'; payload: Record<string, unknown> };

// Comandos enviados da Webview para o Extension Host
export type WebviewCommand =
  | { type: 'command:run';       payload: { workflowPath?: string; jobId?: string; dryRun?: boolean; workflowInputs?: Record<string, string | number | boolean>; workflowRef?: string } }
  | { type: 'command:quickRun';  payload: { workflowPath: string } }
  | { type: 'command:stop';      payload: { executionId: string } }
  | { type: 'command:rerun';     payload: { executionId: string } }
  | { type: 'command:restoreHistoryRepository'; payload: { executionId: string } }
  | { type: 'command:selectProject'; payload: Record<string, never> }
  | { type: 'command:locateAct'; payload: Record<string, never> }
  | { type: 'command:loadEnv';      payload: { tab: string; filePath?: string } }
  | { type: 'command:selectEnvFile'; payload: { tab: string } }
  | { type: 'command:saveEnv';      payload: { tab: string; rows: { key: string; value: string }[]; filePath?: string } }
  | { type: 'command:deleteHistory'; payload: { executionId: string } }
  | { type: 'command:deleteHistories'; payload: { executionIds: string[] } }
  | { type: 'command:refreshHistory'; payload: Record<string, never> }
  | { type: 'state:request';        payload: Record<string, never> };
