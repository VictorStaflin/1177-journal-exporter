// 1177 Journal Exporter — Content Script
// Scrapes journal/journal entries from the 1177.se patient journal portal

(function () {
  'use strict';

  if (window.has1177ExporterInjected) {
    console.log('1177 Journal Exporter: Already injected in this page.');
    return;
  }
  window.has1177ExporterInjected = true;

  // ─── Selectors tuned for Journalen / 1177 e-tjänster ────────────────────────
  // 1177's journal portal is rendered server-side with fairly stable class names.
  // We try multiple selector strategies so the extension stays robust across
  // minor redesigns.

  const SELECTORS = {
    // Individual journal entry / visit note containers
    entryContainers: [
      'li.nc-list-post',
      '.nc-list-post',
      'article.journal-entry',
      '[class*="journalentry"]',
      '[class*="journal-entry"]',
      '[class*="journalanteckning"]',
      '[data-testid*="journal"]',
      '.oe-journal-entry',
      '.journal__entry',
      'section.entry',
      '.timeline-item',
    ],
    // Entry heading / title
    entryTitle: [
      'h1', 'h2', 'h3',
      '[class*="title"]',
      '[class*="rubrik"]',
      '[class*="heading"]',
    ],
    // Date / timestamp
    entryDate: [
      'time',
      '[datetime]',
      '[class*="date"]',
      '[class*="datum"]',
      '[class*="timestamp"]',
    ],
    // Author / care-giver
    entryAuthor: [
      '[class*="author"]',
      '[class*="author"]',
      '[class*="signatory"]',
      '[class*="utfardare"]',
      '[class*="lakare"]',
    ],
    // Body / note text
    entryBody: [
      '.nc-list-post-container',
      '[class*="list-post-container"]',
      '[class*="body"]',
      '[class*="content"]',
      '[class*="text"]',
      '[class*="anteckning"]',
      'p',
    ],
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function firstText(el, selectors) {
    for (const sel of selectors) {
      const found = el.querySelector(sel);
      if (found && found.textContent.trim()) {
        return found.textContent.trim();
      }
    }
    return '';
  }

  function allText(el, selectors) {
    for (const sel of selectors) {
      const nodes = el.querySelectorAll(sel);
      if (nodes.length) {
        return Array.from(nodes)
          .map(n => n.textContent.trim())
          .filter(Boolean)
          .join('\n');
      }
    }
    return el.textContent.trim();
  }

  function getDateValue(el) {
    const timeEl = el.querySelector('time');
    if (timeEl) {
      return timeEl.getAttribute('datetime') || timeEl.textContent.trim();
    }
    for (const sel of SELECTORS.entryDate.slice(1)) {
      const found = el.querySelector(sel);
      if (found) return found.getAttribute('datetime') || found.textContent.trim();
    }
    return '';
  }

  // ─── Find all entry containers ───────────────────────────────────────────────

  // ─── Metadata parsing from aria-label (for nc-list-post structure) ───────────

  function parseAriaLabel(label) {
    if (!label) return null;
    // Match "Datum <date>, anteckningstyp <type>, antecknad av <author>."
    const match = label.match(/Datum\s+([^,]+),\s+anteckningstyp\s+([^,]+),\s+antecknad\s+av\s+([^.]+)/i);
    if (match) {
      return {
        date: match[1].trim(),
        title: match[2].trim(),
        author: match[3].trim()
      };
    }
    return null;
  }

  function cleanText(text) {
    if (!text) return '';
    return text
      .split('\n')
      .map(line => line.trim())
      .filter((line, index, arr) => {
        if (line === '') {
          // Allow at most one consecutive empty line for paragraph grouping, skip any duplicates
          return index > 0 && arr[index - 1].trim() !== '';
        }
        return true;
      })
      .join('\n')
      .trim();
  }

  function getEntryBody(el) {
    const clone = el.cloneNode(true);
    // Remove expander buttons to prevent duplicate text in body
    const buttons = clone.querySelectorAll('.nc-list-post-expander, button, [role="button"]');
    buttons.forEach(btn => btn.remove());
    
    // Remove metadata elements if we can find them
    const metaElements = clone.querySelectorAll('.meta, .DocumentTime, [class*="date"], [class*="datum"], [class*="author"]');
    metaElements.forEach(meta => meta.remove());

    // Extract remaining text
    for (const sel of SELECTORS.entryBody) {
      const found = clone.querySelectorAll(sel);
      if (found.length) {
        const text = Array.from(found)
          .map(n => n.textContent.trim())
          .filter(Boolean)
          .join('\n');
        if (text) return cleanText(text);
      }
    }
    return cleanText(clone.textContent);
  }

  // ─── Automated Load All ──────────────────────────────────────────────────────

  async function loadAllEntries() {
    const loadAllSelectors = [
      '.load-all',
      'button.load-all',
      'a.load-all',
      '.load-all.ic-link',
      '[class*="load-all"]',
      'button.visa-alla',
      'a.visa-alla',
    ];
    
    let clicked = false;
    for (const selector of loadAllSelectors) {
      const btn = document.querySelector(selector);
      if (btn) {
        console.log(`1177 Journal Exporter: Found load-all button with selector: ${selector}, clicking...`);
        btn.click();
        clicked = true;
        // Wait for entries to load from network
        await new Promise(resolve => setTimeout(resolve, 1500));
        break;
      }
    }
    return clicked;
  }

  // ─── Automated Expander ──────────────────────────────────────────────────────

  async function expandAllEntries(delayMs = 250) {
    // 1. Try to click "Visa alla" / "Load all" button first to load all items into DOM
    try {
      const loadedMore = await loadAllEntries();
      if (loadedMore) {
        chrome.runtime.sendMessage({
          action: 'expand_progress',
          statusText: 'Laddar in alla journalanteckningar från servern...',
          current: 10,
          total: 100
        }).catch(() => {});
        // Wait a little extra for the server response to fully render elements in the DOM
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    } catch (e) {
      console.error('Error loading all entries:', e);
    }

    // 2. Find all expander buttons that are currently collapsed
    const expanders = Array.from(document.querySelectorAll('button.nc-list-post-expander[aria-expanded="false"], .nc-list-post-expander[aria-expanded="false"]'));
    
    // If none are found, let's also check for general buttons that might have aria-expanded="false"
    if (expanders.length === 0) {
      const generalButtons = document.querySelectorAll('button[aria-expanded="false"], [role="button"][aria-expanded="false"]');
      // Filter to only include buttons that are actually expanders (having chevron or specific classes)
      const likelyExpanders = Array.from(generalButtons).filter(btn => {
        const classStr = btn.className || '';
        const ariaLabel = btn.getAttribute('aria-label') || '';
        return classStr.includes('expander') || 
               classStr.includes('post') || 
               ariaLabel.includes('Klicka') || 
               ariaLabel.includes('detaljer') || 
               btn.querySelector('svg, .chevron, i');
      });
      expanders.push(...likelyExpanders);
    }

    if (expanders.length === 0) {
      return { total: 0, expanded: 0 };
    }

    const total = expanders.length;
    let expanded = 0;

    // Use a sliding worker pool of concurrent expansion tasks.
    // A concurrency limit of 5 speeds up the expansion by ~5x without exceeding 
    // standard browser HTTP connection limits (usually 6) or triggering platform rate limits.
    const CONCURRENCY_LIMIT = 5;
    let index = 0;

    async function worker() {
      while (index < total) {
        const currentIndex = index++;
        if (currentIndex >= total) break;

        const btn = expanders[currentIndex];
        btn.click();
        expanded++;

        // Send progress update to popup
        try {
          chrome.runtime.sendMessage({
            action: 'expand_progress',
            current: expanded,
            total: total
          }).catch(() => {});
        } catch (e) {}

        // Add a small stagger delay inside each worker slot to pace requests
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Launch workers in parallel
    const workers = [];
    const numWorkers = Math.min(CONCURRENCY_LIMIT, total);
    for (let i = 0; i < numWorkers; i++) {
      workers.push(worker());
    }

    // Wait for all workers to complete their jobs
    await Promise.all(workers);

    // Wait a little extra after the last click for the last dynamic entry to finish loading
    await new Promise(resolve => setTimeout(resolve, 800));

    return { total, expanded };
  }

  // ─── Find all entry containers ───────────────────────────────────────────────

  function findEntryContainers() {
    for (const sel of SELECTORS.entryContainers) {
      const results = document.querySelectorAll(sel);
      if (results.length > 0) return Array.from(results);
    }
    return [];
  }

  // ─── Parse a single entry ────────────────────────────────────────────────────

  function parseEntry(el) {
    let title = '';
    let date = '';
    let author = '';
    
    // Attempt to parse metadata from aria-label (extremely robust for nc-list-post)
    const expanderBtn = el.querySelector('.nc-list-post-expander') || 
                        el.closest('.nc-list-post-expander') || 
                        (el.tagName === 'BUTTON' && el.classList.contains('nc-list-post-expander') ? el : null);
    
    if (expanderBtn) {
      const labelData = parseAriaLabel(expanderBtn.getAttribute('aria-label'));
      if (labelData) {
        title = labelData.title;
        date = labelData.date;
        author = labelData.author;
      }
    }

    // Fallbacks if aria-label parsing failed or is incomplete
    if (!title)  title = firstText(el, SELECTORS.entryTitle) || 'Journal entry';
    if (!date)   date = getDateValue(el);
    if (!author) author = firstText(el, SELECTORS.entryAuthor);

    return {
      title,
      date,
      author,
      body: getEntryBody(el),
      html: el.innerHTML,
    };
  }

  // ─── Full-page fallback ───────────────────────────────────────────────────────
  // If we couldn't identify individual containers, grab the whole <main> text.

  function fullPageFallback() {
    const main = document.querySelector('main') || document.body;
    return [{
      title: document.title || 'Journal export',
      date: new Date().toISOString().slice(0, 10),
      author: '',
      body: main.innerText.trim(),
      html: main.innerHTML,
    }];
  }

  // ─── Export helpers ───────────────────────────────────────────────────────────

  function entriesToText(entries) {
    return entries.map(e => {
      const lines = [];
      lines.push('═'.repeat(60));
      lines.push(`📋  ${e.title}`);
      if (e.date)   lines.push(`📅  Datum: ${e.date}`);
      if (e.author) lines.push(`👤  Av:    ${e.author}`);
      lines.push('─'.repeat(60));
      lines.push(e.body);
      lines.push('');
      return lines.join('\n');
    }).join('\n');
  }

  function entriesToJSON(entries) {
    return JSON.stringify(entries.map(({ title, date, author, body }) => ({
      title, date, author, body
    })), null, 2);
  }

  function entriesToMarkdown(entries) {
    return entries.map(e => {
      const lines = [];
      lines.push(`# ${e.title}`);
      if (e.date)   lines.push(`- **Datum:** ${e.date}`);
      if (e.author) lines.push(`- **Antecknad av:** ${e.author}`);
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push(e.body);
      lines.push('');
      return lines.join('\n');
    }).join('\n\n');
  }

  function entriesToCSV(entries) {
    const bom = '\uFEFF';
    const headers = ['Datum', 'Typ/Rubrik', 'Antecknad av', 'Innehåll'];
    const rows = [headers];

    for (const e of entries) {
      const escape = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).trim();
        return '"' + str.replace(/"/g, '""') + '"';
      };
      rows.push([
        escape(e.date),
        escape(e.title),
        escape(e.author),
        escape(e.body)
      ]);
    }

    return bom + rows.map(r => r.join(',')).join('\r\n');
  }

  function formatBodyContent(bodyText) {
    if (!bodyText) return '';
    const lines = bodyText.split('\n');
    const formattedPieces = [];
    
    const knownHeaders = [
      'kontaktorsak', 'anamnes', 'status', 'bedömning', 'åtgärd', 'planering', 'behandling',
      'diagnos', 'läkemedel', 'ordination', 'sökord', 'aktuellt', 'bakgrund', 'vårdbegäran',
      'epikris', 'lokalt status', 'undersökning', 'laboratoriesvar', 'svar', 'kommentar',
      'signeringsstatus', 'undersökningsresultat', 'röntgensvar', 'vårdplan', 'patientinformation'
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const lowerLine = line.toLowerCase().replace(/:$/, '');
      const isKnownHeader = knownHeaders.includes(lowerLine);
      const endsWithColon = line.endsWith(':') && line.length < 50 && !/\d{1,2}:\d{2}/.test(line);

      if (isKnownHeader || endsWithColon) {
        const headerText = line.replace(/:$/, '');
        formattedPieces.push(`<h4 class="clinical-header">${escHtml(headerText)}</h4>`);
      } else {
        if (line.includes('  ') || line.includes('\t')) {
          formattedPieces.push(`<div class="clinical-data-row">${escHtml(line)}</div>`);
        } else {
          formattedPieces.push(`<p class="clinical-paragraph">${escHtml(line)}</p>`);
        }
      }
    }

    return formattedPieces.join('\n');
  }

  function entriesToHTML(entries) {
    const rows = entries.map((e, index) => {
      const metaItems = [];
      if (e.date) {
        metaItems.push(`
          <div class="meta-item">
            <span class="meta-label">Datum</span>
            <span class="meta-value">${escHtml(e.date)}</span>
          </div>
        `);
      }
      if (e.author) {
        metaItems.push(`
          <div class="meta-item">
            <span class="meta-label">Antecknad av</span>
            <span class="meta-value">${escHtml(e.author)}</span>
          </div>
        `);
      }

      const metaGrid = metaItems.length > 0 
        ? `<div class="entry-meta-grid">${metaItems.join('')}</div>`
        : '';

      return `
      <article class="entry" data-index="${index}" data-title="${escHtml(e.title)}" data-date="${escHtml(e.date)}" data-author="${escHtml(e.author)}">
        <div class="entry-header">
          <h2 class="entry-title">${escHtml(e.title)}</h2>
          ${metaGrid}
        </div>
        <div class="entry-body">${formatBodyContent(e.body)}</div>
      </article>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Journalutdrag — ${new Date().toLocaleDateString('sv-SE')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    :root {
      --primary: #005d6c; /* Deep Swedish healthcare teal */
      --primary-hover: #004b57;
      --accent: #0d9488;
      --accent-light: #f0fdfa;
      
      --bg-app: #f8fafc; /* Sleek warm slate background */
      --bg-card: #ffffff;
      --bg-sidebar: #ffffff;
      --border-color: #e2e8f0;
      
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-body: #334155;
      
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.05), 0 4px 6px -4px rgb(0 0 0 / 0.05);
      
      --radius-sm: 6px;
      --radius-md: 12px;
      --radius-lg: 16px;
      
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
    }

    body.dark-theme {
      --primary: #14b8a6; /* Glowing active teal in dark mode */
      --primary-hover: #2dd4bf;
      --accent: #14b8a6;
      --accent-light: #115e59;
      
      --bg-app: #090d16; /* Deep dark background */
      --bg-card: #111827;
      --bg-sidebar: #0f172a;
      --border-color: #1f2937;
      
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --text-body: #d1d5db;
      
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.3);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-app);
      color: var(--text-main);
      line-height: 1.6;
      padding: 0;
      transition: background-color 0.3s, color 0.3s;
    }

    /* ── Layout Grid ── */
    .app-layout {
      display: grid;
      grid-template-columns: 340px 1fr;
      min-height: 100vh;
      max-width: 1400px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
      gap: 3rem;
    }

    /* ── Sidebar Styling ── */
    .sidebar {
      position: relative;
    }
    
    .sidebar-sticky {
      position: sticky;
      top: 2.5rem;
      max-height: calc(100vh - 5rem);
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Brand Header */
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 0.25rem;
    }
    
    .medical-icon {
      width: 32px;
      height: 32px;
      color: var(--primary);
      background: var(--accent-light);
      padding: 6px;
      border-radius: 8px;
      flex-shrink: 0;
    }
    
    .brand-text h2 {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-main);
      letter-spacing: -0.02em;
    }
    
    .brand-text p {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Controls Container */
    .controls-card {
      background: var(--bg-sidebar);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    /* Search Box */
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    
    .search-icon {
      position: absolute;
      left: 12px;
      width: 18px;
      height: 18px;
      color: var(--text-muted);
    }
    
    .search-box input {
      width: 100%;
      padding: 0.75rem 0.75rem 0.75rem 2.5rem;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-app);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    
    .search-box input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--accent-light);
    }

    /* Filter Select */
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .control-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    
    .filter-group select {
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-app);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.9rem;
      outline: none;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 16px;
      padding-right: 2.5rem;
      transition: border-color 0.2s;
    }
    
    .filter-group select:focus {
      border-color: var(--primary);
    }

    /* Buttons Row */
    .button-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    
    .control-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0.6rem;
      background: var(--bg-app);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s, border-color 0.2s;
    }
    
    .control-btn:hover {
      background: var(--border-color);
    }
    
    .btn-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* Primary Action Print Button */
    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0.8rem;
      background: var(--primary);
      border: none;
      border-radius: var(--radius-sm);
      color: #ffffff;
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: background-color 0.2s, transform 0.1s;
    }
    
    .action-btn:hover {
      background: var(--primary-hover);
    }
    
    .action-btn:active {
      transform: scale(0.98);
    }

    /* Statistics panel */
    .stats-panel {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-muted);
      text-align: center;
      padding: 0.25rem 0;
    }

    /* Privacy and safety Notice */
    .privacy-card {
      background: var(--bg-sidebar);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    
    .privacy-header {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--primary);
    }
    
    .privacy-header h3 {
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .privacy-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    
    .privacy-card p {
      color: var(--text-muted);
    }

    /* Timeline Navigation */
    .nav-timeline-header {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-top: 0.5rem;
      margin-bottom: -0.5rem;
    }
    
    .nav-timeline {
      flex: 1;
      overflow-y: auto;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background: var(--bg-sidebar);
      padding: 1rem;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .timeline-nav-item {
      display: flex;
      gap: 12px;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      transition: background-color 0.2s;
    }
    
    .timeline-nav-item:hover {
      background-color: var(--bg-app);
    }
    
    .timeline-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--border-color);
      margin-top: 6px;
      position: relative;
      flex-shrink: 0;
    }
    
    .timeline-nav-item:hover .timeline-dot {
      background-color: var(--primary);
    }
    
    .timeline-content {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    
    .timeline-date {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    
    .timeline-title {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Main Panel Styling ── */
    .main-content {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Document Header inside Main Content */
    header.doc-header {
      background: var(--bg-sidebar);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 1.5rem 2rem;
      box-shadow: var(--shadow-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .doc-title-area h1 {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--primary);
      letter-spacing: -0.02em;
    }
    
    .doc-title-area p {
      font-size: 0.9rem;
      color: var(--text-muted);
      margin-top: 2px;
    }
    
    .doc-warning-tag {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--primary);
      background-color: var(--accent-light);
      padding: 6px 12px;
      border-radius: 30px;
    }

    /* List of entries */
    .entries-list {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Redesigned Journal Entry Card */
    article.entry {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 2.25rem;
      box-shadow: var(--shadow-md);
      position: relative;
      overflow: hidden;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
      scroll-margin-top: 2.5rem;
    }
    
    article.entry::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 5px;
      background-color: var(--primary);
      opacity: 0.8;
    }
    
    article.entry:hover {
      box-shadow: var(--shadow-lg);
      border-color: var(--primary);
    }
    
    article.entry.hidden {
      display: none !important;
    }

    /* Highlight Flash animation when clicking Quick Link */
    @keyframes flash-highlight {
      0% { border-color: var(--primary); box-shadow: 0 0 0 4px var(--accent-light); }
      50% { border-color: var(--primary); box-shadow: 0 0 0 4px var(--accent-light); }
      100% { border-color: var(--border-color); box-shadow: var(--shadow-md); }
    }
    
    article.entry.highlight-flash {
      animation: flash-highlight 1.5s ease-out;
    }

    .entry-header {
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1.25rem;
      margin-bottom: 1.75rem;
    }

    .entry-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 0.75rem;
      letter-spacing: -0.01em;
    }

    /* Metadata Grid */
    .entry-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    
    .meta-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.05em;
    }
    
    .meta-value {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-main);
    }

    /* Body text parsing styles */
    .entry-body {
      font-size: 0.95rem;
      color: var(--text-body);
      line-height: 1.75;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    /* Formatted subheaders in body */
    .clinical-header {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--primary);
      margin-top: 1rem;
      margin-bottom: 0.25rem;
      letter-spacing: -0.01em;
      border-bottom: 1px dashed var(--border-color);
      padding-bottom: 4px;
      text-transform: capitalize;
    }
    
    .entry-body > .clinical-header:first-child {
      margin-top: 0;
    }

    .clinical-paragraph {
      margin: 0;
    }

    /* Monospace style for aligned diagnostic tables */
    .clinical-data-row {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      background-color: var(--bg-app);
      color: var(--text-body);
      padding: 0.6rem 0.9rem;
      border-radius: var(--radius-sm);
      white-space: pre-wrap;
      margin-bottom: 0.25rem;
      border-left: 3px solid var(--primary);
      box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.02);
    }

    /* ── Responsive Styling ── */
    @media (max-width: 1023px) {
      .app-layout {
        grid-template-columns: 1fr;
        padding: 1.25rem;
        gap: 1.5rem;
      }
      
      .sidebar-sticky {
        position: relative;
        top: 0;
        max-height: none;
      }
      
      .nav-timeline, .nav-timeline-header {
        display: none !important;
      }
      
      article.entry {
        padding: 1.5rem;
      }
    }

    /* ── Pure Clean Print Styling ── */
    @media print {
      body, body.dark-theme {
        background-color: #ffffff !important;
        color: #000000 !important;
        padding: 0 !important;
        --text-main: #000000;
        --text-muted: #475569;
        --text-body: #000000;
        --border-color: #cbd5e1;
      }
      
      .sidebar, .privacy-card {
        display: none !important;
      }
      
      .app-layout {
        display: block !important;
        max-width: 100% !important;
        padding: 0 !important;
        gap: 0 !important;
      }
      
      header.doc-header {
        border: none !important;
        border-bottom: 2px solid #000000 !important;
        box-shadow: none !important;
        padding: 0 0 1rem 0 !important;
        margin-bottom: 2rem !important;
        border-radius: 0 !important;
        background: none !important;
      }
      
      .doc-title-area h1 {
        color: #000000 !important;
        font-size: 2rem !important;
      }
      
      .doc-warning-tag {
        border: 1px solid #000000 !important;
        background: none !important;
        color: #000000 !important;
      }

      article.entry {
        border: none !important;
        border-bottom: 1px dashed #94a3b8 !important;
        border-radius: 0 !important;
        padding: 1.5rem 0 !important;
        box-shadow: none !important;
        margin-bottom: 0 !important;
        page-break-inside: avoid !important;
        background: transparent !important;
      }
      
      article.entry::before {
        display: none !important;
      }

      .entry-header {
        border-bottom: 1px solid #cbd5e1 !important;
        padding-bottom: 0.75rem !important;
        margin-bottom: 1rem !important;
      }

      .entry-title {
        color: #000000 !important;
        font-size: 1.25rem !important;
      }

      .meta-value {
        color: #000000 !important;
      }

      .clinical-header {
        color: #000000 !important;
        border-bottom-color: #cbd5e1 !important;
      }

      .clinical-data-row {
        background-color: #f1f5f9 !important;
        color: #000000 !important;
        border-left: 2px solid #000000 !important;
      }
    }
  </style>
</head>
<body>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-sticky">
        <div class="brand">
          <svg class="medical-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div class="brand-text">
            <h2>Patientjournal</h2>
            <p>Säker export från 1177 (av <a href="https://github.com/VictorStaflin" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Victor Staflin</a>)</p>
          </div>
        </div>
        
        <div class="controls-card">
          <div class="search-box">
            <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" id="search-input" placeholder="Sök i anteckningar...">
          </div>
          
          <div class="filter-group">
            <label class="control-label" for="category-filter">Anteckningstyp</label>
            <select id="category-filter">
              <option value="">Alla typer</option>
            </select>
          </div>
          
          <div class="button-row">
            <button id="sort-btn" class="control-btn" title="Sortera kronologiskt">
              <svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
              <span id="sort-btn-text">Nyast först</span>
            </button>
            <button id="theme-btn" class="control-btn" title="Växla ljus/mörkt läge">
              <svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span>Mörkt läge</span>
            </button>
          </div>
          
          <button id="print-btn" class="action-btn">
            <svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-3a2 2 0 00-2-2H9a2 2 0 00-2 2v3a2 2 0 002 2zm5-11h.01" />
            </svg>
            Skriv ut journal
          </button>
          
          <div class="stats-panel" id="stats-text">
            Visar 0 av 0 anteckningar
          </div>
        </div>
        
        <div class="privacy-card">
          <div class="privacy-header">
            <svg class="privacy-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3>Integritet &amp; Säkerhet</h3>
          </div>
          <p>Detta dokument innehåller känsliga person- och hälsouppgifter. Dela inte denna fil öppet.</p>
          <p>Om du planerar att analysera journaltexterna med AI-verktyg rekommenderas starkt att du använder lokala, självhostade AI-modeller (t.ex. via Ollama eller LM Studio) för att garantera att dina hälsodata förblir helt privata och inte delas med externa molntjänster.</p>
        </div>

        <h3 class="nav-timeline-header">Tidslinje</h3>
        <div class="nav-timeline" id="timeline-container">
          <!-- Dynamic nodes go here -->
        </div>
      </div>
    </aside>
    
    <main class="main-content">
      <header class="doc-header">
        <div class="doc-title-area">
          <h1>Journalutdrag</h1>
          <p>Utdraget genererades ${new Date().toLocaleDateString('sv-SE')}</p>
        </div>
        <span class="doc-warning-tag">Patientjournal</span>
      </header>
      
      <div class="entries-list">
        ${rows}
      </div>
    </main>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const searchInput = document.getElementById('search-input');
      const categoryFilter = document.getElementById('category-filter');
      const sortBtn = document.getElementById('sort-btn');
      const sortBtnText = document.getElementById('sort-btn-text');
      const printBtn = document.getElementById('print-btn');
      const statsText = document.getElementById('stats-text');
      const timelineContainer = document.getElementById('timeline-container');
      const entriesList = document.querySelector('.entries-list');
      const entries = Array.from(document.querySelectorAll('article.entry'));

      // Unique categories for filtering
      const categories = new Set();
      entries.forEach(entry => {
        const cat = entry.getAttribute('data-title');
        if (cat) categories.add(cat);
      });

      // Populate category filter dropdown
      Array.from(categories).sort().forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categoryFilter.appendChild(opt);
      });

      // Render vertical timeline navigation list
      function renderTimeline() {
        timelineContainer.innerHTML = '';
        
        // Get currently visible entries in active order
        const visibleEntries = entries.filter(entry => !entry.classList.contains('hidden'));
        
        if (visibleEntries.length === 0) {
          timelineContainer.innerHTML = '<div class="timeline-empty" style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:1rem 0;">Inga matchande anteckningar</div>';
          return;
        }

        visibleEntries.forEach(entry => {
          const title = entry.getAttribute('data-title') || 'Journalanteckning';
          const date = entry.getAttribute('data-date') || '';
          const index = entry.getAttribute('data-index');

          const item = document.createElement('div');
          item.className = 'timeline-nav-item';
          item.innerHTML = 
            '<div class="timeline-dot"></div>' +
            '<div class="timeline-content">' +
              '<span class="timeline-date">' + date + '</span>' +
              '<span class="timeline-title" title="' + title + '">' + title + '</span>' +
            '</div>';

          item.addEventListener('click', () => {
            const target = document.querySelector(\'article.entry[data-index="\' + index + \'"]\');
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              target.classList.remove('highlight-flash');
              // Trigger reflow to restart animation
              void target.offsetWidth;
              target.classList.add('highlight-flash');
            }
          });

          timelineContainer.appendChild(item);
        });
      }

      // Filter functionality
      function filterEntries() {
        const query = searchInput.value.toLowerCase().trim();
        const activeCat = categoryFilter.value;
        let visibleCount = 0;

        entries.forEach(entry => {
          const title = (entry.getAttribute('data-title') || '').toLowerCase();
          const body = entry.querySelector('.entry-body').textContent.toLowerCase();
          const author = (entry.getAttribute('data-author') || '').toLowerCase();
          const date = (entry.getAttribute('data-date') || '').toLowerCase();

          const matchesSearch = !query || 
            title.includes(query) || 
            body.includes(query) || 
            author.includes(query) || 
            date.includes(query);

          const matchesCat = !activeCat || entry.getAttribute('data-title') === activeCat;

          if (matchesSearch && matchesCat) {
            entry.classList.remove('hidden');
            visibleCount++;
          } else {
            entry.classList.add('hidden');
          }
        });

        statsText.textContent = "Visar " + visibleCount + " av " + entries.length + " anteckningar";
        renderTimeline();
      }

      // Sorting functionality
      let ascending = false; // Default: newest first.
      
      // Custom date parsing to handle YYYY-MM-DD or custom Swedish date formats robustly
      function parseEntryDate(dateStr) {
        if (!dateStr) return 0;
        const parts = dateStr.match(/(\\d{4})-(\\d{2})-(\\d{2})/);
        if (parts) {
          return new Date(parts[1], parts[2] - 1, parts[3]).getTime();
        }
        const parsed = Date.parse(dateStr);
        return isNaN(parsed) ? 0 : parsed;
      }

      function sortEntries() {
        ascending = !ascending;
        sortBtnText.textContent = ascending ? 'Äldst först' : 'Nyast först';
        
        // Sort array of DOM elements
        entries.sort((a, b) => {
          const dateA = parseEntryDate(a.getAttribute('data-date'));
          const dateB = parseEntryDate(b.getAttribute('data-date'));
          return ascending ? dateA - dateB : dateB - dateA;
        });

        // Re-append elements in sorted order
        entries.forEach(entry => entriesList.appendChild(entry));
        renderTimeline();
      }

      // Theme toggle persistent loading
      const themeBtn = document.getElementById('theme-btn');
      const themeText = themeBtn.querySelector('span');
      let currentTheme = localStorage.getItem('theme') || 'light';
      if (currentTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeText.textContent = 'Ljust läge';
      }
      themeBtn.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        currentTheme = isDark ? 'dark' : 'light';
        localStorage.setItem('theme', currentTheme);
        themeText.textContent = isDark ? 'Ljust läge' : 'Mörkt läge';
      });

      // Set up listeners
      searchInput.addEventListener('input', filterEntries);
      categoryFilter.addEventListener('change', filterEntries);
      sortBtn.addEventListener('click', sortEntries);
      printBtn.addEventListener('click', () => window.print());

      // Initialize view
      filterEntries();
    });
  </script>
</body>
</html>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = '1177-journal-export/' + filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  // ─── Message handler from popup ──────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ ok: true, url: location.href });
      return true;
    }

    if (message.action === 'scan') {
      const containers = findEntryContainers();
      const count = containers.length;
      const collapsedCount = document.querySelectorAll('button.nc-list-post-expander[aria-expanded="false"], .nc-list-post-expander[aria-expanded="false"]').length;
      sendResponse({ count, collapsedCount, url: location.href });
      return true;
    }

    if (message.action === 'expand_all') {
      expandAllEntries(message.delayMs || 200)
        .then(result => {
          sendResponse({ ok: true, ...result });
        })
        .catch(err => {
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    if (message.action === 'export') {
      try {
        let entries = findEntryContainers().map(parseEntry);
        if (!entries.length) entries = fullPageFallback();

        const dateStamp = new Date().toISOString().slice(0, 10);
        const format    = message.format || 'html';

        if (format === 'txt') {
          triggerDownload(entriesToText(entries), `1177-journal-${dateStamp}.txt`, 'text/plain;charset=utf-8');
        } else if (format === 'json') {
          triggerDownload(entriesToJSON(entries), `1177-journal-${dateStamp}.json`, 'application/json');
        } else if (format === 'md') {
          triggerDownload(entriesToMarkdown(entries), `1177-journal-${dateStamp}.md`, 'text/markdown;charset=utf-8');
        } else if (format === 'csv') {
          triggerDownload(entriesToCSV(entries), `1177-journal-${dateStamp}.csv`, 'text/csv;charset=utf-8');
        } else {
          triggerDownload(entriesToHTML(entries), `1177-journal-${dateStamp}.html`, 'text/html;charset=utf-8');
        }

        sendResponse({ ok: true, count: entries.length });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return true;
    }
  });

})();
