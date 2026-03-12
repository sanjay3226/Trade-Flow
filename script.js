/**
 * ============================================================
 * TradeFlow Pro — Complete JavaScript Engine (Premium)
 * ============================================================
 */

const TRADES_KEY = 'tf_trades';
const SETTINGS_KEY = 'tf_settings';
const JOURNAL_KEY = 'tf_journal';

const CURRENCY_SYMBOLS = {
    USD:'$',EUR:'€',GBP:'£',INR:'₹',JPY:'¥',AUD:'A$',CAD:'C$',CHF:'Fr',
    CNY:'¥',NZD:'NZ$',ZAR:'R',SGD:'S$',HKD:'HK$',KRW:'₩',BRL:'R$',
    MXN:'Mex$',AED:'د.إ',THB:'฿',TRY:'₺',PLN:'zł',BTC:'₿',ETH:'Ξ'
};

// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyAncGKQZ0GTmCg-q5Ki483r9ggsbYBCYhs",
    authDomain: "trade-flow-fcfbf.firebaseapp.com",
    databaseURL: "https://trade-flow-fcfbf-default-rtdb.firebaseio.com",
    projectId: "trade-flow-fcfbf",
    storageBucket: "trade-flow-fcfbf.firebasestorage.app",
    messagingSenderId: "177112382134",
    appId: "1:177112382134:web:b20dc878e28668e80d0417",
    measurementId: "G-C5M6MXSVLM"
};

// Initialize Firebase
let db = null;
let auth = null;

if (window.firebase) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
}

let trades = [];
let journal = {}; // { "YYYY-MM-DD": "Text note..." }
let settings = { currency:'USD', balance:10000, theme:'dark', accent:'blue', sound:true };
let charts = {};
let currentDate = new Date(); // For calendar
let currentUser = null;

// ==================== AUDIO (Synth) ====================
function playSound(type) {
    if (!settings.sound) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        if (type === 'click') {
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
            osc.stop(ctx.currentTime + 0.1);
        } else if (type === 'success') {
            osc.frequency.setValueAtTime(500, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.2);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
            osc.stop(ctx.currentTime + 0.3);
        } else if (type === 'streak') {
            // Arpeggio for streak
            [440, 554, 659, 880].forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.frequency.value = freq;
                g.gain.setValueAtTime(0.1, ctx.currentTime + i*0.1);
                g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i*0.1 + 0.3);
                o.connect(g); g.connect(ctx.destination);
                o.start(ctx.currentTime + i*0.1);
                o.stop(ctx.currentTime + i*0.1 + 0.3);
            });
            return;
        }

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
    } catch (e) {
        console.warn('AudioContext not supported or blocked, skipping audio.');
    }
}

const sym = () => CURRENCY_SYMBOLS[settings.currency] || settings.currency + ' ';

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    // Start Auth Flow immediately
    initAppFlow();
});

function initAppFlow() {
    // Hide identity sequence if it exists in HTML
    const seqEl = document.getElementById('identity-sequence');
    if (seqEl) seqEl.style.display = 'none';

    if (!auth) {
        // Fallback if Firebase not configured
        console.warn("Firebase not initialized. Running in local mode.");
        startLocalSession();
        return;
    }

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            // Hide login loading if visible
            const loader = document.getElementById('auth-loading');
            if (loader) loader.style.display = 'none';
            loadDataFromCloud();
        } else {
            currentUser = null;
            showLogin();
        }
    });
}

function showLogin() {
    // Hide app, show auth screen
    document.getElementById('app').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('login-card').style.display = 'block';
    
    document.getElementById('google-login').onclick = () => {
        const loader = document.getElementById('auth-loading');
        if (loader) loader.style.display = 'block';
        
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(err => {
            console.error(err);
            if (loader) loader.style.display = 'none';
            toast("Login Failed", "error");
        });
    };
}

function startLocalSession() {
    loadData();
    proceedToApp();
}

function proceedToApp() {
    document.getElementById('auth-screen').style.display = 'none';
    
    if (!localStorage.getItem(SETTINGS_KEY)) {
        document.getElementById('onboarding').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
        document.body.style.overflow = 'hidden';
    } else {
        document.getElementById('onboarding').style.display = 'none';
        document.getElementById('app').style.display = 'block';
    }

    applyTheme();
    applyAccent();
    initOnboarding();
    initNav();
    initKeyboardShortcuts();
    initForm();
    initHistory();
    initSettings();
    initExport();
    initEditModal();
    initCalendar();
    setDefaultDate();
    
    // Confidence Slider Update
    document.getElementById('f_confidence').addEventListener('input', e => {
        document.getElementById('f_conf_val').textContent = e.target.value;
    });

    renderAll();
}

async function loadDataFromCloud() {
    if (!db || !currentUser) return;
    
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            const data = doc.data();
            trades = data.trades || [];
            settings = data.settings || { currency:'USD', balance:10000, theme:'dark', accent:'blue', sound:true };
            journal = data.journal || {};
            // Sync to local specifically for this session
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            localStorage.setItem(TRADES_KEY, JSON.stringify(trades));
            localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
        } else {
            // NEW CLOUD USER - Fresh Start
            trades = [];
            settings = { currency:'USD', balance:10000, theme:'dark', accent:'blue', sound:true };
            journal = {};
            // Clear local storage so onboarding triggers
            localStorage.removeItem(SETTINGS_KEY);
            localStorage.removeItem(TRADES_KEY);
            localStorage.removeItem(JOURNAL_KEY);
        }
    } catch (e) {
        console.error("Cloud load error, falling back to local:", e);
        loadData();
    }
    proceedToApp();
}

async function syncToCloud() {
    if (!currentUser || !db) return;
    try {
        await db.collection('users').doc(currentUser.uid).set({
            trades, settings, journal,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("Cloud sync error:", e);
    }
}

// ==================== STORAGE ====================
function loadData() {
    try { trades = JSON.parse(localStorage.getItem(TRADES_KEY)) || []; } catch { trades = []; }
    try { journal = JSON.parse(localStorage.getItem(JOURNAL_KEY)) || {}; } catch { journal = {}; }
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) settings = { ...settings, ...s }; } catch {}
}
function saveTrades() { localStorage.setItem(TRADES_KEY, JSON.stringify(trades)); syncToCloud(); }
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); syncToCloud(); }
function saveJournal() { localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal)); syncToCloud(); }

// ==================== THEME & ACCENT ====================
function applyTheme() { document.documentElement.setAttribute('data-theme', settings.theme); }
function applyAccent() { document.documentElement.setAttribute('data-accent', settings.accent); }

// ==================== TOAST ====================
function toast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.innerHTML = `<span>${msg}</span>`;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ==================== ONBOARDING ====================
function initOnboarding() {
    document.getElementById('ob_start').addEventListener('click', () => {
        playSound('success');
        settings.currency = document.getElementById('ob_currency').value;
        settings.balance = parseFloat(document.getElementById('ob_balance').value) || 10000;
        saveSettings();
        document.getElementById('onboarding').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        document.body.style.overflow = '';
        toast('Journal Synchronized', 'success');
        renderAll();
    });
}

// ==================== NAVIGATION ====================
function initNav() {
    document.querySelectorAll('.bnav').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
}

function switchView(viewId) {
    playSound('click');
    document.querySelectorAll('.bnav').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('v_' + viewId).classList.add('active');
    
    if (viewId === 'calendar') renderCalendar();
    renderAll();
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        // Don't trigger if typing in input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        
        switch(e.key.toLowerCase()) {
            case '1': switchView('dashboard'); break;
            case '2': switchView('add'); break;
            case '3': switchView('history'); break;
            case '4': switchView('analytics'); break;
            case '5': switchView('calendar'); break;
            case 's': document.getElementById('settingsBtn').click(); break;
            case 'e': document.getElementById('exportBtn').click(); break;
        }
    });
}

// ==================== SETTINGS PANEL ====================
function initSettings() {
    const modal = document.getElementById('settingsModal');
    
    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('set_currency').value = settings.currency;
        document.getElementById('set_balance').value = settings.balance;
        document.getElementById('set_sound').checked = settings.sound;
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
        document.querySelectorAll('.accent-dot').forEach(d => d.classList.toggle('active', d.dataset.accent === settings.accent));
        modal.style.display = 'flex';
    });

    function closeAndSave() {
        settings.currency = document.getElementById('set_currency').value;
        settings.balance = parseFloat(document.getElementById('set_balance').value) || settings.balance;
        settings.sound = document.getElementById('set_sound').checked;
        saveSettings();
        modal.style.display = 'none';
        toast('✅ Settings saved');
        renderAll();
    }

    document.getElementById('closeSettings').addEventListener('click', closeAndSave);
    modal.addEventListener('click', e => { if (e.target === modal) closeAndSave(); });

    // Logout Logic
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if (confirm('Logout of your account? Your local cache will be cleared.')) {
                if (auth) {
                    auth.signOut().then(() => {
                        // Clear local storage on logout for security/cleanliness
                        localStorage.clear();
                        location.reload();
                    });
                } else {
                    location.reload();
                }
            }
        };
    }

    // Instants
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            playSound('click');
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            settings.theme = btn.dataset.theme;
            applyTheme(); saveSettings();
        });
    });

    document.querySelectorAll('.accent-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            playSound('click');
            document.querySelectorAll('.accent-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            settings.accent = dot.dataset.accent;
            applyAccent(); saveSettings(); renderAll(); // Re-render to update charts
        });
    });

    document.getElementById('set_sound').addEventListener('change', e => {
        settings.sound = e.target.checked; saveSettings();
        if(settings.sound) playSound('success');
    });

    document.getElementById('clearAllData').addEventListener('click', () => {
        if (confirm('Delete ALL trades and journal entries? This cannot be undone.')) {
            trades = []; journal = {};
            saveTrades(); saveJournal();
            toast('🗑️ All data cleared');
            renderAll();
        }
    });
}

// ==================== TRADE FORM ====================
function setDefaultDate() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('f_date').value = now.toISOString().slice(0, 16);
}

function initForm() {
    ['f_entry','f_exit','f_size','f_type','f_sl'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', liveCalc);
    });

    document.getElementById('tradeForm').addEventListener('submit', e => {
        e.preventDefault();
        const entry = parseFloat(document.getElementById('f_entry').value);
        const exit = parseFloat(document.getElementById('f_exit').value);
        const size = parseFloat(document.getElementById('f_size').value);
        const type = document.getElementById('f_type').value;
        const sl = parseFloat(document.getElementById('f_sl').value) || null;
        const tp = parseFloat(document.getElementById('f_tp').value) || null;

        const pnl = type === 'Buy' ? (exit - entry) * size : (entry - exit) * size;
        let rr = 0;
        if (sl) { const risk = Math.abs(entry - sl); rr = risk > 0 ? Math.abs(exit - entry) / risk : 0; }

        const tags = [];
        document.querySelectorAll('#tradeForm .chip input:checked').forEach(cb => tags.push(cb.value));
        
        const emotion = document.getElementById('f_emotion').value;
        const conf = parseInt(document.getElementById('f_confidence').value);

        trades.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            date: document.getElementById('f_date').value,
            asset: document.getElementById('f_asset').value.toUpperCase().trim(),
            type, timeframe: document.getElementById('f_tf').value,
            strategy: document.getElementById('f_strat').value,
            entry, exit, stopLoss: sl, takeProfit: tp, size,
            risk: parseFloat(document.getElementById('f_risk').value) || 0,
            pnl: parseFloat(pnl.toFixed(2)),
            rr: parseFloat(rr.toFixed(2)),
            result: pnl >= 0 ? 'Win' : 'Loss',
            emotion: emotion,
            confidence: conf,
            tags, notes: document.getElementById('f_notes').value.trim()
        });

        saveTrades();
        e.target.reset();
        setDefaultDate();
        document.getElementById('f_confidence').value = 5;
        document.getElementById('f_conf_val').textContent = 5;
        document.getElementById('lc_pnl').textContent = '—';
        document.getElementById('lc_rr').textContent = '—';
        document.getElementById('lc_res').textContent = '—';
        
        playSound('success');
        toast('✅ Trade logged!');
        
        // Check for streak internally (Confetti will fire in renderStats if applicable)
        switchView('dashboard');
    });
}

function liveCalc() {
    const entry = parseFloat(document.getElementById('f_entry').value);
    const exit = parseFloat(document.getElementById('f_exit').value);
    const size = parseFloat(document.getElementById('f_size').value);
    const type = document.getElementById('f_type').value;
    const sl = parseFloat(document.getElementById('f_sl').value);

    if (entry && exit && size) {
        const pnl = type === 'Buy' ? (exit - entry) * size : (entry - exit) * size;
        const el = document.getElementById('lc_pnl');
        el.textContent = sym() + pnl.toFixed(2);
        el.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
        const r = document.getElementById('lc_res');
        r.textContent = pnl >= 0 ? '✅ WIN' : '❌ LOSS';
        r.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    }
    if (entry && exit && sl) {
        const risk = Math.abs(entry - sl);
        const rr = risk > 0 ? (Math.abs(exit - entry) / risk).toFixed(2) : '—';
        document.getElementById('lc_rr').textContent = rr;
    }
}

// ==================== RENDERING ENGINE ====================
function renderAll() {
    const sorted = [...trades].sort((a,b) => new Date(a.date) - new Date(b.date));
    const netPnl = sorted.reduce((s,t) => s + t.pnl, 0);
    const curBal = settings.balance + netPnl;
    
    document.getElementById('balancePill').textContent = sym() + curBal.toFixed(2);
    
    renderStats(sorted, netPnl);
    renderCharts(sorted);
    renderRecent(sorted);
    renderHistory();
    renderAnalytics();
}

// ==================== STATS & STREAKS ====================
let lastStreak = 0;
function renderStats(sorted, netPnl) {
    const n = sorted.length;
    const wins = sorted.filter(t => t.result === 'Win');
    const losses = sorted.filter(t => t.result === 'Loss');
    const wr = n ? (wins.length / n * 100).toFixed(1) : 0;
    const avgRR = n ? (sorted.reduce((s, t) => s + t.rr, 0) / n).toFixed(2) : 0;

    // Advanced Stats
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : 0);
    
    const bestT = n ? Math.max(...sorted.map(t=>t.pnl)) : 0;
    const worstT = n ? Math.min(...sorted.map(t=>t.pnl)) : 0;
    const avgW = wins.length ? grossProfit / wins.length : 0;
    const avgL = losses.length ? grossLoss / losses.length : 0;

    // Drawdown
    let maxEq = 0, dd = 0, cum = 0;
    sorted.forEach(t => { cum += t.pnl; if (cum > maxEq) maxEq = cum; const curDd = maxEq - cum; if (curDd > dd) dd = curDd; });

    // Streak Calculation
    let currentStreak = 0, streakType = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
        const res = sorted[i].result;
        if (!streakType) { streakType = res; currentStreak = 1; }
        else if (res === streakType) { currentStreak++; }
        else break;
    }

    // Update DOM
    document.getElementById('s_total').textContent = n;
    document.getElementById('s_winrate').textContent = wr + '%';
    const pEl = document.getElementById('s_pnl');
    pEl.textContent = sym() + netPnl.toFixed(2);
    pEl.className = 'stat-val ' + (netPnl >= 0 ? 'text-green' : 'text-red');
    document.getElementById('s_rr').textContent = avgRR;

    document.getElementById('s_pf').textContent = pf;
    document.getElementById('s_dd').textContent = sym() + dd.toFixed(2);
    document.getElementById('s_best').textContent = sym() + bestT.toFixed(2);
    document.getElementById('s_worst').textContent = sym() + worstT.toFixed(2);
    document.getElementById('s_avgw').textContent = sym() + avgW.toFixed(2);
    document.getElementById('s_avgl').textContent = sym() + avgL.toFixed(2);

    // Streak Banner & Confetti
    const banner = document.getElementById('streakBanner');
    if (streakType === 'Win' && currentStreak >= 3) {
        banner.style.display = 'flex';
        banner.innerHTML = `<span><i class="fas fa-fire streak-fire"></i> ${currentStreak} Win Streak! Mastery confirmed.</span>`;
        if (currentStreak > lastStreak && document.getElementById('v_dashboard').classList.contains('active')) {
            playSound('streak'); fireConfetti();
        }
    } else if (streakType === 'Loss' && currentStreak >= 3) {
        banner.style.display = 'flex';
        banner.style.background = 'linear-gradient(135deg, var(--red), #7f1d1d)';
        banner.innerHTML = `<span><i class="fas fa-wind"></i> ${currentStreak} Loss Streak. Pause and recalibrate.</span>`;
    } else {
        banner.style.display = 'none';
    }
    lastStreak = currentStreak;
}

// ==================== CHARTS ====================
function renderCharts(sorted) {
    const tc = settings.theme === 'dark' ? '#94a3b8' : '#475569';
    const gc = settings.theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

    // Equity
    if (charts.eq) charts.eq.destroy();
    let cum = 0;
    const eqData = [0, ...sorted.map(t => { cum += t.pnl; return +cum.toFixed(2); })];
    const eqLabels = ['Start', ...sorted.map(t => new Date(t.date).toLocaleDateString())];
    charts.eq = new Chart(document.getElementById('cEquity'), {
        type: 'line',
        data: { labels: eqLabels, datasets: [{ data: eqData, borderColor: accent, backgroundColor: accent + '15', fill: true, tension: .35, pointRadius: eqData.length > 20 ? 0 : 3, borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: gc }, ticks: { color: tc, callback: v => sym() + v } }, x: { grid: { display: false }, ticks: { color: tc, maxTicksLimit: 8 } } } }
    });

    // Win/Loss
    if (charts.wl) charts.wl.destroy();
    const w = trades.filter(t => t.result === 'Win').length;
    const l = trades.filter(t => t.result === 'Loss').length;
    charts.wl = new Chart(document.getElementById('cWL'), {
        type: 'doughnut',
        data: { labels: ['Wins', 'Losses'], datasets: [{ data: [w, l], backgroundColor: ['#10b981', '#ef4444'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: tc, padding: 12 } } } }
    });

    // Strategy
    if (charts.st) charts.st.destroy();
    const strats = {};
    sorted.forEach(t => { if (!strats[t.strategy]) strats[t.strategy] = 0; strats[t.strategy] += t.pnl; });
    const sLabels = Object.keys(strats);
    const sData = sLabels.map(s => +strats[s].toFixed(2));
    const sColors = sData.map(v => v >= 0 ? '#10b981' : '#ef4444');
    charts.st = new Chart(document.getElementById('cStrat'), {
        type: 'bar',
        data: { labels: sLabels, datasets: [{ data: sData, backgroundColor: sColors, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { color: gc }, ticks: { color: tc, callback: v => sym() + v } }, y: { grid: { display: false }, ticks: { color: tc } } } }
    });

    // Mistakes
    if (charts.mk) charts.mk.destroy();
    const mCounts = {};
    sorted.forEach(t => { if (t.tags) t.tags.forEach(tag => { 
        if(['FOMO','Revenge Trade','Overtrading','Early Exit','Late Entry'].includes(tag)){
            mCounts[tag] = (mCounts[tag]||0) + 1;
        }
    }); });
    charts.mk = new Chart(document.getElementById('cMistakes'), {
        type: 'bar',
        data: { labels: Object.keys(mCounts), datasets: [{ data: Object.values(mCounts), backgroundColor: '#f59e0b', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: gc }, ticks: { color: tc, stepSize: 1 } }, x: { grid: { display: false }, ticks: { color: tc, font: { size: 10 } } } } }
    });
}

function renderRecent(sorted) {
    const tbody = document.getElementById('recentBody');
    const empty = document.getElementById('recentEmpty');
    const recent = sorted.slice(-5).reverse();
    if(!recent.length) { tbody.innerHTML=''; empty.style.display='block'; return;}
    empty.style.display='none';
    tbody.innerHTML = recent.map(t => `<tr>
        <td style="font-size:0.75rem">${new Date(t.date).toLocaleDateString()}</td>
        <td><strong>${t.asset}</strong></td>
        <td><span class="badge badge-${t.type.toLowerCase()}">${t.type}</span></td>
        <td class="${t.pnl>=0?'text-green':'text-red'}"><strong>${sym()}${t.pnl.toFixed(2)}</strong></td>
        <td>${t.rr.toFixed(1)}</td>
    </tr>`).join('');
}


// ==================== HISTORY ====================
function initHistory() {
    document.getElementById('histSearch').addEventListener('input', renderHistory);
    document.getElementById('histFilter').addEventListener('change', renderHistory);
    document.getElementById('histSort').addEventListener('change', renderHistory);
}

function renderHistory() {
    const q = (document.getElementById('histSearch').value || '').toLowerCase();
    const f = document.getElementById('histFilter').value;
    const s = document.getElementById('histSort').value;

    let list = trades.filter(t => {
        const mQ = t.asset.toLowerCase().includes(q) || t.strategy.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q);
        const mF = f === 'all' || t.result === f;
        return mQ && mF;
    });

    switch (s) {
        case 'date-desc': list.sort((a,b) => new Date(b.date)-new Date(a.date)); break;
        case 'date-asc': list.sort((a,b) => new Date(a.date)-new Date(b.date)); break;
        case 'pnl-desc': list.sort((a,b) => b.pnl-a.pnl); break;
        case 'pnl-asc': list.sort((a,b) => a.pnl-b.pnl); break;
    }

    const tbody = document.getElementById('histBody');
    const empty = document.getElementById('histEmpty');
    if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    tbody.innerHTML = list.map(t => `<tr>
        <td>${new Date(t.date).toLocaleDateString()}</td>
        <td><strong>${t.asset}</strong></td>
        <td><span class="badge badge-${t.type.toLowerCase()}">${t.type}</span></td>
        <td>${t.entry}</td><td>${t.exit}</td>
        <td class="${t.pnl >= 0 ? 'text-green' : 'text-red'}"><strong>${sym()}${t.pnl.toFixed(2)}</strong></td>
        <td>${t.rr.toFixed(2)}</td><td>${t.strategy}</td>
        <td>${(t.tags || []).map(tag => '<span class="tag-mini">' + tag + '</span>').join('')}</td>
        <td class="actions-cell">
            <button class="btn btn-edit btn-sm" onclick="openEdit('${t.id}')"><i class="fas fa-pen"></i></button>
            <button class="btn btn-danger btn-sm" onclick="delTrade('${t.id}')"><i class="fas fa-trash"></i></button>
        </td>
    </tr>`).join('');
}

window.delTrade = id => { if (confirm('Delete this trade?')) { trades = trades.filter(t => t.id !== id); saveTrades(); toast('🗑️ Deleted'); renderAll(); } };

// ==================== EDIT MODAL ====================
function initEditModal() {
    document.getElementById('closeEdit').addEventListener('click', () => document.getElementById('editModal').style.display = 'none');
    document.getElementById('editModal').addEventListener('click', e => { if (e.target.id === 'editModal') e.target.style.display = 'none'; });

    document.getElementById('editForm').addEventListener('submit', e => {
        e.preventDefault();
        const id = document.getElementById('e_id').value;
        const idx = trades.findIndex(t => t.id === id);
        if (idx === -1) return;

        const entry = parseFloat(document.getElementById('e_entry').value);
        const exit = parseFloat(document.getElementById('e_exit').value);
        const size = parseFloat(document.getElementById('e_size').value);
        const type = document.getElementById('e_type').value;
        const sl = parseFloat(document.getElementById('e_sl').value) || null;

        const pnl = type === 'Buy' ? (exit - entry) * size : (entry - exit) * size;
        let rr = 0;
        if (sl) { const risk = Math.abs(entry - sl); rr = risk > 0 ? Math.abs(exit - entry) / risk : 0; }

        trades[idx] = { ...trades[idx],
            date: document.getElementById('e_date').value,
            asset: document.getElementById('e_asset').value.toUpperCase().trim(),
            type, strategy: document.getElementById('e_strat').value,
            timeframe: document.getElementById('e_tf').value,
            entry, exit, size, stopLoss: sl,
            takeProfit: parseFloat(document.getElementById('e_tp').value) || null,
            risk: parseFloat(document.getElementById('e_risk').value) || 0,
            pnl: +pnl.toFixed(2), rr: +rr.toFixed(2),
            result: pnl >= 0 ? 'Win' : 'Loss',
            notes: document.getElementById('e_notes').value.trim()
        };
        saveTrades();
        document.getElementById('editModal').style.display = 'none';
        toast('✏️ Updated');
        renderAll();
    });
}
window.openEdit = id => {
    const t = trades.find(x => x.id === id);
    if (!t) return;
    document.getElementById('e_id').value = t.id;
    document.getElementById('e_date').value = t.date;
    document.getElementById('e_asset').value = t.asset;
    document.getElementById('e_type').value = t.type;
    document.getElementById('e_strat').value = t.strategy;
    document.getElementById('e_tf').value = t.timeframe;
    document.getElementById('e_entry').value = t.entry;
    document.getElementById('e_exit').value = t.exit;
    document.getElementById('e_sl').value = t.stopLoss || '';
    document.getElementById('e_tp').value = t.takeProfit || '';
    document.getElementById('e_size').value = t.size;
    document.getElementById('e_risk').value = t.risk;
    document.getElementById('e_notes').value = t.notes || '';
    document.getElementById('editModal').style.display = 'flex';
};

// ==================== ANALYTICS ====================
function renderAnalytics() {
    // Strategies
    const strats = {};
    trades.forEach(t => { if (!strats[t.strategy]) strats[t.strategy] = []; strats[t.strategy].push(t); });
    const sc = document.getElementById('stratCards');
    if (!Object.keys(strats).length) { sc.innerHTML = '<p style="color:var(--text3)">No data yet.</p>'; }
    else {
        sc.innerHTML = Object.entries(strats).map(([name, arr]) => {
            const w = arr.filter(t => t.result === 'Win').length;
            const pnl = arr.reduce((s, t) => s + t.pnl, 0);
            return `<div class="mini-card"><h4>${name}</h4><div class="mini-stats">
                <div class="mini-stat"><span class="ms-l">Trades</span><span class="ms-v">${arr.length}</span></div>
                <div class="mini-stat"><span class="ms-l">Win Rate</span><span class="ms-v">${(w/arr.length*100).toFixed(0)}%</span></div>
                <div class="mini-stat"><span class="ms-l">P&L</span><span class="ms-v ${pnl>=0?'text-green':'text-red'}">${sym()}${pnl.toFixed(2)}</span></div>
            </div></div>`;
        }).join('');
    }

    // Mistakes
    const mTags = ['FOMO','Revenge Trade','Overtrading','Early Exit','Late Entry'];
    const mStats = {};
    mTags.forEach(t => mStats[t] = { count: 0, pnl: 0 });
    trades.forEach(t => { if (t.tags) t.tags.forEach(tag => { if (mStats[tag]) { mStats[tag].count++; mStats[tag].pnl += t.pnl; } }); });
    const activeM = Object.entries(mStats).filter(([, v]) => v.count > 0);
    const mc = document.getElementById('mistakeCards');
    if (!activeM.length) { mc.innerHTML = '<p style="color:var(--text3)">No disciplined mistakes tracked yet. 🎯</p>'; }
    else {
        mc.innerHTML = activeM.map(([name, v]) => `<div class="mini-card"><h4>⚠️ ${name}</h4><div class="mini-stats">
            <div class="mini-stat"><span class="ms-l">Count</span><span class="ms-v">${v.count}</span></div>
            <div class="mini-stat"><span class="ms-l">Impact</span><span class="ms-v ${v.pnl>=0?'text-green':'text-red'}">${sym()}${v.pnl.toFixed(2)}</span></div>
        </div></div>`).join('');
    }

    // Emotions
    const eStats = {};
    trades.forEach(t => { if (t.emotion) { if(!eStats[t.emotion]) eStats[t.emotion]={w:0, l:0, pnl:0};
        eStats[t.emotion].pnl += t.pnl;
        if(t.result==='Win') eStats[t.emotion].w++; else eStats[t.emotion].l++;
    }});
    const ec = document.getElementById('emotionCards');
    if (!Object.keys(eStats).length) { ec.innerHTML = '<p style="color:var(--text3)">Log emotions to see analysis.</p>'; }
    else {
        ec.innerHTML = Object.entries(eStats).map(([name, v]) => {
            const tot=v.w+v.l; const wr=(v.w/tot*100).toFixed(0);
            return `<div class="mini-card"><h4>🧠 ${name}</h4><div class="mini-stats">
            <div class="mini-stat"><span class="ms-l">Win Rate</span><span class="ms-v">${wr}%</span></div>
            <div class="mini-stat"><span class="ms-l">P&L</span><span class="ms-v ${v.pnl>=0?'text-green':'text-red'}">${sym()}${v.pnl.toFixed(2)}</span></div>
        </div></div>`}).join('');
    }
}

// ==================== CALENDAR & JOURNAL ====================
function initCalendar() {
    document.getElementById('calPrev').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    document.getElementById('calNext').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
    
    document.getElementById('saveJournal').addEventListener('click', () => {
        const text = document.getElementById('journalText').value.trim();
        const dateStr = new Date().toISOString().slice(0,10);
        if (text) {
            if(!journal[dateStr]) journal[dateStr] = [];
            if(!Array.isArray(journal[dateStr])) journal[dateStr] = [journal[dateStr]]; // Migration safely
            journal[dateStr].unshift(text);
            saveJournal();
            document.getElementById('journalText').value = '';
            toast('📝 Note saved!');
            renderJournal();
        }
    });
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    document.getElementById('calTitle').textContent = `${months[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1; // Mon=0, Sun=6

    const calBody = document.getElementById('calBody');
    let html = '';

    // Empty previous days
    for (let i = 0; i < startOffset; i++) { html += `<div class="cal-day empty"></div>`; }

    // Map trades by day
    const dayData = {};
    trades.forEach(t => {
        const d = new Date(t.date);
        if (d.getFullYear() === year && d.getMonth() === month) {
            const day = d.getDate();
            if (!dayData[day]) dayData[day] = { count: 0, pnl: 0 };
            dayData[day].count++;
            dayData[day].pnl += t.pnl;
        }
    });

    // Generate days
    for (let i = 1; i <= daysInMonth; i++) {
        const d = dayData[i];
        if (d) {
            const clss = d.pnl >= 0 ? 'profit' : 'loss';
            const sign = d.pnl >= 0 ? '+' : '';
            html += `<div class="cal-day ${clss}" title="${d.count} Trades">
                <span class="d-num">${i}</span>
                <span class="d-metric">${sign}${d.pnl.toFixed(0)}</span>
                </div>`;
        } else {
            const hasNotes = journal[`${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`];
            html += `<div class="cal-day"><span class="d-num">${i} ${hasNotes?'📝':''}</span></div>`;
        }
    }
    calBody.innerHTML = html;
    renderJournal();
}

function renderJournal() {
    const dateStr = currentDate.toISOString().slice(0,10); // Today's notes primarily, or list all
    const entries = document.getElementById('journalEntries');
    
    // Convert old single-string format to array and sort to get newest first
    const allNotes = [];
    Object.entries(journal).forEach(([d, notes]) => {
        const arr = Array.isArray(notes) ? notes : [notes];
        arr.forEach(n => allNotes.push({ date: d, text: n }));
    });
    
    allNotes.sort((a,b) => new Date(b.date) - new Date(a.date));

    if (!allNotes.length) { entries.innerHTML = '<p class="sub-text">No notes written yet.</p>'; return; }
    
    entries.innerHTML = allNotes.slice(0,10).map(n => 
        `<div class="journal-entry">
            <div class="j-date">${new Date(n.date).toLocaleDateString()}</div>
            <div>${n.text}</div>
        </div>`
    ).join('');
}


// ==================== EXPORT (PDF & CSV) ====================
function initExport() {
    const modal = document.getElementById('exportModal');
    document.getElementById('exportBtn').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('closeExport').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    document.getElementById('exportPDF').addEventListener('click', () => {
        const { jsPDF } = window.jspdf; const doc = new jsPDF(); const s = sym();
        doc.setFontSize(18); doc.text('TradeFlow Pro — Trade Report', 14, 20);
        doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
        const rows = [...trades].sort((a,b) => new Date(b.date)-new Date(a.date)).map(t => [
            new Date(t.date).toLocaleDateString(), t.asset, t.type, t.entry, t.exit, t.size, s + t.pnl.toFixed(2), t.rr.toFixed(2)
        ]);
        doc.autoTable({ startY:35, head: [['Date','Asset','Side','Entry','Exit','Size','P&L','R:R']], body: rows,
            headStyles: { fillColor: [59, 130, 246] }, styles: { fontSize: 8 }
        });
        doc.save(`TradeFlow_Report.pdf`);
        modal.style.display = 'none'; toast('📄 PDF exported');
    });

    document.getElementById('exportCSV').addEventListener('click', () => {
        const headers = ['Date','Asset','Type','Entry','Exit','Size','P&L','R:R','Strategy','Emotion','Tags','Notes'];
        const rows = trades.map(t => [t.date, t.asset, t.type, t.entry, t.exit, t.size, t.pnl.toFixed(2), t.rr.toFixed(2), t.strategy, t.emotion, (t.tags||[]).join(';'), '"' + (t.notes||'').replace(/"/g,'""') + '"']);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `TradeFlow.csv`;
        a.click(); modal.style.display = 'none'; toast('📊 CSV exported');
    });
}

// ==================== CONFETTI ENGINE ====================
function fireConfetti() {
    const canvas = document.getElementById('confetti');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    
    const pieces = [];
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];
    for(let i=0; i<100; i++) {
        pieces.push({
            x: canvas.width / 2, y: canvas.height / 2 + 100,
            vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 1) * 20 - 5,
            size: Math.random() * 8 + 4, color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 10
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0,0, canvas.width, canvas.height);
        let active = false;
        pieces.forEach(p => {
            p.vy += 0.4; p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed;
            if (p.y < canvas.height) active = true;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
            ctx.fillStyle = p.color; ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); ctx.restore();
        });
        if(active && frame < 200) { frame++; requestAnimationFrame(animate); }
        else { ctx.clearRect(0,0, canvas.width, canvas.height); }
    }
    animate();
}
