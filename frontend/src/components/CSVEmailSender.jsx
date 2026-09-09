import React, { useCallback, useEffect, useState } from 'react';
import Papa from 'papaparse';
import axios from 'axios';

import {
  DEFAULT_SUBJECT,
  DEFAULT_TEMPLATE,
  DEFAULT_FOLLOWUP_SUBJECT,
  DEFAULT_FOLLOWUP_TEMPLATE,
} from '../emailTemplates.js';

// Relative base URL — Vite proxies /api to the backend, so this works in dev,
// in a hosted preview and in production without code changes.
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GAP_MS = 2000;

const CSVEmailSender = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [csvData, setCsvData] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [batches, setBatches] = useState([]);
  // Identity of the CSV currently loaded — sends are filed under this batch.
  const [batchInfo, setBatchInfo] = useState(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [followUpSubject, setFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  const [followUpTemplate, setFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);

  const [theme, setTheme] = useState('plain');
  const [themeList, setThemeList] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  // One rendered preview per CSV row.
  const [batchPreviews, setBatchPreviews] = useState([]);
  const [batchAttachment, setBatchAttachment] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [openBatch, setOpenBatch] = useState(null);

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });

  const fetchFollowUps = useCallback(async () => {
    try {
      const res = await api.get('/followups');
      setFollowUps(res.data.candidates || []);
      setBatches(res.data.batches || []);
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err);
      setFollowUps([]);
      setBatches([]);
    }
  }, []);

  useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

  const fetchJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/schedule');
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to load scheduled jobs:', err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    // Poll so a job that fires server-side updates without a manual refresh.
    const id = setInterval(fetchJobs, 15000);
    return () => clearInterval(id);
  }, [fetchJobs]);

  useEffect(() => {
    api
      .get('/themes')
      .then(({ data }) => setThemeList(data.themes || []))
      .catch((err) => console.error('Failed to load themes:', err));
  }, []);

  // ─── Upload & parse CSV ───────────────────────────────────────────────────
  const handleUpload = async () => {
    setError('');
    if (!csvFile) {
      setError('Please select a CSV file first.');
      return;
    }

    const formData = new FormData();
    formData.append('csvFile', csvFile);

    try {
      const { data } = await api.post('/uploadCSV', formData);
      const csvRes = await api.get(`/getCSVFile/${data.fileName}`, { responseType: 'text' });

      Papa.parse(csvRes.data, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const rows = result.data
            .filter((row) => row.email && row.name)
            .map((row) => ({
              ...row,
              // Per-row overrides win; empty means "use the shared template".
              emailSubject: row.emailSubject || '',
              emailTemplate: row.emailTemplate || '',
            }));
          setCsvData(rows);
          setExpanded(null);
          // Every upload becomes its own follow-up batch.
          setBatchInfo({
            id: `b_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
            label: csvFile?.name || 'upload.csv',
          });
          if (!rows.length) {
            setBatchPreviews([]);
            setError('No rows with both "name" and "email" were found.');
          }
        },
      });
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.response?.data?.message || 'Upload failed. Check the console for details.');
    }
  };

  // ─── Send initial emails ──────────────────────────────────────────────────
  const sendEmails = async () => {
    setError('');
    if (!csvData.length) {
      setError('No candidates to send emails to.');
      return;
    }

    setSending(true);
    setProgress({ current: 0, total: csvData.length, status: 'Starting...' });

    let failures = 0;
    try {
      for (let i = 0; i < csvData.length; i++) {
        const candidate = csvData[i];
        setProgress({
          current: i,
          total: csvData.length,
          status: `Sending to ${candidate.name} (${candidate.email})`,
        });

        const res = await api.post('/sendCustomEmails', {
          candidates: [candidate],
          // Shared subject/template edited above are used unless the row overrides them.
          emailSubject: subject,
          emailTemplate: template,
          theme,
          batchId: batchInfo?.id,
          batchLabel: batchInfo?.label,
        });
        failures += res.data.failCount || 0;

        if (i < csvData.length - 1) await sleep(GAP_MS);
      }

      setProgress({
        current: csvData.length,
        total: csvData.length,
        status: failures ? `Done with ${failures} failure(s).` : 'All emails sent.',
      });
      await fetchFollowUps();
    } catch (err) {
      console.error('Send failed:', err);
      setError(err.response?.data?.message || 'Sending failed. Check the console.');
      setProgress((p) => ({ ...p, status: 'Failed. Check logs.' }));
    } finally {
      setSending(false);
    }
  };

  // ─── Send follow-ups ──────────────────────────────────────────────────────
  const sendFollowUpEmails = async (targetBatch) => {
    setError('');
    setSending(true);
    setProgress({ current: 0, total: 0, status: 'Fetching follow-up data...' });

    try {
      const { data } = await api.get('/followups', {
        params: targetBatch ? { batchId: targetBatch.id } : {},
      });
      const pending = data.candidates || [];

      if (!pending.length) {
        setError('No candidates available for follow-up.');
        setProgress({ current: 0, total: 0, status: '' });
        return;
      }

      let failures = 0;
      for (let i = 0; i < pending.length; i++) {
        const candidate = pending[i];
        setProgress({
          current: i,
          total: pending.length,
          status: `Sending follow-up to ${candidate.name || candidate.email}`,
        });

        const res = await api.post('/sendFollowUpEmails', {
          candidates: [candidate],
          emailSubject: followUpSubject,
          emailTemplate: followUpTemplate,
          theme,
          batchId: candidate.batchId || targetBatch?.id,
        });
        failures += res.data.failCount || 0;

        if (i < pending.length - 1) await sleep(GAP_MS);
      }

      setProgress({
        current: pending.length,
        total: pending.length,
        status: failures ? `Done with ${failures} failure(s).` : 'All follow-up emails sent.',
      });
      await fetchFollowUps();
    } catch (err) {
      console.error('Follow-up failed:', err);
      setError(err.response?.data?.message || 'Follow-up failed. Check the console.');
      setProgress((p) => ({ ...p, status: 'Follow-up failed.' }));
    } finally {
      setSending(false);
    }
  };

  // ─── Render a preview for every parsed row ────────────────────────────────
  const loadBatchPreviews = useCallback(
    async (rows, activeTheme) => {
      const list = rows ?? csvData;
      if (!list.length) {
        setBatchPreviews([]);
        return;
      }

      setBatchLoading(true);
      try {
        const { data } = await api.post('/preview/batch', {
          candidates: list,
          emailSubject: subject,
          emailTemplate: template,
          theme: activeTheme ?? theme,
        });
        setBatchPreviews(data.previews || []);
        setBatchAttachment(data.attachment || null);
      } catch (err) {
        console.error('Batch preview failed:', err);
        setError(err.response?.data?.message || 'Could not render previews.');
        setBatchPreviews([]);
      } finally {
        setBatchLoading(false);
      }
    },
    [csvData, subject, template, theme]
  );

  // Re-render whenever the theme or shared copy changes (debounced so typing
  // in the template textarea does not fire a request per keystroke).
  useEffect(() => {
    if (!csvData.length) return undefined;
    const id = setTimeout(() => loadBatchPreviews(csvData, theme), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, subject, template, csvData]);

  // ─── Dry run: render without sending ──────────────────────────────────────
  const showPreview = async (candidate) => {
    setError('');
    setPreviewing(true);
    try {
      const sample =
        candidate ||
        csvData[0] || {
          name: 'Vishnu',
          companyName: 'KukuFM',
          jobDescription: 'Backend / Frontend Engineer',
        };

      const { data } = await api.post('/preview', {
        candidate: sample,
        emailSubject: sample.emailSubject || subject,
        emailTemplate: sample.emailTemplate || template,
        theme,
      });
      setPreview({ ...data, to: sample.email || '(sample)' });
    } catch (err) {
      console.error('Preview failed:', err);
      setError(err.response?.data?.message || 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const scheduleSend = async () => {
    setError('');
    if (!csvData.length) {
      setError('Upload a CSV before scheduling.');
      return;
    }
    if (!scheduleAt) {
      setError('Pick a date and time to send.');
      return;
    }

    // datetime-local is local wall-clock; convert to an absolute instant.
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime())) {
      setError('That date/time is not valid.');
      return;
    }
    if (when.getTime() < Date.now()) {
      setError('That time is in the past.');
      return;
    }

    try {
      await api.post('/schedule', {
        runAt: when.toISOString(),
        label: batchInfo?.label || 'Scheduled send',
        candidates: csvData,
        emailSubject: subject,
        emailTemplate: template,
        theme,
        batchId: batchInfo?.id,
        batchLabel: batchInfo?.label,
      });
      setScheduleAt('');
      await fetchJobs();
    } catch (err) {
      console.error('Schedule failed:', err);
      setError(err.response?.data?.message || 'Could not schedule that send.');
    }
  };

  const cancelJob = async (job) => {
    const verb = job.status === 'scheduled' ? 'Cancel' : 'Remove';
    if (!window.confirm(`${verb} "${job.label}"?`)) return;
    try {
      await api.delete(`/schedule/${job.id}`);
      await fetchJobs();
    } catch (err) {
      console.error('Cancel failed:', err);
      setError(err.response?.data?.message || 'Could not cancel that job.');
    }
  };

  const discardBatch = async (b) => {
    if (!window.confirm(`Discard "${b.label}" (${b.count} pending) without emailing?`)) return;
    try {
      await api.delete(`/followups/batches/${b.id}`);
      await fetchFollowUps();
    } catch (err) {
      console.error('Discard failed:', err);
      setError(err.response?.data?.message || 'Could not discard that batch.');
    }
  };

  const updateRow = (index, field, value) => {
    setCsvData((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const overrideCount = csvData.filter((r) => r.theme).length;

  const clearRowThemes = () => setCsvData((rows) => rows.map(({ theme: _t, ...r }) => r));

  return (
    <div className="page">
      <h1>Upload CSV and Send Emails</h1>
      <p className="hint">
        CSV columns: <code>name, email, cc, companyName, jobDescription, jobId</code>. Optional
        per-row <code>emailSubject</code> / <code>emailTemplate</code> override the shared copy.
        Placeholders: <code>[user name]</code>, <code>[company name]</code>,{' '}
        <code>[job description]</code>, <code>[job id]</code>.
      </p>
      <p className="hint">
        <code>jobId</code> is optional — wrap the bits that depend on it in{' '}
        <code>[if job id]...[/if job id]</code> and they are dropped entirely for rows without one.
      </p>

      <div className="card">
        <label htmlFor="csv">CSV file</label>
        <input
          id="csv"
          type="file"
          accept=".csv"
          onChange={(e) => setCsvFile(e.target.files[0])}
        />
        <div className="row">
          <button onClick={handleUpload} disabled={sending}>
            Parse CSV
          </button>
          {csvData.length > 0 && <span className="hint">{csvData.length} candidate(s) loaded</span>}
        </div>
      </div>

      <div className="card">
        <h2>Initial email</h2>
        <label htmlFor="subject">Subject</label>
        <textarea id="subject" rows={2} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label htmlFor="template">Body (HTML)</label>
        <textarea
          id="template"
          rows={10}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
        />
      </div>

      <div className="card">
        <h2>Follow-up email</h2>
        <p className="hint">
          Sent as a reply in the original Gmail thread. The subject stored from the original mail is
          reused for threading; this field is only a fallback.
        </p>
        <label htmlFor="fsubject">Subject (fallback)</label>
        <textarea
          id="fsubject"
          className="followup"
          rows={2}
          value={followUpSubject}
          onChange={(e) => setFollowUpSubject(e.target.value)}
        />
        <label htmlFor="ftemplate">Body (HTML)</label>
        <textarea
          id="ftemplate"
          className="followup"
          rows={6}
          value={followUpTemplate}
          onChange={(e) => setFollowUpTemplate(e.target.value)}
        />
      </div>

      <div className="card">
        <h2>Theme</h2>
        <div className="themes">
          {themeList.map((t) => (
            <label key={t.key} className={`theme-opt ${theme === t.key ? 'sel' : ''}`}>
              <span className="theme-top">
                <input
                  type="radio"
                  name="theme"
                  value={t.key}
                  checked={theme === t.key}
                  onChange={() => setTheme(t.key)}
                />
                <b>{t.label}</b>
                <em className={`risk risk-${t.risk}`}>{t.risk}</em>
              </span>
              <span>{t.blurb}</span>
            </label>
          ))}
        </div>
        <p className="hint">
          <b>Risk</b> = chance Gmail files it under Promotions instead of Primary. For cold
          outreach, lower is better.
        </p>
        <div className="row">
          <button onClick={() => showPreview()} disabled={previewing}>
            {previewing ? 'Rendering...' : 'Preview (dry run)'}
          </button>
          {preview && (
            <button className="ghost" onClick={() => setPreview(null)}>
              Close preview
            </button>
          )}
        </div>
      </div>

      {preview && (
        <div className="card">
          <h2>Preview — {preview.theme}</h2>
          <p className="hint">
            To: {preview.to} &nbsp;·&nbsp; Subject: <b>{preview.subject}</b>
            {preview.attachment && <> &nbsp;·&nbsp; Attachment: {preview.attachment}</>}
          </p>
          <iframe
            title="Email preview"
            srcDoc={preview.html}
            className="preview-frame"
            sandbox=""
          />
        </div>
      )}

      <div className="card">
        <h2>Schedule for later</h2>
        <p className="hint">
          Queues this CSV to send at a chosen time. Gmail&rsquo;s own
          &ldquo;Schedule send&rdquo; is only in its web/mobile UI and cannot be reached over
          SMTP, so the delay is handled by this backend &mdash; it must be running at the
          scheduled moment. Deploy it somewhere always-on (see DEPLOY.md) if you want sends to
          fire with your laptop closed.
        </p>
        <div className="row">
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="dt"
          />
          <button onClick={scheduleSend} disabled={sending || !csvData.length || !scheduleAt}>
            Schedule {csvData.length ? `(${csvData.length})` : ''}
          </button>
          {scheduleAt && (
            <span className="hint">
              Sends {new Date(scheduleAt).toLocaleString()} &middot; your local time
            </span>
          )}
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="card">
          <h2>Scheduled sends ({jobs.filter((j) => j.status === 'scheduled').length} pending)</h2>
          {jobs.map((j) => (
            <div key={j.id} className="jobrow">
              <div>
                <b>{j.label}</b>
                <span className={`jstatus j-${j.status}`}>{j.status}</span>
                <div className="hint">
                  {new Date(j.runAt).toLocaleString()} &middot; {j.recipientCount} recipient
                  {j.recipientCount === 1 ? '' : 's'}
                  {j.progress && (j.status === 'done' || j.status === 'failed') && (
                    <> &middot; {j.progress.sent} sent, {j.progress.failed} failed</>
                  )}
                  {j.error && <> &middot; {j.error}</>}
                </div>
              </div>
              <button className="ghost small danger" onClick={() => cancelJob(j)}>
                {j.status === 'scheduled' ? 'Cancel' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <button className="secondary" onClick={sendEmails} disabled={sending || !csvData.length}>
          {sending ? 'Sending...' : `Send Emails (${csvData.length})`}
        </button>
        <button
          className="tertiary"
          onClick={() => sendFollowUpEmails()}
          disabled={sending || followUps.length === 0}
          title="Follow up with every pending batch"
        >
          {sending ? 'Working...' : `Send All Follow-Ups (${followUps.length})`}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {(sending || progress.total > 0) && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <p className="status">
            {progress.status} ({progress.current}/{progress.total})
          </p>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          Candidate previews{csvData.length ? ` (${csvData.length})` : ''}
        </h2>
        {csvData.length > 0 && (
          <span className="hint">
            {batchLoading ? 'Rendering...' : `Theme: ${theme}`}
            {overrideCount > 0 && ` · ${overrideCount} custom`}
            {batchAttachment && ` · ${batchAttachment}`}
          </span>
        )}
      </div>

      {!csvData.length && <p className="hint">Upload and parse a CSV to see every email here.</p>}

      {csvData.length > 0 && (
        <p className="hint">
          Each card is the real rendered email for that row. Click a card to enlarge. Use the
          dropdown on a card to give that one recipient a different theme, or edit its template
          below the preview to override the shared copy.
          {overrideCount > 0 && (
            <>
              {' '}
              <button className="linkish" onClick={clearRowThemes}>
                Reset all {overrideCount} theme override{overrideCount > 1 ? 's' : ''}
              </button>
            </>
          )}
        </p>
      )}

      <div className="preview-grid">
        {csvData.map((row, i) => {
          const p = batchPreviews.find((b) => b.index === i);
          const isOpen = expanded === i;

          return (
            <div key={`${row.email}-${i}`} className={`pcard ${isOpen ? 'open' : ''}`}>
              <div className="pcard-head">
                <div className="pcard-to">
                  <b>{row.name}</b> &lt;{row.email}&gt;
                  {row.cc && <span className="hint"> · CC: {row.cc}</span>}
                  {p?.themeOverridden && <span className="badge-override">{p.theme}</span>}
                </div>
                <div className="pcard-sub">{p?.subject || row.emailSubject || subject}</div>
                <div className="pcard-meta">
                  {row.companyName} · {row.jobDescription}
                  {row.jobId && <span className="tag"> · ID: {row.jobId}</span>}
                </div>

                <div className="pcard-theme">
                  <select
                    value={row.theme || ''}
                    onChange={(e) => updateRow(i, 'theme', e.target.value)}
                    title="Theme for this recipient only"
                  >
                    <option value="">Use batch theme ({theme})</option>
                    {themeList.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label || t.key}
                      </option>
                    ))}
                  </select>
                  {row.theme && (
                    <button
                      className="ghost small reset"
                      onClick={() => updateRow(i, 'theme', '')}
                      title="Revert to the batch theme"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {p?.error ? (
                <div className="pcard-err">{p.error}</div>
              ) : p ? (
                <div
                  className="pcard-frame-wrap"
                  onClick={() => setExpanded(isOpen ? null : i)}
                  title={isOpen ? 'Click to shrink' : 'Click to enlarge'}
                >
                  <iframe
                    title={`Preview ${row.email}`}
                    srcDoc={p.html}
                    className="pcard-frame"
                    sandbox=""
                    scrolling="no"
                  />
                </div>
              ) : (
                <div className="pcard-skel">{batchLoading ? 'Rendering...' : 'No preview'}</div>
              )}

              <details className="pcard-edit">
                <summary>Override template for this row</summary>
                <textarea
                  rows={5}
                  value={row.emailTemplate || ''}
                  placeholder="Leave empty to use the shared template above"
                  onChange={(e) => updateRow(i, 'emailTemplate', e.target.value)}
                />
              </details>
            </div>
          );
        })}
      </div>

      {batches.length > 0 && (
        <>
          <h2>Pending follow-ups by upload ({followUps.length})</h2>
          <p className="hint">
            Each CSV upload is its own batch, so you can follow up one file at a time instead of
            everyone at once. Sent follow-ups leave the batch automatically.
          </p>

          {batches.map((b) => {
            const rows = followUps.filter((c) => c.batchId === b.id);
            const open = openBatch === b.id;

            return (
              <div key={b.id} className="batch">
                <div className="batch-head">
                  <div>
                    <b>{b.label}</b>
                    <span className="hint">
                      {' '}
                      · {b.count} pending · {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="batch-actions">
                    <button
                      className="ghost small"
                      onClick={() => setOpenBatch(open ? null : b.id)}
                    >
                      {open ? 'Hide' : 'Show'}
                    </button>
                    <button
                      className="tertiary small"
                      onClick={() => sendFollowUpEmails(b)}
                      disabled={sending}
                    >
                      Follow up ({b.count})
                    </button>
                    <button
                      className="ghost small danger"
                      onClick={() => discardBatch(b)}
                      disabled={sending}
                      title="Remove without emailing"
                    >
                      Discard
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="batch-body">
                    {rows.map((c) => (
                      <div key={`${b.id}-${c.email}`} className="candidate">
                        <p className="meta">
                          <b>{c.name || c.email}</b> — {c.email}
                          {c.companyName ? ` — ${c.companyName}` : ''}
                        </p>
                        <p className="subject">Original subject: {c.subject}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

    </div>
  );
};

export default CSVEmailSender;
