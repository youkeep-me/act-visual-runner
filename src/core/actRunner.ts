import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { eventBus } from './eventBus';
import type { ExecutionOptions } from '../types/execution.types';
import type { LogPayload } from '../types/events.types';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'notice';

const MAX_ACCUMULATED_LOG_LINES = 3000;
const MAX_ACCUMULATED_LOG_LINE_CHARS = 4000;
const MAX_EVENT_LOG_LINE_CHARS = 2000;
const MAX_UI_LOG_EVENTS = 1500;
const MAX_SUMMARY_LINES = 1200;
const MAX_SUMMARY_LINE_CHARS = 2000;

// Caminhos candidatos para o binário do act em ordem de prioridade
const ACT_CANDIDATE_PATHS: string[] = [
  path.join(os.homedir(), '.act', 'act'),          // ~/.act/act  (seu caso)
  '/usr/local/bin/act',
  '/usr/bin/act',
  path.join(os.homedir(), 'bin', 'act'),            // ~/bin/act
  path.join(os.homedir(), '.local', 'bin', 'act'),  // ~/.local/bin/act
  '/opt/homebrew/bin/act',                          // macOS Homebrew Apple Silicon
  '/home/linuxbrew/.linuxbrew/bin/act',             // Linuxbrew
];

const ANSI_RE = /\x1B[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');
const stripCarriageReturn = (s: string) => s.replace(/\r/g, '');

const RE_GITHUB_ANNOTATION = /::(notice|warning|error|debug)(?:\s+.*?)?::?\s*(.*)$/i;
const RE_LEVEL_PREFIX = /^\s*\[(notice|info|warning|warn|error|debug)\]\s*(.*)$/i;

// Output channel visível em "Output > Act Visual Runner"
let _outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel('Act Visual Runner');
  }
  return _outputChannel;
}
function actLog(msg: string): void {
  getOutputChannel().appendLine(msg);
}

// Padrões de output do act CLI
const RE_STEP_START   = /^\[([^\]]+)\]\s+⭐\s+Run\s+(.+)$/;
const RE_STEP_OK      = /^\[([^\]]+)\]\s+✅\s+Success\s+-\s+(.+)$/;
const RE_STEP_FAIL    = /^\[([^\]]+)\]\s+❌\s+Failure\s+-\s+(.+)$/;
const RE_STEP_SKIP    = /^\[([^\]]+)\]\s+⏭️\s+Skipping\s+(.+)$/;
const RE_LOG_LINE     = /^\[([^\]]+)\]\s+\|\s*(.*)$/;
const RE_JOB_START    = /^\[([^\]]+)\]\s+(?:🚀|🐳)\s+Start(?:\s+image)?/;
// Accept plain, 🐳/🚀 (docker/start) and 🏁 (racing flag used by act for sub-job completion)
const RE_JOB_OK       = /^\[([^\]]+)\]\s+(?:[🐳🚀🏁]\s+)?(?:✅\s+)?Job\s+succeeded/u;
const RE_JOB_FAIL     = /^\[([^\]]+)\]\s+(?:[🐳🚀🏁]\s+)?(?:❌\s+)?Job\s+failed/u;
// Any bracket-prefixed line — used to detect outer-job transitions
const RE_ANY_BRACKET  = /^\[([^\]]+)\]/;

/**
 * Para brackets de reusable workflows (3 partes: OuterJob/ReusableWorkflow/InnerJob),
 * retorna o InnerJob como effectiveJobId (é o job que "possui" o step/log).
 * Para brackets normais (2 partes: Job/StepName), retorna OuterJob como effectiveJobId.
 */
function parseEffectiveBracket(bracket: string): {
  outerJobId: string;      // Usado para lifecycle tracking do job externo
  effectiveJobId: string;  // Inner job para reusable, outer job para regular
  isReusable: boolean;
} {
  const parts = bracket.split('/');
  const outerJobId = parts[0].trim();
  if (parts.length >= 3) {
    // [OuterJob/ReusableWorkflowName/InnerJobId]
    return { outerJobId, effectiveJobId: parts[parts.length - 1].trim(), isReusable: true };
  }
  return { outerJobId, effectiveJobId: outerJobId, isReusable: false };
}

/** Remove sufixos de timing do act, ex: " [52.52743ms]" ou " [1.2s]" */
const RE_TIMING_SUFFIX = /\s+\[\d+(?:\.\d+)?(?:ns|µs|ms|s)?\]$/;
const stripTiming = (s: string): string => s.replace(RE_TIMING_SUFFIX, '');

function sanitizeArg(arg: string): string {
  return arg.replace(/[;&|`$<>()\[\]{}\\'"]/g, '');
}

function sanitizePath(p: string): string {
  return p.replace(/[;&|`$<>()\[\]{}\\"']/g, '');
}

interface PendingJobStatus {
  status: 'success' | 'failed';
  completedAt: string;
}

export class ActRunner {
  private activeProcess: ChildProcess | null = null;
  /**
   * Pending job status: when act emits "🏁 Job succeeded" at sub-job level we can't
   * confirm the outer job is done immediately — it might have more sequential sub-jobs.
   * We confirm only when the next line belongs to a DIFFERENT outer job, or at execution end.
   */
  private pendingJobStatus = new Map<string, PendingJobStatus>();
  /**
   * Outer jobs already marked as "running" in this execution.
   * Avoids redundant dispatches when every bracket line would re-trigger.
   */
  private runningJobs = new Set<string>();

  /** Log lines acumulados da execução atual (para persistência no logSummary) */
  private accumulatedLogs: string[] = [];

  /**
   * Último outer job visto — usado para inferir conclusão do outer job
   * quando act não emite [OuterJob] 🏁 Job succeeded para reusable workflows.
   */
  private lastOuterJobId: string | null = null;

  /**
   * Outer jobs cujos inner jobs tiveram falha — usado para inferir status
   * 'failed' ao fechar o outer job implicitamente.
   */
  private failedInnerByOuter = new Set<string>();

  /**
   * Nome display do workflow em execução (ex: "CI/CD Pipeline (Local – Consolidated)").
   * Act prefixa todos os brackets com [WorkflowName/...], então removemos esse prefixo
   * antes de parsear os brackets para evitar falsos "outer jobs" (ex: "CI" de "CI/CD Pipeline").
   */
  private workflowDisplayName: string | null = null;

  /**
   * Step atualmente ativo por effectiveJobId.
   * Usado para atribuir jobId/stepId corretos a linhas de log que não carregam
   * o nome do step no bracket (apenas o nome do job).
   */
  private currentStep = new Map<string, string>(); // effectiveJobId → stepName

  /** Conteúdo acumulado do GITHUB_STEP_SUMMARY (capturado do output ◎ Summary) */
  private summaryLines: string[] = [];
  private summaryTruncated = false;
  /** Flag indicando que estamos capturando linhas do summary (entre ◎ Summary e o próximo bracket) */
  private inSummaryCapture = false;
  private uiLogEventsSent = 0;
  private uiLogEventsDropped = 0;

  /** Retorna os logs acumulados da última execução */
  getLogs(): string[] {
    return [...this.accumulatedLogs];
  }

  private pushAccumulatedLog(line: string): void {
    const normalized = line.length > MAX_ACCUMULATED_LOG_LINE_CHARS
      ? `${line.slice(0, MAX_ACCUMULATED_LOG_LINE_CHARS)} …[truncated]`
      : line;
    this.accumulatedLogs.push(normalized);
    if (this.accumulatedLogs.length > MAX_ACCUMULATED_LOG_LINES) {
      this.accumulatedLogs = this.accumulatedLogs.slice(-MAX_ACCUMULATED_LOG_LINES);
    }
  }

  private toUiLogLine(line: string): string {
    return line.length > MAX_EVENT_LOG_LINE_CHARS
      ? `${line.slice(0, MAX_EVENT_LOG_LINE_CHARS)} …[truncated]`
      : line;
  }

  private dispatchLog(payload: LogPayload): void {
    if (this.uiLogEventsSent >= MAX_UI_LOG_EVENTS) {
      this.uiLogEventsDropped++;
      return;
    }
    this.uiLogEventsSent++;
    eventBus.dispatch({ type: 'log', payload });
  }

  private flushDroppedLogNotice(executionId: string): void {
    if (this.uiLogEventsDropped === 0) return;
    eventBus.dispatch({
      type: 'log',
      payload: {
        executionId,
        line: `[act-runner] ${this.uiLogEventsDropped} log lines omitted from UI to avoid VS Code OOM. Full act output is not persisted by the extension.`,
        level: 'warn',
        timestamp: now(),
      },
    });
    this.uiLogEventsDropped = 0;
  }

  private pushSummaryLine(line: string): void {
    if (this.summaryLines.length >= MAX_SUMMARY_LINES) {
      this.summaryTruncated = true;
      return;
    }
    const normalized = line.length > MAX_SUMMARY_LINE_CHARS
      ? `${line.slice(0, MAX_SUMMARY_LINE_CHARS)} …[truncated]`
      : line;
    this.summaryLines.push(normalized);
  }

  /** Testa se um caminho/comando executa act corretamente */
  async isActInstalled(actPath = 'act'): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(actPath, ['--version'], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Detecta automaticamente o binário do act.
   * Busca em caminhos candidatos comuns e retorna o primeiro que funcionar.
   * Salva automaticamente em actRunner.actPath se encontrado.
   */
  async autoDetect(): Promise<string | undefined> {
    // 1. Tentar o valor já configurado
    const configured = vscode.workspace.getConfiguration('actRunner').get<string>('actPath', 'act');
    if (await this.isActInstalled(configured)) {
      return configured;
    }

    // 2. Tentar caminhos candidatos conhecidos
    for (const candidate of ACT_CANDIDATE_PATHS) {
      if (fs.existsSync(candidate) && await this.isActInstalled(candidate)) {
        // Salvar automaticamente nas configurações globais
        await vscode.workspace
          .getConfiguration('actRunner')
          .update('actPath', candidate, vscode.ConfigurationTarget.Global);
        return candidate;
      }
    }

    // 3. Tentar via shell interativo para capturar aliases/PATH do usuário
    const shellPath = await this.resolveViaShell();
    if (shellPath) {
      await vscode.workspace
        .getConfiguration('actRunner')
        .update('actPath', shellPath, vscode.ConfigurationTarget.Global);
      return shellPath;
    }

    return undefined;
  }

  /** Tenta resolver o path do act via shell interativo (captura aliases e PATH do usuário) */
  private resolveViaShell(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const shell = process.env.SHELL ?? '/bin/bash';
      // -i = interactive (carrega .bashrc/.zshrc com aliases), -c = executa comando
      const proc = spawn(shell, ['-i', '-c', 'command -v act 2>/dev/null || which act 2>/dev/null'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TERM: 'dumb' },
      });
      let output = '';
      proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      proc.on('close', (code: number | null) => {
        const resolved = output.trim().split('\n').pop()?.trim();
        if (code === 0 && resolved && resolved.length > 0 && !resolved.includes(' ')) {
          resolve(resolved);
        } else {
          resolve(undefined);
        }
      });
      proc.on('error', () => resolve(undefined));
      // timeout de 5s para não travar
      setTimeout(() => { proc.kill(); resolve(undefined); }, 5000);
    });
  }

  async run(executionId: string, options: ExecutionOptions): Promise<void> {
    const workspaceRoot = options.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) throw new Error('Nenhum projeto selecionado. Use "Selecionar Projeto" na sidebar.');

    // actCwd: diretório de onde o act será invocado (pode ser pai do projeto para reusable workflows)
    const actCwd = options.actCwd ?? workspaceRoot;

    const config = vscode.workspace.getConfiguration('actRunner');
    const actPath = (config.get<string>('actPath') ?? 'act');
    const defaultImage = (config.get<string>('defaultImage') ?? 'catthehacker/ubuntu:act-latest');

    const args = this.buildArgs(options, defaultImage, actCwd);

    this.pendingJobStatus.clear();
    this.runningJobs.clear();
    this.accumulatedLogs = [];
    this.currentStep.clear();
    this.lastOuterJobId = null;
    this.failedInnerByOuter.clear();
    this.workflowDisplayName = options.workflowName ?? null;
    this.summaryLines = [];
    this.inSummaryCapture = false;
    this.summaryTruncated = false;
    this.uiLogEventsSent = 0;
    this.uiLogEventsDropped = 0;

    // Limpar containers act-* órfãos de execuções anteriores antes de iniciar
    await this.cleanupActContainers();
    return new Promise((resolve, reject) => {
      this.activeProcess = spawn(actPath, args, {
        cwd: actCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.activeProcess.stdout?.on('data', (chunk: Buffer) => {
        chunk.toString().split('\n').forEach((line: string) => {
          if (line.trim()) this.processLine(executionId, line);
        });
      });

      this.activeProcess.stderr?.on('data', (chunk: Buffer) => {
        chunk.toString().split('\n').forEach((line: string) => {
          const classified = this.classifyLogLine(line, 'error');
          const clean = stripAnsi(classified.line);
          if (clean.trim()) {
            this.pushAccumulatedLog(clean);
            this.dispatchLog({ executionId, line: this.toUiLogLine(classified.line), level: classified.level, timestamp: now() });
          }
        });
      });

      this.activeProcess.on('close', (code: number | null) => {
        this.activeProcess = null;
        const finalJobStatus: 'success' | 'failed' = code === 0 ? 'success' : 'failed';
        // Flush any pending job status before execution:end so nodes reflect
        // their individual status (not just the global fallback)
        for (const [pendingJobId, pending] of this.pendingJobStatus) {
          actLog(`[act-runner] job:${pending.status} (flush on close) → jobId="${pendingJobId}"`);
          eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: pendingJobId, jobName: pendingJobId, status: finalJobStatus, completedAt: pending.completedAt } });
        }
        this.pendingJobStatus.clear();

        // Flush summary acumulado do output do act
        this.flushSummary(executionId);
        this.flushDroppedLogNotice(executionId);

        eventBus.dispatch({
          type: 'execution:end',
          payload: {
            executionId,
            status: code === 0 ? 'success' : 'failed',
            duration: 0,
            completedAt: now(),
          },
        });
        if (code === 0) resolve();
        else reject(new Error(`act encerrou com código ${code}`));
      });

      this.activeProcess.on('error', (err: Error) => {
        this.activeProcess = null;
        eventBus.dispatch({ type: 'execution:error', payload: { executionId, error: err.message } });
        reject(err);
      });
    });
  }

  stop(): void {
    this.pendingJobStatus.clear();
    this.runningJobs.clear();
    this.currentStep.clear();
    this.lastOuterJobId = null;
    this.failedInnerByOuter.clear();
    this.summaryLines = [];
    this.inSummaryCapture = false;
    this.summaryTruncated = false;
    this.uiLogEventsSent = 0;
    this.uiLogEventsDropped = 0;
    this.activeProcess?.kill('SIGTERM');
    this.activeProcess = null;
    // Limpar containers act-* que ficaram ativos após o kill
    this.cleanupActContainers()
      .catch(() => { /* silencioso */ });
  }

  clearLogs(): void {
    this.accumulatedLogs = [];
  }

  /**
   * Remove todos os containers Docker cujo nome começa com "act-".
   * Chamado em stop() e antes de cada run() para garantir que containers
   * órfãos de execuções anteriores não acumulem.
   */
  private cleanupActContainers(): Promise<void> {
    return new Promise((resolve) => {
      // Busca IDs de containers em execução cujo nome começa com "act-"
      const find = spawn('docker', ['ps', '-q', '--filter', 'name=act-'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let ids = '';
      find.stdout?.on('data', (chunk: Buffer) => { ids += chunk.toString(); });
      find.on('error', () => resolve()); // docker não instalado ou indisponível
      find.on('close', () => {
        const containerIds = ids.trim().split('\n').filter(Boolean);
        if (containerIds.length === 0) { resolve(); return; }
        actLog(`[act-runner] limpando ${containerIds.length} container(s) act-* residual(is)`);
        const rm = spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'ignore' });
        rm.on('close', () => resolve());
        rm.on('error', () => resolve());
      });
    });
  }

  /**
   * Remove o prefixo do nome do workflow dos brackets do act.
   * Act emite: [WorkflowDisplayName/JobName] content
   * Após strip: [JobName] content
   * Isso evita que o workflow name seja confundido com um outer job
   * (ex: "CI" de "CI/CD Pipeline" sendo interpretado como job pai).
   */
  private stripWorkflowPrefix(line: string): string {
    if (!this.workflowDisplayName) return line;
    const prefix = '[' + this.workflowDisplayName + '/';
    if (line.startsWith(prefix)) {
      return '[' + line.slice(prefix.length);
    }
    return line;
  }

  private classifyLogLine(rawLine: string, fallbackLevel: LogLevel = 'info'): { line: string; level: LogLevel } {
    const line = stripCarriageReturn(rawLine);

    const ghAnnotationRaw = line.match(RE_GITHUB_ANNOTATION);
    if (ghAnnotationRaw) {
      const levelToken = ghAnnotationRaw[1].toLowerCase();
      const message = ghAnnotationRaw[2] ?? '';
      if (levelToken === 'warning') return { line: message, level: 'warn' };
      if (levelToken === 'error') return { line: message, level: 'error' };
      if (levelToken === 'debug') return { line: message, level: 'debug' };
      return { line: message, level: 'notice' };
    }

    const levelPrefix = line.match(RE_LEVEL_PREFIX);
    if (levelPrefix) {
      const levelToken = levelPrefix[1].toLowerCase();
      const message = levelPrefix[2] ?? '';
      if (levelToken === 'warning' || levelToken === 'warn') return { line: message, level: 'warn' };
      if (levelToken === 'error') return { line: message, level: 'error' };
      if (levelToken === 'debug') return { line: message, level: 'debug' };
      if (levelToken === 'notice' || levelToken === 'info') return { line: message, level: 'notice' };
    }

    return { line, level: fallbackLevel };
  }

  private processLine(executionId: string, raw: string): void {
    const clean = stripCarriageReturn(raw);
    const cleanForParsingOnly = stripAnsi(clean);
    if (!clean.trim()) return;

    // Remover prefixo do workflow name para parsear brackets corretamente
    // Act v2 prefixa todos os brackets com: [WorkflowDisplayName/JobName]
    // Para workflows com "/" no nome (ex: "CI/CD Pipeline"), isso causaria falsos outer jobs.
    const cleanForParsingNoWorkflowPrefix = this.stripWorkflowPrefix(cleanForParsingOnly);
    const cleanNoWorkflowPrefix = this.stripWorkflowPrefix(clean);

    let m: RegExpMatchArray | null;

    // ── Outer-job lifecycle tracking ────────────────────────────────────────
    // Any bracketed line tells us which outer job is active.
    // - First appearance  → mark it as "running" (works for ALL act output formats)
    // - Pending resolve   → confirm/cancel pending status based on outer-job change
    const bracketM = cleanForParsingNoWorkflowPrefix.match(RE_ANY_BRACKET);
    if (bracketM) {
      const { outerJobId: currentOuterJobId, effectiveJobId: currentEffectiveJobId, isReusable } = parseEffectiveBracket(bracketM[1]);

      // Mark outer job as running on first bracket line seen for that job
      if (!this.runningJobs.has(currentOuterJobId)) {
        // Quando um NOVO outer job aparece pela primeira vez, o anterior já terminou.
        // Act não emite [OuterJob] 🏁 Job succeeded para callers de reusable workflows,
        // então inferimos a conclusão aqui.
        if (this.lastOuterJobId && this.lastOuterJobId !== currentOuterJobId) {
          const prevId = this.lastOuterJobId;
          if (!this.pendingJobStatus.has(prevId)) {
            const inferredStatus = this.failedInnerByOuter.has(prevId) ? 'failed' : 'success';
            actLog(`[act-runner] outer job:${inferredStatus} (inferred on transition) → jobId="${prevId}"`);
            eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: prevId, jobName: prevId, status: inferredStatus, completedAt: now() } });
          }
        }
        this.lastOuterJobId = currentOuterJobId;
        this.runningJobs.add(currentOuterJobId);
        actLog(`[act-runner] job:running (first bracket) → jobId="${currentOuterJobId}"`);
        eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: currentOuterJobId, jobName: currentOuterJobId, status: 'running', startedAt: now() } });
      } else {
        // Atualiza o outer job mais recentemente visto (mesmo que já visto antes)
        this.lastOuterJobId = currentOuterJobId;
      }
      // Para reusables, também marcar o inner job como running na primeira aparição
      if (isReusable && !this.runningJobs.has(currentEffectiveJobId)) {
        this.runningJobs.add(currentEffectiveJobId);
        actLog(`[act-runner] inner job:running (first bracket) → jobId="${currentEffectiveJobId}"`);
        eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: currentEffectiveJobId, jobName: currentEffectiveJobId, outerJobId: currentOuterJobId, status: 'running', startedAt: now() } });
      }

      // Pending confirmation: confirm/cancel based on outer-job change
      if (this.pendingJobStatus.size > 0) {
        for (const [pendingJobId, pending] of this.pendingJobStatus) {
          if (pendingJobId !== currentOuterJobId) {
            // Outer job changed → confirm the pending job as done
            actLog(`[act-runner] job:${pending.status} (confirmed, outer changed) → jobId="${pendingJobId}"`);
            eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: pendingJobId, jobName: pendingJobId, status: pending.status, completedAt: pending.completedAt } });
            this.pendingJobStatus.delete(pendingJobId);
          } else {
            // Same outer job still has work → cancel pending (more sub-jobs running)
            actLog(`[act-runner] job:pending cancelled (same outer job active) → jobId="${pendingJobId}"`);
            this.pendingJobStatus.delete(pendingJobId);
          }
        }
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_STEP_START))) {
      const { outerJobId, effectiveJobId, isReusable } = parseEffectiveBracket(m[1]);
      const stepName = m[2].trim();
      this.currentStep.set(effectiveJobId, stepName);
      eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: effectiveJobId, jobName: effectiveJobId, outerJobId: isReusable ? outerJobId : undefined, status: 'running', startedAt: now() } });
      eventBus.dispatch({ type: 'step:update', payload: { executionId, jobId: effectiveJobId, stepId: stepName, stepName, status: 'running', startedAt: now() } });
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_STEP_OK))) {
      const { effectiveJobId } = parseEffectiveBracket(m[1]);
      const stepName = stripTiming(m[2].trim()); // remove sufixo de timing: "Name [52ms]" → "Name"
      this.currentStep.delete(effectiveJobId);
      eventBus.dispatch({ type: 'step:update', payload: { executionId, jobId: effectiveJobId, stepId: stepName, stepName, status: 'success', completedAt: now() } });
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_STEP_FAIL))) {
      const { effectiveJobId } = parseEffectiveBracket(m[1]);
      const stepName = stripTiming(m[2].trim());
      this.currentStep.delete(effectiveJobId);
      eventBus.dispatch({ type: 'step:update', payload: { executionId, jobId: effectiveJobId, stepId: stepName, stepName, status: 'failed', completedAt: now() } });
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_STEP_SKIP))) {
      const { effectiveJobId } = parseEffectiveBracket(m[1]);
      const stepName = stripTiming(m[2].trim());
      this.currentStep.delete(effectiveJobId);
      eventBus.dispatch({ type: 'step:update', payload: { executionId, jobId: effectiveJobId, stepId: stepName, stepName, status: 'skipped', completedAt: now() } });
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_JOB_START))) {
      const { outerJobId, effectiveJobId, isReusable } = parseEffectiveBracket(m[1]);
      actLog(`[act-runner] job:running → jobId="${effectiveJobId}"`);
      eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: effectiveJobId, jobName: effectiveJobId, outerJobId: isReusable ? outerJobId : undefined, status: 'running', startedAt: now() } });
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_JOB_OK))) {
      const { outerJobId, effectiveJobId, isReusable } = parseEffectiveBracket(m[1]);
      if (isReusable) {
        actLog(`[act-runner] inner job:success → jobId="${effectiveJobId}"`);
        eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: effectiveJobId, jobName: effectiveJobId, outerJobId, status: 'success', completedAt: now() } });
      } else {
        actLog(`[act-runner] job:success (pending) → jobId="${outerJobId}"`);
        this.pendingJobStatus.set(outerJobId, { status: 'success', completedAt: now() });
      }
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_JOB_FAIL))) {
      const { outerJobId, effectiveJobId, isReusable } = parseEffectiveBracket(m[1]);
      if (isReusable) {
        actLog(`[act-runner] inner job:failed → jobId="${effectiveJobId}"`);
        this.failedInnerByOuter.add(outerJobId); // registrar falha para inferir status do outer
        eventBus.dispatch({ type: 'job:update', payload: { executionId, jobId: effectiveJobId, jobName: effectiveJobId, outerJobId, status: 'failed', completedAt: now() } });
      } else {
        actLog(`[act-runner] job:failed (pending) → jobId="${outerJobId}"`);
        this.pendingJobStatus.set(outerJobId, { status: 'failed', completedAt: now() });
      }
      return;
    }
    if ((m = cleanForParsingNoWorkflowPrefix.match(RE_LOG_LINE))) {
      // Formato: [bracket] | content
      const { effectiveJobId } = parseEffectiveBracket(m[1]);
      const stepId = this.currentStep.get(effectiveJobId) ?? effectiveJobId;
      const rawLogMatch = cleanNoWorkflowPrefix.match(RE_LOG_LINE);
      const rawContent = rawLogMatch ? rawLogMatch[2] : m[2];
      const classified = this.classifyLogLine(rawContent, 'info');
      this.pushAccumulatedLog(stripAnsi(classified.line));
      this.dispatchLog({ executionId, jobId: effectiveJobId, stepId, line: this.toUiLogLine(classified.line), level: classified.level, timestamp: now() });
      return;
    }
    // ── Detecção de GITHUB_STEP_SUMMARY via output do act ──────────────────
    // Act pode emitir: [bracket] ◎ Summary - <linha> ou [bracket] Summary - <linha>
    // Linhas seguintes sem bracket são continuação do summary.
    const bracketFallback = cleanForParsingNoWorkflowPrefix.match(RE_ANY_BRACKET);
    if (bracketFallback) {
      const rawLineContent = cleanNoWorkflowPrefix.slice(cleanNoWorkflowPrefix.indexOf(']') + 1).trim();
      const lineContent = stripAnsi(rawLineContent);
      // Detectar início de summary, tolerando ícones/símbolos antes de "Summary".
      const summaryMatch = lineContent.match(/^(?:[^A-Za-z0-9#|`*-]+\s*)?Summary\s*-\s*(.*)$/i);
      if (summaryMatch) {
        // Flush summary anterior se existir (outro job pode ter gerado summary antes)
        this.flushSummary(executionId);
        this.inSummaryCapture = true;
        if (summaryMatch[1].trim()) {
          this.pushSummaryLine(summaryMatch[1].trim());
        }
        // Também enviar como log normal
        const { effectiveJobId } = parseEffectiveBracket(bracketFallback[1]);
        const stepId = this.currentStep.get(effectiveJobId) ?? effectiveJobId;
        const classified = this.classifyLogLine(rawLineContent, 'info');
        this.pushAccumulatedLog(stripAnsi(classified.line));
        this.dispatchLog({ executionId, jobId: effectiveJobId, stepId, line: this.toUiLogLine(classified.line), level: classified.level, timestamp: now() });
        return;
      }
      // Qualquer outra linha com bracket encerra a captura de summary
      if (this.inSummaryCapture) {
        this.inSummaryCapture = false;
        this.dispatchSummary(executionId);
      }
      // Linha com bracket mas sem padrão específico (⚙ ::set-output::, 🐳 docker exec, etc.)
      const { effectiveJobId } = parseEffectiveBracket(bracketFallback[1]);
      const stepId = this.currentStep.get(effectiveJobId) ?? effectiveJobId;
      if (lineContent) {
        const classified = this.classifyLogLine(rawLineContent, 'info');
        this.pushAccumulatedLog(stripAnsi(classified.line));
        this.dispatchLog({ executionId, jobId: effectiveJobId, stepId, line: this.toUiLogLine(classified.line), level: classified.level, timestamp: now() });
      }
      return;
    }
    // Linha sem bracket — pode ser continuação do summary ou stdout bruto
    if (this.inSummaryCapture) {
      this.pushSummaryLine(cleanForParsingOnly);
    }
    const classified = this.classifyLogLine(clean, 'info');
    this.pushAccumulatedLog(stripAnsi(classified.line));
    this.dispatchLog({ executionId, line: this.toUiLogLine(classified.line), level: classified.level, timestamp: now() });
  }

  /** Despacha o summary acumulado para o webview se houver conteúdo */
  private dispatchSummary(executionId: string): void {
    if (this.summaryLines.length === 0) return;
    const content = this.summaryTruncated
      ? `${this.summaryLines.join('\n')}\n...[summary truncated]`
      : this.summaryLines.join('\n');
    actLog(`[act-runner] summary:update (${this.summaryLines.length} lines)`);
    eventBus.dispatch({ type: 'summary:update', payload: { executionId, content } });
  }

  /** Flush final do summary (chamado no close do processo) */
  private flushSummary(executionId: string): void {
    if (this.inSummaryCapture) {
      this.inSummaryCapture = false;
    }
    this.dispatchSummary(executionId);
  }

  private buildArgs(options: ExecutionOptions, defaultImage: string, actCwd?: string): string[] {
    const args: string[] = [];

    if (options.workflowPath) {
      // Quando o CWD é diferente do projeto, -W deve ser relativo ao actCwd
      // (exatamente como: cd fean-projects/ && act -W sample-dotnet-api/.github/workflows/file.yaml)
      const effectiveCwd = actCwd ?? options.workspaceRoot ?? '';
      const wfPath = effectiveCwd && effectiveCwd !== options.workspaceRoot
        ? path.relative(effectiveCwd, path.resolve(options.workflowPath))
        : sanitizePath(options.workflowPath);
      args.push('-W', wfPath);
    }
    if (options.jobId)        args.push('-j', sanitizeArg(options.jobId));
    if (options.dryRun)       args.push('-n');
    if (options.eventType)    args.push(sanitizeArg(options.eventType));
    if (options.eventPayloadPath) args.push('-e', sanitizePath(options.eventPayloadPath));
    if (options.envFile)      args.push('--env-file', sanitizePath(options.envFile));
    if (options.varFile)      args.push('--var-file', sanitizePath(options.varFile));
    if (options.secretsFile)  args.push('--secret-file', sanitizePath(options.secretsFile));

    // Passa --rm para que act remova o container automaticamente ao finalizar
    // (cobre saída normal com sucesso ou falha gerenciada pelo próprio act)
    args.push('--rm');

    // Só adicionar -P se nenhum .actrc no projeto já define a plataforma
    // (evita sobrescrever a configuração local do usuário)
    if (!this.actrcDefinesPlatform(actCwd, options.workspaceRoot)) {
      args.push('-P', `ubuntu-latest=${defaultImage}`);
    }

    return args;
  }

  /** Verifica se algum .actrc no projeto já define -P para não sobrescrever */
  private actrcDefinesPlatform(actCwd?: string, workspaceRoot?: string): boolean {
    const candidates = [...new Set([actCwd, workspaceRoot].filter(Boolean) as string[])];
    return candidates.some((dir) => {
      try {
        const content = fs.readFileSync(path.join(dir, '.actrc'), 'utf-8');
        return content.split('\n').some((line) => line.trim().startsWith('-P '));
      } catch {
        return false;
      }
    });
  }
}

const now = () => new Date().toISOString();
export const actRunner = new ActRunner();
