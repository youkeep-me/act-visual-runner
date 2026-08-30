import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { actRunner } from './core/actRunner';
import { executionEngine } from './core/executionEngine';
import { historyService } from './core/historyService';
import { envManager } from './core/envManager';
import { dockerGuide } from './core/dockerGuide';
import { workflowParser } from './core/workflowParser';
import { workflowValidator } from './core/workflowValidator';
import { eventBus } from './core/eventBus';
import { workflowExplorer } from './providers/workflowExplorer';
import { workflowCodeLensProvider } from './providers/codeLensProvider';
import { StatusBarController } from './providers/statusBarController';
import type { WebviewCommand } from './types/events.types';
import type { ExecutionOptions } from './types/execution.types';
import type { WorkflowDefinition } from './types/workflow.types';
import { t } from './i18n/messages';

let webviewPanel: vscode.WebviewPanel | undefined;
/** Execução pendente: inicia quando o webview enviar state:request (React montado) */
/* Start */
let pendingExecution: (() => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  historyService.initialize(context);
  envManager.initialize(context);

  // Status bar
  const statusBar = new StatusBarController();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // Workflow explorer (TreeView na sidebar)
  const treeView = vscode.window.createTreeView('actRunner.workflowExplorer', {
    treeDataProvider: workflowExplorer,
    showCollapseAll: true,
  });
  const treeVisibilityDisposable = treeView.onDidChangeVisibility((event) => {
    if (!event.visible) return;
    openWebviewPanel(context, 'graph');
    vscode.commands.executeCommand('workbench.action.closeSidebar');
  });
  context.subscriptions.push(treeView, treeVisibilityDisposable);

  // CodeLens nos arquivos YAML
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'yaml', pattern: '**/.github/workflows/*.{yml,yaml}' },
      workflowCodeLensProvider
    )
  );

  // Watcher para atualizar o explorer ao mudar workflows
  const watcher = vscode.workspace.createFileSystemWatcher('**/.github/workflows/*.{yml,yaml}');
  const refreshWorkflows = () => {
    workflowExplorer.refresh();
    sendWorkflowSnapshot();
  };
  watcher.onDidCreate(refreshWorkflows);
  watcher.onDidDelete(refreshWorkflows);
  watcher.onDidChange(refreshWorkflows);
  context.subscriptions.push(watcher);

  // --- Registro de Comandos ---
  context.subscriptions.push(
    vscode.commands.registerCommand('actRunner.showMenu', () => showMainMenu()),

    vscode.commands.registerCommand('actRunner.runWorkflow', async (arg?: unknown) => {
      const root = workspaceRoot();
      const wfPath = resolveWorkflowPathForExecution(root, extractPath(arg)) ?? (await pickWorkflow());
      if (!wfPath) return;
      const opts: ExecutionOptions = { workflowPath: wfPath, trigger: 'manual', workspaceRoot: root };
      openWebviewPanel(context, 'graph', () => safeRun(() => executionEngine.run(opts)));
    }),

    vscode.commands.registerCommand('actRunner.runJob', async (arg?: unknown, jobId?: string) => {
      const root = workspaceRoot();
      const wfPath = resolveWorkflowPathForExecution(root, extractPath(arg)) ?? (await pickWorkflow());
      if (!wfPath) return;
      const argObj = arg && typeof arg === 'object' ? arg as Record<string, unknown> : null;
      const job = (argObj && typeof argObj.jobId === 'string' ? argObj.jobId : undefined)
        ?? jobId
        ?? (await pickJob(wfPath));
      if (!job) return;
      const opts: ExecutionOptions = { workflowPath: wfPath, jobId: job, trigger: 'manual', workspaceRoot: root };
      openWebviewPanel(context, 'graph', () => safeRun(() => executionEngine.run(opts)));
    }),

    vscode.commands.registerCommand('actRunner.listJobs', async () => {
      const wfPath = await pickWorkflow();
      if (!wfPath) return;
      try {
        const wf = workflowParser.parse(wfPath);
        const items = Object.values(wf.jobs).map((j) => ({
          label: j.name ?? j.id,
          description: `${j.steps.length} steps`,
          detail: j.needs?.length ? `needs: ${j.needs.join(', ')}` : undefined,
        }));
        await vscode.window.showQuickPick(items, { placeHolder: t('Available jobs (read-only)') });
      } catch (e) {
        vscode.window.showErrorMessage(t('Failed to list jobs: {0}', e instanceof Error ? e.message : String(e)));
      }
    }),

    vscode.commands.registerCommand('actRunner.stopExecution', () => {
      executionEngine.stop();
    }),

    vscode.commands.registerCommand('actRunner.forceReset', () => {
      executionEngine.forceReset();
      vscode.window.showInformationMessage(t('✅ Execution state reset.'));
    }),

    vscode.commands.registerCommand('actRunner.validateWorkflow', async (arg?: unknown) => {
      const wfPath = extractPath(arg) ?? (await pickWorkflow());
      if (!wfPath) return;
      try {
        const wf = workflowParser.parse(wfPath);
        const result = workflowValidator.validate(wf);
        if (result.valid) {
          vscode.window.showInformationMessage(t('✅ Workflow is valid!'));
        } else {
          vscode.window.showErrorMessage(t('❌ Validation errors:\n{0}', result.errors.join('\n')));
        }
      } catch (e) {
        vscode.window.showErrorMessage(t('Failed to parse YAML: {0}', e instanceof Error ? e.message : String(e)));
      }
    }),

    vscode.commands.registerCommand('actRunner.manageEnv', () => openWebviewPanel(context, 'env')),
    vscode.commands.registerCommand('actRunner.viewHistory', () => openWebviewPanel(context, 'history')),
    vscode.commands.registerCommand('actRunner.dockerGuide', () => dockerGuide.showGuide()),
    vscode.commands.registerCommand('actRunner.securityGuide', () => {
      vscode.env.openExternal(
        vscode.Uri.parse('https://docs.github.com/en/actions/security-guides/encrypted-secrets')
      );
    }),
    vscode.commands.registerCommand('actRunner.refreshExplorer', () => workflowExplorer.refresh()),

    vscode.commands.registerCommand('actRunner.selectProject', () => selectProjectFromUser()),

    vscode.commands.registerCommand('actRunner.locateAct', async () => {
      // Tentar auto-detect antes de pedir ao usuário
      const autoFound = await actRunner.autoDetect();
      if (autoFound) {
        vscode.window.showInformationMessage(t('✅ act detected automatically: {0}', autoFound));
        return;
      }

      // Pedir o path manualmente
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        openLabel: t('Select the act executable'),
        title: t('Locate the act binary (e.g. /home/user/.act/act)'),
        filters: { [t('Executable')]: ['*'] },
      });
      if (!uris || uris.length === 0) return;
      const actPath = uris[0].fsPath;
      const cfg = vscode.workspace.getConfiguration('actRunner');
      await cfg.update('actPath', actPath, vscode.ConfigurationTarget.Global);
      const ok = await actRunner.isActInstalled(actPath);
      if (ok) {
        vscode.window.showInformationMessage(t('✅ act configured: {0}', actPath));
      } else {
        vscode.window.showErrorMessage(t('❌ Could not execute: {0}', actPath));
      }
    }),
  );

  dockerGuide.warnIfMissing();

  // Auto-detectar act na ativação (não bloqueia)
  actRunner.autoDetect().then((found) => {
    if (found) {
      // Encontrado — mostrar apenas se era necessário detectar automaticamente
      const configured = vscode.workspace.getConfiguration('actRunner').get<string>('actPath', 'act');
      if (configured !== found) {
        vscode.window.showInformationMessage(t('✅ act detected automatically: {0}', found));
      }
    } else {
      vscode.window
        .showWarningMessage(
          t('⚠️ "act" was not found automatically. Tell us where the executable is.',),
          t('Locate act'),
          t('View installation')
        )
        .then((choice) => {
          if (choice === t('Locate act')) vscode.commands.executeCommand('actRunner.locateAct');
          if (choice === t('View installation')) vscode.env.openExternal(vscode.Uri.parse('https://github.com/nektos/act#installation'));
        });
    }
  });

  const root = workspaceRoot();
  if (root) envManager.ensureSecretsIgnored(root);
}

export function deactivate(): void {
  webviewPanel?.dispose();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function workspaceRoot(): string {
  // Prefere o projeto selecionado manualmente no explorer
  return (
    workflowExplorer.getProjectRoot() ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    ''
  );
}

function getWorkflowSummaries(): Array<{ name: string; filePath: string; fileName: string; jobs: number; valid: boolean; inputs: Array<{ name: string; description?: string; required: boolean; default?: string | number | boolean; type: 'string' | 'choice' | 'boolean' | 'number' | 'environment'; options?: string[] }>; error?: string }> {
  const root = workspaceRoot();
  if (!root) return [];
  return workflowParser.discoverWorkflows(root).map((filePath) => {
    try {
      const workflow: WorkflowDefinition = workflowParser.parse(filePath);
      return {
        name: workflow.name,
        filePath,
        fileName: path.basename(filePath),
        jobs: Object.keys(workflow.jobs).length,
        valid: true,
        inputs: getWorkflowDispatchInputs(workflow),
      };
    } catch (error) {
      return {
        name: path.basename(filePath, path.extname(filePath)),
        filePath,
        fileName: path.basename(filePath),
        jobs: 0,
        valid: false,
        inputs: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function getWorkflowDispatchInputs(workflow: WorkflowDefinition): Array<{ name: string; description?: string; required: boolean; default?: string | number | boolean; type: 'string' | 'choice' | 'boolean' | 'number' | 'environment'; options?: string[] }> {
  const trigger = workflow.on;
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return [];
  const dispatch = (trigger as Record<string, unknown>).workflow_dispatch;
  if (!dispatch || typeof dispatch !== 'object') return [];
  const inputs = (dispatch as Record<string, unknown>).inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return [];
  return Object.entries(inputs as Record<string, unknown>).map(([name, raw]) => {
    const config = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const rawType = typeof config.type === 'string' ? config.type : 'string';
    const type = ['string', 'choice', 'boolean', 'number', 'environment'].includes(rawType)
      ? rawType as 'string' | 'choice' | 'boolean' | 'number' | 'environment'
      : 'string';
    return {
      name,
      description: typeof config.description === 'string' ? config.description : undefined,
      required: config.required === true,
      default: typeof config.default === 'string' || typeof config.default === 'number' || typeof config.default === 'boolean' ? config.default : undefined,
      type,
      options: Array.isArray(config.options) ? config.options.map(String) : undefined,
    };
  });
}

function getRepositorySnapshot(): { root: string; name: string; currentBranch?: string; branches?: string[] } | null {
  const root = workspaceRoot();
  if (!root) return null;
  const { currentBranch, branches } = getGitBranchSnapshot(root);
  return { root, name: path.basename(root), currentBranch, branches };
}

function getWorkflowProjectRoot(workflowPath: string): string {
  const marker = `${path.sep}.github${path.sep}workflows${path.sep}`;
  const index = workflowPath.indexOf(marker);
  return index >= 0 ? workflowPath.slice(0, index) : path.dirname(path.dirname(path.dirname(workflowPath)));
}

function getGitBranchSnapshot(root: string): { currentBranch?: string; branches: string[] } {
  try {
    const currentBranch = childProcess.execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim() || undefined;
    const branchOutput = childProcess.execFileSync('git', ['-C', root, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' });
    const branches = Array.from(new Set(
      branchOutput
        .split('\n')
        .map((branch: string) => branch.trim())
        .filter(Boolean)
    ));
    if (currentBranch && !branches.includes(currentBranch)) branches.unshift(currentBranch);
    return { currentBranch, branches };
  } catch {
    return { branches: [] };
  }
}

function sendWorkflowSnapshot(): void {
  webviewPanel?.webview.postMessage({
    type: 'state:snapshot',
    payload: { workflows: getWorkflowSummaries(), repository: getRepositorySnapshot(), history: historyService.getAllForWebview() },
  });
}

function resolveWorkflowPathForExecution(root: string, requestedWorkflowPath?: string): string | undefined {
  if (!root) return undefined;
  const availableWorkflows = workflowParser.discoverWorkflows(root);
  if (availableWorkflows.length === 0) return undefined;
  if (!requestedWorkflowPath) return availableWorkflows[0];

  const requested = path.isAbsolute(requestedWorkflowPath)
    ? path.normalize(requestedWorkflowPath)
    : path.resolve(root, requestedWorkflowPath);

  if (availableWorkflows.some((wfPath) => path.normalize(wfPath) === requested)) {
    return requested;
  }

  vscode.window.showWarningMessage(t('The selected workflow does not belong to the active repository. Running the first workflow in the selected repository.'));
  return availableWorkflows[0];
}

async function selectProjectFromUser(): Promise<void> {
  // Começar no workspace atual, projeto selecionado ou no home
  const currentRoot = workspaceRoot();
  const startDir = currentRoot
    ? vscode.Uri.file(currentRoot)
    : vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());

  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: t('Select repository'),
    title: t('Select the repository containing .github/workflows/'),
    defaultUri: startDir,
  });
  if (!uris || uris.length === 0) return;
  const root = uris[0].fsPath;
  workflowExplorer.setProjectRoot(root);
  envManager.ensureSecretsIgnored(root);
  sendWorkflowSnapshot();

  const found = workflowParser.discoverWorkflows(root);
  if (found.length === 0) {
    vscode.window.showWarningMessage(
      t('⚠️ No workflow found in {0}/.github/workflows/', root),
      t('Select another folder')
    ).then((choice) => { if (choice) vscode.commands.executeCommand('actRunner.selectProject'); });
  } else {
    vscode.window.showInformationMessage(t('✅ Repository selected: {0} ({1} workflow(s))', root, found.length));
  }
}

async function showMainMenu(): Promise<void> {
  const isRunning = executionEngine.isRunning();
  const items = [
    { label: `▶ ${t('Run Workflow')}`, command: 'actRunner.runWorkflow' },
    { label: `📋 ${t('Run Job')}`, command: 'actRunner.runJob' },
    { label: `📋 ${t('List Jobs')}`, command: 'actRunner.listJobs' },
    ...(isRunning ? [
      { label: `⏹ ${t('Stop Execution')}`, command: 'actRunner.stopExecution' },
      { label: `🔄 ${t('Reset state (force)')}`, command: 'actRunner.forceReset' },
    ] : []),
    { label: `✅ ${t('Validate Workflow')}`, command: 'actRunner.validateWorkflow' },
    { label: `🔐 ${t('Manage Environment Variables')}`, command: 'actRunner.manageEnv' },
    { label: `📜 ${t('View History')}`, command: 'actRunner.viewHistory' },
    { label: `🐳 ${t('Docker Desktop alternatives')}`, command: 'actRunner.dockerGuide' },
    { label: `🔒 ${t('Security best practices')}`, command: 'actRunner.securityGuide' },
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: '⚡ Act Visual Runner' });
  if (pick) vscode.commands.executeCommand(pick.command);
}

/**
 * Extrai o caminho do arquivo de um argumento que pode ser:
 * - string (path direto)
 * - WorkflowTreeItem (passado quando clicado via botão inline na tree view)
 * - undefined (nenhum argumento passado)
 */
function extractPath(arg: unknown): string | undefined {
  if (typeof arg === 'string' && arg.length > 0) return arg;
  if (arg && typeof (arg as { workflowPath?: string }).workflowPath === 'string') {
    return (arg as { workflowPath: string }).workflowPath;
  }
  return undefined;
}

/**
 * Localiza o .actrc verificando múltiplos caminhos em ordem de prioridade:
 * 1. workspaceRoot/.actrc  (configuração do projeto)
 * 2. parent(workspaceRoot)/.actrc  (repositórios com reusable workflows no pai)
 * 3. ~/.actrc  (configuração global — o local mais comum)
 * Retorna o primeiro que existir; se nenhum existir, retorna workspaceRoot/.actrc
 */
function resolveActrcPath(workspaceRoot: string): string {
  const candidates = [
    path.join(workspaceRoot, '.actrc'),
    path.join(path.dirname(workspaceRoot), '.actrc'),
    path.join(os.homedir(), '.actrc'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

async function pickWorkflow(): Promise<string | undefined> {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Selecione um projeto primeiro (botão 📂 na sidebar do Act Runner).');
    return;
  }
  const paths = workflowParser.discoverWorkflows(root);
  if (paths.length === 0) {
    vscode.window.showErrorMessage('Nenhum workflow encontrado em .github/workflows/');
    return;
  }
  if (paths.length === 1) return paths[0];
  const items = paths.map((p) => ({ label: path.basename(p), description: p, _path: p }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Selecione o workflow' });
  return pick?._path;
}

async function pickJob(wfPath: string): Promise<string | undefined> {
  try {
    const wf = workflowParser.parse(wfPath);
    const jobs = Object.keys(wf.jobs);
    if (jobs.length === 1) return jobs[0];
    return vscode.window.showQuickPick(jobs, { placeHolder: 'Selecione o job' });
  } catch {
    return undefined;
  }
}

async function safeRun(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    vscode.window.showErrorMessage(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function openWebviewPanel(context: vscode.ExtensionContext, initialView: string, onReady?: () => void): void {
  if (webviewPanel) {
    // Painel já existe: revelar e iniciar execução diretamente (webview já está montado)
    webviewPanel.reveal(vscode.ViewColumn.One);
    webviewPanel.webview.postMessage({ type: 'navigate', payload: { view: initialView } });
    sendWorkflowSnapshot();
    if (onReady) onReady();
    return;
  }
  // Armazena o callback para ser chamado quando o React enviar state:request
  pendingExecution = onReady;

  webviewPanel = vscode.window.createWebviewPanel(
    'actVisualRunner',
    'Act Visual Runner',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      retainContextWhenHidden: true,
    }
  );

  eventBus.registerPanel(webviewPanel);

  webviewPanel.webview.onDidReceiveMessage(async (msg: WebviewCommand) => {
    switch (msg.type) {
      case 'command:run': {
        const opts = msg.payload as Partial<ExecutionOptions>;
        const root = workspaceRoot();
        const workflowPath = resolveWorkflowPathForExecution(root, opts.workflowPath) ?? (await pickWorkflow());
        if (!workflowPath) break;
        const workflowInputs = (msg.payload as { workflowInputs?: Record<string, string | number | boolean> }).workflowInputs;
        const workflowRef = (msg.payload as { workflowRef?: string }).workflowRef;
        const eventPayloadPath = workflowInputs ? createWorkflowDispatchPayload(workflowInputs, workflowRef) : opts.eventPayloadPath;
        await safeRun(() => executionEngine.run({
          ...opts,
          workflowPath,
          workspaceRoot: root,
          workflowRef,
          ...(workflowInputs && { eventType: 'workflow_dispatch', eventPayloadPath }),
        }));
        break;
      }
      case 'command:quickRun': {
        const root = workspaceRoot();
        const workflowPath = resolveWorkflowPathForExecution(root, (msg.payload as Partial<ExecutionOptions>).workflowPath);
        if (!workflowPath) { vscode.window.showErrorMessage('Nenhum workflow encontrado.'); break; }
        await safeRun(() => executionEngine.run({ workflowPath, trigger: 'quick-run', workspaceRoot: root }));
        break;
      }
      case 'command:stop':
        executionEngine.stop();
        break;
      case 'command:locateAct':
        vscode.commands.executeCommand('actRunner.locateAct');
        break;
      case 'command:selectProject':
        await selectProjectFromUser();
        break;
      case 'command:rerun': {
        const record = historyService.getById(msg.payload.executionId);
        if (record) {
          const root = getWorkflowProjectRoot(record.workflowPath);
          workflowExplorer.setProjectRoot(root);
          envManager.ensureSecretsIgnored(root);
          sendWorkflowSnapshot();
          await safeRun(() =>
            executionEngine.run({
              workflowPath: record.workflowPath,
              jobId: record.jobId,
              dryRun: record.dryRun,
              trigger: 'replay',
              workspaceRoot: root,
              workflowRef: record.workflowRef,
            })
          );
        }
        break;
      }
      case 'command:restoreHistoryRepository': {
        const record = historyService.getById(msg.payload.executionId);
        if (!record) break;
        const root = getWorkflowProjectRoot(record.workflowPath);
        workflowExplorer.setProjectRoot(root);
        envManager.ensureSecretsIgnored(root);
        workflowExplorer.refresh();
        webviewPanel?.webview.postMessage({
          type: 'state:snapshot',
          payload: { workflows: getWorkflowSummaries(), repository: getRepositorySnapshot() },
        });
        break;
      }
      case 'command:loadEnv': {
        const { tab, filePath: clientFilePath } = msg.payload as { tab: string; filePath?: string };
        const root = workspaceRoot();
        let rows: { key: string; value: string }[] = [];
        let foundFilePath = '';
        try {
          if (tab === 'actrc') {
            // Procura .actrc em vários locais: projeto → pai do projeto → home (~/.actrc)
            foundFilePath = resolveActrcPath(root);
            if (fs.existsSync(foundFilePath)) {
              rows = fs.readFileSync(foundFilePath, 'utf-8')
                .split('\n')
                .map((l: string) => l.trim())
                .filter((l: string) => l && !l.startsWith('#'))
                .map((l: string) => ({ key: l, value: '' }));
            }
          } else {
            const filePath = resolveEnvEditorFilePath(root, tab, clientFilePath);
            if (clientFilePath?.trim() && filePath) {
              await rememberEnvFilePath(root, tab, filePath);
            }
            if (filePath && fs.existsSync(filePath)) {
              foundFilePath = filePath;
              const map = envManager.read(filePath);
              rows = mapToEnvRows(map);
            }
          }
        } catch { /* arquivo não existe — rows permanece vazio */ }
        webviewPanel?.webview.postMessage({
          type: 'state:snapshot',
          payload: { envData: { tab, rows, filePath: foundFilePath } },
        });
        break;
      }
      case 'command:selectEnvFile': {
        const { tab } = msg.payload as { tab: string };
        const root = workspaceRoot();
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          defaultUri: vscode.Uri.file(root),
          openLabel: 'Selecionar arquivo',
          title: `Selecionar arquivo de ${tab}`,
          filters: { 'Arquivos de variáveis': ['env', 'vars', 'variables', 'secrets', '*'] },
        });
        const filePath = selected?.[0]?.fsPath;
        if (!filePath) break;
        await rememberEnvFilePath(root, tab, filePath);
        const map = envManager.read(filePath);
        webviewPanel?.webview.postMessage({
          type: 'state:snapshot',
          payload: { envData: { tab, rows: mapToEnvRows(map), filePath } },
        });
        break;
      }
      case 'command:saveEnv': {
        const { tab, rows, filePath: clientFilePath } = msg.payload as { tab: string; rows: { key: string; value: string }[]; filePath?: string };
        const root = workspaceRoot();
        if (!root) break;
        try {
          if (tab === 'actrc') {
            // Salva no mesmo arquivo que foi carregado (ou no padrão do projeto)
            const filePath = (clientFilePath && clientFilePath.length > 0)
              ? clientFilePath
              : resolveActrcPath(root);
            const content = rows
              .map((r) => r.key.trim())
              .filter(Boolean)
              .join('\n');
            fs.writeFileSync(filePath, content + '\n', 'utf-8');
          } else {
            const requestedFilePath = clientFilePath?.trim();
            const filePath = requestedFilePath
              ? envManager.resolveFilePath(root, requestedFilePath)
              : resolveEnvEditorFilePath(root, tab);
            if (!filePath) {
              vscode.window.showErrorMessage(`Selecione um arquivo para salvar ${tab === 'vars' ? 'vars' : `.${tab}`}.`);
              break;
            }
            const map = new Map(
              rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])
            );
            envManager.write(filePath, map);
            await rememberEnvFilePath(root, tab, filePath);
          }
          vscode.window.showInformationMessage(`✅ ${tab === 'vars' ? 'vars' : `.${tab}`} salvo com sucesso.`);
        } catch (e) {
          vscode.window.showErrorMessage(`Erro ao salvar ${tab === 'vars' ? 'vars' : `.${tab}`}: ${e instanceof Error ? e.message : e}`);
        }
        break;
      }
      case 'command:deleteHistory': {
        const { executionId: delId } = msg.payload as { executionId: string };
        await historyService.deleteById(delId);
        webviewPanel?.webview.postMessage({
          type: 'state:snapshot',
          payload: { history: historyService.getAllForWebview() },
        });
        break;
      }
      case 'state:request':
        webviewPanel?.webview.postMessage({
          type: 'state:snapshot',
          payload: { history: historyService.getAllForWebview(), workflows: getWorkflowSummaries(), repository: getRepositorySnapshot() },
        });
        // Webview está pronto (React montou): disparar execução pendente, se houver
        if (pendingExecution) {
          const exec = pendingExecution;
          pendingExecution = undefined;
          exec();
        }
        break;
    }
  });

  webviewPanel.onDidDispose(() => {
    webviewPanel = undefined;
  });

  const scriptUri = webviewPanel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'webview.js')
  );

  const csp = webviewPanel.webview.cspSource;
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 62)
    )
  ).join('');

  webviewPanel.webview.html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}' ${csp}; style-src ${csp} 'unsafe-inline'; font-src ${csp}; img-src ${csp} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Act Visual Runner</title>
</head>
<body style="padding:0;margin:0;overflow:hidden;background:#111827;color:#F9FAFB;">
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__INITIAL_VIEW__ = '${initialView}';
    const vscode = acquireVsCodeApi();
    window.__vscode__ = vscode;
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

async function rememberEnvFilePath(root: string, tab: string, filePath: string): Promise<void> {
  if (tab === 'env') await envManager.rememberFilePath(root, 'envFile', filePath);
  if (tab === 'vars') await envManager.rememberFilePath(root, 'varFile', filePath);
  if (tab === 'secrets') await envManager.rememberFilePath(root, 'secretsFile', filePath);
}

function mapToEnvRows(map: Map<string, string>): { key: string; value: string }[] {
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

function resolveEnvEditorFilePath(root: string, tab: string, clientFilePath?: string): string | undefined {
  if (clientFilePath?.trim()) return envManager.resolveFilePath(root, clientFilePath.trim());

  const selectedPath = tab === 'env'
    ? envManager.getSelectedEnvFilePath(root)
    : tab === 'vars'
      ? envManager.getSelectedVarFilePath(root)
      : tab === 'secrets'
        ? envManager.getSelectedSecretsFilePath(root)
        : undefined;
  if (selectedPath) return selectedPath;

  const defaultPath = tab === 'env'
    ? envManager.getDefaultFilePath(root, 'envFile')
    : tab === 'vars'
      ? envManager.getDefaultFilePath(root, 'varFile')
      : tab === 'secrets'
        ? envManager.getDefaultFilePath(root, 'secretsFile')
        : undefined;

  return defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined;
}

function createWorkflowDispatchPayload(inputs: Record<string, string | number | boolean>, ref = 'main'): string {
  const filePath = path.join(os.tmpdir(), `act-workflow-dispatch-${Date.now()}.json`);
  const normalizedRef = ref.startsWith('refs/') ? ref : `refs/heads/${ref || 'main'}`;
  const payload = {
    ref: normalizedRef,
    inputs,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}
