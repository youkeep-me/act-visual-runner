import React, { useEffect, useMemo, useState } from 'react';
import { useExecutionStore } from '../store/executionStore';
import { t } from '../i18n';

const PAGE_SIZE = 20;

export function HistoryPanel() {
  const history = useExecutionStore((s) => s.history);
  const historyLogs = useExecutionStore((s) => s.historyLogs);
  const graphSnapshotsByExecutionId = useExecutionStore((s) => s.graphSnapshotsByExecutionId);
  const isWorkflowRunning = useExecutionStore((s) => s.execution.status === 'running');
  const restoreGraphForExecution = useExecutionStore((s) => s.restoreGraphForExecution);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [activeLogMatchIndex, setActiveLogMatchIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const rerun = (id: string) =>
    window.__vscode__?.postMessage({ type: 'command:rerun', payload: { executionId: id } });

  const deleteEntry = (id: string) =>
    window.__vscode__?.postMessage({ type: 'command:deleteHistory', payload: { executionId: id } });

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    window.__vscode__?.postMessage({
      type: 'command:deleteHistories',
      payload: { executionIds: Array.from(selectedIds) },
    });
    setSelectedIds(new Set());
  };

  const restoreExecution = (id: string) => {
    if (isWorkflowRunning) return;
    window.__vscode__?.postMessage({ type: 'command:restoreHistoryRepository', payload: { executionId: id } });
    restoreGraphForExecution(id);
  };

  const filteredHistory = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;
    return history.filter((record) => [
      record.workflowName,
      record.workflowPath,
      record.workflowRef,
      record.jobId,
      record.status,
      record.trigger,
      new Date(record.startedAt).toLocaleString('pt-BR'),
    ].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  }, [history, query]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedHistory = filteredHistory.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pagedIds = pagedHistory.map((record) => record.id);
  const selectedOnPage = pagedIds.filter((id) => selectedIds.has(id));
  const allPageSelected = pagedIds.length > 0 && selectedOnPage.length === pagedIds.length;

  useEffect(() => {
    const historyIds = new Set(history.map((record) => record.id));
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => historyIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [history]);

  const updateQuery = (value: string) => {
    setQuery(value);
    setPage(1);
    setOpenMenuId(null);
  };

  if (history.length === 0) {
    return <div style={styles.empty}>{t('No workflow runs recorded yet.')}</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div>
          <div style={styles.title}>All workflow runs</div>
          <div style={styles.subtitle}>Showing runs from all workflows</div>
          <div style={styles.retentionNote}>For performance, only the latest 40 workflow runs are kept. Older runs are removed automatically.</div>
        </div>
        <input
          style={styles.search}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder={t('Filter workflow runs')}
        />
      </div>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <div style={styles.headerActions}>
            <label style={styles.selectAll}>
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={(event) => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    pagedIds.forEach((id) => event.target.checked ? next.add(id) : next.delete(id));
                    return next;
                  });
                }}
                aria-label={t('Select all runs on this page')}
              />
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filteredHistory.length} workflow ${filteredHistory.length === 1 ? 'run' : 'runs'}`}
            </label>
            <button
              type="button"
              style={{ ...styles.pageButton, ...styles.dangerButton }}
              disabled={selectedIds.size === 0}
              onClick={deleteSelected}
            >
              {t('Delete selected')}
            </button>
          </div>
          <span style={styles.headerColumns}>Workflow · Event · Status · Branch · Action</span>
        </div>

        {pagedHistory.map((r) => {
          const isExpanded = expandedId === r.id;
          const logs = historyLogs[r.id];
          const hasLogs = logs && logs.length > 0;
          const canRestoreGraph = !!graphSnapshotsByExecutionId[r.id];
          const canOpenGraph = canRestoreGraph && !isWorkflowRunning;
          // fallback: logSummary do ExecutionRecord (execuções de sessões anteriores)
          const logFallback = !hasLogs && r.logSummary ? r.logSummary : null;
          const canExpand = hasLogs || !!logFallback;
          const branch = formatBranch(r.workflowRef);
          const menuOpen = openMenuId === r.id;

          return (
            <div key={r.id}>
              <div
                style={{ ...styles.row, ...(canOpenGraph ? styles.clickableRow : {}) }}
                onClick={canOpenGraph ? () => restoreExecution(r.id) : undefined}
                title={historyRowTitle(canRestoreGraph, isWorkflowRunning)}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    });
                  }}
                  aria-label={`${t('Select run')} ${r.workflowName}`}
                />
                <span style={{ color: statusColor(r.status), fontSize: 14 }}>{statusIcon(r.status)}</span>
                <div style={styles.runMain}>
                  <div style={styles.runTitle}>{r.workflowName}</div>
                  <div style={styles.runSubline}>{eventLabel(r)} · {r.jobId ?? 'todos os jobs'} · {r.trigger}</div>
                </div>
                <span style={styles.statusText}>{capitalize(r.status)}</span>
                <span style={styles.branchPill}>{branch}</span>
                <span style={styles.metaBlock}>{new Date(r.startedAt).toLocaleString('pt-BR')}<br />{r.duration != null ? `${(r.duration / 1000).toFixed(1)}s` : '—'}</span>
                <div style={styles.menuWrap}>
                  <button
                    style={styles.kebabButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuId(menuOpen ? null : r.id);
                    }}
                    title={t('Actions')}
                  >
                    ...
                  </button>
                  {menuOpen && (
                    <div style={styles.menu} onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        style={{ ...styles.menuItem, ...(!canExpand ? styles.menuItemDisabled : {}) }}
                        disabled={!canExpand}
                        onClick={() => {
                          setExpandedId(isExpanded ? null : r.id);
                          setOpenMenuId(null);
                        }}
                      >
                        {isExpanded ? t('Hide log') : t('View log')}
                      </button>
                      <button type="button" style={styles.menuItem} onClick={() => { rerun(r.id); setOpenMenuId(null); }}>{t('Rerun')}</button>
                      <button type="button" style={{ ...styles.menuItem, ...styles.dangerItem }} onClick={() => { deleteEntry(r.id); setOpenMenuId(null); }}>{t('Delete')}</button>
                    </div>
                  )}
                </div>
              </div>
              {isExpanded && (
                <HistoryLogPanel
                  lines={hasLogs ? logs : splitLogFallback(logFallback)}
                  query={logSearchQuery}
                  activeMatchIndex={activeLogMatchIndex}
                  onQueryChange={(value) => {
                    setLogSearchQuery(value);
                    setActiveLogMatchIndex(0);
                  }}
                  onActiveMatchIndexChange={setActiveLogMatchIndex}
                />
              )}
            </div>
          );
        })}
        {pagedHistory.length === 0 && <div style={styles.noResults}>{t('No runs found for this filter.')}</div>}
      </div>

      <div style={styles.pagination}>
        <button style={styles.pageButton} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span style={styles.pageInfo}>Page {currentPage} of {totalPages}</span>
        <button style={styles.pageButton} disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>
    </div>
  );
}

function HistoryLogPanel({ lines, query, activeMatchIndex, onQueryChange, onActiveMatchIndexChange }: {
  lines: string[];
  query: string;
  activeMatchIndex: number;
  onQueryChange: (value: string) => void;
  onActiveMatchIndexChange: (value: number | ((current: number) => number)) => void;
}) {
  const lineRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    return lines
      .map((line, index) => ({ line, index }))
      .filter((item) => item.line.toLowerCase().includes(normalizedQuery));
  }, [lines, normalizedQuery]);
  const activeLineIndex = matches[activeMatchIndex]?.index ?? null;

  React.useEffect(() => {
    if (activeLineIndex == null) return;
    lineRefs.current.get(activeLineIndex)?.scrollIntoView({ block: 'center' });
  }, [activeLineIndex]);

  const moveMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    onActiveMatchIndexChange((current) => (current + direction + matches.length) % matches.length);
  };

  return (
    <div style={styles.logPanel}>
      <div style={styles.logSearchBar}>
        <input
          style={styles.logSearchInput}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar neste log"
        />
        <span style={styles.logSearchCount}>
          {normalizedQuery ? `${matches.length ? activeMatchIndex + 1 : 0}/${matches.length}` : '0/0'}
        </span>
        <button style={styles.logSearchButton} disabled={matches.length === 0} onClick={() => moveMatch(-1)}>↑</button>
        <button style={styles.logSearchButton} disabled={matches.length === 0} onClick={() => moveMatch(1)}>↓</button>
        {query && <button style={styles.logSearchButton} onClick={() => onQueryChange('')}>limpar</button>}
      </div>
      <div style={styles.logSearchBody}>
        {lines.map((line, index) => {
          const isMatch = normalizedQuery && line.toLowerCase().includes(normalizedQuery);
          const isActive = activeLineIndex === index;
          return (
            <div
              key={index}
              ref={(element) => setHistoryLineRef(lineRefs.current, index, element)}
              style={{
                ...styles.logLine,
                background: isActive ? '#d2992233' : isMatch ? '#d2992218' : undefined,
                borderLeftColor: isActive ? '#d29922' : 'transparent',
              }}
            >
              {highlightLogText(line, normalizedQuery)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function splitLogFallback(logFallback: string | null): string[] {
  return logFallback ? logFallback.split(/\r?\n/) : [];
}

function setHistoryLineRef(refs: Map<number, HTMLDivElement>, index: number, element: HTMLDivElement | null): void {
  if (element) refs.set(index, element);
  else refs.delete(index);
}

function historyRowTitle(canRestoreGraph: boolean, isWorkflowRunning: boolean): string {
  if (isWorkflowRunning) return 'Execução em andamento: o grafo ao vivo permanece protegido.';
  return canRestoreGraph
    ? 'Abrir grafo desta execução'
    : 'Grafo detalhado disponível para execuções feitas nesta sessão';
}

function highlightLogText(line: string, normalizedQuery: string): React.ReactNode {
  if (!normalizedQuery) return line;
  const lower = line.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lower.indexOf(normalizedQuery);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) parts.push(line.slice(cursor, matchIndex));
    const end = matchIndex + normalizedQuery.length;
    parts.push(<mark key={`${matchIndex}-${end}`} style={styles.logMark}>{line.slice(matchIndex, end)}</mark>);
    cursor = end;
    matchIndex = lower.indexOf(normalizedQuery, cursor);
  }

  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

function formatBranch(ref?: string) {
  if (!ref) return 'main';
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, 'tag:');
}

function eventLabel(record: { workflowRef?: string; trigger: string }) {
  return record.trigger === 'replay' ? 'Re-run' : record.workflowRef ? 'workflow_dispatch' : 'manual';
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusColor(s: string) {
  return ({ success: '#3fb950', failed: '#f85149', cancelled: '#d29922', running: '#58a6ff' } as Record<string, string>)[s] ?? '#6e7681';
}
function statusIcon(s: string) {
  return ({ success: '✓', failed: '✗', cancelled: '⊘', running: '◉' } as Record<string, string>)[s] ?? '○';
}

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, overflow: 'auto', padding: 20, background: '#0d1117' },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', padding: 40 },
  topBar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 16 },
  title: { color: '#e6edf3', fontSize: 20, fontWeight: 600 },
  subtitle: { color: '#8b949e', fontSize: 12, marginTop: 3 },
  retentionNote: { color: '#8b949e', fontSize: 11, marginTop: 6 },
  search: { width: 280, padding: '7px 12px', border: '1px solid #30363d', borderRadius: 6, background: '#0d1117', color: '#c9d1d9', fontSize: 12 },
  table: { border: '1px solid #30363d', borderRadius: 6, overflow: 'visible', background: '#0d1117' },
  tableHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: '1px solid #30363d', background: '#161b22', color: '#c9d1d9', fontSize: 12, fontWeight: 600 },
  headerColumns: { color: '#8b949e', fontWeight: 500 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 12 },
  selectAll: { display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #21262d', fontSize: 12, color: '#c9d1d9', position: 'relative' },
  clickableRow: { cursor: 'pointer' },
  runMain: { flex: 1, minWidth: 220 },
  runTitle: { fontSize: 13, color: '#e6edf3', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  runSubline: { color: '#8b949e', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusText: { width: 80, color: '#8b949e', fontSize: 12 },
  branchPill: { maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: 10, background: '#0d2d57', color: '#79c0ff', fontSize: 11, fontWeight: 600 },
  metaBlock: { width: 160, color: '#8b949e', whiteSpace: 'nowrap', fontSize: 11, lineHeight: 1.45 },
  menuWrap: { position: 'relative', width: 34, display: 'flex', justifyContent: 'flex-end' },
  kebabButton: { width: 28, height: 28, border: '1px solid transparent', borderRadius: 6, background: 'transparent', color: '#8b949e', cursor: 'pointer', fontWeight: 700, lineHeight: 1 },
  menu: { position: 'absolute', right: 0, top: 31, zIndex: 20, minWidth: 150, border: '1px solid #30363d', borderRadius: 6, background: '#161b22', boxShadow: '0 12px 28px rgba(0,0,0,0.45)', padding: '6px 0' },
  menuItem: { width: '100%', display: 'block', padding: '7px 12px', border: 0, background: 'transparent', color: '#c9d1d9', textAlign: 'left', cursor: 'pointer', fontSize: 12 },
  menuItemDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  dangerItem: { color: '#f85149' },
  noResults: { padding: 24, color: '#8b949e', textAlign: 'center', fontSize: 12 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 0' },
  pageButton: { padding: '5px 12px', border: '1px solid #30363d', borderRadius: 6, background: '#161b22', color: '#c9d1d9', cursor: 'pointer', fontSize: 12 },
  dangerButton: { color: '#f85149' },
  pageInfo: { color: '#8b949e', fontSize: 12 },
  logPanel: { background: '#010409', borderBottom: '1px solid #21262d', maxHeight: 360, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  logSearchBar: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderBottom: '1px solid #21262d', background: '#0d1117' },
  logSearchInput: { width: 240, padding: '5px 9px', border: '1px solid #30363d', borderRadius: 6, background: '#010409', color: '#c9d1d9', fontSize: 12 },
  logSearchCount: { minWidth: 48, color: '#8b949e', fontSize: 11, textAlign: 'right' },
  logSearchButton: { padding: '4px 8px', border: '1px solid #30363d', borderRadius: 6, background: '#161b22', color: '#c9d1d9', cursor: 'pointer', fontSize: 11 },
  logSearchBody: { overflow: 'auto', padding: '10px 16px' },
  logLine: { fontFamily: 'monospace', fontSize: 11, color: '#8b949e', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, borderLeft: '2px solid transparent', paddingLeft: 6, marginLeft: -6 },
  logMark: { background: '#d2992244', color: '#e6edf3', padding: '0 1px', borderRadius: 2 },
};
