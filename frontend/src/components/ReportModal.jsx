import { useState } from 'react';
import { api } from '../api/client.js';

const RANGES = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days',   value: '7d'  },
  { label: 'Last 30 days',  value: '30d' },
  { label: 'All time',      value: 'all' },
];

function fromIso(range) {
  if (range === 'all') return undefined;
  const now = new Date();
  if (range === '24h') now.setHours(now.getHours() - 24);
  if (range === '7d')  now.setDate(now.getDate() - 7);
  if (range === '30d') now.setDate(now.getDate() - 30);
  return now.toISOString();
}

function buildHtml({ range, stats, violations, generatedAt }) {
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? range;

  const byTypeRows = (stats.by_type ?? [])
    .map((r) => `<tr><td>${r.type}</td><td>${r.count}</td></tr>`)
    .join('');

  const byCameraRows = (stats.by_camera ?? [])
    .map((r) => `<tr><td>Camera ${r.camera_id}</td><td>${r.count}</td></tr>`)
    .join('');

  const violationRows = violations
    .map(
      (v) =>
        `<tr>
          <td>${v.id}</td>
          <td>${v.violation_type}</td>
          <td>Camera ${v.camera_id}</td>
          <td>${(v.confidence * 100).toFixed(1)}%</td>
          <td>${new Date(v.timestamp).toLocaleString()}</td>
          <td>${v.is_resolved ? 'Resolved' : 'Open'}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>PPE Violation Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #111; padding: 32px; font-size: 13px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 28px; }
    h2 { font-size: 15px; margin: 24px 0 10px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 8px; }
    .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 14px; text-align: center; }
    .kpi-val { font-size: 28px; font-weight: bold; }
    .kpi-lbl { font-size: 11px; color: #555; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:nth-child(even) td { background: #fafafa; }
    .side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    footer { margin-top: 32px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>PPE Violation Report</h1>
  <p class="meta">Period: <strong>${rangeLabel}</strong> &nbsp;|&nbsp; Generated: <strong>${generatedAt}</strong></p>

  <h2>Summary</h2>
  <div class="summary-grid">
    <div class="kpi">
      <div class="kpi-val">${stats.total ?? 0}</div>
      <div class="kpi-lbl">Total Violations</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${(stats.by_type ?? []).length}</div>
      <div class="kpi-lbl">Violation Types</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${(stats.by_camera ?? []).length}</div>
      <div class="kpi-lbl">Cameras Affected</div>
    </div>
  </div>

  <div class="side-by-side">
    <div>
      <h2>By Violation Type</h2>
      <table>
        <thead><tr><th>Type</th><th>Count</th></tr></thead>
        <tbody>${byTypeRows || '<tr><td colspan="2">No data</td></tr>'}</tbody>
      </table>
    </div>
    <div>
      <h2>By Camera</h2>
      <table>
        <thead><tr><th>Camera</th><th>Count</th></tr></thead>
        <tbody>${byCameraRows || '<tr><td colspan="2">No data</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <h2>Violation Records (up to 200)</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Type</th><th>Camera</th><th>Confidence</th><th>Timestamp</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${violationRows || '<tr><td colspan="6">No violations found</td></tr>'}</tbody>
  </table>

  <footer>PPE Detection System &mdash; Auto-generated report</footer>
</body>
</html>`;
}

export default function ReportModal({ onClose }) {
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setError('');
    setLoading(true);
    try {
      const from = fromIso(range);
      const [stats, violationsResp] = await Promise.all([
        api.violationStats(from ? { from } : {}),
        api.listViolations({ ...(from ? { from } : {}), page_size: 200 }),
      ]);

      const html = buildHtml({
        range,
        stats,
        violations: violationsResp.items ?? [],
        generatedAt: new Date().toLocaleString(),
      });

      // Use a hidden iframe — never blocked by pop-up blockers, no user-gesture issues.
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;opacity:0;';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(html);
      iframeDoc.close();

      iframe.contentWindow.focus();
      iframe.contentWindow.print();

      // Keep iframe alive during print dialog, then clean up.
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 3000);

      onClose();
    } catch (err) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-1 border border-border-soft rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Generate Report</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-text-muted uppercase tracking-widest">Time Range</label>
          <select
            className="form-select w-full"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            className="btn-outline flex-1 text-sm py-2"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="btn-brand flex-1 text-sm py-2 flex items-center justify-center gap-2"
            onClick={generate}
            disabled={loading}
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : null}
            {loading ? 'Generating…' : 'Generate PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
