import * as vscode from 'vscode';
import type { ExecutionGraphHistory, ExecutionRecord } from '../types/execution.types';

const HISTORY_KEY = 'actRunner.executionHistory';
const MAX_RECORDS = 40;
const MAX_WEBVIEW_LOG_SUMMARY_CHARS = 40_000;
const MAX_WEBVIEW_RECORDS = 40;
const MAX_WEBVIEW_GRAPH_SUMMARY_CHARS = 20_000;
const MAX_STORED_LOG_SUMMARY_CHARS = 200_000;
const MAX_STORED_GRAPH_SUMMARY_CHARS = 80_000;

export interface HistoryFilter {
  workflowPath?: string;
  status?: string;
  since?: string;
}

export class HistoryService {
  private context: vscode.ExtensionContext | null = null;
  private workspaceRoot: string | undefined;
  private pendingGraphHistory = new Map<string, ExecutionGraphHistory>();

  initialize(context: vscode.ExtensionContext): void {
    this.context = context;
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    void this.compactStoredHistory();
  }

  setWorkspaceRoot(workspaceRoot: string | undefined): void {
    if (this.workspaceRoot === workspaceRoot) return;
    this.workspaceRoot = workspaceRoot;
    void this.compactStoredHistory();
  }

  async save(record: ExecutionRecord): Promise<void> {
    if (!this.context) return;
    const pendingGraphHistory = this.pendingGraphHistory.get(record.id);
    if (pendingGraphHistory) {
      record = { ...record, graphHistory: pendingGraphHistory };
      this.pendingGraphHistory.delete(record.id);
    }
    const history = this.getAll();
    history.unshift(record);
    await this.context.workspaceState.update(this.storageKey(), history.slice(0, MAX_RECORDS));
  }

  getAll(): ExecutionRecord[] {
    if (!this.context) return [];
    return this.context.workspaceState.get<ExecutionRecord[]>(this.storageKey(), []);
  }

  getAllForWebview(): ExecutionRecord[] {
    return this.getAll()
      .slice(0, MAX_WEBVIEW_RECORDS)
      .map((record) => this.compactForWebview(record));
  }

  getById(id: string): ExecutionRecord | undefined {
    return this.getAll().find((r) => r.id === id);
  }

  filter(options: HistoryFilter): ExecutionRecord[] {
    return this.getAll().filter((r) => {
      if (options.workflowPath && r.workflowPath !== options.workflowPath) return false;
      if (options.status && r.status !== options.status) return false;
      if (options.since && r.startedAt < options.since) return false;
      return true;
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.deleteByIds([id]);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (!this.context) return;
    const idsToDelete = new Set(ids);
    const history = this.getAll().filter((r) => !idsToDelete.has(r.id));
    await this.context.workspaceState.update(this.storageKey(), history);
  }

  async updateGraphHistory(id: string, graphHistory: ExecutionGraphHistory): Promise<void> {
    if (!this.context) return;
    let found = false;
    const history = this.getAll().map((record) => (
      record.id === id ? (found = true, { ...record, graphHistory }) : record
    ));
    if (!found) {
      this.pendingGraphHistory.set(id, graphHistory);
      return;
    }
    await this.context.workspaceState.update(this.storageKey(), history);
  }

  async clear(): Promise<void> {
    if (!this.context) return;
    await this.context.workspaceState.update(this.storageKey(), []);
  }

  private compactForWebview(record: ExecutionRecord): ExecutionRecord {
    const compactSummary = record.logSummary.length > MAX_WEBVIEW_LOG_SUMMARY_CHARS
      ? `${record.logSummary.slice(0, MAX_WEBVIEW_LOG_SUMMARY_CHARS)}\n...[truncated for webview]`
      : record.logSummary;
    const compactGraphHistory: ExecutionGraphHistory | undefined = record.graphHistory
      ? {
        final: {
          ...record.graphHistory.final,
          summaryContent: record.graphHistory.final.summaryContent.length > MAX_WEBVIEW_GRAPH_SUMMARY_CHARS
            ? `${record.graphHistory.final.summaryContent.slice(0, MAX_WEBVIEW_GRAPH_SUMMARY_CHARS)}\n...[truncated for webview]`
            : record.graphHistory.final.summaryContent,
        },
        timeline: [],
      }
      : undefined;

    return {
      ...record,
      logSummary: compactSummary,
      graphHistory: compactGraphHistory,
    };
  }

  private async compactStoredHistory(): Promise<void> {
    if (!this.context) return;
    const history = this.getAll();
    let changed = false;

    const compacted = history.map((record) => {
      const compactLogSummary = record.logSummary.length > MAX_STORED_LOG_SUMMARY_CHARS
        ? `${record.logSummary.slice(0, MAX_STORED_LOG_SUMMARY_CHARS)}\n...[truncated in storage migration]`
        : record.logSummary;

      const compactGraphHistory = record.graphHistory
        ? {
          final: {
            ...record.graphHistory.final,
            summaryContent: record.graphHistory.final.summaryContent.length > MAX_STORED_GRAPH_SUMMARY_CHARS
              ? `${record.graphHistory.final.summaryContent.slice(0, MAX_STORED_GRAPH_SUMMARY_CHARS)}\n...[truncated in storage migration]`
              : record.graphHistory.final.summaryContent,
          },
          timeline: [],
        }
        : undefined;

      if (compactLogSummary !== record.logSummary) changed = true;
      if (record.graphHistory && record.graphHistory.timeline.length > 0) changed = true;
      if (record.graphHistory && compactGraphHistory && compactGraphHistory.final.summaryContent !== record.graphHistory.final.summaryContent) changed = true;

      return {
        ...record,
        logSummary: compactLogSummary,
        graphHistory: compactGraphHistory,
      };
    });

    if (changed || compacted.length > MAX_RECORDS) {
      await this.context.workspaceState.update(this.storageKey(), compacted.slice(0, MAX_RECORDS));
    }
  }

  private storageKey(): string {
    return this.workspaceRoot ? `${HISTORY_KEY}.${this.workspaceRoot}` : HISTORY_KEY;
  }
}

export const historyService = new HistoryService();
