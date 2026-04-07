// ═══════════════════════════════════════════════════════════════
//  SupportDesk AI — Frontend Application
// ═══════════════════════════════════════════════════════════════

// ── State ───────────────────────────────────────────────────────
// Zentraler App-State — alles was die UI braucht liegt hier drin
const state = {
  tickets:      [],       // alle Tickets vom Server
  selectedId:   null,     // aktuell ausgewaehltes Ticket
  filter:       'all',    // aktiver Filter (all, open, in_progress, resolved, oder Prioritaet)
  filterType:   'status', // filterart: status, priority oder special
  search:       '',       // Suchbegriff aus dem Suchfeld
  analysis:     null,     // letzte AI-Analyse (fuer Ticket-Erstellung)
  aiEnabled:    false,    // ob Claude AI verfuegbar ist
};

// ── Example messages ────────────────────────────────────────────
// Vordefinierte Beispiel-Nachrichten fuer die Demo-Chips im Create-View
// HINWEIS: Alle Daten hier sind fiktiv (Namen, E-Mails, Kreditkarten, Rechnungsnummern etc.)
const EXAMPLES = {
  technical: `Hi, I've been completely locked out of my account since yesterday. I tried resetting my password three times, but the reset link either doesn't arrive or says it's expired. I have a presentation using your platform tomorrow morning and this is genuinely urgent. My account email is user@company.com. Please help ASAP.`,
  billing:   `Hello, I just noticed I was charged $149 twice this month on my credit card ending in 4242. I only have one subscription with you. I need one of those charges refunded immediately. My invoice number is INV-2024-8834. This is completely unacceptable.`,
  complaint: `I've been a loyal customer for 3 years and I am absolutely furious right now. Your customer service has been completely useless. I've sent 4 emails over the past 2 weeks and nobody has responded. The product is broken and I'm paying for something I can't use. I expect a full refund and an explanation.`,
  sales:     `Hey there, I'm evaluating support tools for our growing team of about 50 agents. We currently use Zendesk but it's getting too expensive. Can you send me pricing for the Enterprise plan? We'd also love a live demo if possible. Our decision deadline is end of next month.`,
};

// ── API helpers ──────────────────────────────────────────────────
// Alle Backend-Aufrufe gebuendelt in einem Objekt — spart Wiederholung
const API = {
  async health()       { return (await fetch('/api/health')).json(); },
  async stats()        { return (await fetch('/api/stats')).json(); },
  async tickets()      { return (await fetch('/api/tickets')).json(); },
  async analyze(msg)   { return (await fetch('/api/analyze',    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: msg }) })).json(); },
  async create(d)      { return (await fetch('/api/tickets',    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d) })).json(); },
  async update(id, d)  { return (await fetch(`/api/tickets/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d) })).json(); },
  async delete(id)     { return (await fetch(`/api/tickets/${id}`,       { method:'DELETE' })).json(); },
  async addNote(id, t) { return (await fetch(`/api/tickets/${id}/notes`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: t }) })).json(); },
  // Streaming: returns the response (use with reader)
  async replyStream(id) { return fetch(`/api/tickets/${id}/generate-reply`, { method:'POST' }); },
};

// ── Utility ──────────────────────────────────────────────────────
// Wandelt ISO-Datum in lesbares "vor X Minuten/Stunden/Tagen" um
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Formatiert ISO-Datum als kurzes Datum mit Uhrzeit (z.B. "Apr 6, 02:30 PM")
function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

// HTML-Escaping gegen XSS — wichtig weil wir innerHTML nutzen
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Kleine Benachrichtigung unten rechts, verschwindet nach 3.2 Sekunden
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${esc(msg)}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Badge helpers ─────────────────────────────────────────────────
// Mapping-Objekte fuer die farbigen Badges in der UI
const priorityLabel = { Critical:'● CRITICAL', High:'● HIGH', Medium:'◐ MEDIUM', Low:'○ LOW' };
const statusLabel   = { open:'Open', in_progress:'In Progress', resolved:'Resolved' };
const sentimentIcon = { Positive:'😊', Neutral:'😐', Frustrated:'😤', Angry:'😠', Urgent:'⚡' };

function badge(cls, label) { return `<span class="badge ${cls}">${esc(label)}</span>`; }
function priorityBadge(p)  { return badge(`badge-priority-${p}`, priorityLabel[p] || p); }
function statusBadge(s)     { return badge(`badge-status-${s}`, statusLabel[s] || s); }
function sentimentBadge(s)  { return badge(`badge-sentiment-${s}`, `${sentimentIcon[s]||''} ${s}`); }

// ── Filter / search helpers ───────────────────────────────────────
// Filtert Tickets nach aktuellem Suchbegriff + Sidebar-Filter (Status/Prioritaet)
function filteredTickets() {
  return state.tickets.filter(t => {
    const q = state.search.toLowerCase();
    if (q && !t.summary.toLowerCase().includes(q) && !t.ticketNumber.toLowerCase().includes(q) && !t.category.toLowerCase().includes(q) && !t.message.toLowerCase().includes(q)) return false;

    if (state.filterType === 'priority') return t.priority === state.filter;
    if (state.filterType === 'special' && state.filter === 'escalated') return t.escalationNeeded;
    if (state.filter === 'all') return true;
    return t.status === state.filter;
  });
}

// ── Render: Stats ─────────────────────────────────────────────────
// Aktualisiert die KPI-Zahlen in Sidebar und Header-Pills
function renderStats(s) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('k-total',    s.total    || 0);
  set('k-open',     s.open     || 0);
  set('k-high',     s.highPriority || 0);
  set('k-resolved', s.resolved || 0);
  set('nc-all',      s.total || 0);
  set('nc-open',     s.open  || 0);
  set('nc-progress', s.inProgress || 0);
  set('nc-resolved', s.resolved || 0);
  set('nc-critical', state.tickets.filter(t => t.priority === 'Critical').length);
  set('nc-high-p',   state.tickets.filter(t => t.priority === 'High').length);
  set('nc-escalated',state.tickets.filter(t => t.escalationNeeded).length);

  // Header pills
  const pills = document.getElementById('header-pills');
  if (pills && s.total > 0) {
    pills.innerHTML = [
      s.open       ? `<span class="header-pill"><span class="hp-dot open"></span><b>${s.open}</b> open</span>` : '',
      s.inProgress ? `<span class="header-pill"><span class="hp-dot progress"></span><b>${s.inProgress}</b> in progress</span>` : '',
      s.highPriority ? `<span class="header-pill"><span class="hp-dot high"></span><b>${s.highPriority}</b> high priority</span>` : '',
    ].join('');
  }
}

// ── Render: Ticket List ───────────────────────────────────────────
// Baut die Ticket-Karten in der mittleren Spalte auf (oder zeigt Leerzustand)
function renderList() {
  const list = document.getElementById('ticket-list');
  const empty = document.getElementById('list-empty');
  const filtered = filteredTickets();

  if (filtered.length === 0) {
    if (!list.contains(empty)) list.innerHTML = '';
    if (!document.getElementById('list-empty')) {
      const e = document.createElement('div');
      e.id = 'list-empty';
      e.className = 'list-empty';
      e.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none"><rect x="6" y="6" width="32" height="32" rx="6" stroke="currentColor" stroke-width="1.5" opacity=".25"/><path d="M14 18H30M14 24H24M14 30H20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"/></svg><p class="le-title">${state.search ? 'No matching tickets' : 'No tickets yet'}</p><p class="le-sub">${state.search ? 'Try a different search term' : 'Create your first ticket to get started'}</p>`;
      list.appendChild(e);
    }
    return;
  }

  const existing = document.getElementById('list-empty');
  if (existing) existing.remove();

  list.innerHTML = filtered.map(t => `
    <button class="tcard ${t.id === state.selectedId ? 'selected' : ''}"
      data-id="${esc(t.id)}" data-priority="${esc(t.priority)}">
      <div class="tcard-top">
        <span class="tcard-num">${esc(t.ticketNumber)}</span>
        ${statusBadge(t.status)}
        ${priorityBadge(t.priority)}
      </div>
      <div class="tcard-summary">${esc(t.summary)}</div>
      <div class="tcard-meta">
        <span class="tcard-tag">${esc(t.category)}</span>
        <span class="tcard-tag">${esc(t.team)}</span>
        ${t.escalationNeeded ? '<span class="tcard-tag" style="color:var(--red);border-color:rgba(239,68,68,.3)">⚠ Escalate</span>' : ''}
        <span class="tcard-time">${timeAgo(t.createdAt)}</span>
      </div>
    </button>
  `).join('');
}

// ── Render: Analysis Card ─────────────────────────────────────────
// Zeigt das AI-Analyse-Ergebnis nach dem "Analyze"-Klick im Create-View
function renderAnalysisCard(a) {
  const card = document.getElementById('analysis-card');
  if (!card) return;
  const urgPct = Math.min(100, Math.max(0, a.urgency_score || 0));
  const confPct = Math.round((a.confidence || 0) * 100);

  card.innerHTML = `
    <div class="ac-header">
      <div class="ac-header-left">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1L9 5H13L10 8L11 13L7 10L3 13L4 8L1 5H5L7 1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        AI Analysis
        ${a.aiPowered ? badge('badge badge-ai', '✦ Claude') : badge('badge badge-rule', '⚙ Rule-based')}
      </div>
      <span class="ac-conf">Confidence ${confPct}%</span>
    </div>
    <div class="ac-grid">
      <div class="ac-row">
        <span class="ac-key">Category</span>
        <span class="ac-val">${esc(a.category)}${a.subcategory ? ` <span style="color:var(--tx-3)">· ${esc(a.subcategory)}</span>` : ''}</span>
      </div>
      <div class="ac-row">
        <span class="ac-key">Priority</span>
        <span class="ac-val">${priorityBadge(a.priority)}</span>
      </div>
      <div class="ac-row">
        <span class="ac-key">Sentiment</span>
        <span class="ac-val">${sentimentBadge(a.sentiment)}</span>
      </div>
      <div class="ac-row">
        <span class="ac-key">Team</span>
        <span class="ac-val">${esc(a.team)}</span>
      </div>
      <div class="ac-row span2" style="gap:10px">
        <span class="ac-key">Urgency</span>
        <div class="urgency-bar"><div class="urgency-fill" style="width:${urgPct}%"></div></div>
        <span class="ac-val" style="min-width:32px">${urgPct}%</span>
      </div>
      <div class="ac-row span2">
        <span class="ac-key">Est. Resolution</span>
        <span class="ac-val">${a.estimated_hours}h · ${a.escalation_needed ? '⚠ Escalation required' : 'No escalation'}</span>
      </div>
    </div>
    <div class="ac-summary">"${esc(a.summary)}"</div>
    ${a.tags?.length ? `<div class="ac-tags">${a.tags.map(tg => `<span class="ac-tag">${esc(tg)}</span>`).join('')}</div>` : ''}
    <div class="ac-action">
      <div class="ac-action-icon">→</div>
      <div class="ac-action-text">${esc(a.suggested_action)}</div>
    </div>
  `;
  card.style.display = '';
}

// ── Render: Ticket Detail ─────────────────────────────────────────
// Rendert die komplette Detailansicht: Kundennachricht, AI-Analyse, Reply, Notizen, Timeline
function renderDetail(ticket) {
  const view = document.getElementById('view-detail');
  if (!view) return;

  view.innerHTML = `
    <div class="dv-header">
      <div class="dv-header-top">
        <div style="flex:1">
          <div class="dv-num">${esc(ticket.ticketNumber)} · ${esc(ticket.category)}</div>
          <div class="dv-summary">${esc(ticket.summary)}</div>
        </div>
      </div>
      <div class="dv-badges">
        ${statusBadge(ticket.status)}
        ${priorityBadge(ticket.priority)}
        ${sentimentBadge(ticket.sentiment)}
        ${ticket.aiPowered ? badge('badge badge-ai', '✦ Claude') : badge('badge badge-rule', '⚙ Rule-based')}
        ${ticket.escalationNeeded ? `<span class="badge" style="background:var(--red-dim);color:var(--red);border-color:rgba(239,68,68,.25)">⚠ Escalation Required</span>` : ''}
      </div>
      <div class="dv-actions">
        <button class="btn-delete" id="btn-delete" title="Delete ticket">🗑 Delete</button>
        <select class="select-sm" id="sel-status" title="Change status">
          ${['open','in_progress','resolved'].map(s => `<option value="${s}" ${ticket.status===s?'selected':''}>${statusLabel[s]}</option>`).join('')}
        </select>
        <select class="select-sm" id="sel-priority" title="Change priority">
          ${['Low','Medium','High','Critical'].map(p => `<option value="${p}" ${ticket.priority===p?'selected':''}>${p}</option>`).join('')}
        </select>
        <select class="select-sm" id="sel-team" title="Assign team">
          ${['Support','Technical','Finance','Sales','Customer Success','Product'].map(t => `<option value="${t}" ${ticket.team===t?'selected':''}>${t}</option>`).join('')}
        </select>
        ${ticket.status !== 'resolved' ? `<button class="btn-success" id="btn-resolve">✓ Resolve</button>` : ''}
      </div>
      <div style="margin-top:6px; font-size:11px; color:var(--tx-3)">
        Created ${fmtDate(ticket.createdAt)} · Last updated ${timeAgo(ticket.updatedAt)}
      </div>
    </div>

    <div class="dv-body">

      <!-- Customer Message -->
      <div class="dv-section">
        <div class="dv-section-title">Customer Message</div>
        <div class="customer-msg">${esc(ticket.message)}</div>
      </div>

      <!-- AI Analysis -->
      <div class="dv-section">
        <div class="dv-section-title">AI Analysis</div>
        <div class="ai-summary-grid">
          <div class="ais-item"><div class="ais-label">Category</div><div class="ais-val">${esc(ticket.category)}</div></div>
          <div class="ais-item"><div class="ais-label">Team</div><div class="ais-val">${esc(ticket.team)}</div></div>
          <div class="ais-item"><div class="ais-label">Est. Resolution</div><div class="ais-val">${ticket.estimatedHours}h</div></div>
        </div>
        ${ticket.urgencyScore > 0 ? `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;color:var(--tx-3);min-width:56px">Urgency</span>
          <div class="urgency-bar"><div class="urgency-fill" style="width:${ticket.urgencyScore}%"></div></div>
          <span style="font-size:11.5px;color:var(--tx-2);min-width:32px">${ticket.urgencyScore}%</span>
        </div>` : ''}
        ${ticket.tags?.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px">${ticket.tags.map(tg => `<span class="ac-tag">${esc(tg)}</span>`).join('')}</div>` : ''}
        <div class="action-box">
          <span class="action-box-icon">→</span>
          <span>${esc(ticket.suggestedAction)}</span>
        </div>
        ${ticket.escalationNeeded ? `<div class="escalation-banner">⚠ This ticket requires escalation to management or a specialist team.</div>` : ''}
      </div>

      <!-- Reply -->
      <div class="dv-section">
        <div class="reply-header">
          <div class="dv-section-title" style="flex:1;margin-bottom:0">Reply</div>
          <button class="btn-generate" id="btn-gen-reply" ${ticket.status==='resolved'?'disabled':''}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1L9 5H13L10 8L11 13L7 10L3 13L4 8L1 5H5L7 1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            Generate with AI
          </button>
        </div>
        <textarea id="reply-ta" class="reply-ta" rows="6" placeholder="Type or generate a reply…" ${ticket.status==='resolved'?'disabled':''}>${esc(ticket.reply)}</textarea>
        <div class="reply-footer">
          <button class="copy-btn" id="btn-copy-reply">Copy</button>
          <button class="btn-secondary" id="btn-save-reply" ${ticket.status==='resolved'?'disabled':''}>Save Reply</button>
          ${ticket.status !== 'resolved' ? `<button class="btn-primary" id="btn-send-resolve">Send & Resolve</button>` : ''}
        </div>
      </div>

      <!-- Internal Notes -->
      <div class="dv-section">
        <div class="dv-section-title">Internal Notes</div>
        ${ticket.status !== 'resolved' ? `
        <div class="note-input-row">
          <input type="text" id="note-input" class="note-input" placeholder="Add an internal note…">
          <button class="btn-secondary" id="btn-add-note">Add Note</button>
        </div>` : ''}
        <div class="notes-list" id="notes-list">
          ${ticket.internalNotes.length === 0
            ? `<div style="font-size:12px;color:var(--tx-3);font-style:italic">No internal notes yet.</div>`
            : ticket.internalNotes.map(n => `
              <div class="note-item">
                <div class="note-item-header">
                  <span class="note-user">${esc(n.user)}</span>
                  <span class="note-time">${fmtDate(n.timestamp)}</span>
                </div>
                <div class="note-text">${esc(n.text)}</div>
              </div>`).join('')}
        </div>
      </div>

      <!-- History -->
      <div class="dv-section">
        <div class="dv-section-title">Activity Timeline</div>
        <div class="timeline">
          ${ticket.history.slice().reverse().map(h => `
            <div class="tl-item">
              <div class="tl-dot ${h.type}"></div>
              <div class="tl-content">
                <div class="tl-action">${esc(h.action)}</div>
                ${h.detail ? `<div class="tl-detail">${esc(h.detail)}</div>` : ''}
                <div class="tl-time">${fmtDate(h.timestamp)} · ${h.user}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>

    </div>
  `;

  bindDetailEvents(ticket);
}

// ── Detail Event Bindings ─────────────────────────────────────────
// Bindet alle Buttons/Dropdowns in der Detailansicht an ihre Aktionen
function bindDetailEvents(ticket) {

  // Ticket loeschen (mit Sicherheitsabfrage)
  document.getElementById('btn-delete')?.addEventListener('click', async () => {
    if (!confirm(`Ticket ${ticket.ticketNumber} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await API.delete(ticket.id);
      state.tickets = state.tickets.filter(t => t.id !== ticket.id);
      state.selectedId = null;
      showView('empty');
      renderList();
      const s = await API.stats();
      renderStats(s);
      toast(`${ticket.ticketNumber} gelöscht`);
    } catch {
      toast('Löschen fehlgeschlagen', 'error');
    }
  });

  // Status aendern per Dropdown (open/in_progress/resolved)
  document.getElementById('sel-status')?.addEventListener('change', async e => {
    ticket = await API.update(ticket.id, { status: e.target.value });
    updateTicketInState(ticket);
    renderAll();
    toast(`Status changed to ${statusLabel[e.target.value]}`);
  });

  // Prioritaet aendern per Dropdown
  document.getElementById('sel-priority')?.addEventListener('change', async e => {
    ticket = await API.update(ticket.id, { priority: e.target.value });
    updateTicketInState(ticket);
    renderAll();
    toast(`Priority set to ${e.target.value}`);
  });

  // Team zuweisen per Dropdown
  document.getElementById('sel-team')?.addEventListener('change', async e => {
    ticket = await API.update(ticket.id, { team: e.target.value });
    updateTicketInState(ticket);
    renderAll();
    toast(`Assigned to ${e.target.value}`);
  });

  // Ticket als geloest markieren
  document.getElementById('btn-resolve')?.addEventListener('click', async () => {
    ticket = await API.update(ticket.id, { status: 'resolved' });
    updateTicketInState(ticket);
    renderAll();
    toast('Ticket resolved ✓');
  });

  // Antwort speichern und gleichzeitig Ticket schliessen
  document.getElementById('btn-send-resolve')?.addEventListener('click', async () => {
    const reply = document.getElementById('reply-ta')?.value || '';
    ticket = await API.update(ticket.id, { reply, status: 'resolved' });
    updateTicketInState(ticket);
    renderAll();
    toast('Reply saved and ticket resolved ✓');
  });

  // Nur die Antwort speichern (ohne Ticket zu schliessen)
  document.getElementById('btn-save-reply')?.addEventListener('click', async () => {
    const reply = document.getElementById('reply-ta')?.value || '';
    await API.update(ticket.id, { reply });
    const t = state.tickets.find(t => t.id === ticket.id);
    if (t) t.reply = reply;
    toast('Reply saved');
  });

  // Antworttext in die Zwischenablage kopieren
  document.getElementById('btn-copy-reply')?.addEventListener('click', async () => {
    const text = document.getElementById('reply-ta')?.value || '';
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('btn-copy-reply');
      if (btn) { btn.textContent = '✓ Copied'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000); }
    } catch {
      toast('Copy failed — please select and copy manually', 'error');
    }
  });

  // AI-Antwort generieren lassen (per Streaming)
  document.getElementById('btn-gen-reply')?.addEventListener('click', async () => {
    await streamReply(ticket.id);
  });

  // Interne Notiz hinzufuegen (nur fuer Support-Team sichtbar)
  document.getElementById('btn-add-note')?.addEventListener('click', async () => {
    const input = document.getElementById('note-input');
    const text = input?.value?.trim();
    if (!text) return;
    const note = await API.addNote(ticket.id, text);
    if (input) input.value = '';
    const t = state.tickets.find(t => t.id === ticket.id);
    if (t) { t.internalNotes.push(note); t.history.push({ id: note.id, type:'note', action:'Internal note added', detail: text.slice(0,60), timestamp: new Date().toISOString(), user:'Agent' }); }
    // Re-render only the notes list
    const notesList = document.getElementById('notes-list');
    const curTicket = state.tickets.find(t => t.id === ticket.id);
    if (notesList && curTicket) {
      notesList.innerHTML = curTicket.internalNotes.map(n => `
        <div class="note-item">
          <div class="note-item-header"><span class="note-user">${esc(n.user)}</span><span class="note-time">${fmtDate(n.timestamp)}</span></div>
          <div class="note-text">${esc(n.text)}</div>
        </div>`).join('');
    }
    toast('Note added');
  });

  // Enter-Taste zum Absenden der Notiz
  document.getElementById('note-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('btn-add-note')?.click(); }
  });
}

// ── Streaming Reply ───────────────────────────────────────────────
// Empfaengt die AI-Antwort als Server-Sent Events und schreibt sie live ins Textfeld
async function streamReply(ticketId) {
  const ta  = document.getElementById('reply-ta');
  const btn = document.getElementById('btn-gen-reply');
  if (!ta || !btn) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Generating…`;
  ta.value = '';
  ta.classList.add('streaming');
  ta.disabled = false;

  try {
    const resp = await API.replyStream(ticketId);

    // Fallback: wenn kein API-Key, kommt JSON statt Stream zurueck
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await resp.json();
      ta.value = data.reply || '';
      ta.classList.remove('streaming');
      btn.disabled = false;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1L9 5H13L10 8L11 13L7 10L3 13L4 8L1 5H5L7 1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg> Regenerate`;
      return;
    }

    // SSE-Stream lesen: Text kommt stueckweise an und wird sofort angezeigt
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') break;
        try {
          const { text, error } = JSON.parse(payload);
          if (error) { toast(error, 'error'); break; }
          if (text) { ta.value += text; ta.scrollTop = ta.scrollHeight; }
        } catch { /* ignore parse errors */ }
      }
    }
  } catch (err) {
    toast('Failed to generate reply', 'error');
  } finally {
    ta.classList.remove('streaming');
    btn.disabled = false;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1L9 5H13L10 8L11 13L7 10L3 13L4 8L1 5H5L7 1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg> Regenerate`;
  }
}

// ── View management ───────────────────────────────────────────────
// Steuert welche der drei Views sichtbar ist: empty, create oder detail
function showView(name) {
  const views = { empty: 'view-empty', create: 'view-create', detail: 'view-detail' };
  Object.entries(views).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (k === name) ? '' : 'none';
  });
}

// Wechselt zum Erstell-Formular und setzt alle Felder zurueck
function showCreateView() {
  showView('create');
  state.selectedId = null;
  state.analysis = null;
  document.getElementById('msg-input').value = '';
  document.getElementById('analysis-card').style.display = 'none';
  document.getElementById('create-footer').style.display = 'none';
  renderList();
}

function showDetailView(ticket) {
  showView('detail');
  renderDetail(ticket);
}

// ── State helpers ─────────────────────────────────────────────────
// Aktualisiert ein Ticket im lokalen State-Array nach Server-Update
function updateTicketInState(updated) {
  const i = state.tickets.findIndex(t => t.id === updated.id);
  if (i !== -1) state.tickets[i] = updated;
}

// Komplettes Re-Render: Liste, Stats und ggf. Detailansicht
function renderAll() {
  renderList();
  API.stats().then(renderStats);
  if (state.selectedId) {
    const t = state.tickets.find(t => t.id === state.selectedId);
    if (t) showDetailView(t);
  }
}

// ── Init ──────────────────────────────────────────────────────────
// Wird beim Laden der Seite aufgerufen: prueft AI-Status, laedt Tickets, bindet Events
async function init() {
  // Pruefen ob der Server laeuft und ob Claude AI verfuegbar ist
  try {
    const h = await API.health();
    state.aiEnabled = h.aiEnabled;
    const dot   = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const badge = document.getElementById('brand-ai');
    if (h.aiEnabled) {
      if (dot)   dot.className   = 'status-dot online';
      if (label) label.textContent = 'Claude AI Online';
    } else {
      if (dot)   dot.className   = 'status-dot offline';
      if (label) label.textContent = 'Rule-based Mode';
      if (badge) badge.classList.add('offline');
    }
  } catch {
    const dot   = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    if (dot)   dot.className   = 'status-dot offline';
    if (label) label.textContent = 'Server offline';
  }

  // Alle existierenden Tickets vom Server laden
  try {
    state.tickets = await API.tickets();
    renderList();
    const s = await API.stats();
    renderStats(s);
  } catch { /* page opened directly without server */ }

  // Alle globalen Event-Listener registrieren
  bindGlobalEvents();
}

// Registriert Events die auf der ganzen Seite gelten (Buttons, Sidebar, Suche, Shortcuts)
function bindGlobalEvents() {

  // "New Ticket"-Buttons (Header + Hero)
  document.getElementById('btn-new')?.addEventListener('click', showCreateView);
  document.getElementById('btn-hero-create')?.addEventListener('click', showCreateView);

  // Abbrechen: zurueck zur vorherigen Ansicht
  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    state.selectedId ? showDetailView(state.tickets.find(t => t.id === state.selectedId)) : showView('empty');
  });

  // Beispiel-Chips: fuellen das Textfeld mit einer Beispielnachricht
  document.querySelectorAll('.ex-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('msg-input');
      if (input) input.value = EXAMPLES[btn.dataset.ex] || '';
    });
  });

  // "Analyze with AI"-Button: schickt Nachricht ans Backend fuer AI-Klassifizierung
  document.getElementById('btn-analyze')?.addEventListener('click', async () => {
    const msg = document.getElementById('msg-input')?.value?.trim();
    if (!msg) { toast('Please enter a customer message first', 'error'); return; }

    const btn = document.getElementById('btn-analyze');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Analyzing…`;

    try {
      state.analysis = await API.analyze(msg);
      renderAnalysisCard(state.analysis);
      document.getElementById('create-footer').style.display = '';
    } catch {
      toast('Analysis failed — please try again', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L9 5H13L10 8L11 13L7 10L3 13L4 8L1 5H5L7 1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg> Analyze with AI`;
    }
  });

  // Ticket erstellen: schickt Nachricht + Analyse-Ergebnis ans Backend
  document.getElementById('btn-create')?.addEventListener('click', async () => {
    const msg = document.getElementById('msg-input')?.value?.trim();
    if (!msg) { toast('Please enter a customer message', 'error'); return; }

    const btn = document.getElementById('btn-create');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      const ticket = await API.create({ message: msg, analysis: state.analysis });
      state.tickets.unshift(ticket);
      state.selectedId = ticket.id;
      showDetailView(ticket);
      renderList();
      const s = await API.stats();
      renderStats(s);
      toast(`${ticket.ticketNumber} created`);
    } catch {
      toast('Failed to create ticket', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Ticket →';
    }
  });

  // Klick auf eine Ticket-Karte: oeffnet die Detailansicht
  document.getElementById('ticket-list')?.addEventListener('click', e => {
    const card = e.target.closest('.tcard');
    if (!card) return;
    const id = card.dataset.id;
    state.selectedId = id;
    const ticket = state.tickets.find(t => t.id === id);
    if (ticket) showDetailView(ticket);
    renderList();
  });

  // Sidebar-Filter: aktiven Filter setzen und Liste neu rendern
  document.querySelectorAll('.snav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.snav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter     = btn.dataset.filter;
      state.filterType = btn.dataset.ftype || 'status';
      renderList();
    });
  });

  // Suche mit Debounce (180ms Verzoegerung, damit nicht bei jedem Tastendruck gesucht wird)
  let searchTimer;
  document.getElementById('search')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; renderList(); }, 180);
  });

  // Escape-Taste: Create-View verlassen
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const createView = document.getElementById('view-create');
      if (createView && createView.style.display !== 'none') {
        state.selectedId ? showDetailView(state.tickets.find(t => t.id === state.selectedId)) : showView('empty');
      }
    }
  });

  // Stats alle 30 Sekunden automatisch aktualisieren
  setInterval(async () => {
    try { renderStats(await API.stats()); } catch { /* ignore */ }
  }, 30000);
}

// ── Boot ─────────────────────────────────────────────────────────
// App starten sobald das Script geladen ist
init();
