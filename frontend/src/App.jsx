import React, { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const defaultBody = `Hi {{first_name}},\n\nI noticed that {{company_name}} is currently recruiting for {{job_title}}.\n\nWe are a recruitment agency that helps companies source suitable candidates efficiently. I would be happy to discuss whether we could support your current hiring needs.\n\nBest regards,\n{{recruiter_name}}`;
const activeJobStatuses = new Set(['queued', 'running']);

export default function App() {
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [limit, setLimit] = useState(100);
  const [emailFilter, setEmailFilter] = useState('all');
  const [job, setJob] = useState(null);
  const [mode, setMode] = useState('');
  const [sending, setSending] = useState(false);
  const [activeLead, setActiveLead] = useState(null);
  const [subject, setSubject] = useState('Recruitment support for {{company_name}}');
  const [body, setBody] = useState(defaultBody);
  const [previews, setPreviews] = useState([]);
  const [notice, setNotice] = useState('');

  const loadLeads = async () => {
    const response = await fetch(`${API}/leads`);
    if (!response.ok) throw new Error('Could not load companies.');
    setLeads(await response.json());
  };

  useEffect(() => {
    loadLeads().catch(() => setNotice('Backend is not reachable.'));
  }, []);

  useEffect(() => {
    if (!job?.id || !activeJobStatuses.has(job.status)) return undefined;
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const response = await fetch(`${API}/discover/${job.id}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not read discovery progress.');
        if (cancelled) return;
        setJob(data.job);
        await loadLeads();

        if (data.job.status === 'completed') {
          setMode(data.job.mode || 'live');
          setNotice(`${data.job.candidatesFound} companies checked; ${data.job.emailsFound} public emails found.`);
        } else if (data.job.status === 'failed' || data.job.status === 'interrupted') {
          setNotice(data.job.error || 'Discovery stopped before completion.');
        } else {
          timer = window.setTimeout(poll, 1500);
        }
      } catch (error) {
        if (!cancelled) setNotice(error.message);
      }
    };

    timer = window.setTimeout(poll, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [job?.id]);

  const discover = async () => {
    setNotice('');
    try {
      const response = await fetch(`${API}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit })
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.job) setJob(data.job);
        throw new Error(data.error || 'Discovery failed');
      }
      setJob(data.job);
      setNotice(`Discovery started for up to ${limit.toLocaleString()} companies.`);
    } catch (error) {
      setNotice(error.message);
    }
  };

  const visibleLeads = useMemo(() => leads.filter(lead => {
    if (emailFilter === 'found') return Boolean(lead.email);
    if (emailFilter === 'missing') return !lead.email;
    return true;
  }), [leads, emailFilter]);

  const selectableLeads = useMemo(() => visibleLeads.filter(lead => lead.email), [visibleLeads]);
  const selectedLeads = useMemo(() => leads.filter(lead => lead.email && selected.has(lead.id)), [leads, selected]);
  const allSelected = selectableLeads.length > 0 && selectableLeads.every(lead => selected.has(lead.id));

  const toggleAll = () => setSelected(current => {
    const next = new Set(current);
    selectableLeads.forEach(lead => allSelected ? next.delete(lead.id) : next.add(lead.id));
    return next;
  });

  const toggle = lead => {
    if (!lead.email) return;
    setSelected(current => {
      const next = new Set(current);
      next.has(lead.id) ? next.delete(lead.id) : next.add(lead.id);
      return next;
    });
  };

  const preview = async () => {
    if (!selectedLeads.length) return setNotice('Select at least one company with an email first.');
    const response = await fetch(`${API}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedLeads.map(lead => lead.id), subject, body })
    });
    setPreviews(await response.json());
  };

  const send = async () => {
    if (!selectedLeads.length) return setNotice('Select at least one company with an email first.');
    if (!window.confirm(`Send an individual email to ${selectedLeads.length} selected companies?`)) return;
    setSending(true);
    setNotice('');
    try {
      const response = await fetch(`${API}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedLeads.map(lead => lead.id), subject, body })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Send failed');
      const successful = data.results.filter(result => result.ok).length;
      const failed = data.results.length - successful;
      setNotice(`${successful} sent successfully${failed ? `, ${failed} failed` : ''}.`);
      await loadLeads();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSending(false);
    }
  };

  const discoveryRunning = job && activeJobStatuses.has(job.status);
  const progress = job?.phase === 'checking-emails' && job.candidatesFound
    ? Math.round((job.processed / job.candidatesFound) * 100)
    : job?.phase === 'completed' ? 100 : job?.phase === 'searching' ? 15 : 3;

  return <div className="app">
    <header>
      <div><h1>Recruitment Email Finder</h1><p>Find local companies that are hiring and retrieve their public business email addresses.</p></div>
      <span className="pill">Version 1 MVP</span>
    </header>

    <section className="panel">
      <div className="discover-row">
        <div><h2>1. Find hiring companies</h2><p>Searches Singapore companies while excluding government organisations, recruitment agencies and common job boards.</p></div>
        <div className="discover-controls">
          <label>Maximum candidates
            <select value={limit} onChange={event => setLimit(Number(event.target.value))} disabled={discoveryRunning}>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
              <option value="1000">1,000</option>
            </select>
          </label>
          <button className="primary discover-button" onClick={discover} disabled={discoveryRunning}>
            {discoveryRunning ? 'Searching…' : 'Find companies & emails'}
          </button>
        </div>
      </div>

      {job && <div className="job-progress">
        <div className="progress-heading"><strong>{job.phase === 'checking-emails' ? 'Checking company websites' : job.phase === 'completed' ? 'Discovery complete' : 'Searching for companies'}</strong><span>{progress}%</span></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }}/></div>
        <div className="progress-stats">
          <span>{job.candidatesFound || 0} candidates</span>
          <span>{job.processed || 0} checked</span>
          <span>{job.emailsFound || 0} emails found</span>
          <span>{job.excluded || 0} excluded</span>
          <span>{job.duplicates || 0} duplicates</span>
          <span>{job.searchRequests || 0} searches used</span>
        </div>
      </div>}

      {notice && <div className="notice">{notice}</div>}
      {mode === 'demo' && <small>Demo results are shown until `SERPAPI_API_KEY` is added in backend/.env.</small>}
    </section>

    <section className="panel">
      <div className="section-head">
        <div><h2>2. Review leads</h2><p>{visibleLeads.length} shown • {selectedLeads.length} selected</p></div>
        <button onClick={toggleAll} disabled={!selectableLeads.length}>{allSelected ? 'Clear shown' : 'Select shown with email'}</button>
      </div>

      <div className="filter-tabs" aria-label="Filter companies by email status">
        <button className={emailFilter === 'all' ? 'active' : ''} onClick={() => setEmailFilter('all')}>All ({leads.length})</button>
        <button className={emailFilter === 'found' ? 'active' : ''} onClick={() => setEmailFilter('found')}>Email found ({leads.filter(lead => lead.email).length})</button>
        <button className={emailFilter === 'missing' ? 'active' : ''} onClick={() => setEmailFilter('missing')}>Email not found ({leads.filter(lead => !lead.email).length})</button>
      </div>

      <div className="lead-list">
        {visibleLeads.map(lead => <article className={`lead ${selected.has(lead.id) ? 'chosen' : ''}`} key={lead.id}>
          <input aria-label={`Select ${lead.company_name}`} type="checkbox" disabled={!lead.email} checked={selected.has(lead.id)} onChange={() => toggle(lead)}/>
          <div className="lead-main" onClick={() => setActiveLead(lead)}>
            <div className="lead-title"><strong>{lead.company_name}</strong><span className={`score s${Math.floor(lead.score / 20)}`}>{lead.score}/100</span></div>
            <div>{lead.job_title || 'Hiring opportunity'}</div>
            {lead.email
              ? <a className="lead-email" href={`mailto:${lead.email}`} onClick={event => event.stopPropagation()}>{lead.email}</a>
              : <span className="missing-email">No public email found</span>}
            <small>{lead.location || 'Singapore'} • {lead.confidence} confidence</small>
          </div>
          <span className={`status ${lead.status.toLowerCase()}`}>{lead.status}</span>
          <button onClick={() => setActiveLead(lead)}>Inspect</button>
        </article>)}
        {!visibleLeads.length && <div className="empty">No companies match this filter yet.</div>}
      </div>
    </section>

    <section className="panel">
      <div className="section-head"><div><h2>3. Compose email</h2><p>One email template is personalised separately for every selected company.</p></div></div>
      <label>Subject<input value={subject} onChange={event => setSubject(event.target.value)}/></label>
      <label>Email body<textarea rows="10" value={body} onChange={event => setBody(event.target.value)}/></label>
      <div className="variables">Available: {'{{contact_name}}'} {'{{first_name}}'} {'{{company_name}}'} {'{{job_title}}'} {'{{location}}'} {'{{recruiter_name}}'}</div>
      <div className="actions"><button onClick={preview}>Preview selected</button><button className="primary" onClick={send} disabled={sending || !selectedLeads.length}>Send individually to {selectedLeads.length}</button></div>
      {previews.length > 0 && <div className="previews"><h3>Email preview</h3>{previews.slice(0, 5).map((previewItem, index) => <div className="preview" key={previewItem.id}><strong>{index + 1}. {previewItem.company_name}</strong><small>{previewItem.recipient}</small><div className="subject">{previewItem.subject}</div><pre>{previewItem.body}</pre></div>)}{previews.length > 5 && <p>+ {previews.length - 5} more selected companies</p>}</div>}
    </section>

    {activeLead && <div className="modal-backdrop" onClick={() => setActiveLead(null)}><div className="modal" onClick={event => event.stopPropagation()}>
      <button className="close" onClick={() => setActiveLead(null)}>×</button>
      <h2>{activeLead.company_name}</h2><p>{activeLead.location || 'Singapore'}</p>
      <dl>
        <dt>Opening</dt><dd>{activeLead.job_title || 'Current hiring opportunity'}</dd>
        <dt>Website</dt><dd><a href={activeLead.website} target="_blank" rel="noreferrer">{activeLead.website}</a></dd>
        <dt>Job source</dt><dd><a href={activeLead.job_url} target="_blank" rel="noreferrer">Open listing</a></dd>
        <dt>Contact</dt><dd>{activeLead.contact_name || 'Hiring team / not identified'}{activeLead.contact_role ? ` — ${activeLead.contact_role}` : ''}</dd>
        <dt>Email</dt><dd>{activeLead.email ? <a href={`mailto:${activeLead.email}`}>{activeLead.email}</a> : 'No public email found'}</dd>
        <dt>Confidence</dt><dd>{activeLead.confidence}</dd>
        <dt>Lead score</dt><dd>{activeLead.score}/100</dd>
        <dt>Status</dt><dd>{activeLead.status}</dd>
      </dl>
      <div className="actions"><button disabled={!activeLead.email} onClick={() => { toggle(activeLead); setActiveLead(null); }}>{selected.has(activeLead.id) ? 'Remove selection' : 'Select company'}</button><button onClick={() => setActiveLead(null)}>Close</button></div>
    </div></div>}
  </div>;
}
