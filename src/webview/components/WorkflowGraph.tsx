import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useExecutionStore, type GraphNode, type NodeStatus } from '../store/executionStore';
import { t } from '../i18n';

// ─── Status config ───────────────────────────────────────────────────────────

interface StatusConfig {
  border: string;
  bg: string;
  iconColor: string;
  icon: string;
  pulse: boolean;
}

const STATUS: Record<NodeStatus, StatusConfig> = {
  idle: { border: '#30363d', bg: '#161b22', iconColor: '#6e7681', icon: '○', pulse: false },
  running: { border: '#f97316', bg: '#1a0f00', iconColor: '#fb923c', icon: '◉', pulse: true },
  success: { border: '#238636', bg: '#0d2818', iconColor: '#3fb950', icon: '✓', pulse: false },
  failed: { border: '#da3633', bg: '#200d0d', iconColor: '#f85149', icon: '✕', pulse: false },
  skipped: { border: '#484f58', bg: '#161b22', iconColor: '#8b949e', icon: '⏭', pulse: false },
};

const JOB_CARD_BG = '#161b22';

// ─── Animation injection ─────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes actPulse {
  0%   { box-shadow: 0 0 0 0 rgba(249,115,22,0.55); }
  70%  { box-shadow: 0 0 0 7px rgba(249,115,22,0); }
  100% { box-shadow: 0 0 0 0 rgba(249,115,22,0); }
}
@keyframes actSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes actDotBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}`;

function injectKeyframes() {
  if (document.getElementById('act-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'act-keyframes';
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: NodeStatus }) {
  const cfg = STATUS[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: status === 'idle' ? 'transparent' : cfg.iconColor + '22',
        color: cfg.iconColor,
        fontSize: status === 'running' ? 13 : 11,
        fontWeight: 700,
        animation: status === 'running' ? 'actSpin 1.2s linear infinite' : undefined,
        flexShrink: 0,
      }}
    >
      {cfg.icon}
    </span>
  );
}

function StepRow({ node, onClick, isSelected }: { node: GraphNode; onClick: () => void; isSelected: boolean }) {
  const cfg = STATUS[node.status];
  const isRunning = node.status === 'running';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px',
        borderLeft: `3px solid ${isSelected ? '#58a6ff' : (isRunning ? cfg.border : 'transparent')}`,
        background: isSelected ? '#0d1f3c' : (isRunning ? cfg.bg : 'transparent'),
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      <StatusDot status={node.status} />
      <span
        style={{
          fontSize: 12,
          color: node.status === 'idle' ? '#6e7681' : cfg.iconColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {node.label}
      </span>
      {node.duration !== undefined && node.duration > 0 && (
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6e7681', whiteSpace: 'nowrap' }}>
          {(node.duration / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

// ─── InnerJobSection: seção plana (sem caixa própria) dentro do outer job ────
function InnerJobCard({
  job, steps, isExpanded, onToggle, onSelectStep, filterJobId, filterStepLabel,
}: {
  job: GraphNode;
  steps: GraphNode[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelectStep: (step: GraphNode) => void;
  filterJobId: string | null;
  filterStepLabel?: string;
}) {
  const cfg = STATUS[job.status];
  const isRunning = job.status === 'running';
  const hasSteps = steps.length > 0;
  return (
    <div style={{ width: '100%' }}>
      {/* Linha do inner job: ▼/▶ + nome colorido */}
      <div
        onClick={hasSteps ? onToggle : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 16px',
          cursor: hasSteps ? 'pointer' : 'default',
          background: undefined,
          transition: 'background 0.15s ease',
        }}
      >
        <span style={{ color: cfg.iconColor, fontSize: 10, width: 10, flexShrink: 0 }}>
          {hasSteps ? (isExpanded ? '▼' : '▶') : '•'}
        </span>
        <span style={{
          fontWeight: 600, fontSize: 12,
          color: job.status === 'idle' ? '#6e7681' : '#c9d1d9',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {job.label}
        </span>
        {isRunning && (
          <span style={{ fontSize: 9, color: cfg.iconColor, animation: 'actDotBlink 1s ease-in-out infinite', flexShrink: 0 }}>●</span>
        )}
        {job.duration !== undefined && job.duration > 0 && !isRunning && (
          <span style={{ fontSize: 10, color: '#6e7681', flexShrink: 0 }}>
            {(job.duration / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      {/* Steps indentados */}
      {isExpanded && hasSteps && (
        <div>
          {steps.map((step) => (
            <div key={step.id} style={{ paddingLeft: 16 }}>
              <StepRow
                node={step}
                onClick={() => onSelectStep(step)}
                isSelected={filterJobId === job.id && filterStepLabel === step.label}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OuterJobCard: outer job (wrap de inner jobs ou steps diretos) ────────────
function OuterJobCard({
  outerJob, innerJobs, directSteps, stepsByJob,
  isExpanded, onToggle, expandedInner, onToggleInner,
  onSelectInnerStep, onSelectDirectStep, filterJobId, filterStepLabel,
}: {
  outerJob: GraphNode;
  innerJobs: GraphNode[];
  directSteps: GraphNode[];
  stepsByJob: Map<string, GraphNode[]>;
  isExpanded: boolean;
  onToggle: () => void;
  expandedInner: Set<string>;
  onToggleInner: (id: string) => void;
  onSelectInnerStep: (job: GraphNode, step: GraphNode) => void;
  onSelectDirectStep: (step: GraphNode) => void;
  filterJobId: string | null;
  filterStepLabel?: string;
}) {
  const cfg = STATUS[outerJob.status];
  const isRunning = outerJob.status === 'running';
  const hasChildren = innerJobs.length > 0 || directSteps.length > 0;
  return (
    <div style={{
      border: `2px solid ${cfg.border}`,
      borderRadius: 12, overflow: 'hidden',
      background: JOB_CARD_BG,
      width: 'fit-content', minWidth: 280,
      animation: isRunning ? 'actPulse 2s ease-in-out infinite' : undefined,
      transition: 'border-color 0.3s ease',
    }}>
      {/* Header centralizado com chevron à esquerda */}
      <div
        onClick={hasChildren ? onToggle : undefined}
        style={{
          display: 'flex', alignItems: 'center',
          padding: '11px 14px',
          borderBottom: isExpanded && hasChildren ? `1px solid ${cfg.border}55` : undefined,
          background: JOB_CARD_BG,
          cursor: hasChildren ? 'pointer' : 'default',
          position: 'relative',
        }}
      >
        {/* Chevron fixo à esquerda */}
        <span style={{ color: '#8b949e', fontSize: 11, width: 14, flexShrink: 0 }}>
          {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
        </span>
        {/* Nome centralizado */}
        <span style={{
          flex: 1, textAlign: 'center',
          fontWeight: 700, fontSize: 14,
          color: outerJob.status === 'idle' ? '#8b949e' : '#e6edf3',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {outerJob.label}
        </span>
        {/* Duração à direita */}
        {isRunning && (
          <span style={{ fontSize: 10, color: cfg.iconColor, animation: 'actDotBlink 1s ease-in-out infinite', flexShrink: 0 }}>
            {t('running')}
          </span>
        )}
        {outerJob.duration !== undefined && outerJob.duration > 0 && !isRunning && (
          <span style={{ fontSize: 10, color: '#6e7681', flexShrink: 0 }}>
            {(outerJob.duration / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      {/* Corpo: inner jobs como seções planas, sem padding extra */}
      {isExpanded && hasChildren && (
        <div>
          {innerJobs.map((ij, idx) => (
            <div key={ij.id}>
              {idx > 0 && <div style={{ height: 1, background: `${cfg.border}33`, marginLeft: 16 }} />}
              <InnerJobCard
                job={ij}
                steps={stepsByJob.get(ij.id) ?? []}
                isExpanded={expandedInner.has(ij.id)}
                onToggle={() => onToggleInner(ij.id)}
                onSelectStep={(step) => onSelectInnerStep(ij, step)}
                filterJobId={filterJobId}
                filterStepLabel={filterStepLabel}
              />
            </div>
          ))}
          {directSteps.map((step, i) => (
            <React.Fragment key={step.id}>
              {(innerJobs.length > 0 || i > 0) && <div style={{ height: 1, background: `${cfg.border}33`, marginLeft: 16 }} />}
              <StepRow
                node={step}
                onClick={() => onSelectDirectStep(step)}
                isSelected={filterJobId === outerJob.id && filterStepLabel === step.label}
              />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Layout engine ───────────────────────────────────────────────────────────

const CARD_W = 300;  // largura fixa do card de job
const HDR_H = 50;   // altura do header (âncora vertical das setas)
const COL_GAP = 48;   // espaço horizontal entre colunas
const ROW_GAP = 56;   // espaço vertical entre linhas (breathing room entre chains)
const PAD = 32;   // padding do canvas

interface Pos { x: number; y: number }

/**
 * Calcula o layout em grade do DAG em duas etapas:
 *
 * 1. Coluna = profundidade máxima a partir das raízes (BFS topológica).
 * 2. Linha  = método do baricentro: cada coluna é reordenada pela média das
 *    linhas dos predecessores, minimizando cruzamentos de arestas.
 *
 * Resultado: chains sequenciais ficam na mesma linha horizontal;
 * chains paralelas ficam em linhas diferentes, como no GitHub Actions UI.
 */
function computeDAGLayout(
  jobs: GraphNode[],
  deps: { from: string; to: string }[]
): Record<string, Pos> {
  if (jobs.length === 0) return {};

  // ── 1. Coluna: profundidade máxima (BFS) ─────────────────────────────────
  const col = new Map<string, number>(jobs.map(j => [j.id, 0]));
  const inDeg = new Map<string, number>(jobs.map(j => [j.id, 0]));
  const adj = new Map<string, string[]>();  // arestas diretas
  const radj = new Map<string, string[]>();  // arestas inversas (predecessores)

  for (const { from, to } of deps) {
    adj.set(from, [...(adj.get(from) ?? []), to]);
    radj.set(to, [...(radj.get(to) ?? []), from]);
    inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
  }

  const queue = jobs.filter(j => !(inDeg.get(j.id) ?? 0)).map(j => j.id);
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of adj.get(id) ?? []) {
      const c = (col.get(id) ?? 0) + 1;
      if (c > (col.get(next) ?? 0)) col.set(next, c);
      const deg = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // ── 2. Agrupar por coluna na ordem YAML ──────────────────────────────────
  const byCol = new Map<number, string[]>();
  jobs.forEach(j => {
    const c = col.get(j.id) ?? 0;
    byCol.set(c, [...(byCol.get(c) ?? []), j.id]);
  });

  // ── 3. Baricentro: reordenar cada coluna pela média das linhas ────────────
  // dos predecessores para minimizar cruzamentos de arestas.
  const rowOf = new Map<string, number>();
  const sortedCols = [...byCol.keys()].sort((a, b) => a - b);

  for (const c of sortedCols) {
    const ids = byCol.get(c)!;

    if (c === 0) {
      // Coluna raiz: mantém ordem original do YAML
      ids.forEach((id, i) => rowOf.set(id, i));
      continue;
    }

    // Calcular baricentro de cada nó: média das linhas dos predecessores
    const withBary = ids.map(id => {
      const preds = radj.get(id) ?? [];
      const bary = preds.length === 0
        ? ids.indexOf(id)   // sem predecessores: manter posição relativa
        : preds.reduce((s, p) => s + (rowOf.get(p) ?? 0), 0) / preds.length;
      return { id, bary };
    });

    // Ordenar pelo baricentro e reatribuir índices de linha
    withBary.sort((a, b) => a.bary - b.bary);
    withBary.forEach(({ id }, i) => rowOf.set(id, i));
    byCol.set(c, withBary.map(x => x.id));
  }

  // ── 4. Converter (coluna, linha) → (x, y) ────────────────────────────────
  const pos: Record<string, Pos> = {};
  jobs.forEach(j => {
    const c = col.get(j.id) ?? 0;
    const r = rowOf.get(j.id) ?? 0;
    pos[j.id] = {
      x: PAD + c * (CARD_W + COL_GAP),
      y: PAD + r * (HDR_H + ROW_GAP),
    };
  });
  return pos;
}

/**
 * Redução transitiva de arestas: remove dependências já implícitas por
 * transitividade. Ex.: se setup→build→tests existem, setup→tests é redundante.
 */
function transitiveReduction(
  deps: { from: string; to: string }[]
): { from: string; to: string }[] {
  const adj = new Map<string, string[]>();
  for (const { from, to } of deps) {
    adj.set(from, [...(adj.get(from) ?? []), to]);
  }
  const reachableViaOther = (u: string, v: string): boolean => {
    const visited = new Set<string>();
    const queue = (adj.get(u) ?? []).filter(n => n !== v);
    while (queue.length) {
      const curr = queue.shift()!;
      if (curr === v) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const next of adj.get(curr) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    return false;
  };
  return deps.filter(({ from, to }) => !reachableViaOther(from, to));
}

// ─── Main component ───────────────────────────────────────────────────────────

interface WorkflowGraphProps {
  showHeader?: boolean;
}

export function WorkflowGraph({ showHeader = true }: WorkflowGraphProps) {
  const { nodes, edges, execution, logFilter, setLogFilter } = useExecutionStore((s) => ({
    nodes: s.nodes,
    edges: s.edges,
    execution: s.execution,
    logFilter: s.logFilter,
    setLogFilter: s.setLogFilter,
  }));

  const [expandedOuter, setExpandedOuter] = useState<Set<string>>(new Set());
  const [expandedInner, setExpandedInner] = useState<Set<string>>(new Set());
  // Posições absolutas dos cards sobrescritas pelo usuário ao arrastar
  const [dragPos, setDragPos] = useState<Record<string, Pos>>({});
  // Id do card atualmente sendo arrastado (para cursor)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const prevExecIdRef = useRef<string | null>(null);
  // Ref interna do drag — não causa re-render durante o arrasto
  const dragRef = useRef<{ id: string; mx: number; my: number; ox: number; oy: number } | null>(null);
  const dragMovedRef = useRef(false);

  useEffect(() => { injectKeyframes(); }, []);

  // Resetar tudo ao iniciar nova execução
  useEffect(() => {
    if (execution.executionId !== prevExecIdRef.current) {
      prevExecIdRef.current = execution.executionId;
      setExpandedOuter(new Set());
      setExpandedInner(new Set());
      setDragPos({});
    }
  }, [execution.executionId]);

  // Handlers globais de mouse para arrastar cards
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { id, mx, my, ox, oy } = dragRef.current;
      dragMovedRef.current = true;
      setDragPos(p => ({ ...p, [id]: { x: ox + e.clientX - mx, y: oy + e.clientY - my } }));
    };
    const onUp = () => {
      if (dragRef.current) { dragRef.current = null; setDraggingId(null); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const outerJobs = nodes.filter((n) => n.type === 'job' && !n.parentId);
  const innerJobs = nodes.filter((n) => n.type === 'job' && !!n.parentId);
  const steps = nodes.filter((n) => n.type === 'step');

  // Redução transitiva: apenas arestas essenciais (sem redundâncias transitivas)
  // DEVE vir antes do return condicional (Rules of Hooks)
  const allDeps = edges.map(e => ({ from: e.source, to: e.target }));
  const depsKey = allDeps.map((e: { from: string; to: string }) => `${e.from}→${e.to}`).join('|');
  const reducedDeps = useMemo(
    () => transitiveReduction(allDeps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [depsKey]
  );
  // IDs das arestas visíveis (para filtrar o array original do store)
  const reducedSet = useMemo(
    () => new Set(reducedDeps.map((e: { from: string; to: string }) => `${e.from}→${e.to}`)),
    [reducedDeps]
  );

  // Layout computado — usa apenas arestas essenciais para baricentro mais limpo
  const reducedKey = reducedDeps.map((e: { from: string; to: string }) => `${e.from}→${e.to}`).join('|');
  const layout = useMemo(
    () => computeDAGLayout(outerJobs, reducedDeps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outerJobs.map(j => j.id).join('|'), reducedKey]
  );

  // Agrupar inner jobs sob o outer correto (match por id OU label)
  const innerByOuter = new Map<string, GraphNode[]>();
  innerJobs.forEach(ij => {
    const outer = outerJobs.find(oj => oj.id === ij.parentId || oj.label === ij.parentId);
    if (!outer) return;
    const list = innerByOuter.get(outer.id) ?? [];
    list.push(ij);
    innerByOuter.set(outer.id, list);
  });

  // Agrupar steps por job pai
  const stepsByJob = new Map<string, GraphNode[]>();
  steps.forEach(step => {
    const list = stepsByJob.get(step.parentId ?? '') ?? [];
    list.push(step);
    stepsByJob.set(step.parentId ?? '', list);
  });

  if (outerJobs.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>▶</div>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>{t('No workflow running')}</p>
        <p style={{ fontSize: 12, color: '#6e7681' }}>
          {t('Select a workflow and click Run to view progress here.')}
        </p>
      </div>
    );
  }

  // Posição efetiva: override do drag ou layout calculado
  const getPos = (id: string): Pos => dragPos[id] ?? layout[id] ?? { x: PAD, y: PAD };

  // Dimensões do canvas
  const allPos = outerJobs.map(j => getPos(j.id));
  const canvasW = Math.max(640, ...allPos.map(p => p.x + CARD_W + PAD + COL_GAP));
  const canvasH = Math.max(320, ...allPos.map(p => p.y + HDR_H * 4 + PAD));

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

  const allJobs = [...outerJobs, ...innerJobs];
  const runningCount = allJobs.filter(j => j.status === 'running').length;
  const successCount = allJobs.filter(j => j.status === 'success').length;
  const failedCount = allJobs.filter(j => j.status === 'failed').length;

  const handleCardMouseDown = (jobId: string, e: React.MouseEvent) => {
    dragMovedRef.current = false;
    const pos = getPos(jobId);
    dragRef.current = { id: jobId, mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y };
    setDraggingId(jobId);
  };

  return (
    <div style={styles.container}>
      {showHeader && (
        <div style={styles.header}>
          <span style={{ fontWeight: 600, color: '#e6edf3' }}>{execution.workflowName || 'Workflow'}</span>
          <div style={styles.summary}>
            {runningCount > 0 && <span style={{ color: '#fb923c' }}>◉ {runningCount} {t('running')}</span>}
            {successCount > 0 && <span style={{ color: '#3fb950' }}>✓ {successCount} {t('completed')}</span>}
            {failedCount > 0 && <span style={{ color: '#f85149' }}>✕ {failedCount} {t('failed plural')}</span>}
            <span style={{ color: '#6e7681', fontSize: 11 }}>
              {allJobs.length} job{allJobs.length !== 1 ? 's' : ''} · {steps.length} step{steps.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Área scrollável com canvas absoluto */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
        <div
          style={{
            position: 'relative',
            width: canvasW,
            height: canvasH,
            minWidth: '100%',
            minHeight: '100%',
            userSelect: 'none',
            // Fundo pontilhado estilo n8n
            backgroundImage: 'radial-gradient(circle, #21262d 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          {/* SVG: arestas entre jobs */}
          <svg
            style={{
              position: 'absolute', inset: 0,
              width: canvasW, height: canvasH,
              pointerEvents: 'none', overflow: 'visible',
            }}
          >
            {edges.filter(e => reducedSet.has(`${e.source}→${e.target}`)).map(e => {
              const src = getPos(e.source);
              const dst = getPos(e.target);
              // Dots ficam NA borda do card (port handle)
              // Stub horizontal sai do dot antes do bezier começar
              const DOT_R = 4;
              const STUB = 8;
              const dot1x = src.x + CARD_W;            // dot na borda direita do card fonte
              const dot1y = src.y + HDR_H / 2;
              const dot2x = dst.x;                     // dot na borda esquerda do card destino
              const dot2y = dst.y + HDR_H / 2;
              // Bezier parte do fim do stub source até o início do stub destino
              const bx1 = dot1x + STUB;
              const bx2 = dot2x - STUB;
              const dx = bx2 - bx1;
              const cpx1 = bx1 + dx * 0.45;
              const cpx2 = bx2 - dx * 0.45;
              const srcJob = outerJobs.find(j => j.id === e.source);
              const clr = STATUS[srcJob?.status ?? 'idle'].border;
              return (
                <g key={e.id}>
                  {/* path: stub saindo do card → bezier → stub entrando no destino */}
                  <path
                    d={`M ${dot1x} ${dot1y} H ${bx1} C ${cpx1} ${dot1y} ${cpx2} ${dot2y} ${bx2} ${dot2y} H ${dot2x}`}
                    stroke={clr} strokeWidth={2} fill="none"
                  />
                  <circle cx={dot1x} cy={dot1y} r={DOT_R} fill={clr} />
                  <circle cx={dot2x} cy={dot2y} r={DOT_R} fill={clr} />
                </g>
              );
            })}
          </svg>

          {/* Cards de job — posicionados absolutamente */}
          {outerJobs.map(oj => {
            const pos = getPos(oj.id);
            const isDragging = draggingId === oj.id;
            return (
              <div
                key={oj.id}
                onMouseDown={(e) => handleCardMouseDown(oj.id, e)}
                onClickCapture={(e) => {
                  // Cancela o click se o usuário arrastou (evita toggle acidental)
                  if (dragMovedRef.current) { dragMovedRef.current = false; e.stopPropagation(); }
                }}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  zIndex: isDragging ? 100 : 1,
                  filter: isDragging ? 'drop-shadow(0 8px 24px rgba(0,0,0,0.55))' : undefined,
                  transition: isDragging ? undefined : 'filter 0.2s ease',
                }}
              >
                <OuterJobCard
                  outerJob={oj}
                  innerJobs={innerByOuter.get(oj.id) ?? []}
                  directSteps={stepsByJob.get(oj.id) ?? []}
                  stepsByJob={stepsByJob}
                  isExpanded={expandedOuter.has(oj.id)}
                  onToggle={() => toggleOuter(oj.id)}
                  expandedInner={expandedInner}
                  onToggleInner={toggleInner}
                  onSelectInnerStep={(job, step) => {
                    if (logFilter?.jobId === job.id && logFilter.stepLabel === step.label) setLogFilter(null);
                    else setLogFilter({ jobId: job.id, stepLabel: step.label, label: `${job.label} › ${step.label}` });
                  }}
                  onSelectDirectStep={(step) => {
                    if (logFilter?.jobId === oj.id && logFilter.stepLabel === step.label) setLogFilter(null);
                    else setLogFilter({ jobId: oj.id, stepLabel: step.label, label: `${oj.label} › ${step.label}` });
                  }}
                  filterJobId={logFilter?.jobId ?? null}
                  filterStepLabel={logFilter?.stepLabel}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#0d1117',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '1px solid #21262d',
    background: '#161b22',
    flexWrap: 'wrap',
    gap: 8,
  },
  summary: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    fontSize: 12,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#8b949e',
    gap: 8,
    padding: 24,
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: 32,
    color: '#30363d',
    marginBottom: 8,
  },
};

