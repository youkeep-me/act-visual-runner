import { create } from 'zustand';
import type { ActEvent, ExecutionStartPayload } from '../../types/events.types';
import type { ExecutionGraphHistory, ExecutionGraphSnapshot, ExecutionRecord } from '../../types/execution.types';

export type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';
export type AppView = 'graph' | 'history' | 'env' | 'summary' | 'analytics';
export type WorkflowInputValue = string | number | boolean;

export interface GraphNode {
  id: string;
  type: 'job' | 'step';
  label: string;
  parentId?: string;
  status: NodeStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface LogLine {
  id: string;
  executionId: string;
  jobId?: string;
  stepId?: string;
  line: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'notice';
  timestamp: string;
}

export interface ExecutionState {
  executionId: string | null;
  status: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  workflowName: string;
  workflowPath: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
}

interface GraphTimelineSnapshot {
  execution: ExecutionState;
  nodes: GraphNode[];
  edges: GraphEdge[];
  summaryContent: string;
}

const MAX_PERSISTED_TIMELINE_ENTRIES = 200;

export interface WorkflowListItem {
  name: string;
  filePath: string;
  fileName: string;
  jobs: number;
  valid: boolean;
  inputs: WorkflowInputItem[];
  error?: string;
}

export interface WorkflowInputItem {
  name: string;
  description?: string;
  required: boolean;
  default?: string | number | boolean;
  type: 'string' | 'choice' | 'boolean' | 'number' | 'environment';
  options?: string[];
}

export interface RepositoryInfo {
  root: string;
  name: string;
  currentBranch?: string;
  branches?: string[];
}

interface StoreState {
  // Navegação
  currentView: AppView;

  // Estado da execução atual
  execution: ExecutionState;

  // Grafo de workflow
  nodes: GraphNode[];
  edges: GraphEdge[];

  // Logs
  logs: LogLine[];

  // Histórico
  history: ExecutionRecord[];

  // Workflows descobertos no projeto atual
  workflows: WorkflowListItem[];
  selectedWorkflowPath: string | null;
  workflowRunDialogPath: string | null;
  workflowInputValues: Record<string, Record<string, WorkflowInputValue>>;
  workflowBranches: Record<string, string>;
  repository: RepositoryInfo | null;
  // Logs por execução (salvo ao final de cada execução, para exibir no histórico)
  historyLogs: Record<string, string[]>;

  // Filtro de log ativo (job e/ou step selecionado no grafo)
  logFilter: { jobId: string; stepLabel?: string; label: string } | null;

  // GITHUB_STEP_SUMMARY — conteúdo Markdown acumulado por execução
  summaryContent: string;

  // Snapshots do grafo associados às linhas de log para navegar no estado da execução
  graphSnapshotsByLogId: Record<string, GraphTimelineSnapshot>;
  liveGraphSnapshot: GraphTimelineSnapshot | null;
  graphSnapshotsByExecutionId: Record<string, GraphTimelineSnapshot>;
  selectedTimelineLogId: string | null;

  // Ações
  setView: (view: AppView) => void;
  handleEvent: (event: ActEvent) => void;
  resetExecution: () => void;
  setHistory: (records: ExecutionRecord[]) => void;
  setWorkflows: (records: WorkflowListItem[]) => void;
  setRepository: (repository: RepositoryInfo | null) => void;
  setSelectedWorkflowPath: (workflowPath: string | null) => void;
  openWorkflowRunDialog: (workflowPath: string) => void;
  closeWorkflowRunDialog: () => void;
  setWorkflowInputValue: (workflowPath: string, inputName: string, value: WorkflowInputValue) => void;
  setWorkflowInputValues: (workflowPath: string, values: Record<string, WorkflowInputValue>) => void;
  setWorkflowBranch: (workflowPath: string, branch: string) => void;
  setLogFilter: (filter: { jobId: string; stepLabel?: string; label: string } | null) => void;
  restoreGraphAtLog: (logId: string) => void;
  restoreGraphForExecution: (executionId: string) => void;
  restoreLatestGraphState: () => void;
  getExecutionGraphHistory: (executionId: string) => ExecutionGraphHistory | undefined;
}

const initialExecution: ExecutionState = {
  executionId: null,
  status: 'idle',
  workflowName: '',
  workflowPath: null,
  startedAt: null,
  completedAt: null,
  duration: null,
};

let logCounter = 0;

export const useExecutionStore = create<StoreState>((set, get) => ({
  currentView: 'graph',
  execution: initialExecution,
  nodes: [],
  edges: [],
  logs: [],
  history: [],
  workflows: [],
  selectedWorkflowPath: null,
  workflowRunDialogPath: null,
  workflowInputValues: {},
  workflowBranches: {},
  repository: null,
  historyLogs: {},
  logFilter: null,
  summaryContent: '',
  graphSnapshotsByLogId: {},
  liveGraphSnapshot: null,
  graphSnapshotsByExecutionId: {},
  selectedTimelineLogId: null,

  setView: (view) => set({ currentView: view }),

  setHistory: (records) => set((s) => {
    const activeExecutionIds = new Set(records.map((record) => record.id));
    const persistedSnapshots = buildExecutionSnapshotIndex(records);
    const liveSnapshots = Object.fromEntries(
      Object.entries(s.graphSnapshotsByExecutionId).filter(([executionId]) => (
        activeExecutionIds.has(executionId) && !persistedSnapshots[executionId]
      ))
    );
    const historyLogs = Object.fromEntries(
      Object.entries(s.historyLogs).filter(([executionId]) => activeExecutionIds.has(executionId))
    );

    return {
      history: records,
      historyLogs,
      graphSnapshotsByExecutionId: {
        ...liveSnapshots,
        ...persistedSnapshots,
      },
    };
  }),

  setWorkflows: (records) => set((s) => ({
    workflows: records,
    selectedWorkflowPath: s.selectedWorkflowPath && records.some((record) => record.filePath === s.selectedWorkflowPath)
      ? s.selectedWorkflowPath
      : records[0]?.filePath ?? null,
  })),

  setRepository: (repository) => set({ repository }),

  setSelectedWorkflowPath: (workflowPath) => set({ selectedWorkflowPath: workflowPath }),

  openWorkflowRunDialog: (workflowPath) => set({ workflowRunDialogPath: workflowPath }),

  closeWorkflowRunDialog: () => set({ workflowRunDialogPath: null }),

  setWorkflowInputValue: (workflowPath, inputName, value) => set((s) => ({
    workflowInputValues: {
      ...s.workflowInputValues,
      [workflowPath]: {
        ...(s.workflowInputValues[workflowPath] ?? {}),
        [inputName]: value,
      },
    },
  })),

  setWorkflowInputValues: (workflowPath, values) => set((s) => ({
    workflowInputValues: {
      ...s.workflowInputValues,
      [workflowPath]: values,
    },
  })),

  setWorkflowBranch: (workflowPath, branch) => set((s) => ({
    workflowBranches: {
      ...s.workflowBranches,
      [workflowPath]: branch,
    },
  })),

  setLogFilter: (filter) => set({ logFilter: filter }),

  restoreGraphAtLog: (logId) => set((s) => {
    const snapshot = s.graphSnapshotsByLogId[logId];
    if (!snapshot) return {};
    return {
      execution: { ...snapshot.execution },
      nodes: cloneNodes(snapshot.nodes),
      edges: cloneEdges(snapshot.edges),
      summaryContent: snapshot.summaryContent,
      selectedTimelineLogId: logId,
      currentView: 'graph',
    };
  }),

  restoreGraphForExecution: (executionId) => set((s) => {
    if (s.execution.status === 'running') return {};
    const record = s.history.find((item) => item.id === executionId);
    const snapshot = record?.graphHistory?.final ?? s.graphSnapshotsByExecutionId[executionId];
    if (!snapshot) return {};
    const restoredLogs = record?.graphHistory?.timeline.map((entry, index) => ({
      id: historicalLogId(executionId, index),
      executionId,
      jobId: entry.jobId,
      stepId: entry.stepId,
      line: entry.line,
      level: entry.level,
      timestamp: entry.timestamp,
    })) ?? s.logs;
    const restoredLogSnapshots = record?.graphHistory?.timeline.reduce<Record<string, GraphTimelineSnapshot>>((acc, entry, index) => {
      acc[historicalLogId(executionId, index)] = fromPersistedSnapshot(entry.snapshot);
      return acc;
    }, {}) ?? s.graphSnapshotsByLogId;
    return {
      execution: { ...snapshot.execution },
      nodes: cloneNodes(snapshot.nodes),
      edges: cloneEdges(snapshot.edges),
      logs: restoredLogs,
      graphSnapshotsByLogId: restoredLogSnapshots,
      summaryContent: snapshot.summaryContent,
      selectedTimelineLogId: null,
      currentView: 'graph',
    };
  }),

  restoreLatestGraphState: () => set((s) => {
    const snapshot = s.liveGraphSnapshot;
    if (!snapshot) return { selectedTimelineLogId: null };
    return {
      execution: { ...snapshot.execution },
      nodes: cloneNodes(snapshot.nodes),
      edges: cloneEdges(snapshot.edges),
      summaryContent: snapshot.summaryContent,
      selectedTimelineLogId: null,
      currentView: 'graph',
    };
  }),

  getExecutionGraphHistory: (executionId) => {
    const state = get();
    const final = state.graphSnapshotsByExecutionId[executionId] ?? state.liveGraphSnapshot;
    if (!final) return undefined;

    // Persist only timeline points that actually have a dedicated snapshot.
    // This avoids duplicating the same "final" snapshot hundreds of times,
    // which can cause large payloads and OOM at execution end.
    const logsWithSnapshot = state.logs
      .filter((log) => log.executionId === executionId && !!state.graphSnapshotsByLogId[log.id])
      .slice(-MAX_PERSISTED_TIMELINE_ENTRIES);

    return {
      final: toPersistedSnapshot(final),
      timeline: logsWithSnapshot.map((log) => ({
        line: log.line,
        level: log.level,
        timestamp: log.timestamp,
        jobId: log.jobId,
        stepId: log.stepId,
        snapshot: toPersistedSnapshot(state.graphSnapshotsByLogId[log.id]!),
      })),
    };
  },

  resetExecution: () =>
    set({
      execution: initialExecution,
      nodes: [],
      edges: [],
      logs: [],
      logFilter: null,
      summaryContent: '',
      graphSnapshotsByLogId: {},
      liveGraphSnapshot: null,
      graphSnapshotsByExecutionId: {},
      selectedTimelineLogId: null,
    }),

  handleEvent: (event) => {
    switch (event.type) {
      case 'execution:start':
        set((s) => {
          const execution: ExecutionState = {
            executionId: event.payload.executionId,
            status: 'running',
            workflowName: event.payload.workflowName,
            workflowPath: event.payload.workflowPath,
            startedAt: event.payload.triggeredAt,
            completedAt: null,
            duration: null,
          };
          const nodes = buildInitialNodes(event.payload);
          const edges = buildInitialEdges(event.payload);
          return {
            execution,
            selectedWorkflowPath: event.payload.workflowPath,
            logs: [],
            nodes,
            edges,
            currentView: 'graph',
            logFilter: null, // limpar filtro ao iniciar nova execução
            summaryContent: '', // limpar summary da execução anterior
            graphSnapshotsByLogId: {},
            liveGraphSnapshot: createGraphSnapshot(s, { execution, nodes, edges, summaryContent: '' }),
            selectedTimelineLogId: null,
          };
        });
        break;

      case 'job:update': {
        const { jobId, jobName, status, startedAt, completedAt, duration, outerJobId } = event.payload;
        set((s) => {
          // Busca por id exato, label exato OU template match
          // (ex: "Build (dotnet)" casa com "Build (${{ needs.setup.outputs.language }})")
          const matchingNode = s.nodes.find(
            n => n.type === 'job' && (
              n.id === jobId ||
              n.label === jobId ||
              matchesTemplate(jobId, n.label)
            )
          );
          if (!matchingNode) {
            // Job não existe → criar dinamicamente (ex: inner job de reusable workflow)
            const newJob: GraphNode = {
              id: jobId, type: 'job', label: jobName ?? jobId,
              parentId: outerJobId,
              status: status as NodeStatus, startedAt, completedAt,
              duration: duration ?? calculateDuration(startedAt, completedAt),
            };
            const nodes = [...s.nodes, newJob];
            return { nodes, liveGraphSnapshot: createGraphSnapshot(s, { nodes }), selectedTimelineLogId: null };
          }
          const TERMINAL: NodeStatus[] = ['success', 'failed'];
          const nodes = s.nodes.map(n => {
            if (n.id !== matchingNode.id) return n;
            if (status === 'running' && TERMINAL.includes(n.status)) return n;
            // Resolver label de template para o nome real
            // ex: "Build (${{ needs.setup.outputs.language }})" → "Build (dotnet)"
            const resolvedLabel = matchesTemplate(jobId, n.label) ? (jobName ?? jobId) : n.label;
            const nextStartedAt = startedAt ?? n.startedAt;
            const nextCompletedAt = completedAt ?? n.completedAt;
            const nextDuration = duration ?? n.duration ?? calculateDuration(nextStartedAt, nextCompletedAt);
            return {
              ...n,
              label: resolvedLabel,
              status: (status as NodeStatus) ?? n.status,
              ...(startedAt && { startedAt }),
              ...(completedAt && { completedAt }),
              ...(nextDuration !== undefined && { duration: nextDuration }),
            };
          });
          return {
            nodes,
            liveGraphSnapshot: createGraphSnapshot(s, { nodes }),
            selectedTimelineLogId: null,
          };
        });
        break;
      }

      case 'step:update': {
        const { jobId, stepId, stepName, status, startedAt, completedAt, duration } = event.payload;
        const nodeId = `${jobId}/${stepId}`;
        // Act prefixa steps definidos pelo usuário com "Main " (ex: "Checkout" → "Main Checkout").
        // Normalizamos para corresponder aos nodes criados a partir do YAML.
        const normalizedStep = normalizeStepName(stepName);
        set((s) => {
          let nodes = s.nodes;
          // Garantir que o job pai existe (pode ser de reusable ou ter nome com template)
          const parentExists = nodes.some(n => n.type === 'job' && (
            n.id === jobId || n.label === jobId || matchesTemplate(jobId, n.label)
          ));
          if (!parentExists) {
            nodes = [...nodes, { id: jobId, type: 'job', label: jobId, status: 'running' as NodeStatus }];
          }
          const parentNode = nodes.find(n => n.type === 'job' && (
            n.id === jobId || n.label === jobId || matchesTemplate(jobId, n.label)
          ));
          const realParentId = parentNode?.id ?? jobId;
          // Verificar se o step já existe — também tenta sem o prefixo "Main "
          const matchingStep = nodes.find(
            n => n.type === 'step' && (
              n.id === nodeId ||
              (n.parentId === realParentId && (n.label === stepName || n.label === normalizedStep))
            )
          );
          if (!matchingStep) {
            const newStep: GraphNode = {
              id: nodeId, type: 'step', label: normalizedStep, parentId: realParentId,
              status: status as NodeStatus, startedAt, completedAt, duration,
            };
            const nextNodes = [...nodes, newStep];
            return { nodes: nextNodes, liveGraphSnapshot: createGraphSnapshot(s, { nodes: nextNodes }), selectedTimelineLogId: null };
          }
          const nextNodes = updateNode(nodes, nodeId, event.payload);
          return { nodes: nextNodes, liveGraphSnapshot: createGraphSnapshot(s, { nodes: nextNodes }), selectedTimelineLogId: null };
        });
        break;
      }

      case 'log':
        set((s) => {
          const id = `log-${++logCounter}`;
          // Performance: apenas adicionar log sem criar snapshots por linha
          // (snapshots completos são criados apenas ao final da execução)
          const keptLogs = s.logs.length >= 1000 ? s.logs.slice(-999) : s.logs;
          return {
            logs: [
              ...keptLogs,
              {
                id,
                executionId: event.payload.executionId,
                jobId: event.payload.jobId,
                stepId: event.payload.stepId,
                line: event.payload.line,
                level: event.payload.level,
                timestamp: event.payload.timestamp,
              },
            ],
          };
        });
        break;

      case 'execution:end': {
        const { executionId, status: endStatus, completedAt } = event.payload;
        const nodeStatus: NodeStatus = endStatus === 'success' ? 'success' : 'failed';
        set((s) => {
          const execution: ExecutionState = {
            ...s.execution,
            status: endStatus,
            completedAt,
            duration: event.payload.duration > 0
              ? event.payload.duration
              : calculateDuration(s.execution.startedAt ?? undefined, completedAt) ?? null,
          };
          // Fallback: any node still in 'running' at execution end transitions to final state.
          const nodes = endStatus === 'cancelled'
            ? s.nodes
            : s.nodes.map((n) => {
                if (n.status !== 'running') return n;
                const duration = calculateDuration(n.startedAt, completedAt);
                return { ...n, status: nodeStatus, completedAt, ...(duration !== undefined && { duration }) };
              });
          return {
            execution,
            nodes,
            // Salvar os logs desta execução para exibir no histórico
            historyLogs: {
              ...s.historyLogs,
              [executionId]: s.logs.map((l) => l.line),
            },
            liveGraphSnapshot: createGraphSnapshot(s, { execution, nodes }),
            graphSnapshotsByExecutionId: {
              ...s.graphSnapshotsByExecutionId,
              [executionId]: createGraphSnapshot(s, { execution, nodes }),
            },
            selectedTimelineLogId: null,
          };
        });
        break;
      }

      case 'execution:error':
        set((s) => {
          const execution: ExecutionState = {
            ...s.execution,
            status: 'failed',
            completedAt: new Date().toISOString(),
            duration: calculateDuration(s.execution.startedAt ?? undefined, new Date().toISOString()) ?? s.execution.duration,
          };
          const id = `log-${++logCounter}`;
          const graphSnapshotsByLogId = {
            ...s.graphSnapshotsByLogId,
            [id]: createGraphSnapshot(s, { execution }),
          };
          return {
            execution,
            logs: [
              ...s.logs,
              {
                id,
                executionId: event.payload.executionId,
                line: `❌ Erro crítico: ${event.payload.error}`,
                level: 'error',
                timestamp: new Date().toISOString(),
              },
            ],
            graphSnapshotsByLogId,
            liveGraphSnapshot: createGraphSnapshot(s, { execution }),
            selectedTimelineLogId: null,
          };
        });
        break;

      case 'summary:update':
        set((s) => ({
          summaryContent: event.payload.content,
          liveGraphSnapshot: createGraphSnapshot(s, { summaryContent: event.payload.content }),
        }));
        break;
    }
  },
}));

// ─── Helpers do store ─────────────────────────────────────────────────────

function cloneNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => ({ ...node }));
}

function cloneEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function historicalLogId(executionId: string, index: number): string {
  return `history-${executionId}-${index}`;
}

function buildExecutionSnapshotIndex(records: ExecutionRecord[]): Record<string, GraphTimelineSnapshot> {
  return records.reduce<Record<string, GraphTimelineSnapshot>>((acc, record) => {
    if (record.graphHistory?.final) acc[record.id] = fromPersistedSnapshot(record.graphHistory.final);
    return acc;
  }, {});
}

function toPersistedSnapshot(snapshot: GraphTimelineSnapshot): ExecutionGraphSnapshot {
  return {
    execution: { ...snapshot.execution },
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    summaryContent: snapshot.summaryContent,
  };
}

function fromPersistedSnapshot(snapshot: ExecutionGraphSnapshot): GraphTimelineSnapshot {
  return {
    execution: { ...snapshot.execution },
    nodes: cloneNodes(snapshot.nodes as GraphNode[]),
    edges: cloneEdges(snapshot.edges),
    summaryContent: snapshot.summaryContent,
  };
}

function createGraphSnapshot(
  state: Pick<StoreState, 'execution' | 'nodes' | 'edges' | 'summaryContent'>,
  overrides: Partial<Pick<StoreState, 'execution' | 'nodes' | 'edges' | 'summaryContent'>> = {}
): GraphTimelineSnapshot {
  const execution = overrides.execution ?? state.execution;
  const nodes = overrides.nodes ?? state.nodes;
  const edges = overrides.edges ?? state.edges;
  const summaryContent = overrides.summaryContent ?? state.summaryContent;
  return {
    execution: { ...execution },
    nodes: cloneNodes(nodes),
    edges: cloneEdges(edges),
    summaryContent,
  };
}

function buildInitialNodes(payload: ExecutionStartPayload): GraphNode[] {
  const nodes: GraphNode[] = [];
  payload.jobs.forEach((job) => {
    nodes.push({ id: job.id, type: 'job', label: job.name ?? job.id, status: 'idle' });
    job.steps.forEach((step, i) => {
      const stepId = step.id ?? `step-${i}`;
      nodes.push({
        id: `${job.id}/${stepId}`,
        type: 'step',
        label: step.name ?? step.uses ?? step.run?.split('\n')[0] ?? stepId,
        parentId: job.id,
        status: 'idle',
      });
    });
  });
  return nodes;
}

/**
 * Act CLI prefixa steps definidos pelo usuário com "Main " no output
 * (ex: "Checkout" no YAML → "Main Checkout" no bracket).
 * Remove esse prefixo para corresponder corretamente aos nodes do YAML.
 */
function normalizeStepName(name: string): string {
  return name.replace(/^Main\s+/, '');
}

/**
 * Verifica se um nome resolvido (ex: "Build (dotnet)") corresponde a um template
 * GitHub Actions (ex: "Build (${{ needs.setup.outputs.language }})").
 * Compara o prefixo e sufixo ao redor da(s) expressão(ões) ${{ }}.
 */
function matchesTemplate(resolved: string, template: string): boolean {
  if (!template.includes('${{')) return false;
  const exprStart = template.indexOf('${{');
  const exprEnd = template.lastIndexOf('}}');
  if (exprEnd < 0) return false;
  const prefix = template.slice(0, exprStart);
  const suffix = template.slice(exprEnd + 2);
  return (
    resolved.startsWith(prefix) &&
    resolved.endsWith(suffix) &&
    resolved.length >= prefix.length + suffix.length
  );
}

function buildInitialEdges(payload: ExecutionStartPayload): GraphEdge[] {
  const edges: GraphEdge[] = [];
  payload.jobs.forEach((job) => {
    (job.needs ?? []).forEach((dep) => {
      edges.push({ id: `${dep}->${job.id}`, source: dep, target: job.id });
    });
  });
  return edges;
}

function updateNode(
  nodes: GraphNode[],
  nodeId: string,
  update: Partial<Pick<GraphNode, 'status' | 'startedAt' | 'completedAt' | 'duration'>>
): GraphNode[] {
  // act outputs job display names (name: field) but node ids are YAML keys.
  // For steps, nodeId is "displayJobName/stepId" while node.id is "yamlKey/stepId".
  // Match strategy: exact id → exact label → for compound "job/step" ids, match by
  // comparing the step part only within the correct parent job (matched by label).
  const exactMatch = nodes.some((n) => n.id === nodeId);
  const labelMatch = !exactMatch && nodes.some((n) => n.label === nodeId);
  const TERMINAL: NodeStatus[] = ['success', 'failed'];

  // For compound step ids ("jobDisplayName/stepId"), try matching by parent label + step suffix
  const slash = nodeId.indexOf('/');
  const jobDisplayName = slash >= 0 ? nodeId.slice(0, slash) : null;
  const stepSuffix     = slash >= 0 ? nodeId.slice(slash + 1) : null;

  return nodes.map((n) => {
    let isTarget: boolean;

    if (exactMatch) {
      isTarget = n.id === nodeId;
    } else if (labelMatch) {
      isTarget = n.label === nodeId;
    } else if (jobDisplayName !== null && stepSuffix !== null) {
      // Match step node: parent must have the job display name as id OR label,
      // and this node's id suffix (after YAML job key/) must match the step suffix.
      const parentNode = nodes.find((p) => p.type === 'job' && (
        p.id === jobDisplayName || p.label === jobDisplayName || matchesTemplate(jobDisplayName!, p.label)
      ));
      if (parentNode && n.parentId === parentNode.id) {
        // n.id = "yamlKey/stepId" — check if our stepSuffix is contained in n.id after the slash
        const nStepPart = n.id.slice(n.id.indexOf('/') + 1);
        const normalizedSuffix = normalizeStepName(stepSuffix!);
        isTarget = nStepPart === stepSuffix || nStepPart === normalizedSuffix ||
                   n.label === stepSuffix || n.label === normalizedSuffix;
      } else {
        isTarget = false;
      }
    } else {
      isTarget = false;
    }

    if (!isTarget) return n;
    // Don't downgrade a terminal state back to running
    if (update.status === 'running' && TERMINAL.includes(n.status)) return n;
    const nextStartedAt = update.startedAt ?? n.startedAt;
    const nextCompletedAt = update.completedAt ?? n.completedAt;
    const nextDuration = update.duration ?? n.duration ?? calculateDuration(nextStartedAt, nextCompletedAt);
    return { ...n, ...update, ...(nextDuration !== undefined && { duration: nextDuration }) };
  });
}

function calculateDuration(startedAt?: string, completedAt?: string): number | undefined {
  if (!startedAt || !completedAt) return undefined;
  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return undefined;
  return completed - started;
}
