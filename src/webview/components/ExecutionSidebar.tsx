import React, { useState, useEffect, useRef } from 'react';
import { useExecutionStore, type GraphNode, type NodeStatus } from '../store/executionStore';

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<NodeStatus, string> = {
  idle:    '#6e7681',
  running: '#fb923c',
  success: '#3fb950',
  failed:  '#f85149',
  skipped: '#8b949e',
};

const STATUS_ICON: Record<NodeStatus, string> = {
  idle:    '○',
  running: '◉',
  success: '✓',
  failed:  '✕',
  skipped: '⏭',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  return ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StepRowProps {
  step: GraphNode;
  isSelected: boolean;
  indent: number;
  onSelect: () => void;
}
function StepRow({ step, isSelected, indent, onSelect }: StepRowProps) {
  return (
    <div
      onClick={onSelect}
      title={step.label}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: `3px 8px 3px ${indent}px`,
        borderLeft: `2px solid ${isSelected ? '#58a6ff' : 'transparent'}`,
        background: isSelected ? '#0d1f3c' : 'transparent',
        cursor: 'pointer',
        borderBottom: '1px solid transparent',
      }}
    >
      <span style={{ color: STATUS_COLOR[step.status], fontSize: 11, flexShrink: 0,
        animation: step.status === 'running' ? 'actSpin 1.2s linear infinite' : undefined }}>
        {STATUS_ICON[step.status]}
      </span>
      <span style={{ flex: 1, fontSize: 11, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {step.label}
      </span>
      {fmtDuration(step.duration) && (
        <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{fmtDuration(step.duration)}</span>
      )}
    </div>
  );
}

interface InnerJobRowProps {
  job: GraphNode;
  steps: GraphNode[];
  isExpanded: boolean;
  isSelected: boolean;
  filterJobId?: string;
  filterStepLabel?: string;
  onToggle: () => void;
  onSelectJob: () => void;
  onSelectStep: (step: GraphNode) => void;
}
function InnerJobRow({ job, steps, isExpanded, isSelected, filterJobId, filterStepLabel, onToggle, onSelectJob, onSelectStep }: InnerJobRowProps) {
  return (
    <div>
      {/* Inner job header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px 4px 18px',
        borderLeft: `2px solid ${isSelected ? '#58a6ff' : 'transparent'}`,
        background: isSelected ? '#0d1f3c' : 'transparent',
        borderBottom: '1px solid #161b22',
      }}>
        {/* Chevron */}
        <button onClick={onToggle} style={styles.chevron} title={isExpanded ? 'Colapsar' : 'Expandir'}>
          {steps.length > 0 ? (isExpanded ? '▾' : '▸') : <span style={{ opacity: 0 }}>▸</span>}
        </button>
        {/* Status */}
        <span style={{ color: STATUS_COLOR[job.status], fontSize: 11, flexShrink: 0,
          animation: job.status === 'running' ? 'actSpin 1.2s linear infinite' : undefined }}>
          {STATUS_ICON[job.status]}
        </span>
        {/* Label */}
        <span onClick={onSelectJob} title={job.label}
          style={{ flex: 1, fontSize: 12, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', fontWeight: 500 }}>
          {job.label}
        </span>
        {fmtDuration(job.duration) && (
          <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{fmtDuration(job.duration)}</span>
        )}
      </div>

      {/* Steps */}
      {isExpanded && steps.map(step => (
        <StepRow
          key={step.id}
          step={step}
          indent={32}
          isSelected={filterJobId === job.id && filterStepLabel === step.label}
          onSelect={() => onSelectStep(step)}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutionSidebar() {
  const nodes        = useExecutionStore(s => s.nodes);
  const logFilter    = useExecutionStore(s => s.logFilter);
  const setLogFilter = useExecutionStore(s => s.setLogFilter);
  const execution    = useExecutionStore(s => s.execution);

  // Sets separados por nível
  const [expandedOuter, setExpandedOuter] = useState<Set<string>>(new Set());
  const [expandedInner, setExpandedInner] = useState<Set<string>>(new Set());

  // Ref para detectar início de nova execução
  const prevExecIdRef   = useRef<string | null>(null);

  // Nodes por tipo/nível
  const outerJobs = nodes.filter(n => n.type === 'job' && !n.parentId);
  const innerJobs = nodes.filter(n => n.type === 'job' && !!n.parentId);
  const steps     = nodes.filter(n => n.type === 'step');

  // Agrupar inner jobs por outer job id
  // Usamos find(id OR label) porque o outerJobId do actRunner é o display name
  // enquanto o nó parsed do YAML tem id = chave YAML (ex: "ci") e label = display ("CI")
  const innerByOuter = new Map<string, GraphNode[]>();
  innerJobs.forEach(ij => {
    const outerNode = outerJobs.find(oj => oj.id === ij.parentId || oj.label === ij.parentId);
    if (!outerNode) return;
    const list = innerByOuter.get(outerNode.id) ?? [];
    list.push(ij);
    innerByOuter.set(outerNode.id, list);
  });

  // Agrupar steps por job id (inner ou outer)
  const stepsByJob = new Map<string, GraphNode[]>();
  steps.forEach(s => {
    if (!s.parentId) return;
    const list = stepsByJob.get(s.parentId) ?? [];
    list.push(s);
    stepsByJob.set(s.parentId, list);
  });

  // Resetar ao início de nova execução
  useEffect(() => {
    if (execution.executionId !== prevExecIdRef.current) {
      prevExecIdRef.current = execution.executionId;
      setExpandedOuter(new Set());
      setExpandedInner(new Set());
    }
  }, [execution.executionId]);

  if (outerJobs.length === 0 || execution.status === 'idle') return null;

  const toggleOuter = (id: string) =>
    setExpandedOuter(prev => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  const toggleInner = (id: string) =>
    setExpandedInner(prev => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });

  const selectInnerJob = (ij: GraphNode) => {
    const isSelected = logFilter?.jobId === ij.id && !logFilter.stepLabel;
    setLogFilter(isSelected ? null : { jobId: ij.id, label: ij.label });
  };

  const selectStep = (ij: GraphNode, step: GraphNode) => {
    const isSelected = logFilter?.jobId === ij.id && logFilter.stepLabel === step.label;
    setLogFilter(isSelected ? null : { jobId: ij.id, stepLabel: step.label, label: `${ij.label} › ${step.label}` });
  };

  const selectOuterStep = (oj: GraphNode, step: GraphNode) => {
    const isSelected = logFilter?.jobId === oj.id && logFilter.stepLabel === step.label;
    setLogFilter(isSelected ? null : { jobId: oj.id, stepLabel: step.label, label: `${oj.label} › ${step.label}` });
  };

  return (
    <div style={styles.container}>
      {/* Cabeçalho */}
      <div style={styles.header}>
        <span>Execução</span>
        {logFilter && (
          <button style={styles.clearBtn} onClick={() => setLogFilter(null)}>✕ todos</button>
        )}
      </div>

      <div style={styles.list}>
        {outerJobs.map(oj => {
          const ijList    = innerByOuter.get(oj.id) ?? [];
          const ojSteps   = stepsByJob.get(oj.id) ?? [];
          const isExpanded = expandedOuter.has(oj.id);
          // Outer job tem steps diretos (sem reusable) ou inner jobs (reusable)
          const hasChildren = ijList.length > 0 || ojSteps.length > 0;

          return (
            <div key={oj.id}>
              {/* ── Outer job row ── */}
              <div style={{ ...styles.outerJobRow, background: '#161b22' }}>
                <button onClick={() => toggleOuter(oj.id)} style={styles.chevronOuter} title={isExpanded ? 'Colapsar' : 'Expandir'}>
                  {hasChildren ? (isExpanded ? '▾' : '▸') : <span style={{ opacity: 0 }}>▸</span>}
                </button>
                <span style={{ color: STATUS_COLOR[oj.status], fontSize: 12, flexShrink: 0,
                  animation: oj.status === 'running' ? 'actSpin 1.2s linear infinite' : undefined }}>
                  {STATUS_ICON[oj.status]}
                </span>
                <span title={oj.label}
                  style={{ flex: 1, fontSize: 12, color: '#e6edf3', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {oj.label}
                </span>
                {fmtDuration(oj.duration) && (
                  <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{fmtDuration(oj.duration)}</span>
                )}
              </div>

              {isExpanded && (
                <>
                  {/* Caso 1: outer job com inner jobs (reusable workflow) */}
                  {ijList.map(ij => (
                    <InnerJobRow
                      key={ij.id}
                      job={ij}
                      steps={stepsByJob.get(ij.id) ?? []}
                      isExpanded={expandedInner.has(ij.id)}
                      isSelected={logFilter?.jobId === ij.id && !logFilter.stepLabel}
                      filterJobId={logFilter?.jobId}
                      filterStepLabel={logFilter?.stepLabel}
                      onToggle={() => toggleInner(ij.id)}
                      onSelectJob={() => selectInnerJob(ij)}
                      onSelectStep={(step) => selectStep(ij, step)}
                    />
                  ))}

                  {/* Caso 2: outer job com steps diretos (sem reusable) */}
                  {ojSteps.map(step => (
                    <StepRow
                      key={step.id}
                      step={step}
                      indent={22}
                      isSelected={logFilter?.jobId === oj.id && logFilter.stepLabel === step.label}
                      onSelect={() => selectOuterStep(oj, step)}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 240,
    minWidth: 160,
    borderRight: '1px solid #21262d',
    background: '#0d1117',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  header: {
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: '#6e7681',
    background: '#161b22',
    borderBottom: '1px solid #21262d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  clearBtn: {
    padding: '1px 6px',
    border: '1px solid #30363d',
    borderRadius: 3,
    background: 'transparent',
    color: '#58a6ff',
    cursor: 'pointer',
    fontSize: 10,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
  },
  outerJobRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 8px 7px 5px',
    borderBottom: '1px solid #21262d',
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  chevron: {
    width: 14,
    border: 'none',
    background: 'transparent',
    color: '#6e7681',
    cursor: 'pointer',
    fontSize: 11,
    padding: 0,
    flexShrink: 0,
    lineHeight: 1,
  },
  chevronOuter: {
    width: 14,
    border: 'none',
    background: 'transparent',
    color: '#6e7681',
    cursor: 'pointer',
    fontSize: 11,
    padding: 0,
    flexShrink: 0,
    lineHeight: 1,
  },
};
