// ==========================================
// 配当台帳 v2 - メインアプリケーション
// ==========================================
// - prices.json (GitHub Actionsで更新) から株価取得
// - Firebase (任意) でクラウド同期
// - IndexedDB (端末ローカル) と並行動作

// ============================================
// 株価データ管理
// ============================================
let priceData = {};       // code -> {price, prev, div, name}
let priceMeta = {};       // {updatedAt, ...}

async function fetchPricesFromJson() {
  try {
    // キャッシュバスティング: GitHub Pagesでも常に最新を取りに行く
    const res = await fetch(`./prices.json?t=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    priceData = data.prices || {};
    priceMeta = {
      updatedAt: data.updatedAt,
      successCount: data.successCount,
      failedCount: data.failedCount,
    };
    // IndexedDB にもキャッシュ
    for (const [code, info] of Object.entries(priceData)) {
      await DB.setPrice({ code, ...info });
    }
    return true;
  } catch (err) {
    console.warn('[Prices] fetch failed, fallback to cache:', err);
    // フォールバック: IndexedDBキャッシュから
    const cached = await DB.getPriceCache();
    cached.forEach(p => { priceData[p.code] = p; });
    return false;
  }
}

async function getPrice(code) {
  if (priceData[code]) return priceData[code];
  // 未知コードはダミー（ユーザーがGitHub Actionsの銘柄リストに追加するまで）
  const cached = await DB.getPrice(code);
  if (cached) {
    priceData[code] = cached;
    return cached;
  }
  const fallback = { code, name: '—', price: 0, prev: 0, div: 0, missing: true };
  priceData[code] = fallback;
  return fallback;
}

// ============================================
// 証券会社リンク
// ============================================
const BROKERS = [
  { name: 'SBI証券', url: 'https://www.sbisec.co.jp/' },
  { name: '楽天証券', url: 'https://www.rakuten-sec.co.jp/' },
  { name: 'マネックス証券', url: 'https://www.monex.co.jp/' },
  { name: '松井証券', url: 'https://www.matsui.co.jp/' },
  { name: 'auカブコム証券', url: 'https://kabu.com/' },
  { name: '野村證券', url: 'https://www.nomura.co.jp/' },
];

// ============================================
// フォーマッタ
// ============================================
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const yenDec = n => '¥' + n.toLocaleString('ja-JP', {maximumFractionDigits:1});
const pct = n => n.toFixed(2) + '%';
const signed = n => (n>=0?'+':'') + n.toLocaleString('ja-JP', {maximumFractionDigits:0});

function formatRelativeTime(isoString) {
  if (!isoString) return '未取得';
  const then = new Date(isoString);
  const now = new Date();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}時間前`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}日前`;
}

// ============================================
// 状態
// ============================================
let state = { holdings: [], watchlist: [], alerts: [], favorites: new Set() };
let useFirebase = false;
let firebaseReady = false;

async function loadState() {
  state.holdings = await DB.getHoldings();
  state.watchlist = await DB.getWatchlist();
  state.alerts = await DB.getAlerts();
  const favs = await DB.getSetting('favorites');
  state.favorites = new Set(favs || []);
}

async function saveFavorites() {
  await DB.setSetting('favorites', Array.from(state.favorites));
  if (firebaseReady) await FirebaseSync.setSetting('favorites', Array.from(state.favorites));
}

// ============================================
// レンダリング: ポートフォリオ
// ============================================
async function renderHoldings(){
  const tbody = document.getElementById('holdings-tbody');
  if(state.holdings.length===0){
    tbody.innerHTML = '<tr><td colspan="10" class="empty">保有銘柄がありません。「銘柄を追加」から登録してください。</td></tr>';
    await updateSummary();
    return;
  }
  const rows = await Promise.all(state.holdings.map(async h=>{
    const q = await getPrice(h.code);
    const value = q.price * h.shares;
    const cost = h.cost * h.shares;
    const pnl = value - cost;
    const yoc = (h.div / h.cost) * 100;
    const currentYield = q.price > 0 ? (h.div / q.price) * 100 : 0;
    const annualDiv = h.div * h.shares;
    const isFav = state.favorites.has(h.id);
    const missingFlag = q.missing ? ' <small style="color:var(--vermillion)">※価格未取得</small>' : '';
    return `
      <tr class="row">
        <td><span class="fav ${isFav?'':'off'}" onclick="toggleFav('${h.id}')">★</span></td>
        <td>
          <span class="ticker">${h.code}</span>
          <span class="company">${h.name}</span>${missingFlag}
        </td>
        <td class="num">${h.shares.toLocaleString()}</td>
        <td class="num">${yenDec(h.cost)}</td>
        <td class="num">${q.price > 0 ? yenDec(q.price) : '—'}</td>
        <td class="num ${pnl>=0?'positive':'negative'}">${q.price > 0 ? signed(pnl)+'円' : '—'}${q.price > 0 ? `<br><small>${((pnl/cost)*100).toFixed(2)}%</small>` : ''}</td>
        <td class="num">${pct(yoc)}</td>
        <td class="num">${q.price > 0 ? pct(currentYield) : '—'}</td>
        <td class="num">${yen(annualDiv)}</td>
        <td><button class="btn btn-sm btn-danger" onclick="removeHolding('${h.id}')">×</button></td>
      </tr>
    `;
  }));
  tbody.innerHTML = rows.join('');
  await updateSummary();
}

async function updateSummary(){
  let totalValue=0, totalCost=0, annualDiv=0;
  for (const h of state.holdings) {
    const q = await getPrice(h.code);
    totalValue += (q.price || h.cost) * h.shares;  // 価格未取得時は取得単価で代用
    totalCost += h.cost * h.shares;
    annualDiv += h.div * h.shares;
  }
  const delta = totalValue - totalCost;
  const deltaPct = totalCost > 0 ? (delta/totalCost)*100 : 0;
  const avgYield = totalValue > 0 ? (annualDiv/totalValue)*100 : 0;
  const yoc = totalCost > 0 ? (annualDiv/totalCost)*100 : 0;

  document.getElementById('total-value').innerHTML = yen(totalValue);
  document.getElementById('total-cost').innerHTML = yen(totalCost);
  document.getElementById('annual-div').innerHTML = yen(annualDiv);
  document.getElementById('avg-yield').innerHTML = avgYield.toFixed(2)+'<span class="unit">%</span>';
  const deltaEl = document.getElementById('total-delta');
  deltaEl.textContent = `${signed(delta)}円 (${deltaPct>=0?'+':''}${deltaPct.toFixed(2)}%)`;
  deltaEl.className = 'sum-delta ' + (delta>=0?'positive':'negative');
  document.getElementById('yoc').textContent = `YoC ${yoc.toFixed(2)}%`;
}

async function renderWatchlist(){
  const tbody = document.getElementById('watch-tbody');
  if(state.watchlist.length===0){
    tbody.innerHTML = '<tr><td colspan="7" class="empty">お気に入り銘柄がありません。</td></tr>';
    return;
  }
  const rows = await Promise.all(state.watchlist.map(async w=>{
    const q = await getPrice(w.code);
    const change = q.price - q.prev;
    const changePct = q.prev > 0 ? (change/q.prev)*100 : 0;
    const divYield = q.div > 0 && q.price > 0 ? (q.div/q.price)*100 : 0;
    return `
      <tr class="row">
        <td>
          <span class="ticker">${w.code}</span>
          <span class="company">${w.name}</span>
        </td>
        <td class="num">${q.price > 0 ? yenDec(q.price) : '—'}</td>
        <td class="num ${change>=0?'positive':'negative'}">${q.price > 0 ? signed(change) : '—'}${q.price > 0 ? `<br><small>${changePct>=0?'+':''}${changePct.toFixed(2)}%</small>` : ''}</td>
        <td class="num">${divYield>0?pct(divYield):'—'}</td>
        <td class="num">${q.div>0?yenDec(q.div)+'/株':'—'}</td>
        <td><small style="color:var(--muted)">${w.memo||''}</small></td>
        <td><button class="btn btn-sm btn-danger" onclick="removeWatch('${w.id}')">×</button></td>
      </tr>
    `;
  }));
  tbody.innerHTML = rows.join('');
}

async function renderAlerts(){
  const list = document.getElementById('alert-list');
  if(state.alerts.length===0){
    list.innerHTML = '<div class="empty">通知設定がありません。</div>';
    return;
  }
  const items = await Promise.all(state.alerts.map(async a=>{
    const q = await getPrice(a.code);
    const badge = a.triggered ? 'badge-triggered' : (a.cond==='above'?'badge-above':'badge-below');
    const badgeLabel = a.triggered ? '発動済み' : (a.cond==='above'?'以上で通知':'以下で通知');
    return `
      <div class="alert-item">
        <div>
          <span class="ticker">${a.code}</span>
          <span class="company">${a.name}</span>
        </div>
        <div><span class="alert-badge ${badge}">${badgeLabel}</span></div>
        <div class="num" style="font-family:'JetBrains Mono',monospace;font-size:13px">閾値 ${yenDec(a.price)}</div>
        <div class="num" style="font-family:'JetBrains Mono',monospace;font-size:13px">現在 ${q.price > 0 ? yenDec(q.price) : '—'}</div>
        <div><button class="btn btn-sm btn-danger" onclick="removeAlert('${a.id}')">×</button></div>
      </div>
    `;
  }));
  list.innerHTML = items.join('');
}

function renderBrokers(){
  document.getElementById('broker-grid').innerHTML = BROKERS.map(b=>`
    <div class="broker-card">
      <div>
        <div class="broker-name">${b.name}</div>
        <div class="broker-url">${b.url.replace('https://','')}</div>
      </div>
      <a href="${b.url}" target="_blank" rel="noopener" class="btn btn-sm">開く ↗</a>
    </div>
  `).join('');
}

function renderSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!useFirebase) {
    el.innerHTML = '<span style="color:var(--muted)">ローカルのみ</span>';
    return;
  }
  if (firebaseReady && FirebaseSync.isSignedIn()) {
    const info = FirebaseSync.getUserInfo();
    el.innerHTML = `<span class="positive">● 同期中</span> <small>${info.email}</small> <button class="btn btn-sm" onclick="signOutFirebase()">ログアウト</button>`;
  } else {
    el.innerHTML = `<button class="btn btn-sm btn-primary" onclick="signInFirebase()">Googleでログインして同期</button>`;
  }
}

function renderPriceStatus() {
  const el = document.getElementById('price-status');
  if (!el) return;
  if (priceMeta.updatedAt) {
    el.textContent = `株価: ${formatRelativeTime(priceMeta.updatedAt)} 取得 (yfinance / 約20分遅延)`;
  } else {
    el.textContent = '株価データ未取得';
  }
}

// ============================================
// 操作
// ============================================
function toggleForm(id){
  const el = document.getElementById(id);
  el.style.display = el.style.display==='none' ? 'block' : 'none';
}

async function toggleFav(id){
  if(state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  await saveFavorites();
  await renderHoldings();
}

function nextLocalId(items) {
  return Math.max(0, ...items.map(x => Number(x.id) || 0)) + 1;
}

async function addHolding(){
  const code = document.getElementById('h-code').value.trim();
  const name = document.getElementById('h-name').value.trim();
  const shares = parseFloat(document.getElementById('h-shares').value);
  const cost = parseFloat(document.getElementById('h-cost').value);
  const div = parseFloat(document.getElementById('h-div').value) || 0;
  if(!code||!name||!shares||!cost){ showToast('入力エラー','すべての必須項目を入力してください'); return; }

  const item = { code, name, shares, cost, div };
  if (firebaseReady) {
    item.id = String(Date.now()) + Math.floor(Math.random()*1000);
    await DB.updateHolding(item);
    await FirebaseSync.upsert('holdings', item);
  } else {
    const id = await DB.addHolding(item);
    item.id = id;
    state.holdings.push(item);
  }
  ['h-code','h-name','h-shares','h-cost','h-div'].forEach(i=>document.getElementById(i).value='');
  toggleForm('holding-form');
  await renderHoldings();
  showToast('登録完了', `${name}を保有銘柄に追加しました`);

  // 銘柄が GitHub Actions の取得対象になっていない場合の案内
  if (!priceData[code]) {
    setTimeout(() => showToast('お知らせ', `${code} は株価取得リストに未登録です。READMEを参照してtickers.jsonに追加してください`), 1500);
  }
}

async function removeHolding(id){
  if(!confirm('この銘柄を削除しますか？')) return;
  await DB.deleteHolding(id);
  state.holdings = state.holdings.filter(h=>String(h.id)!==String(id));
  state.favorites.delete(id);
  await saveFavorites();
  if (firebaseReady) await FirebaseSync.remove('holdings', id);
  await renderHoldings();
}

async function addWatch(){
  const code = document.getElementById('w-code').value.trim();
  const name = document.getElementById('w-name').value.trim();
  const memo = document.getElementById('w-memo').value.trim();
  if(!code||!name){ showToast('入力エラー','コードと銘柄名は必須です'); return; }

  const item = { code, name, memo };
  if (firebaseReady) {
    item.id = String(Date.now()) + Math.floor(Math.random()*1000);
    await DB.updateHolding ? null : null;
    await DB.addWatch ? null : null;
    // 上の2行はno-op、Firestore側がソースオブトゥルース
    await FirebaseSync.upsert('watchlist', item);
  } else {
    const id = await DB.addWatch(item);
    item.id = id;
    state.watchlist.push(item);
  }
  ['w-code','w-name','w-memo'].forEach(i=>document.getElementById(i).value='');
  toggleForm('watch-form');
  await renderWatchlist();
  showToast('登録完了', `${name}をお気に入りに追加しました`);
}

async function removeWatch(id){
  await DB.deleteWatch(id);
  state.watchlist = state.watchlist.filter(w=>String(w.id)!==String(id));
  if (firebaseReady) await FirebaseSync.remove('watchlist', id);
  await renderWatchlist();
}

async function addAlert(){
  const code = document.getElementById('a-code').value.trim();
  const name = document.getElementById('a-name').value.trim();
  const cond = document.getElementById('a-cond').value;
  const price = parseFloat(document.getElementById('a-price').value);
  if(!code||!name||!price){ showToast('入力エラー','すべての項目を入力してください'); return; }

  const item = { code, name, cond, price, triggered:false };
  if (firebaseReady) {
    item.id = String(Date.now()) + Math.floor(Math.random()*1000);
    await FirebaseSync.upsert('alerts', item);
  } else {
    const id = await DB.addAlert(item);
    item.id = id;
    state.alerts.push(item);
  }
  ['a-code','a-name','a-price'].forEach(i=>document.getElementById(i).value='');
  toggleForm('alert-form');
  await renderAlerts();
  showToast('通知を設定','株価が条件を満たしたら通知します');
}

async function removeAlert(id){
  await DB.deleteAlert(id);
  state.alerts = state.alerts.filter(a=>String(a.id)!==String(id));
  if (firebaseReady) await FirebaseSync.remove('alerts', id);
  await renderAlerts();
}

// ============================================
// 株価更新 & アラートチェック
// ============================================
async function refreshPrices(){
  showToast('株価更新中', 'prices.json を取得しています...');
  const ok = await fetchPricesFromJson();
  await renderHoldings();
  await renderWatchlist();
  await renderAlerts();
  await checkAlerts();
  renderPriceStatus();
  showToast(ok ? '更新完了' : '取得失敗', ok ? `${priceMeta.successCount}銘柄の株価を更新しました` : 'オフラインの可能性があります');
}

async function checkAlerts(){
  for (const a of state.alerts) {
    if(a.triggered) continue;
    const q = await getPrice(a.code);
    if (!q.price) continue;
    const hit = (a.cond==='above' && q.price >= a.price) ||
                (a.cond==='below' && q.price <= a.price);
    if(hit){
      a.triggered = true;
      await DB.updateAlert(a);
      if (firebaseReady) await FirebaseSync.upsert('alerts', a);
      const msg = `${a.name} (${a.code}) が ${yenDec(a.price)} を${a.cond==='above'?'上回りました':'下回りました'}。現在株価: ${yenDec(q.price)}`;
      showToast('株価アラート ⚠', msg);
      if('Notification' in window && Notification.permission==='granted'){
        new Notification('配当台帳: 株価アラート', { body: msg, icon:'./icon-192.png' });
      }
    }
  }
  await renderAlerts();
}

function requestNotifPermission(){
  if(!('Notification' in window)){
    showToast('通知非対応', 'このブラウザは通知に対応していません');
    return;
  }
  Notification.requestPermission().then(p=>{
    showToast('通知設定', p==='granted' ? '通知が有効になりました' : '通知が拒否されました');
  });
}

// ============================================
// CSV Import
// ============================================
function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(s=>s.trim());
  return lines.slice(1).map(line=>{
    const vals = line.split(',').map(s=>s.trim());
    const obj = {};
    headers.forEach((h,i)=> obj[h] = vals[i]);
    return obj;
  });
}

async function handleCSV(file){
  const reader = new FileReader();
  reader.onload = async e=>{
    try {
      const rows = parseCSV(e.target.result);
      let added = 0;
      for (const r of rows) {
        if(!r.code || !r.name || !r.shares || !r.cost) continue;
        const item = {
          code:r.code, name:r.name,
          shares:parseFloat(r.shares), cost:parseFloat(r.cost),
          div:parseFloat(r.dividend_per_share||0)
        };
        if (firebaseReady) {
          item.id = String(Date.now()) + Math.floor(Math.random()*10000) + added;
          await FirebaseSync.upsert('holdings', item);
        } else {
          const id = await DB.addHolding(item);
          state.holdings.push({ id, ...item });
        }
        added++;
      }
      await renderHoldings();
      showToast('CSV取り込み完了', `${added}件の銘柄を追加しました`);
      document.querySelector('[data-tab="portfolio"]').click();
    } catch(err){
      console.error(err);
      showToast('CSV読込エラー', 'ファイル形式をご確認ください');
    }
  };
  reader.readAsText(file);
}

// ============================================
// バックアップ
// ============================================
async function exportBackup(){
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dividend-ledger-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('バックアップ完了', 'JSONファイルをダウンロードしました');
}

function triggerImport(){
  document.getElementById('backup-file').click();
}

async function handleBackupImport(file){
  const reader = new FileReader();
  reader.onload = async e=>{
    try {
      const data = JSON.parse(e.target.result);
      if(!confirm('現在のデータに追加でインポートします。よろしいですか？')) return;
      await DB.importAll(data);
      await loadState();
      await renderAll();
      showToast('インポート完了', 'データを復元しました');
    } catch(err){
      showToast('インポート失敗', 'ファイル形式が正しくありません');
    }
  };
  reader.readAsText(file);
}

// ============================================
// Firebase
// ============================================
async function signInFirebase() {
  try {
    await FirebaseSync.signIn();
  } catch (err) {
    showToast('ログイン失敗', err.message);
  }
}

async function signOutFirebase() {
  await FirebaseSync.signOut();
  showToast('ログアウト完了', 'ローカルモードに戻りました');
  firebaseReady = false;
  await loadState();
  await renderAll();
  renderSyncStatus();
}

async function initFirebase() {
  if (!window.USE_FIREBASE) {
    useFirebase = false;
    renderSyncStatus();
    return;
  }
  if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    console.warn('[Firebase] config not set');
    useFirebase = false;
    renderSyncStatus();
    return;
  }
  useFirebase = true;
  try {
    const { FirebaseSync } = window;
    await FirebaseSync.init(window.FIREBASE_CONFIG);

    FirebaseSync.onAuthChange = async (user) => {
      if (user) {
        firebaseReady = true;
        // 初回ログイン時: ローカルデータをFirestoreに上げる（必要に応じ）
        const remote = await FirebaseSync.pullAll();
        const hasRemote = remote.holdings.length || remote.watchlist.length || remote.alerts.length;
        const hasLocal = state.holdings.length || state.watchlist.length || state.alerts.length;
        if (!hasRemote && hasLocal) {
          if (confirm('クラウドに保存されたデータがありません。現在のローカルデータをアップロードしますか？')) {
            await FirebaseSync.pushAll({
              holdings: state.holdings,
              watchlist: state.watchlist,
              alerts: state.alerts,
              settings: { favorites: Array.from(state.favorites) }
            });
          }
        }
        showToast('同期開始', `${user.email} としてログイン中`);
      } else {
        firebaseReady = false;
      }
      renderSyncStatus();
    };

    FirebaseSync.onDataChange = async (storeName, items) => {
      // FirestoreからのリアルタイムプッシュをIndexedDBに反映
      await DB.replaceStore(storeName, items);
      state[storeName] = items;
      if (storeName === 'holdings') await renderHoldings();
      if (storeName === 'watchlist') await renderWatchlist();
      if (storeName === 'alerts') await renderAlerts();
    };
  } catch (err) {
    console.error('[Firebase] init error:', err);
    useFirebase = false;
    showToast('Firebase初期化失敗', 'ローカルモードで起動します');
  }
}

// ============================================
// Toast
// ============================================
let toastTimer;
function showToast(title, body){
  const t = document.getElementById('toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-body').textContent = body;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 4000);
}

// ============================================
// PWA Install
// ============================================
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'inline-block';
});

async function installApp() {
  if (!deferredInstallPrompt) {
    showToast('インストール', 'すでにインストール済みか、iOSでは共有メニューから「ホーム画面に追加」を選択してください');
    return;
  }
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') showToast('インストール完了', 'ホーム画面から起動できます');
  deferredInstallPrompt = null;
  document.getElementById('install-btn').style.display = 'none';
}

// ============================================
// 全体再描画
// ============================================
async function renderAll() {
  await renderHoldings();
  await renderWatchlist();
  await renderAlerts();
  renderBrokers();
  renderSyncStatus();
  renderPriceStatus();
}

// ============================================
// 初期化
// ============================================
async function init(){
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth()+1).padStart(2,'0');
  const d = String(today.getDate()).padStart(2,'0');
  const wd = ['日','月','火','水','木','金','土'][today.getDay()];
  document.getElementById('today').textContent = `${y}.${m}.${d} (${wd})`;

  // DB初期化 + シード
  await DB.seedIfEmpty();
  await loadState();

  // タブ切り替え
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    });
  });

  // CSV
  const drop = document.getElementById('csv-drop');
  const fileInput = document.getElementById('csv-file');
  fileInput.addEventListener('change', e=>{
    if(e.target.files[0]) handleCSV(e.target.files[0]);
  });
  ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev, e=>{
    e.preventDefault(); drop.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev, e=>{
    e.preventDefault(); drop.classList.remove('drag');
  }));
  drop.addEventListener('drop', e=>{
    if(e.dataTransfer.files[0]) handleCSV(e.dataTransfer.files[0]);
  });

  // バックアップインポート
  const backupInput = document.getElementById('backup-file');
  if (backupInput) {
    backupInput.addEventListener('change', e => {
      if(e.target.files[0]) handleBackupImport(e.target.files[0]);
    });
  }

  // 1. 株価データを取得（アプリ起動時）
  await fetchPricesFromJson();

  // 2. Firebase 初期化（任意）
  await initFirebase();

  // 3. 初期描画
  await renderAll();
  await checkAlerts();

  // 4. 定期処理: 1時間ごとに株価再取得 + アラート確認
  setInterval(async () => {
    await fetchPricesFromJson();
    await renderHoldings();
    await renderWatchlist();
    await renderAlerts();
    await checkAlerts();
    renderPriceStatus();
  }, 60 * 60 * 1000);  // 1時間

  // 5. タブが表示状態に戻った時 (visibilitychange) も再取得
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      // 最後の取得から5分以上経過していたら再取得
      const last = priceMeta.updatedAt ? new Date(priceMeta.updatedAt) : null;
      if (!last || Date.now() - last.getTime() > 5 * 60 * 1000) {
        await fetchPricesFromJson();
        await renderHoldings();
        await renderWatchlist();
        await renderAlerts();
        renderPriceStatus();
      }
    }
  });

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('[PWA] Service Worker 登録失敗:', err);
    }
  }
}

init();
