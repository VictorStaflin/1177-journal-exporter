// 1177 Journal Exporter — Popup Script

const statusBanner     = document.getElementById('status-banner');
const statusDot        = document.getElementById('status-dot');
const statusText       = document.getElementById('status-text');

// ── Step Cards & Badges ──────────────────────────────────────────────────────
const step1Card        = document.getElementById('step1-card');
const step2Card        = document.getElementById('step2-card');
const step3Card        = document.getElementById('step3-card');
const step1Badge       = document.getElementById('step1-badge');
const step2Badge       = document.getElementById('step2-badge');
const step3Badge       = document.getElementById('step3-badge');

// ── Actions & Buttons ────────────────────────────────────────────────────────
const expandBtn        = document.getElementById('expand-btn');
const expandLabel      = document.getElementById('expand-label');
const exportBtn        = document.getElementById('export-btn');
const btnLabel         = document.getElementById('btn-label');

const progressContainer = document.getElementById('progress-container');
const progressStatus    = document.getElementById('progress-status');
const progressPercent   = document.getElementById('progress-percent');
const progressBarFill   = document.getElementById('progress-bar-fill');

// ── Format picker ─────────────────────────────────────────────────────────────
let selectedFormat = 'md'; // Markdown as the recommended AI-default format

document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const radio = btn.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    
    selectedFormat = btn.dataset.format;
  });
});

// ── Status helpers ─────────────────────────────────────────────────────────────
function setStatus(dotClass, text, type = '') {
  statusDot.className = 'status-dot ' + dotClass;
  statusText.textContent = text;
  statusBanner.className = type;
}

// ── Inject helper ─────────────────────────────────────────────────────────────
async function ensureContentScriptInjected(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.ok) {
      console.log('Content script already responding.');
      return;
    }
  } catch (err) {
    // Not responding, we need to inject
    console.log('Content script not responding, injecting...');
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js'],
    });
    // Brief sleep to allow context initialization
    await new Promise(r => setTimeout(r, 60));
  } catch (err) {
    console.error('Failed to inject content script:', err);
  }
}

// ── Step Highlighting Controller ──────────────────────────────────────────────
function updateActiveSteps(collapsedCount, count, isPageValid) {
  if (!isPageValid) {
    step1Card.classList.remove('active');
    step2Card.classList.remove('active');
    step3Card.classList.remove('active');
    step1Badge.textContent = '1';
    step2Badge.textContent = '2';
    step3Badge.textContent = '3';
    step1Badge.className = 'step-badge';
    step2Badge.className = 'step-badge';
    step3Badge.className = 'step-badge';
    return;
  }

  // Step 1 is always active if page is valid
  step1Card.classList.add('active');
  step1Badge.className = 'step-badge';
  step1Badge.textContent = '1';

  if (collapsedCount > 0) {
    // We have collapsed entries, so Step 2 is active and needs attention
    step2Card.classList.add('active');
    step2Badge.className = 'step-badge';
    step2Badge.textContent = '2';

    // Step 3 is inactive
    step3Card.classList.remove('active');
    step3Badge.className = 'step-badge';
    step3Badge.textContent = '3';
  } else if (count > 0) {
    // No collapsed entries, and we have open entries! Step 2 is completed.
    step2Card.classList.remove('active');
    step2Badge.className = 'step-badge completed';
    step2Badge.textContent = '✓';

    // Step 3 is active and highlighted
    step3Card.classList.add('active');
    step3Badge.className = 'step-badge';
    step3Badge.textContent = '3';
  } else {
    // Valid page but no entries found yet
    step2Card.classList.remove('active');
    step2Badge.className = 'step-badge';
    step2Badge.textContent = '2';

    step3Card.classList.remove('active');
    step3Badge.className = 'step-badge';
    step3Badge.textContent = '3';
  }
}

// ── Check active tab ──────────────────────────────────────────────────────────
async function checkPage() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    setStatus('error', 'Kunde inte läsa fliken.', 'error');
    updateActiveSteps(0, 0, false);
    return;
  }

  const url = tab.url || '';
  const isCorrectPage = url.startsWith('https://journalen.1177.se/JournalCategories/CareDocumentation');

  if (!isCorrectPage) {
    setStatus(
      'error',
      'Öppna journalsidan (CareDocumentation) på journalen.1177.se för att exportera.',
      'error'
    );
    expandBtn.disabled = true;
    exportBtn.disabled = true;
    updateActiveSteps(0, 0, false);
    return;
  }

  // Inject content script if not yet present, then scan
  await ensureContentScriptInjected(tab.id);

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { action: 'scan' });
  } catch {
    setStatus('info', 'Navigera till journalsidan och försök igen.', '');
    expandBtn.disabled = true;
    exportBtn.disabled = true;
    updateActiveSteps(0, 0, false);
    return;
  }

  if (response) {
    const count = response.count || 0;
    const collapsedCount = response.collapsedCount || 0;

    updateActiveSteps(collapsedCount, count, true);

    if (collapsedCount > 0) {
      setStatus(
        'info',
        `Hittade ${collapsedCount} dolda anteckning${collapsedCount !== 1 ? 'ar' : ''}. Klicka på Steg 2 först!`,
        ''
      );
      expandBtn.disabled = false;
      exportBtn.disabled = false; // Allow export of whatever is loaded, but prompt to expand first
    } else if (count > 0) {
      setStatus(
        'success',
        `Hittade ${count} öppna poster. Redo att spara!`,
        'success'
      );
      expandBtn.disabled = true;
      exportBtn.disabled = false;
    } else {
      setStatus(
        'info',
        'Inga journalposter hittades. Se till att du är på sidan där dina journalanteckningar visas.',
        ''
      );
      expandBtn.disabled = true;
      exportBtn.disabled = true;
    }
  }
}

// ── Listen for progress messages from content script ──────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'expand_progress') {
    const percent = Math.round((message.current / message.total) * 100);
    progressContainer.style.display = 'block';
    if (message.statusText) {
      progressStatus.textContent = message.statusText;
    } else {
      progressStatus.textContent = `Öppnar anteckningar: ${message.current} av ${message.total}`;
    }
    progressPercent.textContent = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;
  }
});

// ── Expand all entries (Step 2) ───────────────────────────────────────────────
expandBtn.addEventListener('click', async () => {
  expandBtn.disabled = true;
  exportBtn.disabled = true;
  progressContainer.style.display = 'block';
  progressStatus.textContent = 'Förbereder expansion...';
  progressPercent.textContent = '0%';
  progressBarFill.style.width = '0%';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    // Inject content script just in case
    await ensureContentScriptInjected(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'expand_all',
      delayMs: 150 // Sequential click delay (150ms is very safe and fast for 255 items)
    });

    if (response && response.ok) {
      if (response.expanded > 0) {
        progressStatus.textContent = `Klart! Öppnade ${response.expanded} anteckningar.`;
        progressPercent.textContent = '100%';
        progressBarFill.style.width = '100%';
        
        // Brief timeout so user sees 100% completion before UI updates
        setTimeout(async () => {
          progressContainer.style.display = 'none';
          await checkPage();
        }, 1200);
      } else {
        progressStatus.textContent = 'Inga dolda anteckningar hittades.';
        setTimeout(() => { progressContainer.style.display = 'none'; }, 1500);
        await checkPage();
      }
    } else {
      setStatus('error', `Kunde inte öppna poster: ${response?.error || 'okänt fel'}`, 'error');
      expandBtn.disabled = false;
      exportBtn.disabled = false;
    }
  } catch (err) {
    setStatus('error', `Fel: ${err.message}`, 'error');
    expandBtn.disabled = false;
    exportBtn.disabled = false;
  }
});

// ── Export (Step 3) ───────────────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  expandBtn.disabled = true;
  btnLabel.innerHTML = '<span class="spinner"></span> Sparar…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    // Inject content script just in case
    await ensureContentScriptInjected(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'export',
      format: selectedFormat,
    });

    if (response && response.ok) {
      setStatus(
        'success',
        `Exporterade ${response.count} post${response.count !== 1 ? 'er' : ''} som .${selectedFormat}`,
        'success'
      );
    } else {
      setStatus('error', `Export misslyckades: ${response?.error || 'okänt fel'}`, 'error');
    }
  } catch (err) {
    setStatus('error', `Fel: ${err.message}`, 'error');
  }

  btnLabel.textContent = 'Spara journal';
  exportBtn.disabled = false;
  
  // Recheck page state to enable/disable buttons correctly
  await checkPage();
});

// ── Init ──────────────────────────────────────────────────────────────────────
checkPage();
