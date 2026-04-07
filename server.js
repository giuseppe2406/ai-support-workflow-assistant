// Express-Server, Anthropic SDK fuer Claude AI, UUID fuer Ticket-IDs
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// .env laden (ANTHROPIC_API_KEY muss da drin stehen, sonst Fallback-Modus)
dotenv.config();

// __dirname gibts in ES-Modules nicht nativ, deshalb manuell ableiten
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Anthropic-Client nur erstellen wenn API-Key vorhanden, sonst bleibt null (= Fallback-Modus)
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

app.use(express.json());
// Statische Dateien (index.html, style.css, app.js) direkt aus dem Projektordner ausliefern
app.use(express.static(path.join(__dirname)));

// ─── In-memory store ───────────────────────────────────────────────────────
// Keine Datenbank — Tickets leben nur im RAM (gehen bei Server-Neustart verloren)
let tickets = [];
let counter = 1000;                          // Zaehler fuer Ticket-Nummern (TKT-1001, TKT-1002, ...)
const newId  = () => `TKT-${++counter}`;
const now    = () => new Date().toISOString();

// ─── Health ────────────────────────────────────────────────────────────────
// Gibt dem Frontend Bescheid ob der Server laeuft und ob AI aktiv ist
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', aiEnabled: !!anthropic, model: 'claude-haiku-4-5' });
});

// ─── Stats ─────────────────────────────────────────────────────────────────
// Zaehlt Tickets nach Status und Prioritaet fuer die KPI-Anzeige in der Sidebar
app.get('/api/stats', (_req, res) => {
  res.json({
    total:       tickets.length,
    open:        tickets.filter(t => t.status === 'open').length,
    inProgress:  tickets.filter(t => t.status === 'in_progress').length,
    resolved:    tickets.filter(t => t.status === 'resolved').length,
    highPriority:tickets.filter(t => ['High','Critical'].includes(t.priority)).length,
    escalated:   tickets.filter(t => t.escalationNeeded).length,
  });
});

// ─── Ticket list ───────────────────────────────────────────────────────────
// Gibt einfach alle Tickets zurueck (kein Paging, reicht fuer Demo)
app.get('/api/tickets', (_req, res) => res.json(tickets));

// ─── AI Analyze ────────────────────────────────────────────────────────────
// Kernfunktion: analysiert Kundennachricht mit Claude AI (oder Fallback-Regeln)
app.post('/api/analyze', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  // Kein API-Key? Dann regelbasierte Analyse als Fallback
  if (!anthropic) return res.json({ ...ruleBasedAnalysis(message), aiPowered: false });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: 'You are a customer support ticket analyzer. Return ONLY valid JSON, no markdown, no extra text.',
      messages: [{
        role: 'user',
        content: `Analyze this customer support message:\n"${message}"\n\nReturn exactly this JSON (no markdown fences):\n{\n  "category": "Technical Support|Billing|Sales Inquiry|Complaint|Feature Request|General Inquiry",\n  "subcategory": "specific descriptive type",\n  "priority": "Low|Medium|High|Critical",\n  "sentiment": "Positive|Neutral|Frustrated|Angry|Urgent",\n  "urgency_score": 60,\n  "summary": "one-line summary max 80 chars",\n  "tags": ["tag1", "tag2"],\n  "team": "Support|Technical|Finance|Sales|Customer Success|Product",\n  "suggested_action": "actionable next step for support agent",\n  "escalation_needed": false,\n  "estimated_hours": 4,\n  "confidence": 0.88\n}`
      }]
    });

    // Manchmal liefert Claude Markdown-Fences mit — die muessen raus bevor wir JSON parsen
    let text = response.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    const analysis = JSON.parse(text);
    res.json({ ...analysis, aiPowered: true });
  } catch (err) {
    // Bei AI-Fehler: Fallback auf Regelwerk, damit die App trotzdem funktioniert
    console.error('Analysis error:', err.message);
    res.json({ ...ruleBasedAnalysis(message), aiPowered: false });
  }
});

// ─── Create ticket ─────────────────────────────────────────────────────────
// Neues Ticket anlegen: nimmt Nachricht + optionale AI-Analyse entgegen
app.post('/api/tickets', (req, res) => {
  const { message, analysis } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  // Ticket-Objekt zusammenbauen: AI-Daten uebernehmen oder Defaults setzen
  const ticket = {
    id:              uuidv4(),
    ticketNumber:    newId(),
    message:         message.trim(),
    category:        analysis?.category        || 'General Inquiry',
    subcategory:     analysis?.subcategory     || '',
    priority:        analysis?.priority        || 'Low',
    sentiment:       analysis?.sentiment       || 'Neutral',
    urgencyScore:    analysis?.urgency_score   || 0,
    summary:         analysis?.summary        || message.slice(0, 80).trim(),
    tags:            analysis?.tags           || [],
    team:            analysis?.team            || 'Support',
    suggestedAction: analysis?.suggested_action|| 'Review and respond to customer',
    escalationNeeded:analysis?.escalation_needed || false,
    estimatedHours:  analysis?.estimated_hours || 24,
    confidence:      analysis?.confidence     || 0,
    status:          'open',
    reply:           '',
    internalNotes:   [],
    history: [{
      id: uuidv4(), type: 'created',
      action: 'Ticket created',
      detail: `${analysis?.category || 'General Inquiry'} · ${analysis?.priority || 'Low'} priority`,
      timestamp: now(), user: 'System',
    }],
    aiPowered:  analysis?.aiPowered || false,
    createdAt:  now(),
    updatedAt:  now(),
  };

  tickets.unshift(ticket);
  res.status(201).json(ticket);
});

// ─── Delete ticket ─────────────────────────────────────────────────────────
// Ticket per ID aus dem Array entfernen
app.delete('/api/tickets/:id', (req, res) => {
  const idx = tickets.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  tickets.splice(idx, 1);
  res.json({ ok: true });
});

// ─── Update ticket ─────────────────────────────────────────────────────────
// Ticket teilweise aktualisieren (Status, Prioritaet, Team, Reply) — jede Aenderung wird in der History geloggt
app.patch('/api/tickets/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const { status, priority, team, reply } = req.body;

  if (status && status !== ticket.status) {
    ticket.history.push({ id: uuidv4(), type: 'status', action: `Status → ${status.replace('_', ' ')}`, detail: '', timestamp: now(), user: 'Agent' });
    ticket.status = status;
  }
  if (priority && priority !== ticket.priority) {
    ticket.history.push({ id: uuidv4(), type: 'priority', action: `Priority → ${priority}`, detail: '', timestamp: now(), user: 'Agent' });
    ticket.priority = priority;
  }
  if (team && team !== ticket.team) {
    ticket.history.push({ id: uuidv4(), type: 'assign', action: `Assigned to ${team}`, detail: '', timestamp: now(), user: 'Agent' });
    ticket.team = team;
  }
  if (reply !== undefined) ticket.reply = reply;

  ticket.updatedAt = now();
  res.json(ticket);
});

// ─── Internal note ─────────────────────────────────────────────────────────
// Interne Notiz an ein Ticket anhaengen (nur fuers Support-Team, nicht fuer Kunden)
app.post('/api/tickets/:id/notes', (req, res) => {
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const text = req.body.text?.trim();
  if (!text) return res.status(400).json({ error: 'Note text required' });

  const note = { id: uuidv4(), text, timestamp: now(), user: 'Agent' };
  ticket.internalNotes.push(note);
  ticket.history.push({
    id: uuidv4(), type: 'note', action: 'Internal note added',
    detail: text.slice(0, 60) + (text.length > 60 ? '…' : ''),
    timestamp: now(), user: 'Agent',
  });
  ticket.updatedAt = now();
  res.status(201).json(note);
});

// ─── Generate reply (streaming SSE) ───────────────────────────────────────
// Generiert eine Kundenantwort mit Claude AI und streamt sie als Server-Sent Events
app.post('/api/tickets/:id/generate-reply', async (req, res) => {
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  // Ohne API-Key: vorgefertigte Template-Antwort zurueckgeben
  if (!anthropic) return res.json({ reply: fallbackReply(ticket) });

  // SSE-Header setzen fuer Streaming (Antwort kommt stueckweise)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 450,
      system: `You are a professional customer support agent. Write empathetic, concise, and actionable replies.
Rules:
- Address the specific issue directly, be warm but professional
- 3–5 sentences max, no filler
- Never use [placeholder] text — write naturally
- End with a clear next step or resolution timeframe
- Sign off with "Best regards, Support Team"`,
      messages: [{
        role: 'user',
        content: `Write a support reply for this ${ticket.priority} priority ${ticket.category} ticket.\n\nCustomer message:\n"${ticket.message}"\n\nContext: Team=${ticket.team}, Sentiment=${ticket.sentiment}, Action=${ticket.suggestedAction}${ticket.escalationNeeded ? ', ESCALATION REQUIRED' : ''}\n\nWrite only the reply text.`
      }]
    });

    // Jedes Text-Fragment sofort an den Client weiterleiten
    stream.on('text', text => res.write(`data: ${JSON.stringify({ text })}\n\n`));
    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── Rule-based fallback ───────────────────────────────────────────────────
// Einfache Keyword-Erkennung als Alternative wenn kein API-Key vorhanden ist
function ruleBasedAnalysis(message) {
  const m = message.toLowerCase();
  // Regelwerk: je mehr Keywords matchen, desto hoeher der Score fuer die Kategorie
  const rules = [
    { kw: ['urgent','emergency','system down','outage','cannot access','completely broken'],      cat:'Technical Support', team:'Technical',        pri:'Critical', sent:'Urgent' },
    { kw: ['furious','outraged','unacceptable','terrible','disgusting','lawsuit'],                cat:'Complaint',         team:'Customer Success', pri:'High',     sent:'Angry' },
    { kw: ['complaint','unhappy','disappointed','frustrated','fed up','not satisfied'],           cat:'Complaint',         team:'Customer Success', pri:'High',     sent:'Frustrated' },
    { kw: ['charged twice','overcharged','wrong charge','duplicate charge','billing error'],      cat:'Billing',           team:'Finance',          pri:'High',     sent:'Frustrated' },
    { kw: ['refund','invoice','payment','receipt','billing','credit card'],                       cat:'Billing',           team:'Finance',          pri:'Medium',   sent:'Neutral' },
    { kw: ['locked out','cannot login','password reset','authentication','access denied'],        cat:'Technical Support', team:'Technical',        pri:'High',     sent:'Frustrated' },
    { kw: ['error','bug','not working','broken','crash','failed','malfunction','glitch'],         cat:'Technical Support', team:'Technical',        pri:'Medium',   sent:'Frustrated' },
    { kw: ['feature request','would be great','suggestion','idea','could you add'],               cat:'Feature Request',   team:'Product',          pri:'Low',      sent:'Neutral' },
    { kw: ['price','pricing','quote','how much','cost','discount','deal','offer'],                cat:'Sales Inquiry',     team:'Sales',            pri:'Low',      sent:'Neutral' },
    { kw: ['upgrade','enterprise plan','demo','trial','subscription','package'],                  cat:'Sales Inquiry',     team:'Sales',            pri:'Low',      sent:'Positive' },
  ];

  let best = null, bestScore = 0;
  for (const rule of rules) {
    const score = rule.kw.filter(k => m.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = rule; }
  }
  const r = best || { cat:'General Inquiry', team:'Support', pri:'Low', sent:'Neutral' };
  const urgMap = { Critical:90, High:65, Medium:40, Low:18 };
  const hrMap  = { Critical:1,  High:4,  Medium:24, Low:48 };
  return {
    category: r.cat, subcategory: '', priority: r.pri, sentiment: r.sent,
    urgency_score: urgMap[r.pri], summary: message.slice(0, 78).trim(),
    tags: [], team: r.team,
    suggested_action: `Review and ${r.pri === 'Critical' ? 'immediately escalate' : 'respond to'} this ${r.cat.toLowerCase()} ticket`,
    escalation_needed: r.pri === 'Critical',
    estimated_hours: hrMap[r.pri],
    confidence: bestScore > 0 ? 0.68 : 0.38,
  };
}

// Vorgefertigte Antwort-Templates je nach Ticket-Kategorie (wenn kein AI verfuegbar)
function fallbackReply(t) {
  const map = {
    'Complaint':         `Thank you for sharing your experience with us. I sincerely apologize — this is not the level of service we pride ourselves on. I've escalated your case directly to our ${t.team} team, who will review the full situation and reach out within 24 hours. We're committed to making this right.\n\nBest regards, Support Team`,
    'Billing':           `Thank you for reaching out about this billing concern. I completely understand how frustrating unexpected charges are, and resolving this is our priority. Our ${t.team} team will investigate your account and issue a full resolution within 1–2 business days. You'll receive a confirmation email once complete.\n\nBest regards, Support Team`,
    'Technical Support': `Thank you for reporting this issue. I've logged it as a ${t.priority} priority ticket with our ${t.team} team, who will investigate and provide a fix or workaround within ${t.estimatedHours} hours. In the meantime, try clearing your browser cache or using a different browser. We'll keep you updated throughout.\n\nBest regards, Support Team`,
    'Sales Inquiry':     `Thank you for your interest! Our ${t.team} team will reach out within one business day to schedule a personalized consultation and walk you through the options that best fit your needs. We look forward to finding the right solution for you.\n\nBest regards, Support Team`,
    'Feature Request':   `Thank you for this thoughtful suggestion! It's been submitted to our product team for review. While we can't guarantee every request makes the roadmap, all feedback is carefully evaluated. We'll notify you if this feature moves forward.\n\nBest regards, Support Team`,
  };
  return map[t.category] || `Thank you for contacting support. A member of our ${t.team} team will respond within ${t.estimatedHours} hours. We appreciate your patience.\n\nBest regards, Support Team`;
}

// ─── Start ─────────────────────────────────────────────────────────────────
// Server starten und anzeigen ob AI-Modus oder Fallback aktiv ist
app.listen(PORT, () => {
  console.log(`\n  AI Support Workflow Assistant`);
  console.log(`  URL:  http://localhost:${PORT}`);
  console.log(`  Mode: ${anthropic ? '✓ Claude AI (claude-haiku-4-5 / claude-opus-4-6)' : '⚠ Rule-based fallback (add ANTHROPIC_API_KEY to .env)'}\n`);
});
