import React, { useState } from 'react';
import { useExecutionStore, type WorkflowListItem } from '../store/executionStore';
import { t } from '../i18n';

export function WorkflowLauncherSidebar() {
  const { workflows, selectedWorkflowPath, repository, execution, setSelectedWorkflowPath, openWorkflowRunDialog } = useExecutionStore();
  const [isOpen, setIsOpen] = useState(true);

  const selectRepository = () => {
    window.__vscode__?.postMessage({ type: 'command:selectProject', payload: {} });
  };

  const runWorkflow = (workflow: WorkflowListItem) => {
    if (!workflow.valid) return;
    setSelectedWorkflowPath(workflow.filePath);
    if (workflow.inputs.length > 0) {
      openWorkflowRunDialog(workflow.filePath);
      return;
    }
    window.__vscode__?.postMessage({ type: 'command:run', payload: { workflowPath: workflow.filePath } });
  };

  if (!isOpen) {
    return (
      <aside style={styles.sidebarCollapsed}>
        <button
          type="button"
          style={styles.toggleCollapsedBtn}
          onClick={() => setIsOpen(true)}
          title={t('Open workflow sidebar')}
        >
          ▸
        </button>
      </aside>
    );
  }

  return (
    <aside style={styles.sidebar}>
      <button
        type="button"
        style={styles.toggleOpenBtn}
        onClick={() => setIsOpen(false)}
        title={t('Close workflow sidebar')}
      >
        ◂
      </button>
      <div style={styles.repoBox}>
        <div style={styles.repoLabel}>{t('Repository')}</div>
        <button type="button" style={styles.repoButton} onClick={selectRepository} title={repository?.root ?? t('Select repository')}>
          <span style={styles.repoIcon}>📁</span>
          <span style={styles.repoText}>{repository?.name ?? t('Select repository')}</span>
        </button>
      </div>
      <div style={styles.header}>
        <span style={styles.title}>Workflows</span>
        <span style={styles.count}>{workflows.length}</span>
      </div>
      <div style={styles.list}>
        {workflows.length === 0 ? (
          <div style={styles.empty}>
            {t('No workflow found in .github/workflows.')}
            <button type="button" style={styles.emptyButton} onClick={selectRepository}>{t('Select repository')}</button>
          </div>
        ) : workflows.map((workflow) => {
          const active = selectedWorkflowPath === workflow.filePath;
          const isRunning = execution.status === 'running' && execution.workflowPath === workflow.filePath;
          return (
            <div
              key={workflow.filePath}
              style={{
                ...styles.item,
                ...(active ? styles.itemActive : {}),
                ...(!workflow.valid ? styles.itemInvalid : {}),
              }}
            >
              <button
                type="button"
                title={workflow.valid ? `${t('Run')} ${workflow.fileName}${workflow.inputs.length ? ` ${t('with inputs')}` : ''}` : workflow.error}
                style={styles.itemButton}
                onClick={() => runWorkflow(workflow)}
                disabled={!workflow.valid || isRunning}
              >
                <span style={{ ...styles.icon, ...(isRunning ? styles.runningIcon : {}) }}>
                  {isRunning ? <span className="workflow-running-spinner" aria-hidden="true" /> : workflow.valid ? '▶' : '!'}
                </span>
                <span style={styles.itemText}>
                  <span style={styles.itemName}>{workflow.name}</span>
                  <span style={styles.itemMeta}>{workflow.fileName} · {workflow.jobs} job{workflow.jobs === 1 ? '' : 's'}{workflow.inputs.length ? ` · ${workflow.inputs.length} input${workflow.inputs.length === 1 ? '' : 's'}` : ''}</span>
                </span>
              </button>
              {isRunning && (
                <button
                  type="button"
                  style={styles.stopButton}
                  title={t('Stop workflow execution')}
                  aria-label={`${t('Stop workflow execution')} ${workflow.name}`}
                  onClick={() => window.__vscode__?.postMessage({
                    type: 'command:stop',
                    payload: { executionId: execution.executionId ?? '' },
                  })}
                >
                  ■
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    position: 'relative',
    width: 240,
    flexShrink: 0,
    borderRight: '1px solid #21262d',
    background: '#0d1117',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarCollapsed: {
    width: 28,
    flexShrink: 0,
    borderRight: '1px solid #21262d',
    background: '#0d1117',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: 6,
  },
  toggleCollapsedBtn: {
    width: 18,
    height: 24,
    border: '1px solid #30363d',
    borderRadius: 4,
    background: '#161b22',
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1,
    padding: 0,
  },
  toggleOpenBtn: {
    position: 'absolute',
    top: 8,
    right: 6,
    width: 18,
    height: 18,
    border: '1px solid #30363d',
    borderRadius: 4,
    background: '#161b22',
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: 10,
    lineHeight: 1,
    padding: 0,
  },
  repoBox: {
    padding: 10,
    borderBottom: '1px solid #21262d',
  },
  repoLabel: {
    marginBottom: 6,
    color: '#8b949e',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  repoButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '7px 8px',
    border: '1px solid #30363d',
    borderRadius: 6,
    background: '#161b22',
    color: '#e6edf3',
    cursor: 'pointer',
    textAlign: 'left',
  },
  repoIcon: { flexShrink: 0, fontSize: 13 },
  repoText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700 },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid #21262d',
  },
  title: { color: '#e6edf3', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' },
  count: { color: '#8b949e', fontSize: 11 },
  list: { overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  empty: { color: '#8b949e', fontSize: 12, padding: 8, lineHeight: 1.4, display: 'flex', flexDirection: 'column', gap: 10 },
  emptyButton: {
    padding: '6px 8px',
    border: '1px solid #30363d',
    borderRadius: 5,
    background: '#161b22',
    color: '#c9d1d9',
    cursor: 'pointer',
    fontSize: 11,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    minHeight: 54,
    padding: '8px 10px',
    border: '1px solid transparent',
    borderRadius: 6,
    background: 'transparent',
    color: '#c9d1d9',
    textAlign: 'left',
  },
  itemButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  itemActive: { background: '#161b22', borderColor: '#30363d' },
  itemInvalid: { color: '#f85149', cursor: 'not-allowed', opacity: 0.8 },
  icon: { width: 16, flexShrink: 0, color: '#3fb950', fontSize: 11 },
  runningIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stopButton: {
    width: 26,
    height: 26,
    flexShrink: 0,
    border: '1px solid #da3633',
    borderRadius: 4,
    background: '#3d1719',
    color: '#ff7b72',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1,
    padding: 0,
  },
  itemText: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  itemName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700 },
  itemMeta: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#8b949e', fontSize: 11 },
};