(() => {
  const $ = (id) => document.getElementById(id);
  const qualityLevels = ['poor', 'fair', 'good', 'excellent'];
  const qualityScore = { poor: 25, fair: 50, good: 78, excellent: 95 };
  const qualityLabel = { poor: 'Poor', fair: 'Fair', good: 'Good', excellent: 'Excellent' };
  const cropDefaults = {
    tomato: { price: 2400, shelfLife: 72 }, onion: { price: 1800, shelfLife: 240 }, potato: { price: 1600, shelfLife: 360 }, mango: { price: 3200, shelfLife: 96 }, grapes: { price: 4500, shelfLife: 72 }
  };
  const actionNames = { sell: 'Sell soon', store: 'Store temporarily', process: 'Process harvest', wait: 'Wait and monitor', redirect: 'Redirect to another market' };
  const HISTORY_KEY = 'perplectra_agri_decision_history_v1';
  const STATE_KEY = 'perplectra_agri_state_v1';
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); if (!Array.isArray(history)) history = []; } catch { history = []; }
  let currentState = null;
  let toastTimer;

  function money(value) {
    return '\u20B9' + Math.max(0, Math.round(value)).toLocaleString('en-IN');
  }
  function readState() {
    const base = {
      crop: $('crop').value,
      quantity: Math.max(1, Number($('quantity').value) || 1),
      price: Math.max(1, Number($('price').value) || 1),
      quality: $('quality').value,
      shelfLife: Math.max(1, Number($('shelfLife').value) || 1),
      transit: Math.max(0, Number($('transit').value) || 0),
      storage: $('storage').value,
      destination: $('destination').value.trim() || 'Selected market'
    };
    const shocks = [];
    if ($('shockPrice').checked) { base.price *= .85; shocks.push('market price \u221215%'); }
    if ($('shockTransit').checked) { base.transit += 8; shocks.push('transport +8 hours'); }
    if ($('shockQuality').checked) {
      const index = qualityLevels.indexOf(base.quality);
      base.quality = qualityLevels[Math.max(0, index - 1)];
      shocks.push('quality reduced');
    }
    if ($('shockStorage').checked) { base.storage = 'unavailable'; shocks.push('storage unavailable'); }
    base.shocks = shocks;
    return base;
  }
  function evaluate(state) {
    const q = qualityScore[state.quality];
    const effectiveShelf = Math.max(0, state.shelfLife - state.transit);
    const shelfRatio = state.transit / Math.max(1, state.shelfLife);
    const gross = state.quantity * state.price;
    const delayExposure = gross * Math.min(.45, .04 + shelfRatio * .35 + (100 - q) / 500);
    const scores = {
      sell: 44 + q * .22 + (state.price >= 2200 ? 9 : 2) + (shelfRatio > .5 ? 13 : 0) - (state.transit > state.shelfLife ? 18 : 0),
      store: 28 + (state.storage === 'available' ? 25 : state.storage === 'limited' ? 10 : -25) + (state.shelfLife > 120 ? 12 : -8) + (q >= 75 ? 6 : -5),
      process: 34 + (q <= 50 ? 19 : 4) + (state.storage === 'unavailable' ? 8 : 0) + (state.shelfLife < 72 ? 8 : 0),
      wait: 26 + (state.shelfLife > 120 ? 12 : -13) + (state.storage === 'available' ? 8 : -12) + (state.transit < 3 ? 4 : -4),
      redirect: 32 + (state.transit > 8 ? 15 : 0) + (state.price < 2200 ? 12 : 2) + (state.quality === 'excellent' ? 5 : 0)
    };
    // Feasibility guardrails keep options from appearing attractive when they cannot reasonably be used.
    if (state.storage === 'unavailable') { scores.store = 3; scores.wait -= 8; }
    if (state.storage === 'limited') scores.store -= 7;
    if (effectiveShelf <= 0) { scores.sell += 12; scores.store = Math.min(scores.store, 8); scores.wait = Math.min(scores.wait, 5); }
    if (state.quality === 'poor') { scores.sell -= 8; scores.process += 9; }
    if (state.quality === 'excellent') scores.sell += 4;
    if (state.transit > state.shelfLife * .7) scores.redirect += 8;
    Object.keys(scores).forEach(k => scores[k] = Math.max(3, Math.min(96, Math.round(scores[k]))));
    const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]);
    let winner = sorted[0][0];
    // If price is weak but quality and storage are good, preserve optionality; if quality is poor, processing can win.
    if (state.quality === 'poor' && state.storage === 'unavailable' && state.transit < state.shelfLife) winner = 'process';
    const gap = Math.max(0, sorted[0][1] - (sorted[1] ? sorted[1][1] : 0));
    const confidence = Math.max(58, Math.min(94, 64 + gap * .65 + (state.shocks.length ? 0 : 5)));
    const reasons = [];
    if (winner === 'sell') {
      reasons.push({kind:'positive', icon:'\u2713', text:`${qualityLabel[state.quality]} quality supports a near-term sale before further deterioration.`});
      reasons.push({kind: effectiveShelf > 0 ? 'positive' : 'warning', icon: effectiveShelf > 0 ? '\u2197' : '!', text: effectiveShelf > 0 ? `Estimated transit leaves about ${effectiveShelf} hours in the shelf-life window.` : 'Estimated transit time exceeds the remaining shelf-life window.'});
      reasons.push({kind: state.price >= 2200 ? 'positive' : 'warning', icon: state.price >= 2200 ? '\u2713' : '!', text: state.price >= 2200 ? 'The entered price makes an immediate sale comparatively attractive.' : 'The entered price is relatively low; compare another market if feasible.'});
    } else if (winner === 'store') {
      reasons.push({kind:'positive', icon:'\u2713', text:'Storage is available, allowing time for a later sale.'});
      reasons.push({kind:'positive', icon:'\u2713', text:`The estimated shelf-life window (${state.shelfLife} hours) gives some flexibility.`});
      reasons.push({kind:'warning', icon:'!', text:'Storage costs and future prices are not connected to live data; validate them before acting.'});
    } else if (winner === 'process') {
      reasons.push({kind:'positive', icon:'\u2713', text:'Processing may preserve value when fresh-market quality or shelf life is under pressure.'});
      reasons.push({kind:'warning', icon:'!', text:'Confirm local processing capacity, costs, food-safety requirements, and buyer demand.'});
      reasons.push({kind:'positive', icon:'\u2197', text:'This option is ranked higher by the prototype rules for the current conditions.'});
    } else if (winner === 'redirect') {
      reasons.push({kind:'positive', icon:'\u2197', text:'A different destination may improve the sale outcome under the entered market conditions.'});
      reasons.push({kind:'warning', icon:'!', text:`Re-check whether the added route can be completed within about ${state.shelfLife} hours of shelf life.`});
      reasons.push({kind:'positive', icon:'\u2713', text:'The recommendation weighs price, transit, and quality together.'});
    } else {
      reasons.push({kind:'positive', icon:'\u2713', text:'The current shelf-life window suggests there may be time to monitor conditions.'});
      reasons.push({kind:'warning', icon:'!', text:'Waiting is only sensible if quality can be maintained and a viable storage option exists.'});
      reasons.push({kind:'positive', icon:'\u2197', text:'Re-evaluate after any material price, quality, or logistics change.'});
    }
    if (state.shocks.length) reasons.push({kind:'warning', icon:'!', text:`Scenario applied: ${state.shocks.join(', ')}.`});
    const status = effectiveShelf <= 0 || shelfRatio > .75 ? 'TIME-SENSITIVE' : state.quality === 'poor' ? 'QUALITY AT RISK' : state.price < 1800 ? 'PRICE PRESSURE' : 'REVIEW BEFORE ACTING';
    return {state, scores, winner, confidence: Math.round(confidence), gross, delayExposure, reasons, status, effectiveShelf};
  }
  function render(result, isNewHistory = true) {
    currentState = result;
    const s = result.state;
    $('metricPrice').innerHTML = `${money(s.price)} <small>/ quintal</small>`;
    $('priceChangeChip').textContent = s.shocks.includes('market price \u221215%') ? '\u221215% scenario' : 'Base scenario';
    $('metricQuality').textContent = qualityLabel[s.quality];
    $('qualityBar').style.width = qualityScore[s.quality] + '%';
    $('qualityScore').textContent = `${qualityScore[s.quality]} / 100`;
    $('metricShelf').innerHTML = `${s.shelfLife} <small>hours</small>`;
    $('metricStorage').textContent = s.storage === 'available' ? 'Available' : s.storage === 'limited' ? 'Limited' : 'Unavailable';
    $('storageFoot').textContent = s.storage === 'available' ? 'Capacity assumed sufficient' : s.storage === 'limited' ? 'Capacity may be constrained' : 'No storage fallback';
    $('recommendationTitle').textContent = actionNames[result.winner];
    $('recommendationSummary').textContent = summaryFor(result);
    $('confidenceValue').textContent = result.confidence + '%';
    $('confidenceRing').style.background = `conic-gradient(#37865b ${result.confidence}%, #e7efe7 0)`;
    $('confidenceRing').style.border = '0';
    $('confidenceRing').style.position = 'relative';
    $('confidenceRing').style.boxShadow = 'inset 0 0 0 3px #fff';
    $('decisionStatus').textContent = result.status;
    $('grossValue').textContent = money(result.gross);
    $('delayExposure').textContent = money(result.delayExposure);
    $('reasonList').innerHTML = result.reasons.map(r => `<li><span class="reason-bullet ${r.kind}">${r.icon}</span><span>${escapeHTML(r.text)}</span></li>`).join('');
    $('optionsList').innerHTML = Object.entries(result.scores).sort((a,b) => b[1]-a[1]).map(([key,score]) => `<div class="option-row"><div class="option-name ${key===result.winner?'recommended':''}">${actionNames[key]}</div><div class="score-track"><span class="${key===result.winner?'recommended':''}" style="width:${score}%"></span></div><div class="option-score ${key===result.winner?'recommended':''}">${score}</div></div>`).join('');
    $('scenarioSummary').textContent = s.shocks.length ? `Applied: ${s.shocks.join(' \u00b7 ')}` : 'Base conditions \u00b7 no shocks applied';
    $('updatedAt').textContent = `Evaluated ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    if (isNewHistory) addHistory(result);
  }
  function summaryFor(r) {
    const s = r.state;
    const intro = {
      sell: `The current rule-based assessment favors selling ${s.crop} soon while the entered quality and market value remain usable.`,
      store: 'The current rule-based assessment favors temporary storage, provided storage costs and quality conditions remain acceptable.',
      process: 'The current rule-based assessment favors exploring processing to reduce exposure to further quality deterioration.',
      wait: 'The current rule-based assessment allows a short wait, but only while quality and storage conditions remain safe.',
      redirect: `The current rule-based assessment favors comparing another destination instead of relying only on ${s.destination}.`
    };
    return intro[r.winner] + (s.shocks.length ? ' This recommendation changed under the selected scenario.' : '');
  }
  function addHistory(result) {
    const entry = {title: actionNames[result.winner], desc: result.state.shocks.length ? result.state.shocks.join(' \u00b7 ') : 'Base conditions evaluated', time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), score: result.confidence};
    history.unshift(entry);
    if (history.length > 50) history.pop();
    persistHistory();
    drawHistory();
  }
  function persistHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* Browser storage may be disabled. */ }
  }
  function drawHistory() {
    $('historyCount').textContent = String(history.length).padStart(2,'0');
    $('historyList').innerHTML = history.length ? history.map((h,i) => `<div class="history-item"><span class="history-node ${i===0?'current':''}"></span><div><strong>${escapeHTML(h.title)}</strong><p>${escapeHTML(h.desc)}</p><small>${escapeHTML(h.time)} \u00b7 ${h.score}% rule confidence</small></div></div>`).join('') : '<div class="history-empty">No saved decisions yet. Evaluate a harvest to create the first record.</div>';
  }
  function persistInputs() {
    const data = {};
    ['crop','quantity','price','quality','shelfLife','transit','storage','destination','shockPrice','shockTransit','shockQuality','shockStorage'].forEach(id => { const el = $(id); if (el) data[id] = el.type === 'checkbox' ? el.checked : el.value; });
    try { localStorage.setItem(STATE_KEY, JSON.stringify(data)); } catch { /* Browser storage may be disabled. */ }
  }
  function restoreInputs() {
    try {
      const data = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!data) return;
      Object.entries(data).forEach(([id,value]) => { const el = $(id); if (el && value !== undefined) { if (el.type === 'checkbox') el.checked = Boolean(value); else el.value = value; } });
    } catch { /* Start with the defaults if saved state cannot be read. */ }
  }
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], {type}); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function notify(message) {
    const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }
  function recalc() { const result = evaluate(readState()); render(result); persistInputs(); }
  $('harvestForm').addEventListener('submit', e => { e.preventDefault(); recalc(); notify('Decision recalculated from current inputs.'); });
  $('simulateBtn').addEventListener('click', () => { recalc(); notify('Scenario recalculated. Review the new decision trace.'); });
  $('clearScenario').addEventListener('click', () => { ['shockPrice','shockTransit','shockQuality','shockStorage'].forEach(id => $(id).checked = false); recalc(); notify('Scenario changes cleared.'); });
  $('resetBtn').addEventListener('click', () => {
    $('crop').value='tomato'; $('quantity').value=120; $('price').value=2400; $('quality').value='good'; $('shelfLife').value=72; $('transit').value=6; $('storage').value='available'; $('destination').value='Nearest wholesale market';
    ['shockPrice','shockTransit','shockQuality','shockStorage'].forEach(id => $(id).checked = false);
    history.length = 0; recalc(); notify('Demo reset to its starting state.');
  });
  $('crop').addEventListener('change', () => { const d = cropDefaults[$('crop').value]; $('price').value = d.price; $('shelfLife').value = d.shelfLife; });
  $('copyBrief').addEventListener('click', async () => {
    if (!currentState) return;
    const r = currentState;
    const brief = `PERPLECTRA \u2014 AGRICULTURAL DECISION BRIEF\nRecommended action: ${actionNames[r.winner]}\nCrop: ${r.state.crop}\nQuantity: ${r.state.quantity} quintals\nPrice input: ${money(r.state.price)} per quintal\nEstimated gross value: ${money(r.gross)}\nRule confidence: ${r.confidence}%\nConditions: ${r.state.shocks.length ? r.state.shocks.join(', ') : 'Base scenario'}\nReasons:\n${r.reasons.map(x => '- ' + x.text).join('\n')}\n\nIllustrative local demo only. Not live market data, a trained AI prediction, or financial advice.`;
    try { await navigator.clipboard.writeText(brief); notify('Decision brief copied.'); }
    catch { const ta = document.createElement('textarea'); ta.value=brief; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); notify('Decision brief copied.'); }
  });
  $('exportHistoryBtn').addEventListener('click', () => {
    if (!history.length) { notify('There are no decisions to export yet.'); return; }
    const rows = [['Time','Recommended action','Scenario','Rule confidence (%)'], ...history.map(h => [h.time,h.title,h.desc,h.score])];
    const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
    downloadFile('perplectra-decision-history.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    notify('Decision history exported as CSV.');
  });
  $('clearHistoryBtn').addEventListener('click', () => {
    if (!history.length) { notify('Decision history is already empty.'); return; }
    history = []; persistHistory(); drawHistory(); notify('Decision history cleared.');
  });
  document.querySelectorAll('.nav-item').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
  }));
  restoreInputs();
  drawHistory();
  render(evaluate(readState()), false);
})();

// =============================================================================
// CROP INTELLIGENCE MODULE
// Self-contained IIFE appended below. The decision engine above is untouched.
// Communicates with the existing engine only by writing to the form select and
// triggering the existing submit pathway.
// =============================================================================
(() => {
  'use strict';

  // DOM refs
  const zone         = document.getElementById('ciUploadZone');
  const idleView     = document.getElementById('ciUploadIdle');
  const previewView  = document.getElementById('ciUploadPreview');
  const previewImg   = document.getElementById('ciPreviewImg');
  const fileInput    = document.getElementById('ciFileInput');
  const cameraInput  = document.getElementById('ciCameraInput');
  const browseBtn    = document.getElementById('ciBrowseBtn');
  const replaceBtn   = document.getElementById('ciReplaceBtn');
  const removeBtn    = document.getElementById('ciRemoveBtn');
  const analyzeBtn   = document.getElementById('ciAnalyzeBtn');
  const analyzeLbl   = document.getElementById('ciAnalyzeBtnLabel');
  const errorBox     = document.getElementById('ciError');
  const loadingEl    = document.getElementById('ciLoading');
  const reportEl     = document.getElementById('ciReport');
  const reassessBtn  = document.getElementById('ciReassessBtn');

  // Report sub-elements
  const ciCropName         = document.getElementById('ciCropName');
  const ciAlternatives     = document.getElementById('ciAlternatives');
  const ciFeatureList      = document.getElementById('ciFeatureList');
  const ciUncertaintyBadge = document.getElementById('ciUncertaintyBadge');
  const ciRipenessBadge    = document.getElementById('ciRipenessBadge');
  const ciColorTexture     = document.getElementById('ciColorTexture');
  const ciDamage           = document.getElementById('ciDamage');
  const ciPhotoLimitations = document.getElementById('ciPhotoLimitations');
  const ciNextStepsList    = document.getElementById('ciNextStepsList');
  const ciDecisionAction   = document.getElementById('ciDecisionAction');
  const ciDecisionReasoning= document.getElementById('ciDecisionReasoning');
  const ciMissingInfo      = document.getElementById('ciMissingInfo');
  const ciReportMeta       = document.getElementById('ciReportMeta');

  // Existing form elements (pre-fill only)
  const cropSelect = document.getElementById('crop');
  const priceInput = document.getElementById('price');
  const shelfInput = document.getElementById('shelfLife');

  // Constants
  const MAX_BYTES    = 8 * 1024 * 1024; // 8 MB
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

  // Maps crop names Gemini might return to existing <select> option values
  const CROP_MAP = {
    tomato: 'tomato', tomatoes: 'tomato',
    onion: 'onion', onions: 'onion',
    potato: 'potato', potatoes: 'potato',
    mango: 'mango', mangoes: 'mango', mangos: 'mango',
    grape: 'grapes', grapes: 'grapes'
  };

  const CROP_DEFAULTS = {
    tomato: { price: 2400, shelfLife: 72 },
    onion:  { price: 1800, shelfLife: 240 },
    potato: { price: 1600, shelfLife: 360 },
    mango:  { price: 3200, shelfLife: 96 },
    grapes: { price: 4500, shelfLife: 72 }
  };

  // State
  let selectedFile      = null;
  let analysisInFlight  = false;

  // Escape for innerHTML use
  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function showError(msg) {
    errorBox.innerHTML = '<span aria-hidden="true">\u26A0\uFE0F</span> ' + esc(msg);
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.innerHTML = '';
  }

  function setLoading(on) {
    loadingEl.hidden = !on;
    analyzeBtn.disabled = on || !selectedFile;
    analyzeLbl.textContent = on ? 'Analysing\u2026' : 'Analyze Crop';
  }

  function showIdle() {
    idleView.classList.remove('hidden');
    previewView.classList.add('hidden');
  }

  function showPreview(dataUrl) {
    previewImg.src = dataUrl;
    idleView.classList.add('hidden');
    previewView.classList.remove('hidden');
  }

  // Client-side validation
  function validateFile(file) {
    if (!file) return 'No file selected.';
    if (!ALLOWED_TYPES.has(file.type)) {
      return 'Unsupported file type "' + (file.type || 'unknown') + '". Please use JPEG, PNG, or WebP.';
    }
    if (file.size > MAX_BYTES) {
      return 'File is ' + (file.size / 1024 / 1024).toFixed(1) + ' MB, which exceeds the 8 MB limit. Please compress or resize the image.';
    }
    return null;
  }

  // Handle a chosen file
  function handleFile(file) {
    clearError();
    reportEl.hidden = true;

    const err = validateFile(file);
    if (err) {
      showError(err);
      selectedFile = null;
      analyzeBtn.disabled = true;
      showIdle();
      return;
    }

    selectedFile = file;
    analyzeBtn.disabled = false;

    const reader = new FileReader();
    reader.onload  = (e) => showPreview(e.target.result);
    reader.onerror = () => {
      showError('Could not read the selected file. It may be corrupted or inaccessible.');
      selectedFile = null;
      analyzeBtn.disabled = true;
      showIdle();
    };
    reader.readAsDataURL(file);
  }

  // Zone interactions
  zone.addEventListener('click', (e) => {
    // Ignore clicks on buttons inside the zone
    if ([browseBtn, replaceBtn, removeBtn].includes(e.target)) return;
    if (!previewView.classList.contains('hidden')) return;
    fileInput.click();
  });

  zone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === zone) {
      e.preventDefault();
      fileInput.click();
    }
  });

  browseBtn.addEventListener('click',  (e) => { e.stopPropagation(); fileInput.click(); });
  replaceBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedFile     = null;
    fileInput.value  = '';
    cameraInput.value = '';
    previewImg.src   = '';
    showIdle();
    clearError();
    reportEl.hidden  = true;
    analyzeBtn.disabled = true;
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  cameraInput.addEventListener('change', () => {
    if (cameraInput.files[0]) handleFile(cameraInput.files[0]);
  });

  // Drag and drop
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  ['dragleave', 'dragend'].forEach(evt =>
    zone.addEventListener(evt, () => zone.classList.remove('drag-over'))
  );
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Convert file to base64 string (without data-URL prefix)
  function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Main analysis
  analyzeBtn.addEventListener('click', async () => {
    if (analysisInFlight) return;
    if (!selectedFile) { showError('Please select an image first.'); return; }

    const err = validateFile(selectedFile);
    if (err) { showError(err); return; }

    clearError();
    reportEl.hidden   = true;
    analysisInFlight  = true;
    setLoading(true);

    let base64;
    try {
      base64 = await fileToBase64(selectedFile);
    } catch (_) {
      showError('Could not read the image file. Please try selecting it again.');
      setLoading(false);
      analysisInFlight = false;
      return;
    }

    let responseData;
    try {
      const resp = await fetch('/api/analyze-crop', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mimeType: selectedFile.type })
      });
      responseData = await resp.json();
    } catch (_) {
      showError('Could not reach the analysis server. Check your network connection and try again.');
      setLoading(false);
      analysisInFlight = false;
      return;
    }

    setLoading(false);
    analysisInFlight = false;

    // Not yet configured
    if (responseData.configured === false) {
      showError(
        'Crop image analysis is not yet configured on this server. ' +
        'To enable it, add your GEMINI_API_KEY environment variable (see .env.example). ' +
        'The harvest decision engine below still works with your manual inputs.'
      );
      return;
    }

    // API returned an error
    if (responseData.error && !responseData.report) {
      showError(responseData.error);
      return;
    }

    renderReport(responseData);
  });

  // Render the analysis report
  function renderReport(data) {
    var r = data.report;
    if (!r) { showError('The server returned an incomplete response. Please try again.'); return; }

    var id = r.cropIdentification  || {};
    var vc = r.visibleCondition    || {};
    var ds = r.decisionSummary     || {};

    // Section A — Identification
    ciCropName.textContent = id.mostLikelyCrop || 'Unknown';

    var alts = (Array.isArray(id.alternatives) && id.alternatives.length)
      ? 'Also possible: ' + id.alternatives.join(', ')
      : '';
    ciAlternatives.textContent = alts;

    ciFeatureList.innerHTML = (Array.isArray(id.visibleFeatures) && id.visibleFeatures.length)
      ? id.visibleFeatures.map(function(f){ return '<li>' + esc(f) + '</li>'; }).join('')
      : '<li>No specific features noted</li>';

    var unc = (id.uncertaintyLevel || 'high').toLowerCase();
    ciUncertaintyBadge.textContent = unc + ' uncertainty';
    ciUncertaintyBadge.className   = 'ci-uncertainty-badge ' + unc;

    // Section B — Condition
    var ripenessRaw   = (vc.ripenessStage || 'cannot assess').toLowerCase();
    var ripenessClass = ripenessRaw.replace(/[\s_]+/g, '-');
    ciRipenessBadge.textContent = ripenessRaw.replace(/_/g, ' ');
    ciRipenessBadge.className   = 'ci-ripeness-badge ' + ripenessClass;

    ciColorTexture.textContent    = vc.colorAndTexture           || '\u2014';
    ciDamage.textContent          = vc.damageOrDiseaseSymptoms   || '\u2014';
    ciPhotoLimitations.textContent= vc.photoLimitations          || 'None noted.';

    // Section C — Next steps
    var steps = Array.isArray(r.suggestedNextSteps) ? r.suggestedNextSteps : [];
    ciNextStepsList.innerHTML = steps.length
      ? steps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('')
      : '<li>No specific steps suggested from the image alone.</li>';

    // Section D — Decision summary
    var actionRaw = (ds.recommendedAction || 'insufficient data').toLowerCase();
    var actionLabels = {
      'sell':              'Sell soon',
      'store':             'Store temporarily',
      'process':           'Process harvest',
      'wait':              'Wait and monitor',
      'redirect':          'Redirect to another market',
      'insufficient data': 'Insufficient data \u2014 complete inputs below'
    };
    ciDecisionAction.textContent   = actionLabels[actionRaw] || actionRaw;
    ciDecisionReasoning.textContent = ds.reasoning || '';

    var missing = Array.isArray(ds.missingInformation) ? ds.missingInformation : [];
    if (missing.length) {
      ciMissingInfo.innerHTML =
        '<div class="ci-missing-info-head">Missing information</div>' +
        '<ul>' + missing.map(function(m){ return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
      ciMissingInfo.hidden = false;
    } else {
      ciMissingInfo.innerHTML = '';
      ciMissingInfo.hidden = true;
    }

    // Footer
    var modelStr = data.model || 'gemini-2.0-flash';
    var timeStr  = data.analysedAt
      ? new Date(data.analysedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
      : 'just now';
    ciReportMeta.textContent =
      'Analysed by ' + modelStr + ' \u00b7 ' + timeStr + ' \u00b7 Not a diagnosis or financial advice';

    reportEl.hidden = false;

    // Pre-fill form from crop name
    prefillForm(id.mostLikelyCrop);

    reportEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Pre-fill the existing harvest form if the identified crop matches a known option
  function prefillForm(cropName) {
    if (!cropName) return;
    var key = cropName.toLowerCase().trim();
    if (key === 'unknown' || key === 'not a crop image') return;

    var selectValue = CROP_MAP[key];
    if (!selectValue || !cropSelect) return;

    cropSelect.value = selectValue;
    var defaults = CROP_DEFAULTS[selectValue];
    if (defaults) {
      if (priceInput) priceInput.value = defaults.price;
      if (shelfInput) shelfInput.value = defaults.shelfLife;
    }
    // Fire change so the existing listener reapplies defaults
    cropSelect.dispatchEvent(new Event('change'));

    // Brief confirmation toast
    var notice       = document.createElement('div');
    notice.className = 'toast show';
    notice.style.cssText = 'position:fixed;bottom:60px;right:25px;z-index:30;pointer-events:none';
    notice.textContent   = 'Crop set to "' + selectValue + '" in the harvest form \u2014 review and adjust as needed.';
    document.body.appendChild(notice);
    setTimeout(function(){
      notice.classList.remove('show');
      setTimeout(function(){ notice.remove(); }, 400);
    }, 3200);
  }

  // Reassess: re-runs the existing decision engine without re-uploading
  if (reassessBtn) {
    reassessBtn.addEventListener('click', function() {
      var harvestForm = document.getElementById('harvestForm');
      if (harvestForm) harvestForm.requestSubmit();
      var decisionEl = document.getElementById('recommendation');
      if (decisionEl) decisionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

})();
