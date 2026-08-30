import { HistoryService } from '../core/historyService';
import type { ExecutionRecord } from '../types/execution.types';
import * as vscode from 'vscode';

describe('HistoryService', () => {
  let service: HistoryService;
  const mockContext = {
    workspaceState: {
      get: jest.fn().mockReturnValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    globalState: {
      get: jest.fn().mockReturnValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as vscode.ExtensionContext;

  const sample: ExecutionRecord = {
    id: 'exec-001',
    workflowName: 'CI Node.js',
    workflowPath: '.github/workflows/ci.yml',
    status: 'success',
    startedAt: new Date('2024-01-01T10:00:00Z').toISOString(),
    completedAt: new Date('2024-01-01T10:01:00Z').toISOString(),
    duration: 60000,
    trigger: 'manual',
    dryRun: false,
    actArgs: [],
    jobs: [],
    logSummary: '',
  };

  beforeEach(() => {
    service = new HistoryService();
    service.initialize(mockContext);
    jest.clearAllMocks();
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([]);
  });

  it('deve salvar um registro', async () => {
    await service.save(sample);
    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'actRunner.executionHistory',
      expect.arrayContaining([expect.objectContaining({ id: 'exec-001' })])
    );
  });

  it('deve retornar todos os registros', () => {
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([sample]);
    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('exec-001');
  });

  it('deve buscar por ID', () => {
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([sample]);
    const found = service.getById('exec-001');
    expect(found?.workflowName).toBe('CI Node.js');
  });

  it('deve retornar undefined para ID inexistente', () => {
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([]);
    expect(service.getById('inexistente')).toBeUndefined();
  });

  it('deve filtrar por status', async () => {
    const failed: ExecutionRecord = { ...sample, id: 'exec-002', status: 'failed' };
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([sample, failed]);
    const results = service.filter({ status: 'failed' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('exec-002');
  });

  it('deve deletar um registro por ID', async () => {
    const failed: ExecutionRecord = { ...sample, id: 'exec-002', status: 'failed' };
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([sample, failed]);

    await service.deleteById('exec-001');

    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'actRunner.executionHistory',
      [expect.objectContaining({ id: 'exec-002' })]
    );
  });

  it('deve limpar o histórico', async () => {
    await service.clear();
    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'actRunner.executionHistory',
      []
    );
  });

  it('deve deletar múltiplos registros por ID', async () => {
    const cancelled: ExecutionRecord = { ...sample, id: 'exec-002', status: 'cancelled' };
    const failed: ExecutionRecord = { ...sample, id: 'exec-003', status: 'failed' };
    (mockContext.workspaceState.get as jest.Mock).mockReturnValue([sample, cancelled, failed]);

    await service.deleteByIds(['exec-001', 'exec-003']);

    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'actRunner.executionHistory',
      [expect.objectContaining({ id: 'exec-002' })]
    );
  });

  it('deve usar uma chave separada para cada projeto', async () => {
    service.setWorkspaceRoot('/repo-a');

    await service.save(sample);

    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'actRunner.executionHistory./repo-a',
      expect.arrayContaining([expect.objectContaining({ id: 'exec-001' })])
    );
  });
});
