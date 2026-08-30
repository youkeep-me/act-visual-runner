import React from 'react';
import { useExecutionStore } from '../store/executionStore';
import { t } from '../i18n';

/**
 * Barra de controle superior com botões de execução e navegação.
 */
export function ControlBar() {
  const { currentView, setView, execution, summaryContent, selectedWorkflowPath, workflows, openWorkflowRunDialog } = useExecutionStore();
  const hasSummary = !!summaryContent;

  const send = (type: string, payload: Record<string, unknown> = {}) =>
    window.__vscode__?.postMessage({ type, payload });

  const isRunning = execution.status === 'running';

  const runSelectedWorkflow = () => {
    const workflowPath = selectedWorkflowPath ?? execution.workflowPath ?? undefined;
    const workflow = workflows.find((item) => item.filePath === workflowPath);
    if (workflow?.inputs.length) {
      openWorkflowRunDialog(workflow.filePath);
      return;
    }
    send('command:run', { workflowPath });
  };

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        {!isRunning && (
          <button style={styles.btnPrimary} onClick={runSelectedWorkflow}>▶ {t('Run')}</button>
        )}
        {isRunning && (
          <button style={styles.btnDanger} onClick={() => send('command:stop', {})}>⏹ {t('Stop')}</button>
        )}
        <button
          style={styles.btnAct}
          title={t('Configure the act executable path')}
          onClick={() => send('command:locateAct', {})}
        >
          ⚙ act
        </button>
      </div>
      <div style={styles.right}>
        {(['graph', 'history', 'analytics', 'env'] as const).map((view) => (
          <button
            key={view}
            style={{ ...styles.tab, ...(currentView === view ? styles.tabActive : {}) }}
            onClick={() => {
              setView(view);
              if (view === 'history') {
                window.__vscode__?.postMessage({ type: 'command:refreshHistory', payload: {} });
              }
            }}
          >
            {VIEW_LABELS[view]}
          </button>
        ))}
        <button
          style={{
            ...styles.tab,
            ...(currentView === 'summary' ? styles.tabActive : {}),
            ...(hasSummary && currentView !== 'summary' ? styles.tabSummaryHighlight : {}),
          }}
          onClick={() => setView('summary')}
        >
          📋 Summary
        </button>
      </div>
    </div>
  );
}

const VIEW_LABELS: Record<string, string> = {
  graph: `🗺 ${t('Graph')}`, history: `📜 ${t('History')}`, analytics: `📊 ${t('Analytics')}`, env: `⚙️ ${t('Settings')}`,
};

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 12px', background: '#161b22', borderBottom: '1px solid #21262d',
    gap: 8, flexWrap: 'wrap',
  },
  left:  { display: 'flex', gap: 6, alignItems: 'center' },
  right: { display: 'flex', gap: 4 },
  btnPrimary: {
    padding: '4px 10px', border: 'none', borderRadius: 4,
    background: '#238636', color: '#fff', cursor: 'pointer', fontSize: 12,
  },
  btnSecondary: {
    padding: '4px 10px', border: '1px solid #30363d', borderRadius: 4,
    background: 'transparent', color: '#c9d1d9', cursor: 'pointer', fontSize: 12,
  },
  btnDanger: {
    padding: '4px 10px', border: 'none', borderRadius: 4,
    background: '#da3633', color: '#fff', cursor: 'pointer', fontSize: 12,
  },
  btnAct: {
    padding: '4px 8px', border: '1px solid #30363d', borderRadius: 4,
    background: 'transparent', color: '#8b949e', cursor: 'pointer', fontSize: 11,
  },
  tab: {
    padding: '3px 8px', border: '1px solid #30363d', borderRadius: 4,
    background: 'transparent', color: '#8b949e', cursor: 'pointer', fontSize: 11,
  },
  tabActive: { background: '#21262d', color: '#e6edf3', borderColor: '#484f58' },
  tabSummaryHighlight: { borderColor: '#238636', color: '#3fb950' },
};
