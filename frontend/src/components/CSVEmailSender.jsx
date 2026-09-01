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
  const [error, setError] = useState('');

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [followUpSubject, setFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  const [followUpTemplate, setFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });

  const fetchFollowUps = useCallback(async () => {
    try {
      const res = await api.get('/followups');
      setFollowUps(res.data.candidates || []);
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err);
      setFollowUps([]);
    }
  }, []);

  useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

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
          if (!rows.length) setError('No rows with both "name" and "email" were found.');
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
  const sendFollowUpEmails = async () => {
    setError('');
    setSending(true);
    setProgress({ current: 0, total: 0, status: 'Fetching follow-up data...' });

    try {
      const { data } = await api.get('/followups');
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

  const updateRow = (index, field, value) => {
    setCsvData((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="page">
      <h1>Upload CSV and Send Emails</h1>
      <p className="hint">
        CSV columns: <code>name, email, cc, companyName, jobDescription, jobId</code>. Optional
        per-row <code>emailSubject</code> / <code>emailTemplate</code> override the shared copy.
        Placeholders: <code>[user name]</code>, <code>[company name]</code>,{' '}
        <code>[job description]</code>, <code>[job id]</code>.
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

      <div className="row">
        <button className="secondary" onClick={sendEmails} disabled={sending || !csvData.length}>
          {sending ? 'Sending...' : `Send Emails (${csvData.length})`}
        </button>
        <button
          className="tertiary"
          onClick={sendFollowUpEmails}
          disabled={sending || followUps.length === 0}
        >
          {sending ? 'Working...' : `Send Follow-Ups (${followUps.length})`}
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

      <h2>Candidate preview</h2>
      {!csvData.length && <p className="hint">Nothing parsed yet.</p>}
      {csvData.map((row, i) => (
        <div key={`${row.email}-${i}`} className="candidate">
          <p className="meta">
            <b>{row.name}</b> — {row.email}
            {row.cc ? ` (CC: ${row.cc})` : ''} — {row.companyName} — {row.jobDescription}{' '}
            {row.jobId && <span className="tag">(ID: {row.jobId})</span>}
          </p>
          <p className="subject">Subject: {row.emailSubject || subject}</p>
          <textarea
            rows={4}
            value={row.emailTemplate || ''}
            placeholder="Leave empty to use the shared template above"
            onChange={(e) => updateRow(i, 'emailTemplate', e.target.value)}
          />
        </div>
      ))}

      {followUps.length > 0 && (
        <>
          <h2>Pending follow-ups ({followUps.length})</h2>
          {followUps.map((c) => (
            <div key={c.email} className="candidate">
              <p className="meta">
                <b>{c.name || c.email}</b> — {c.email} — {c.companyName}
              </p>
              <p className="subject">Original subject: {c.subject}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default CSVEmailSender;
