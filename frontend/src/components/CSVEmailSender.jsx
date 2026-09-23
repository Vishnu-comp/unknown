import React, { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import axios from 'axios';

import { DEFAULT_SUBJECT, DEFAULT_TEMPLATE } from '../emailTemplates.js';

// Relative base URL — Vite proxies /api to the backend, so this works in dev,
// in a hosted preview and in production without code changes.
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GAP_MS = 2000;

const EMPTY_MANUAL_CANDIDATE = {
  name: '',
  email: '',
  cc: '',
  companyName: '',
  jobDescription: '',
  jobId: '',
};

const newBatch = (label) => ({
  id: `b_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
  label,
});

const CSVEmailSender = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [manualCandidate, setManualCandidate] = useState(EMPTY_MANUAL_CANDIDATE);
  const [csvData, setCsvData] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [batches, setBatches] = useState([]);
  // Identity of the current recipient group — sends are filed under this batch.
  const [batchInfo, setBatchInfo] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [validation, setValidation] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [error, setError] = useState('');

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

  // One editable block per follow-up step. The copy is fetched from
  // /api/followups/templates so the send route can fall back to the exact same
  // defaults; clearing a field means "use the built-in copy for this step".
  const [followUpStages, setFollowUpStages] = useState([]);
  const [stagePlan, setStagePlan] = useState([]);
  // Pristine server copy per step, so previewing a blanked field still shows
  // exactly what the server would send.
  const stageDefaults = useRef({});

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
      setStagePlan(res.data.stages || []);
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err);
      setFollowUps([]);
      setBatches([]);
      setStagePlan([]);
    }
  }, []);

  // Default copy for each follow-up step, plus how many steps the server is
  // configured for (MAX_FOLLOW_UPS).
  useEffect(() => {
    api
      .get('/followups/templates')
      .then(({ data }) => {
        const stages = data.stages || [];
        stageDefaults.current = Object.fromEntries(
          stages.map((s) => [s.stage, { subject: s.subject, template: s.template }])
        );
        setFollowUpStages(stages);
      })
      .catch((err) => console.error('Failed to load follow-up templates:', err));
  }, []);

  const stageLabel = (stage) =>
    followUpStages.find((s) => s.stage === stage)?.label ||
    stagePlan.find((s) => s.stage === stage)?.label ||
    `Follow-up ${stage}`;

  const copyForStage = (stage) => followUpStages.find((s) => s.stage === stage) || {};

  const updateFollowUpCopy = (stage, field, value) =>
    setFollowUpStages((prev) =>
      prev.map((s) => (s.stage === stage ? { ...s, [field]: value } : s))
    );

  const waitingFor = (stage) => followUps.filter((c) => c.nextFollowUp === stage).length;

  useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

  const fetchDrafts = useCallback(async () => {
    try {
      const { data } = await api.get('/drafts');
      setDrafts(data.drafts || []);
    } catch (err) {
      console.error('Failed to load saved batches:', err);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

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
            // Keep rows with only an email: validation flags the missing name
            // rather than silently dropping the row.
            .filter((row) => row.email || row.name)
            .map((row) => ({
              ...row,
              // Per-row overrides win; empty means "use the shared template".
              emailSubject: row.emailSubject || '',
              emailTemplate: row.emailTemplate || '',
            }));
          setCsvData(rows);
          setExpanded(null);
          setSkipped([]);
          setValidation(null);
          if (rows.length) validateRows(rows);
          // Every upload becomes its own follow-up batch.
          setBatchInfo(newBatch(csvFile?.name || 'upload.csv'));
          if (!rows.length) {
            setBatchPreviews([]);
            setError('No usable rows found - the CSV needs an "email" column.');
          }
        },
      });
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.response?.data?.message || 'Upload failed. Check the console for details.');
    }
  };

  // ─── Send initial emails ──────────────────────────────────────────────────
  // The same queue is used by CSV sends and by the manual "Add & send" action,
  // so both paths get identical batching, progress, follow-up and contact-log
  // behaviour.
  const sendQueue = async (queue, sendBatch = batchInfo, rowsToRefresh = csvData) => {
    setSending(true);
    setProgress({ current: 0, total: queue.length, status: 'Starting...' });

    let failures = 0;
    try {
      for (let i = 0; i < queue.length; i++) {
        const candidate = queue[i];
        setProgress({
          current: i,
          total: queue.length,
          status: `Sending to ${candidate.name || candidate.email} (${candidate.email})`,
        });

        const res = await api.post('/sendCustomEmails', {
          candidates: [candidate],
          // Shared subject/template edited above are used unless the row overrides them.
          emailSubject: subject,
          emailTemplate: template,
          theme,
          batchId: sendBatch?.id,
          batchLabel: sendBatch?.label,
        });
        failures += res.data.failCount || 0;

        if (i < queue.length - 1) await sleep(GAP_MS);
      }

      setProgress({
        current: queue.length,
        total: queue.length,
        status: failures ? `Done with ${failures} failure(s).` : 'All emails sent.',
      });
      await fetchFollowUps();
      if (rowsToRefresh.length) await validateRows(rowsToRefresh);
      return { successCount: queue.length - failures, failCount: failures };
    } catch (err) {
      console.error('Send failed:', err);
      setError(err.response?.data?.message || 'Sending failed. Check the console.');
      setProgress((p) => ({ ...p, status: 'Failed. Check logs.' }));
      return null;
    } finally {
      setSending(false);
    }
  };

  const sendEmails = async () => {
    setError('');
    if (!csvData.length) {
      setError('No candidates to send emails to.');
      return;
    }
    // activeRows drops invalid rows and anything ticked as skipped.
    const queue = activeRows;
    if (!queue.length) {
      setError('Every row is skipped or invalid - nothing to send.');
      return;
    }

    await sendQueue(queue, batchInfo, csvData);
  };

  // A manual recipient is added to the same working list used by CSV rows.
  // This keeps the existing preview, validation, save-for-later and follow-up
  // features available without making the user create a one-row CSV.
  const addManualCandidate = async (event, sendNow = false) => {
    event?.preventDefault();
    setError('');

    const candidate = Object.fromEntries(
      Object.entries(manualCandidate).map(([key, value]) => [key, String(value || '').trim()])
    );

    if (!candidate.name || !candidate.email || !candidate.companyName || !candidate.jobDescription) {
      setError('Name, email, company and job description are required for a manual recipient.');
      return;
    }

    const nextRows = [...csvData, candidate];
    const sendBatch = batchInfo || newBatch('Manual recipients');

    setCsvData(nextRows);
    setBatchInfo(sendBatch);
    setExpanded(null);

    const result = await validateRows(nextRows);
    if (!result) {
      if (sendNow) setError('Could not validate this recipient. It was added but not sent.');
      setManualCandidate(EMPTY_MANUAL_CANDIDATE);
      return;
    }

    const addedValidation = result.rows[result.rows.length - 1];
    const recentlyContacted = Boolean(
      addedValidation?.contacted &&
        result?.summary &&
        addedValidation.contacted.daysAgo <= result.summary.recentDays
    );
    const duplicate = Boolean(addedValidation?.duplicate);

    if (sendNow && addedValidation?.sendable && !recentlyContacted && !duplicate) {
      const outcome = await sendQueue([candidate], sendBatch, nextRows);
      if (outcome?.successCount) setManualCandidate(EMPTY_MANUAL_CANDIDATE);
      return;
    }

    if (sendNow) {
      if (!addedValidation?.sendable) {
        setError('That email address is invalid. Fix it in the pre-send check before sending.');
      } else if (recentlyContacted) {
        setError('This recipient was contacted recently. Review the pre-send warning before sending.');
      } else if (duplicate) {
        setError('This email is already in the recipient list. The new row was added and pre-ticked to skip.');
      }
    }

    setManualCandidate(EMPTY_MANUAL_CANDIDATE);
  };

  // ─── Send follow-ups ──────────────────────────────────────────────────────
  //
  // One step at a time: `stage` is which follow-up to send (1 = first nudge,
  // 2 = final note). The server refuses to send the wrong step, so a group
  // can only ever receive the follow-up it is actually waiting for.
  const runFollowUps = async (
    pending,
    stage,
    { targetBatch, done = 0, total = pending.length, tally = { sent: 0, failures: 0, skipped: 0 } } = {}
  ) => {
    const copy = copyForStage(stage);

    for (let i = 0; i < pending.length; i++) {
      const candidate = pending[i];
      setProgress({
        current: done + i,
        total,
        status: `${stageLabel(stage)} to ${candidate.name || candidate.email}`,
      });

      const res = await api.post('/sendFollowUpEmails', {
        candidates: [candidate],
        // Blank copy is fine: the server uses the built-in copy for that step.
        emailSubject: copy.subject || '',
        emailTemplate: copy.template || '',
        theme,
        batchId: candidate.batchId || targetBatch?.id,
        stage,
      });

      tally.sent += res.data.successCount || 0;
      tally.failures += res.data.failCount || 0;
      tally.skipped += res.data.skippedCount || 0;

      if (i < pending.length - 1) await sleep(GAP_MS);
    }

    return tally;
  };

  const summarize = ({ sent, failures, skipped }, total) =>
    [
      `${sent}/${total} sent`,
      failures ? `${failures} failed` : null,
      skipped ? `${skipped} skipped` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const sendFollowUpEmails = async (targetBatch, stage) => {
    setError('');
    setSending(true);
    setProgress({ current: 0, total: 0, status: `Collecting who is waiting for ${stageLabel(stage)}...` });

    try {
      const { data } = await api.get('/followups', {
        params: { ...(targetBatch ? { batchId: targetBatch.id } : {}), stage },
      });
      const pending = data.candidates || [];

      if (!pending.length) {
        setError(`Nobody is waiting for ${stageLabel(stage)}.`);
        setProgress({ current: 0, total: 0, status: '' });
        return;
      }

      const tally = await runFollowUps(pending, stage, {
        targetBatch,
        total: pending.length,
      });

      setProgress({
        current: pending.length,
        total: pending.length,
        status: `${stageLabel(stage)}: ${summarize(tally, pending.length)}`,
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

  /**
   * Send everything pending, oldest step first. The queue is snapshotted before
   * the first send so somebody who just received follow-up 1 is not chased with
   * follow-up 2 in the same run.
   */
  const sendAllFollowUps = async () => {
    setError('');
    if (!followUps.length) {
      setError('Nothing is waiting for a follow-up.');
      return;
    }

    const snapshot = followUps.map((c) => ({ ...c }));
    const stages = [...new Set(snapshot.map((c) => c.nextFollowUp))]
      .filter((s) => Number.isFinite(s) && s > 0)
      .sort((a, b) => a - b);

    setSending(true);
    const tally = { sent: 0, failures: 0, skipped: 0 };
    let done = 0;

    setProgress({ current: 0, total: snapshot.length, status: 'Sending pending follow-ups...' });

    try {
      for (const stage of stages) {
        const group = snapshot.filter((c) => c.nextFollowUp === stage);
        if (!group.length) continue;

        await runFollowUps(group, stage, { done, total: snapshot.length, tally });
        done += group.length;
        setProgress({
          current: done,
          total: snapshot.length,
          status: `${stageLabel(stage)} done - ${summarize(tally, done)}`,
        });
      }

      setProgress({
        current: snapshot.length,
        total: snapshot.length,
        status: `All pending follow-ups: ${summarize(tally, snapshot.length)}`,
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
  // Pass `copy` to preview a follow-up step instead of the initial email.
  const showPreview = async (candidate, copy) => {
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
        emailSubject: copy?.subject || sample.emailSubject || subject,
        emailTemplate: copy?.template || sample.emailTemplate || template,
        theme,
      });
      setPreview({ ...data, to: sample.email || '(sample)', step: copy?.step || null });
    } catch (err) {
      console.error('Preview failed:', err);
      setError(err.response?.data?.message || 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const validateRows = async (rows) => {
    try {
      const { data } = await api.post('/validate', { candidates: rows });
      setValidation(data);
      // Pre-tick anything unsendable or already contacted recently.
      const auto = data.rows
        .filter((r) => !r.sendable || r.duplicate || (r.contacted && r.contacted.daysAgo <= data.summary.recentDays))
        .map((r) => r.index);
      setSkipped(auto);
      return data;
    } catch (err) {
      console.error('Validation failed:', err);
      return null;
    }
  };

  const toggleSkip = (index) =>
    setSkipped((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );

  // Rows that will actually be sent: never include invalid ones.
  const activeRows = csvData.filter((row, i) => {
    const v = validation?.rows?.[i];
    if (v && !v.sendable) return false;
    return !skipped.includes(i);
  });

  const saveForLater = async () => {
    setError('');
    if (!csvData.length) {
      setError('Add a recipient or import a CSV first.');
      return;
    }

    try {
      await api.post('/drafts', {
        candidates: activeRows,
        emailSubject: subject,
        emailTemplate: template,
        theme,
        label: batchInfo?.label || 'Saved batch',
        batchId: batchInfo?.id,
        batchLabel: batchInfo?.label,
      });
      await fetchDrafts();
    } catch (err) {
      console.error('Save failed:', err);
      setError(err.response?.data?.message || 'Could not save that batch.');
    }
  };

  const sendDraft = async (d) => {
    if (!window.confirm(`Send "${d.label}" to ${d.recipientCount} recipient(s) now?`)) return;

    setError('');
    setSending(true);
    setProgress({ current: 0, total: d.recipientCount, status: `Sending ${d.label}...` });

    try {
      const { data } = await api.post(`/drafts/${d.id}/send`);
      setProgress({
        current: d.recipientCount,
        total: d.recipientCount,
        status: data.failCount
          ? `${data.successCount} sent, ${data.failCount} failed (kept for retry).`
          : `All ${data.successCount} sent.`,
      });
      setDrafts(data.drafts || []);
      await fetchFollowUps();
    } catch (err) {
      console.error('Send failed:', err);
      setError(err.response?.data?.message || 'Could not send that batch.');
      setProgress((p) => ({ ...p, status: 'Failed. Check logs.' }));
    } finally {
      setSending(false);
    }
  };

  const deleteDraft = async (d) => {
    if (!window.confirm(`Discard "${d.label}" without sending?`)) return;
    try {
      const { data } = await api.delete(`/drafts/${d.id}`);
      setDrafts(data.drafts || []);
    } catch (err) {
      console.error('Discard failed:', err);
      setError(err.response?.data?.message || 'Could not discard that batch.');
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
      <h1>Send personalized emails</h1>
      <p className="hint">
        Upload a CSV for a batch, or enter one recipient below — a CSV is no longer required.
        Both options use the same template, preview, validation and follow-up flow.
      </p>
      <p className="hint">
        CSV columns: <code>name, email, cc, companyName, jobDescription, jobId</code>. Optional
        per-row <code>emailSubject</code> / <code>emailTemplate</code> override the shared copy.
        Placeholders: <code>[user name]</code>, <code>[company name]</code>,{' '}
        <code>[job description]</code>, <code>[job id]</code>.
      </p>

      <div className="card recipients-card">
        <div className="section-heading">
          <div>
            <h2>Recipients</h2>
            <p className="hint">Add a single recipient manually or import several from a CSV file.</p>
          </div>
          {csvData.length > 0 && <span className="count-badge">{csvData.length} loaded</span>}
        </div>

        <div className="manual-entry">
          <div className="manual-entry-head">
            <div>
              <h3>Enter recipient details</h3>
              <p className="hint">
                Required fields are marked <span className="required-mark">*</span>. Add the
                recipient to the list, or add it and send immediately.
              </p>
            </div>
            <span className="entry-badge">No CSV needed</span>
          </div>

          <form onSubmit={(event) => addManualCandidate(event)}>
            <div className="manual-grid">
              <label className="manual-field" htmlFor="manual-name">
                Full name <span className="required-mark">*</span>
                <input
                  id="manual-name"
                  type="text"
                  value={manualCandidate.name}
                  onChange={(e) => setManualCandidate((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Asha Rao"
                  required
                />
              </label>
              <label className="manual-field" htmlFor="manual-email">
                Email address <span className="required-mark">*</span>
                <input
                  id="manual-email"
                  type="email"
                  value={manualCandidate.email}
                  onChange={(e) => setManualCandidate((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="asha@example.com"
                  required
                />
              </label>
              <label className="manual-field" htmlFor="manual-company">
                Company <span className="required-mark">*</span>
                <input
                  id="manual-company"
                  type="text"
                  value={manualCandidate.companyName}
                  onChange={(e) =>
                    setManualCandidate((prev) => ({ ...prev, companyName: e.target.value }))
                  }
                  placeholder="Acme Corp"
                  required
                />
              </label>
              <label className="manual-field" htmlFor="manual-job">
                Job description <span className="required-mark">*</span>
                <input
                  id="manual-job"
                  type="text"
                  value={manualCandidate.jobDescription}
                  onChange={(e) =>
                    setManualCandidate((prev) => ({ ...prev, jobDescription: e.target.value }))
                  }
                  placeholder="Backend Engineer"
                  required
                />
              </label>
              <label className="manual-field" htmlFor="manual-cc">
                CC <span className="optional-mark">optional</span>
                <input
                  id="manual-cc"
                  type="text"
                  value={manualCandidate.cc}
                  onChange={(e) => setManualCandidate((prev) => ({ ...prev, cc: e.target.value }))}
                  placeholder="manager@example.com"
                />
              </label>
              <label className="manual-field" htmlFor="manual-job-id">
                Job ID <span className="optional-mark">optional</span>
                <input
                  id="manual-job-id"
                  type="text"
                  value={manualCandidate.jobId}
                  onChange={(e) => setManualCandidate((prev) => ({ ...prev, jobId: e.target.value }))}
                  placeholder="ENG-101"
                />
              </label>
            </div>
            <div className="row manual-actions">
              <button type="submit" disabled={sending}>
                Add recipient
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(event) => addManualCandidate(event, true)}
                disabled={sending}
              >
                Add and send now
              </button>
              <span className="hint">The shared subject and email body below will be used.</span>
            </div>
          </form>
        </div>

        <div className="csv-entry">
          <label htmlFor="csv">Import CSV instead</label>
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
            {csvData.length > 0 && <span className="hint">{csvData.length} recipient(s) loaded</span>}
          </div>
        </div>
      </div>

      {validation && (
        <div className="card">
          <h2>
            Pre-send check
            <span className="vcount">
              {activeRows.length} of {validation.summary.total} will be sent
            </span>
          </h2>

          <div className="vsummary">
            {validation.summary.invalid > 0 && (
              <span className="vpill v-err">{validation.summary.invalid} invalid</span>
            )}
            {validation.summary.duplicates > 0 && (
              <span className="vpill v-warn">{validation.summary.duplicates} duplicate</span>
            )}
            {validation.summary.alreadyContacted > 0 && (
              <span className="vpill v-warn">
                {validation.summary.alreadyContacted} already contacted
              </span>
            )}
            {validation.summary.invalid === 0 &&
              validation.summary.duplicates === 0 &&
              validation.summary.alreadyContacted === 0 && (
                <span className="vpill v-ok">Nothing to flag</span>
              )}
          </div>

          {(validation.summary.invalid > 0 ||
            validation.summary.duplicates > 0 ||
            validation.summary.alreadyContacted > 0 ||
            validation.summary.missingFields > 0) && (
            <>
              <p className="hint">
                Flagged rows are pre-ticked to skip. Untick to send anyway. Invalid addresses can
                never be sent.
              </p>
              <div className="vlist">
                {validation.rows
                  .filter((r) => r.errors.length || r.warnings.length)
                  .map((r) => (
                    <label
                      key={r.index}
                      className={`vrow ${!r.sendable ? 'v-dead' : ''}`}
                      title={!r.sendable ? 'Invalid address - cannot be sent' : ''}
                    >
                      <input
                        type="checkbox"
                        checked={!r.sendable || skipped.includes(r.index)}
                        disabled={!r.sendable}
                        onChange={() => toggleSkip(r.index)}
                      />
                      <span className="vmain">
                        <b>{r.email || '(no email)'}</b>
                        {r.name ? <span className="hint"> &middot; {r.name}</span> : null}
                        <span className="vmsgs">
                          {r.errors.map((m, k) => (
                            <span key={`e${k}`} className="vmsg v-err">
                              {m}
                            </span>
                          ))}
                          {r.warnings.map((m, k) => (
                            <span key={`w${k}`} className="vmsg v-warn">
                              {m}
                            </span>
                          ))}
                        </span>
                      </span>
                    </label>
                  ))}
              </div>
              <div className="row">
                <button
                  className="ghost small"
                  onClick={() =>
                    setSkipped(
                      validation.rows.filter((r) => r.errors.length || r.warnings.length).map((r) => r.index)
                    )
                  }
                >
                  Skip all flagged
                </button>
                <button className="ghost small" onClick={() => setSkipped([])}>
                  Send everything valid
                </button>
              </div>
            </>
          )}
        </div>
      )}

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
        <h2>Follow-up emails</h2>
        <p className="hint">
          Follow-ups reply inside the original Gmail thread, one step at a time: everyone gets{' '}
          <b>Follow-up 1</b>, and <b>Follow-up 2</b> only goes to the people still silent after
          that. Once the last step is sent the contact leaves the queue, so nobody is chased for
          ever. The subject stored from the original mail is reused for threading; these subjects
          are only fallbacks.
        </p>
        <p className="hint">
          Copy is loaded from the server (<code>GET /api/followups/templates</code>). Leave a field
          blank to send the built-in copy for that step.
        </p>

        {followUpStages.map((s) => (
          <div key={s.stage} className={`fu-block ${s.final ? 'fu-final' : ''}`}>
            <div className="fu-head">
              <b>{s.label}</b>
              <span className={`stage-badge ${s.final ? 's-final' : ''}`}>
                {s.final ? 'last step' : 'next step'}
              </span>
              <span className="hint"> {waitingFor(s.stage)} waiting</span>
            </div>
            <p className="hint">{s.blurb}</p>

            <label htmlFor={`fsubject-${s.stage}`}>Subject (fallback)</label>
            <textarea
              id={`fsubject-${s.stage}`}
              className="followup"
              rows={2}
              value={s.subject}
              onChange={(e) => updateFollowUpCopy(s.stage, 'subject', e.target.value)}
            />
            <label htmlFor={`ftemplate-${s.stage}`}>Body (HTML)</label>
            <textarea
              id={`ftemplate-${s.stage}`}
              className="followup"
              rows={6}
              value={s.template}
              onChange={(e) => updateFollowUpCopy(s.stage, 'template', e.target.value)}
            />
            <div className="row">
              <button
                className="ghost small"
                onClick={() => {
                  const fallback = stageDefaults.current[s.stage] || {};
                  showPreview(null, {
                    subject: s.subject || fallback.subject,
                    template: s.template || fallback.template,
                    step: s.label,
                  });
                }}
                disabled={previewing}
              >
                {previewing ? 'Rendering...' : `Preview ${s.label}`}
              </button>
            </div>
          </div>
        ))}

        {!followUpStages.length && (
          <p className="hint">Loading the default follow-up copy from the server...</p>
        )}
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
          <h2>
            Preview — {preview.theme}
            {preview.step && <> &nbsp;·&nbsp; {preview.step}</>}
          </h2>
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

      {drafts.length > 0 && (
        <div className="card">
          <h2>Saved batches ({drafts.length})</h2>
          <p className="hint">
            Saved on the server and sent only when you press Send now. Nothing goes out on its
            own, so the server does not need to be running in between.
          </p>
          {drafts.map((d) => (
            <div key={d.id} className="jobrow">
              <div>
                <b>{d.label}</b>
                <span className="jstatus j-saved">saved</span>
                <div className="hint">
                  {d.recipientCount} recipient{d.recipientCount === 1 ? '' : 's'} &middot;{' '}
                  {d.theme || 'plain'} &middot; saved {new Date(d.createdAt).toLocaleString()}
                </div>
                {d.recipients?.length > 0 && (
                  <div className="hint small">
                    {d.recipients.join(', ')}
                    {d.recipientCount > d.recipients.length && ` +${d.recipientCount - d.recipients.length} more`}
                  </div>
                )}
              </div>
              <div className="batch-actions">
                <button className="secondary small" onClick={() => sendDraft(d)} disabled={sending}>
                  Send now
                </button>
                <button
                  className="ghost small danger"
                  onClick={() => deleteDraft(d)}
                  disabled={sending}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <button className="secondary" onClick={sendEmails} disabled={sending || !activeRows.length}>
          {sending ? 'Sending...' : `Send Now (${activeRows.length})`}
        </button>
        <button onClick={saveForLater} disabled={sending || !activeRows.length}>
          Save for Later
        </button>
        <button
          className="tertiary"
          onClick={sendAllFollowUps}
          disabled={sending || followUps.length === 0}
          title="Work through every pending batch, oldest step first"
        >
          {sending ? 'Working...' : `Send All Follow-Ups (${followUps.length})`}
        </button>
      </div>

      {followUps.length > 0 && stagePlan.some((s) => s.waiting > 0) && (
        <p className="hint">
          Queue:{' '}
          {stagePlan
            .filter((s) => s.waiting > 0)
            .map((s) => `${s.waiting} waiting for ${s.label}`)
            .join(' · ')}
        </p>
      )}

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

      {!csvData.length && (
        <p className="hint">Add a recipient above or import a CSV to see the rendered email here.</p>
      )}

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
          <h2>Pending follow-ups by batch ({followUps.length})</h2>
          <p className="hint">
            Each CSV upload or manual recipient group is its own batch, so you can follow up one
            group at a time instead of everyone at once. Every batch shows which step its people
            are on — follow-up 2 only goes to those still waiting after follow-up 1. Sent follow-ups
            leave the batch automatically.
          </p>

          {batches.map((b) => {
            const rows = followUps.filter((c) => c.batchId === b.id);
            const open = openBatch === b.id;
            const pendingByStage = b.pendingByStage || {};
            const stagesHere = Object.keys(pendingByStage)
              .map(Number)
              .sort((a, z) => a - z);

            return (
              <div key={b.id} className="batch">
                <div className="batch-head">
                  <div>
                    <b>{b.label}</b>
                    <span className="hint">
                      {' '}
                      · {b.count} pending
                      {stagesHere
                        .map((s) => ` · ${pendingByStage[s]} waiting for ${stageLabel(s)}`)
                        .join('')}{' '}
                      · {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="batch-actions">
                    <button
                      className="ghost small"
                      onClick={() => setOpenBatch(open ? null : b.id)}
                    >
                      {open ? 'Hide' : 'Show'}
                    </button>
                    {stagesHere.map((s) => (
                      <button
                        key={s}
                        className="tertiary small"
                        onClick={() => sendFollowUpEmails(b, s)}
                        disabled={sending}
                      >
                        {stageLabel(s)} ({pendingByStage[s]})
                      </button>
                    ))}
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
                          <span className={`stage-badge ${c.nextFollowUp > 1 ? 's-2' : ''}`}>
                            waiting for {stageLabel(c.nextFollowUp)}
                          </span>
                        </p>
                        <p className="subject">Original subject: {c.subject}</p>
                        {c.followUps?.length > 0 && (
                          <p className="hint small">
                            Sent:{' '}
                            {c.followUps
                              .map(
                                (f) =>
                                  `${stageLabel(f.stage)} on ${new Date(
                                    f.sentAt
                                  ).toLocaleDateString()}`
                              )
                              .join(' · ')}
                          </p>
                        )}
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
