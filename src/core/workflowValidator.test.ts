/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'path';
import { workflowParser } from '../core/workflowParser';
import { workflowValidator } from '../core/workflowValidator';

const FIXTURES = path.resolve(__dirname, '../__fixtures__');

describe('WorkflowValidator', () => {
  it('deve validar um workflow simples como válido', async () => {
    const wf = await workflowParser.parse(path.join(FIXTURES, 'workflow-simple.yml'));
    const result = workflowValidator.validate(wf);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('deve validar um workflow multi-job como válido', async () => {
    const wf = await workflowParser.parse(path.join(FIXTURES, 'workflow-multi-job.yml'));
    const result = workflowValidator.validate(wf);

    expect(result.valid).toBe(true);
  });

  it('deve detectar runs-on ausente', async () => {
    const wf = await workflowParser.parse(path.join(FIXTURES, 'workflow-invalid.yml'));
    const result = workflowValidator.validate(wf);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /runs-on|runsOn/i.test(e))).toBe(true);
  });

  it('deve detectar referência a job inexistente em needs', async () => {
    const wf = await workflowParser.parse(path.join(FIXTURES, 'workflow-simple.yml'));
    // Injetar needs inválido
    const modified = {
      ...wf,
      jobs: {
        ...wf.jobs,
        build: { ...wf.jobs['build'], needs: ['inexistente'] },
      },
    };
    const result = workflowValidator.validate(modified as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /inexistente/i.test(e))).toBe(true);
  });

  it('deve detectar ciclo em needs', async () => {
    const wf = await workflowParser.parse(path.join(FIXTURES, 'workflow-simple.yml'));
    // Criar ciclo artificial: build → build
    const modified = {
      ...wf,
      jobs: {
        build: { ...wf.jobs['build'], needs: ['build'] },
      },
    };
    const result = workflowValidator.validate(modified as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /circular|ciclo|cycle/i.test(e))).toBe(true);
  });
});
