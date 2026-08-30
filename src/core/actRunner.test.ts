/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActRunner } from '../core/actRunner';
import { eventBus } from '../core/eventBus';

// Mockar child_process para não executar o CLI de verdade
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

function createMockProcess(stdoutLines: string[], stderrLines: string[] = [], exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  proc.pid = 12345;

  // Emitir linhas async
  setImmediate(() => {
    for (const line of stdoutLines) {
      proc.stdout.emit('data', Buffer.from(line + '\n'));
    }
    for (const line of stderrLines) {
      proc.stderr.emit('data', Buffer.from(line + '\n'));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('ActRunner', () => {
  let runner: ActRunner;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    runner = new ActRunner();
    (spawn as jest.Mock).mockReset();
    dispatchSpy = jest.spyOn(eventBus, 'dispatch').mockImplementation(() => undefined);
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it('isActInstalled() deve retornar true quando act está disponível', async () => {
    (spawn as jest.Mock).mockReturnValueOnce(createMockProcess(['act version 0.2.60']));
    const result = await runner.isActInstalled('act');
    expect(result).toBe(true);
  });

  it('isActInstalled() deve retornar false quando act não está disponível', async () => {
    (spawn as jest.Mock).mockReturnValueOnce(createMockProcess([], [], 127));
    const result = await runner.isActInstalled('act-nao-existe');
    expect(result).toBe(false);
  });

  it('buildArgs() deve incluir varFile quando informado', () => {
    const args = (runner as any).buildArgs(
      {
        workflowPath: '.github/workflows/ci.yml',
        workspaceRoot: '/repo',
        envFile: '/repo/.env',
        varFile: '/repo/.vars',
      },
      'catthehacker/ubuntu:act-latest',
      '/repo'
    );

    expect(args).toEqual(expect.arrayContaining([
      '--env-file', '/repo/.env',
      '--var-file', '/repo/.vars',
    ]));
  });

  it('run() deve resolver ao finalizar com sucesso', async () => {
    const mockProc = createMockProcess([
      '[build] ⭐ Run actions/checkout@v4',
      '[build]   ✅ Success - actions/checkout@v4',
    ]);
    (runner as any).cleanupActContainers = jest.fn().mockResolvedValue(undefined);
    (runner as any).cleanupDanglingImages = jest.fn().mockResolvedValue(undefined);
    (spawn as jest.Mock).mockReturnValueOnce(mockProc);

    await expect(runner.run('exec-001', {
      workflowPath: '.github/workflows/ci.yml',
      workspaceRoot: '/repo',
    })).resolves.toBeUndefined();

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'act',
      expect.arrayContaining(['-W', '.github/workflows/ci.yml']),
      expect.objectContaining({ cwd: '/repo' })
    );
  });

  it('processLine() deve mapear ::notice:: para level notice removendo o comando', () => {
    (runner as any).processLine('exec-001', '[build/Test] | ::notice:: deploy em andamento');

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('notice');
    expect(logEvent.payload.line).toBe('deploy em andamento');
  });

  it('processLine() deve mapear ::notice:: mesmo com prefixo visual do act', () => {
    (runner as any).processLine('exec-001', '[build/Test] | ❓ ::notice title=AWS Setup::Running in SIMULATION MODE');

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('notice');
    expect(logEvent.payload.line).toBe('Running in SIMULATION MODE');
  });

  it('processLine() deve mapear anotacao notice com separador de um colon', () => {
    (runner as any).processLine('exec-001', '[build/Test] | ?::notice title=AWS Setup:Running in SIMULATION MODE');

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('notice');
    expect(logEvent.payload.line).toBe('Running in SIMULATION MODE');
  });

  it('processLine() deve mapear ::error:: para level error removendo o comando', () => {
    (runner as any).processLine('exec-001', '[build/Test] | ::error:: falhou o build');

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('error');
    expect(logEvent.payload.line).toBe('falhou o build');
  });

  it('processLine() deve mapear [INFO] para level notice', () => {
    (runner as any).processLine('exec-001', '[build/Test] | [INFO] mensagem azul');

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('notice');
    expect(logEvent.payload.line).toBe('mensagem azul');
  });

  it('processLine() deve mapear [DEBUG] para level debug', () => {
    (runner as any).processLine('exec-001', '[build/Test] | [DEBUG] detalhe técnico');

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('debug');
    expect(logEvent.payload.line).toBe('detalhe técnico');
  });

  it('processLine() deve preservar ANSI na linha enviada ao evento de log', () => {
    const ansiLine = '[build/Test] | \u001b[31mfalha colorida\u001b[0m';
    (runner as any).processLine('exec-001', ansiLine);

    const logEvent = dispatchSpy.mock.calls
      .map((args) => args[0])
      .find((event) => event.type === 'log');

    expect(logEvent).toBeDefined();
    expect(logEvent.payload.level).toBe('info');
    expect(logEvent.payload.line).toContain('\u001b[31m');
    expect(logEvent.payload.line).toContain('falha colorida');
  });
});
