import React, { useState } from 'react';
import { t } from '../i18n';

/**
 * Simulador de eventos webhook com editor JSON.
 * Implementação completa: @frontend
 */

const EVENTS = ['push', 'pull_request', 'workflow_dispatch', 'release', 'schedule', 'issues'];

const TEMPLATES: Record<string, Record<string, unknown>> = {
  push: { ref: 'refs/heads/main', repository: { full_name: 'owner/repo' } },
  pull_request: { action: 'opened', number: 1, pull_request: { title: 'feat: new feature' } },
  workflow_dispatch: { inputs: {}, ref: 'refs/heads/main' },
  release: { action: 'published', release: { tag_name: 'v1.0.0' } },
  schedule: { repository: { full_name: 'owner/repo' } },
  issues: { action: 'opened', issue: { number: 1, title: 'Bug report' } },
};

export function WebhookSimulator() {
  const [eventType, setEventType] = useState('push');
  const [payload, setPayload] = useState(() => JSON.stringify(TEMPLATES['push'], null, 2));
  const [error, setError] = useState<string | null>(null);

  const loadTemplate = (type: string) => {
    setEventType(type);
    setPayload(JSON.stringify(TEMPLATES[type] ?? {}, null, 2));
    setError(null);
  };

  const simulate = () => {
    try {
      const parsed = JSON.parse(payload);
      window.__vscode__?.postMessage({
        type: 'command:run',
        payload: { eventType, eventPayload: parsed },
      });
      setError(null);
    } catch {
      setError(t('Invalid JSON - fix the payload before simulating.'));
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>Simulador de Webhook</div>
      <div style={styles.row}>
        <label style={styles.label}>Tipo de evento</label>
        <select style={styles.select} value={eventType} onChange={(e) => loadTemplate(e.target.value)}>
          {EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button style={styles.btnSecondary} onClick={() => loadTemplate(eventType)}>Carregar Template</button>
      </div>
      <label style={styles.label}>Payload JSON</label>
      {/* TODO @frontend: substituir por editor com syntax highlighting (Monaco ou CodeMirror) */}
      <textarea
        style={styles.textarea}
        value={payload}
        onChange={(e) => { setPayload(e.target.value); setError(null); }}
        spellCheck={false}
      />
      {error && <div style={styles.error}>{error}</div>}
      <button style={styles.btnPrimary} onClick={simulate}>📡 Simular Evento</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  header: { fontSize: 13, fontWeight: 600, color: '#F3F4F6' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 12, color: '#9CA3AF' },
  select: { padding: '4px 8px', background: '#1F2937', border: '1px solid #374151', borderRadius: 4, color: '#F3F4F6', fontSize: 12 },
  textarea: { flex: 1, minHeight: 300, padding: 10, background: '#0D1117', border: '1px solid #374151', borderRadius: 4, color: '#D1D5DB', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' },
  error: { color: '#EF4444', fontSize: 12 },
  btnPrimary: { padding: '6px 14px', background: '#3B82F6', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, alignSelf: 'flex-start' },
  btnSecondary: { padding: '4px 10px', background: 'transparent', border: '1px solid #374151', borderRadius: 4, color: '#9CA3AF', cursor: 'pointer', fontSize: 11 },
};
