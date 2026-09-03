import React, { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const defaultBody = `Hi {{first_name}},\n\nI noticed that {{company_name}} is currently recruiting for {{job_title}}.\n\nWe are a recruitment agency that helps companies source suitable candidates efficiently. I would be happy to discuss whether we could support your current hiring needs.\n\nBest regards,\n{{recruiter_name}}`;

export default function App() {
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeLead, setActiveLead] = useState(null);
  const [subject, setSubject] = useState('Recruitment support for {{company_name}}');
  const [body, setBody] = useState(defaultBody);
  const [previews, setPreviews] = useState([]);
  const [notice, setNotice] = useState('');

  const loadLeads = async () => {
    const r = await fetch(`${API}/leads`);
    setLeads(await r.json());
  };
  useEffect(() => { loadLeads().catch(() => setNotice('Backend is not reachable.')); }, []);

  const discover = async () => {
    setLoading(true); setNotice('');
    try {
      const r = await fetch(`${API}/discover`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Discovery failed');
      setLeads(data.leads); setMode(data.mode);
      setNotice(data.mode === 'demo' ? `Demo mode: ${data.added} sample companies loaded. Add Google Search credentials for live discovery.` : `${data.added} hiring companies with email addresses found.`);
    } catch (e2) { setNotice(e2.message); }
    finally { setLoading(false); }
  };

  const allSelected = leads.length > 0 && leads.every(l => selected.has(l.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(leads.map(l => l.id)));
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedLeads = useMemo(() => leads.filter(l => selected.has(l.id)), [leads, selected]);

  const preview = async () => {
    if (!selected.size) return setNotice('Select at least one company first.');
    const r = await fetch(`${API}/preview`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ids:[...selected], subject, body }) });
    setPreviews(await r.json());
  };

  const send = async () => {
    if (!selected.size) return setNotice('Select at least one company first.');
    if (!window.confirm(`Send an individual email to ${selected.size} selected companies?`)) return;
    setLoading(true); setNotice('');
    try {
      const r = await fetch(`${API}/send`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ids:[...selected], subject, body }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Send failed');
      const ok = data.results.filter(x => x.ok).length;
      const failed = data.results.length - ok;
      setNotice(`${ok} sent successfully${failed ? `, ${failed} failed` : ''}.`);
      await loadLeads();
    } catch(e){ setNotice(e.message); }
    finally { setLoading(false); }
  };

  return <div className="app">
    <header><div><h1>Recruitment Email Finder</h1><p>Find local companies that are hiring and retrieve their public business email addresses.</p></div><span className="pill">Version 1 MVP</span></header>

    <section className="panel">
      <div className="discover-row">
        <div><h2>1. Find hiring companies</h2><p>Searches Singapore companies while excluding government organisations and recruitment agencies.</p></div>
        <button className="primary discover-button" onClick={discover} disabled={loading}>{loading ? 'Searching…' : 'Find companies & emails'}</button>
      </div>
      {notice && <div className="notice">{notice}</div>}
      {mode === 'demo' && <small>Live search is intentionally disabled until API credentials are added in backend/.env.</small>}
    </section>

    <section className="panel">
      <div className="section-head"><div><h2>2. Review leads</h2><p>{leads.length} companies • {selected.size} selected</p></div><button onClick={toggleAll} disabled={!leads.length}>{allSelected ? 'Clear all' : 'Select all'}</button></div>
      <div className="lead-list">
        {leads.map(l => <article className={`lead ${selected.has(l.id)?'chosen':''}`} key={l.id}>
          <input aria-label={`Select ${l.company_name}`} type="checkbox" checked={selected.has(l.id)} onChange={()=>toggle(l.id)}/>
          <div className="lead-main" onClick={()=>setActiveLead(l)}>
            <div className="lead-title"><strong>{l.company_name}</strong><span className={`score s${Math.floor(l.score/20)}`}>{l.score}/100</span></div>
            <div>{l.job_title || 'Hiring opportunity'}</div>
            <a className="lead-email" href={`mailto:${l.email}`} onClick={e=>e.stopPropagation()}>{l.email}</a>
            <small>{l.location || 'Singapore'} • {l.confidence} confidence</small>
          </div>
          <span className={`status ${l.status.toLowerCase()}`}>{l.status}</span>
          <button onClick={()=>setActiveLead(l)}>Inspect</button>
        </article>)}
        {!leads.length && <div className="empty">No leads yet. Run discovery above.</div>}
      </div>
    </section>

    <section className="panel">
      <div className="section-head"><div><h2>3. Compose email</h2><p>One email template is personalised separately for every selected company.</p></div></div>
      <label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>
      <label>Email body<textarea rows="10" value={body} onChange={e=>setBody(e.target.value)}/></label>
      <div className="variables">Available: {'{{contact_name}}'} {'{{first_name}}'} {'{{company_name}}'} {'{{job_title}}'} {'{{location}}'} {'{{recruiter_name}}'}</div>
      <div className="actions"><button onClick={preview}>Preview selected</button><button className="primary" onClick={send} disabled={loading || !selected.size}>Send individually to {selected.size || 0}</button></div>
      {previews.length > 0 && <div className="previews"><h3>Email preview</h3>{previews.slice(0,5).map((p,i)=><div className="preview" key={p.id}><strong>{i+1}. {p.company_name}</strong><small>{p.recipient}</small><div className="subject">{p.subject}</div><pre>{p.body}</pre></div>)}{previews.length>5 && <p>+ {previews.length-5} more selected companies</p>}</div>}
    </section>

    {activeLead && <div className="modal-backdrop" onClick={()=>setActiveLead(null)}><div className="modal" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setActiveLead(null)}>×</button><h2>{activeLead.company_name}</h2><p>{activeLead.location || 'Singapore'}</p><dl><dt>Opening</dt><dd>{activeLead.job_title || 'Current hiring opportunity'}</dd><dt>Website</dt><dd><a href={activeLead.website} target="_blank" rel="noreferrer">{activeLead.website}</a></dd><dt>Job source</dt><dd><a href={activeLead.job_url} target="_blank" rel="noreferrer">Open listing</a></dd><dt>Contact</dt><dd>{activeLead.contact_name || 'Hiring team / not identified'}{activeLead.contact_role ? ` — ${activeLead.contact_role}`:''}</dd><dt>Email</dt><dd><a href={`mailto:${activeLead.email}`}>{activeLead.email}</a></dd><dt>Confidence</dt><dd>{activeLead.confidence}</dd><dt>Lead score</dt><dd>{activeLead.score}/100</dd><dt>Status</dt><dd>{activeLead.status}</dd></dl><div className="actions"><button onClick={()=>{toggle(activeLead.id); setActiveLead(null)}}>{selected.has(activeLead.id)?'Remove selection':'Select company'}</button><button onClick={()=>setActiveLead(null)}>Close</button></div></div></div>}
  </div>;
}
