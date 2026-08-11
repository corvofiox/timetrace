// ===== Timetrace 2.0 · 琉璃 Glass — 应用主逻辑 =====
// ===== 工具 =====
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const WDS = ['日','一','二','三','四','五','六'];

// ===== 全局状态 =====
// appData 由 api.js 的 _getLocalUserId() 引用（跨标签页 token 广播按用户隔离）
const appData = {
  user: null,
  goals: [],                    // 目标列表（服务端 order 顺序）
  settings: { theme:'default', hideWeekend:false, startMonday:true, notify:true }
};
const state = { days: new Map() };          // 'YYYY-MM-DD' → day {id,date,tasks:[{title,completed}],summary,timeEntries}
const DEFAULT_SETTINGS = { theme:'default', hideWeekend:false, startMonday:true, notify:true };
// 主题白名单（body[data-theme]；旧 localStorage 值 'blue'/'green' 同名保留 → 天然兼容）
const THEMES = ['default','blue','green','rose','amber','teal','slate','dark'];
let settings = Object.assign({}, DEFAULT_SETTINGS);
let settingsKey = null;                     // 'timetrace2.settings.${userId}'（按用户隔离）

// 视图状态（0-indexed 月份）；「今天」= 真实日期
const TODAY = new Date();
const todayD = TODAY.getDate();
let viewYear = TODAY.getFullYear(), viewMonth = TODAY.getMonth();
const MIN_YEAR = 1900, MAX_YEAR = 2100;
const YM = (y,m) => `${y}-${String(m+1).padStart(2,'0')}`;
const YMD = (y,m,d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const dim = (y,m) => new Date(y, m+1, 0).getDate();
let pickSet = new Set();
let pickYear = TODAY.getFullYear(), pickMonth = TODAY.getMonth(); // 「指定日期」迷你日历独立年月（不与主视图联动）
let popTarget = 'main'; // 年月选择器目标：'main' 主日历 | 'pick' 迷你日历
let batchTasks = [];
// R5-4：月度统计粒度（'month' | 'year'）+ 渲染序号（防过期补拉结果覆盖）
let msGran = 'month';
let msSeq = 0;

// 保存队列（按日期串行 drain，防快速连续 toggle 竞态）
const daySaveQueue = new Map();             // dateStr → 重试次数
const daySaveAttempts = new Map();          // dateStr → 已尝试次数
let daySaveInFlight = false;
// R5-4 竞态修复：保存请求飞行中的日期集合。drain 出队早于请求发出，daySaveQueue 保护窗口
// 在保存飞行期间失效 → R5-4 补拉（ensureRangeLoaded）响应可能用旧快照覆盖本地未落库改动（如备注）。
// mergeServerDays 增加该集合检查，保存落地前补拉不覆盖该日期。
const daySaveFlyingDates = new Set();
// R5 复审：保存彻底失败（重试 3 次放弃）后本地未落库改动的日期集合。放弃条目加入 →
// mergeServerDays 跳过该日期（防切季/年视图或批量清除预览时旧快照覆盖本地改动）；保存成功后清除。
const daysDirty = new Set();
let retryTimer = null;                      // R3-1：失败重试定时器句柄（resetSessionState 可取消）

// 会话代际：登出/换账号后丢弃旧会话在飞行中的异步写回
let sessionEpoch = 0;

// 目标
let goalsByDate = new Map();                // 'YYYY-MM-DD' → [{ga, gb}, ...]（renderCalendar 的 goal-mark）
let editingGoal = null;                     // 当前编辑的卡片 DOM
let editingGoalId = null;                   // 当前编辑的目标 id
let goalMode = 'edit';                      // 'edit' | 'create'
let goalColorTouched = false;               // 本次抽屉会话用户是否点选过色板（防静默改色）
let goalTimers = [];                        // 目标卡倒计时定时器（重建时统一清理）

// 任务编辑
let editingTask = null;
let taskReturn = null;                      // 任务详情来源：{type:'grid'} 或 {type:'day', dateStr}
let searchSeq = 0;                          // 搜索响应序号（防慢响应覆盖新结果）

// ===== Toast =====
let toastTimer = null;
function toast(msg, withBar=false){
  $('#toast-msg').textContent = msg;
  const bar = $('#toast-bar');
  bar.style.width = '0';
  $('#toast').classList.add('show');
  if (withBar) {
    let p = 0;
    clearInterval(toastTimer);
    toastTimer = setInterval(() => {
      p += 3.2; bar.style.width = Math.min(100, p) + '%';
      if (p >= 100) { clearInterval(toastTimer); setTimeout(() => $('#toast').classList.remove('show'), 350); }
    }, 40);
  } else {
    clearTimeout(toastTimer); toastTimer = null;
    setTimeout(() => $('#toast').classList.remove('show'), 1800);
  }
}

// ===== 弹窗开关 =====
function openDrawer(id){ $('#'+id).classList.add('open'); $('#overlay').classList.add('show'); }
function closeAll(){
  $$('.drawer').forEach(d => d.classList.remove('open'));
  $('#overlay').classList.remove('show');
  closeMonthPop();
}
$$('.close-x').forEach(b => b.addEventListener('click', closeAll));
$('#overlay').addEventListener('click', closeAll);

// ===== 数据层 =====
function hasCheckin(daysMap, dateStr){
  return hasCheckinDay(daysMap.get(dateStr));
}
// 1.0 打卡语义：有任务且全部完成才算打卡（仅摘要不算）
function hasCheckinDay(day){
  return !!(day && Array.isArray(day.tasks) && day.tasks.length > 0 && day.tasks.every(t => t.completed));
}
// 日期状态判定（时区安全：'T00:00:00' 按本地时区解析，避免 UTC 回退一天；YYYY-MM-DD 可字符串比较，双保险）
// R5-6/7/8 三处 past/today 判定同源，杜绝边界漂移
function dateState(dateStr){
  const todayStr = fmtD(TODAY);
  if (dateStr === todayStr) return 'today';
  return new Date(dateStr + 'T00:00:00') < new Date(todayStr + 'T00:00:00') ? 'past' : 'future';
}

// 拉取某月数据 → 合并入 state.days → 重绘
// 服务端日数据合并：跳过 daySaveQueue 中仍在队的日期（本地未保存改动为权威，防旧响应覆盖）
function mergeServerDays(days){
  (days || []).forEach(day => { if (day && day.date && !daySaveQueue.has(day.date) && !daySaveFlyingDates.has(day.date) && !daysDirty.has(day.date)) state.days.set(day.date, day); });
}
async function loadMonth(y, m){
  const startDate = YMD(y, m, 1);
  const endDate = YMD(y, m, dim(y, m));
  const epochAtStart = sessionEpoch;
  try {
    const res = await api.getDays(startDate, endDate);
    if (sessionEpoch !== epochAtStart) return;
    mergeServerDays(res && res.data);
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    ErrorHandler.handle(err, '加载日计划', { silent: true });
  }
  if (sessionEpoch !== epochAtStart) return;
  renderCalendar();
}

// 补拉缺失日期范围（批量合并/搜索跳转前）；网络失败向上抛（调用方中止并提示）
async function ensureRangeLoaded(startDate, endDate){
  const missing = [];
  const d = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (d <= end) {
    const ds = fmtD(d);
    if (!state.days.has(ds)) missing.push(ds);
    d.setDate(d.getDate() + 1);
  }
  if (!missing.length) return;
  const epochAtStart = sessionEpoch;
  const res = await api.getDays(startDate, endDate);
  if (sessionEpoch !== epochAtStart) return;
  mergeServerDays(res && res.data);
}

// 保存单日：payload 只含 {date, tasks, summary}，绝不传 timeEntries（D2 回读红线）
async function saveDayNow(dateStr){
  daySaveFlyingDates.add(dateStr);           // R5-4 竞态修复：请求飞行期间补拉不得覆盖
  const epochAtStart = sessionEpoch;
  let saved = false;
  try {
    const day = state.days.get(dateStr);
    const payload = {
      date: dateStr,
      tasks: (day && Array.isArray(day.tasks)) ? day.tasks : [],
      summary: (day && day.summary) || ''
    };
    const res = await api.createOrUpdateDay(payload);
    if (sessionEpoch !== epochAtStart) return res;
    if (res && res.data === null) {
      // D1：内容全空 → 后端自动删除该日 → 本地同步移除（防幽灵日）
      state.days.delete(dateStr);
      renderCalendar();
      updateToday();
    }
    // 响应非 null 时不回写 state：本地是权威（1) 旧响应快照可能覆盖队列中更新的任务；
    // 2) 回写会替换任务对象引用，导致已渲染抽屉行与 state 脱钩）
    saved = true;                             // R5 复审：落库成功标志（含空日删除场景）
    return res;
  } catch (err) {
    // P2-2：d-save 直调失败无队列重试，必须标记脏防止补拉覆盖
    if (sessionEpoch === epochAtStart) daysDirty.add(dateStr);
    throw err;                                // 保留原错误传播（调用方 ErrorHandler 逻辑不变）
  } finally {
    daySaveFlyingDates.delete(dateStr);
    if (saved) daysDirty.delete(dateStr);     // R5 复审：保存成功解除脏标记；失败保留（由 drain 决定重试或放弃）
  }
}

// 入队保存（取最新快照，串行 drain）
function queueDaySave(dateStr){
  if (daySaveQueue.has(dateStr)) return;
  daySaveQueue.set(dateStr, true);
  drainDaySaveQueue();
}

async function drainDaySaveQueue(){
  if (daySaveInFlight) return;
  daySaveInFlight = true;
  const epoch = sessionEpoch; // R3-1：入口快照会话纪元，登出/换账号后放弃重试（防陈旧队列用新 token 保存空日）
  try {
    while (daySaveQueue.size > 0) {
      if (sessionEpoch !== epoch) return; // 会话已变（登出/强制登出）：丢弃残留队列
      const dateStr = daySaveQueue.keys().next().value;
      daySaveQueue.delete(dateStr);
      try {
        await saveDayNow(dateStr);
        daySaveAttempts.delete(dateStr);
      } catch (err) {
        if (sessionEpoch !== epoch) return; // 失败晚于会话切换：不得重入队/排定时器
        const n = (daySaveAttempts.get(dateStr) || 0) + 1;
        daySaveAttempts.set(dateStr, n);
        if (n < 3) {
          // 前两次失败：提示用户并 3 秒后主动重试（保留串行语义，避免静默搁置）
          daySaveQueue.set(dateStr, true);
          ErrorHandler.handle(err, '保存日计划');
          toast('保存失败，正在重试…');
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { retryTimer = null; drainDaySaveQueue(); }, 3000);
        } else {
          daySaveAttempts.delete(dateStr);
          daysDirty.add(dateStr);             // R5 复审：彻底放弃 → 标记脏日期，补拉不得用旧快照覆盖本地改动
          ErrorHandler.handle(err, '保存日计划');
          toast('保存失败，请重试');
        }
        break; // 失败即停，避免紧循环
      }
    }
  } finally {
    daySaveInFlight = false;
  }
}

// 任务完成状态翻转（今日卡/日计划抽屉共用）
function taskToggle(dateStr, idx){
  const day = state.days.get(dateStr);
  if (!day || !Array.isArray(day.tasks)) return;
  const t = day.tasks[idx];
  if (!t) return;
  t.completed = !t.completed;
  renderCalendar();
  updateToday();
  updateStreakCards();
  queueDaySave(dateStr);
}

// ===== 目标卡倒计时 =====
function initCountdown(card){
  const target = new Date(card.dataset.target).getTime();
  const start = new Date(card.dataset.start).getTime();
  const els = {
    d: card.querySelector('.u-d'), h: card.querySelector('.u-h'),
    m: card.querySelector('.u-m'), s: card.querySelector('.u-s')
  };
  const fill = card.querySelector('.gc-fill');
  const pct = card.querySelector('.gc-pct');
  const elapsed = card.querySelector('.gm-elapsed');
  const left = card.querySelector('.gm-left');
  const tick = () => {
    const now = Date.now();
    let diff = Math.max(0, target - now);
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000); diff -= h * 3600000;
    const m = Math.floor(diff / 60000); diff -= m * 60000;
    const s = Math.floor(diff / 1000);
    els.d.textContent = d; els.h.textContent = String(h).padStart(2,'0');
    els.m.textContent = String(m).padStart(2,'0'); els.s.textContent = String(s).padStart(2,'0');
    const span = target - start;
    const p = span > 0 ? Math.min(100, Math.max(0, Math.round((now - start) / span * 100))) : 0;
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
    if (elapsed) elapsed.textContent = Math.max(0, Math.floor((now - start) / 86400000));
    if (left) left.textContent = Math.max(0, Math.ceil((target - now) / 86400000));
  };
  tick();
  goalTimers.push(setInterval(tick, 1000));
}
function clearGoalTimers(){
  goalTimers.forEach(t => clearInterval(t));
  goalTimers = [];
}

// ===== 目标卡拖拽 =====
const goalsRow = $('.goals-row');
let dragEl = null;
function bindGoalDrag(card){
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', e => { dragEl = card; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  card.addEventListener('dragover', e => {
    if (!dragEl || dragEl === card) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const r = card.getBoundingClientRect();
    card.classList.toggle('drop-before', e.clientY < r.top + r.height / 2);
    card.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2);
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragEl || dragEl === card) return;
    const r = card.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) goalsRow.insertBefore(dragEl, card);
    else goalsRow.insertBefore(dragEl, card.nextSibling);
    card.classList.remove('drop-before', 'drop-after');
  });
  card.addEventListener('dragend', onGoalDragEnd);
}
// 拖拽结束 → 持久化新顺序；失败回滚渲染
async function onGoalDragEnd(){
  $$('.goal-card').forEach(c => c.classList.remove('dragging','drop-before','drop-after'));
  dragEl = null;
  const ids = $$('.goal-card').map(c => c.dataset.id);
  const prev = appData.goals.map(g => String(g.id));
  if (ids.length === 0 || ids.join(',') === prev.join(',')) return;
  const epochAtStart = sessionEpoch;
  try {
    await api.updateGoalOrder(ids);
    if (sessionEpoch !== epochAtStart) return;
    const byId = new Map(appData.goals.map(g => [String(g.id), g]));
    appData.goals = ids.map(id => byId.get(id)).filter(Boolean);
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    rebuildGoalsDOM();
    ErrorHandler.handle(err, '目标排序');
  }
}

// ===== 目标颜色 =====
const GOAL_COLOR_PRESETS = [
  ['#6366f1', '#a855f7'],
  ['#f97316', '#ec4899'],
  ['#10b981', '#06b6d4'],
  ['#14b8a6', '#3b82f6'],
  ['#f59e0b', '#ef4444'],
  ['#3498db', '#5dade2'],   // 1.0 旧目标默认色（单色 #3498db 编辑时可选中）
  ['#e11d48', '#f43f5e'],   // 玫红
  ['#ec4899', '#f472b6'],   // 粉
  ['#4f46e5', '#6366f1'],   // 靛蓝
  ['#0ea5e9', '#38bdf8'],   // 天蓝
  ['#059669', '#34d399'],   // 翠绿
  ['#0d9488', '#2dd4bf'],   // 青碧
  ['#ca8a04', '#eab308'],   // 柠檬
  ['#ea580c', '#f97316'],   // 橙
  ['#dc2626', '#ef4444'],   // 朱红
  ['#475569', '#64748b']    // 炭灰
];
// '#ga,#gb' | '#hex' → {ga, gb}；单色 → ga=gb（渐变退化为纯色卡，兼容 1.0 旧数据）；非法 → 默认双色
function parseGoalColor(color){
  if (typeof color === 'string' && color) {
    const parts = color.split(',').map(s => s.trim()).filter(s => /^#[0-9a-fA-F]{6}$/.test(s) || /^#[0-9a-fA-F]{3}$/.test(s));
    if (parts.length >= 2) return { ga: parts[0], gb: parts[1] };
    if (parts.length === 1) return { ga: parts[0], gb: parts[0] };
  }
  return { ga: '#6366f1', gb: '#a855f7' };
}

// ===== 目标列表 =====
async function renderGoals(){
  const epochAtStart = sessionEpoch;
  try {
    const res = await api.getGoals();
    if (sessionEpoch !== epochAtStart) return;
    appData.goals = (res && res.data) || [];
    rebuildGoalsDOM();
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    appData.goals = [];
    rebuildGoalsDOM();
    ErrorHandler.handle(err, '加载目标', { silent: true });
  }
}

// 重建目标卡 DOM + goalsByDate（日历 goal-mark 数据源）
function rebuildGoalsDOM(){
  clearGoalTimers();
  $$('.goal-card').forEach(c => c.remove());
  goalsByDate = new Map();
  appData.goals.forEach(goal => {
    createGoalCard(goal);
    // goal.date 当天显示该目标主色点（1.0 语义）
    if (goal.date && /^\d{4}-\d{2}-\d{2}$/.test(goal.date)) {
      const arr = goalsByDate.get(goal.date) || [];
      arr.push({ ga: parseGoalColor(goal.color).ga });
      goalsByDate.set(goal.date, arr);
    }
  });
  renderCalendar();
}

// 目标截止日期解析：'YYYY-MM-DD' → 当天 23:59:59（本地时区）；非法 → 90 天后兜底
function parseGoalTarget(date){
  if (typeof date === 'string' && date) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(date + 'T23:59:59');
    const t = new Date(date);
    if (!isNaN(t.getTime())) return t;
  }
  return new Date(Date.now() + 90 * 86400000);
}
const isoD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// 创建目标卡（接收 goal 对象；开始日期 = createdAt，截止日期 = goal.date）
function createGoalCard(goal){
  const { ga, gb } = parseGoalColor(goal.color);
  const start = goal.createdAt ? new Date(goal.createdAt) : new Date();
  const target = parseGoalTarget(goal.date);
  const el = document.createElement('div');
  el.className = 'goal-card glass';
  el.dataset.id = goal.id;
  el.dataset.start = start.toISOString();
  el.dataset.target = target.toISOString();
  el.style.setProperty('--ga', ga);
  el.style.setProperty('--gb', gb);
  el.innerHTML =
    '<div class="gc-head">' +
      '<span class="gc-dot"></span>' +
      '<span class="gc-name"></span>' +
      '<span class="gc-date"></span>' +
    '</div>' +
    '<div class="gc-count">' +
      '<div class="gc-unit"><b class="u-d">0</b><span>天</span></div><div class="gc-sep">:</div>' +
      '<div class="gc-unit"><b class="u-h">00</b><span>时</span></div><div class="gc-sep">:</div>' +
      '<div class="gc-unit"><b class="u-m">00</b><span>分</span></div><div class="gc-sep">:</div>' +
      '<div class="gc-unit"><b class="u-s">00</b><span>秒</span></div>' +
    '</div>' +
    '<div class="gc-meta">' +
      '<span><span class="gm-dot"></span>已进行 <b class="gm-elapsed">0</b> 天</span>' +
      '<span>剩余 <b class="gm-left">0</b> 天</span>' +
    '</div>' +
    '<div class="gc-foot">' +
      '<div class="gc-track"><div class="gc-fill"></div></div>' +
      '<span class="gc-pct">0%</span>' +
    '</div>';
  el.querySelector('.gc-name').textContent = goal.title;
  el.querySelector('.gc-date').textContent = `截止 ${target.getFullYear()}年${target.getMonth()+1}月${target.getDate()}日`;
  bindGoalDrag(el);
  el.addEventListener('click', () => openGoalDrawer(el));
  initCountdown(el);
  $('#goal-add').insertAdjacentElement('beforebegin', el);
  return el;
}

// ===== 目标编辑 / 新建 =====
function openGoalDrawer(card){
  goalMode = 'edit';
  goalColorTouched = false;
  editingGoal = card;
  editingGoalId = card.dataset.id || null;
  const goal = editingGoalId ? appData.goals.find(g => String(g.id) === String(editingGoalId)) : null;
  const { ga } = parseGoalColor(goal ? goal.color : undefined);
  $('#g-name').value = goal ? goal.title : '';
  const start = goal && goal.createdAt ? new Date(goal.createdAt) : new Date();
  $('#g-start').value = isoD(start);
  $('#g-start').readOnly = true;
  const target = goal ? parseGoalTarget(goal.date) : new Date(Date.now() + 90 * 86400000);
  $('#g-target').value = isoD(target);
  $$('#g-colors .color-swat').forEach(s => s.classList.toggle('on', s.dataset.c1.toLowerCase() === ga.toLowerCase()));
  const now = Date.now(), st = start.getTime(), tg = target.getTime();
  $('#g-days').textContent = Math.max(0, Math.ceil((tg - now) / 86400000));
  $('#g-elapsed').textContent = Math.max(0, Math.floor((now - st) / 86400000));
  $('#g-pct').textContent = (tg > st ? Math.min(100, Math.max(0, Math.round((now - st) / (tg - st) * 100))) : 0) + '%';
  $('#g-desc').textContent = '编辑目标信息 · 修改实时生效';
  $('#g-delete').style.display = '';
  $('#g-save').textContent = '保存修改';
  openDrawer('goalDrawer');
}
function openGoalCreate(){
  goalMode = 'create';
  goalColorTouched = false;
  editingGoal = null;
  editingGoalId = null;
  $('#g-name').value = '';
  const now = new Date();
  const t = new Date(now); t.setDate(t.getDate() + 90);
  $('#g-start').value = isoD(now);
  $('#g-start').readOnly = true;
  $('#g-target').value = isoD(t);
  $$('#g-colors .color-swat').forEach(s => s.classList.toggle('on', s.dataset.c1 === '#6366f1'));
  $('#g-days').textContent = 90;
  $('#g-elapsed').textContent = 0;
  $('#g-pct').textContent = '0%';
  $('#g-desc').textContent = '新建目标 · 填写信息后点击创建';
  $('#g-delete').style.display = 'none';
  $('#g-save').textContent = '创建目标';
  openDrawer('goalDrawer');
}
$$('#g-colors .color-swat').forEach(s => s.addEventListener('click', () => {
  goalColorTouched = true;
  $$('#g-colors .color-swat').forEach(x => x.classList.remove('on'));
  s.classList.add('on');
}));
$('#goal-add').addEventListener('click', openGoalCreate);

// g-save：创建/更新走真实 API；color 存 '#ga,#gb' 逗号分隔双色
$('#g-save').addEventListener('click', async () => {
  const name = $('#g-name').value.trim() || '未命名目标';
  const sw = $('#g-colors .color-swat.on');
  const editingGoalObj = (goalMode === 'edit' && editingGoalId)
    ? appData.goals.find(g => String(g.id) === String(editingGoalId)) : null;
  // 未点选色板（旧单色/预设外颜色）→ 保留原 color，避免保存任意改动时静默改色
  const color = (goalColorTouched && sw)
    ? `${sw.dataset.c1},${sw.dataset.c2}`
    : ((editingGoalObj && editingGoalObj.color) || '#6366f1,#a855f7');
  const startV = $('#g-start').value, targetV = $('#g-target').value;
  if (!targetV){ toast('请填写目标日期'); return; }
  if (targetV <= startV){ toast('目标日期需晚于开始日期'); return; }
  const epochAtStart = sessionEpoch;
  try {
    if (goalMode === 'create'){
      const res = await api.createGoal({ title: name, color, date: targetV, description: '' });
      if (sessionEpoch !== epochAtStart) return;
      const goal = res && res.data;
      if (goal) { appData.goals.push(goal); rebuildGoalsDOM(); }
      closeAll(); toast('目标已创建 ✓');
    } else {
      if (!editingGoalId) return;
      const res = await api.updateGoal(editingGoalId, { title: name, color, date: targetV });
      if (sessionEpoch !== epochAtStart) return;
      const goal = res && res.data;
      if (goal) {
        const idx = appData.goals.findIndex(g => String(g.id) === String(editingGoalId));
        if (idx >= 0) appData.goals[idx] = goal; else appData.goals.push(goal);
        rebuildGoalsDOM();
      }
      closeAll(); toast('目标已保存 ✓');
    }
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    ErrorHandler.handle(err, '保存目标');
  }
});
$('#g-delete').addEventListener('click', async () => {
  if (!editingGoalId) return;
  const id = editingGoalId;
  const epochAtStart = sessionEpoch;
  try {
    await api.deleteGoal(id);
    if (sessionEpoch !== epochAtStart) return;
    appData.goals = appData.goals.filter(g => String(g.id) !== String(id));
    rebuildGoalsDOM();
    closeAll(); toast('目标已删除');
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    ErrorHandler.handle(err, '删除目标');
  }
});

// ===== 日历渲染 =====
function renderCalendar(){
  const grid = $('#grid');
  grid.innerHTML = '';
  grid.classList.toggle('no-weekend', settings.hideWeekend);
  const wds = $('#weekdays');
  wds.innerHTML = '';
  wds.classList.toggle('no-weekend', settings.hideWeekend);
  const order = settings.startMonday ? [1,2,3,4,5,6,0] : [0,1,2,3,4,5,6];
  order.forEach(wd => {
    if (settings.hideWeekend && (wd === 0 || wd === 6)) return;
    wds.insertAdjacentHTML('beforeend', `<div class="weekday ${wd===0||wd===6?'weekend-label':''}">${WDS[wd]}</div>`);
  });
  $('#cal-title').innerHTML = `${viewYear} 年 ${viewMonth+1} 月 <span class="cal-caret">▾</span>`;
  const daysIn = dim(viewYear, viewMonth);
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const offset = settings.startMonday ? (firstDay + 6) % 7 : firstDay;
  for (let i = 0; i < offset; i++) grid.insertAdjacentHTML('beforeend', '<div class="cell empty"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const dt = new Date(viewYear, viewMonth, d);
    const wd = dt.getDay();
    if (settings.hideWeekend && (wd === 0 || wd === 6)) continue;
    const dateStr = YMD(viewYear, viewMonth, d);
    const data = state.days.get(dateStr);
    const tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
    const st = dateState(dateStr);                 // R5-6：明暗反转（原 isFuture 语义 → isPast）
    const isToday = st === 'today';
    const isPast = st === 'past';
    let cls = ['cell', isToday?'today':'', isPast?'other':'', (wd===0||wd===6)?'weekend':''].join(' ');
    const gs = goalsByDate.get(dateStr);
    const hasGoal = !!(gs && gs.length);
    // R5-7：仅 past 且有任务 → 状态点（全完成绿 / 欠账红）；与 goal-mark 并存 → has-status 让位
    const status = (isPast && tasks.length > 0) ? (tasks.every(t => t.completed) ? 'ok' : 'bad') : null;
    if (status && hasGoal) cls += ' has-status';
    let html = `<div class="${cls}" data-d="${d}">`;
    html += `<div class="day-num">${d}${hasGoal ? `<span class="goal-mark" style="background:${gs[0].ga}"></span>` : ''}</div>`;
    if (status) html += `<span class="status-dot ${status}"></span>`;
    if (tasks.length) {
      html += '<div class="tasks-box">';
      // R5-8：past 未完成 → 欠账红（done/debt 构造互斥）
      tasks.slice(0,3).forEach((t, i) => html += `<div class="pill ${t.completed?'done':''}${(!t.completed && isPast)?' debt':''}" data-d="${d}" data-i="${i}">${esc(t.title)}</div>`);
      if (tasks.length > 3) html += `<div class="more">+${tasks.length-3} 项</div>`;
      html += '</div>';
    }
    html += '</div>';
    grid.insertAdjacentHTML('beforeend', html);
  }
  bindCalendarEvents();
  updateMonthStats();
}
// R5-4：统计范围（锚定 viewYear/viewMonth；年份恒为 viewYear 不跨年）
function msRange(){
  if (msGran === 'month') return { label: `${viewYear} 年 ${viewMonth+1} 月`, y0: viewYear, m0: viewMonth, m1: viewMonth };
  return { label: `${viewYear} 年`, y0: viewYear, m0: 0, m1: 11 };
}
// ===== 月度统计（跟随视图月/年，任何日历重绘后自动刷新；R5-4 重构 async+序号守卫+补拉） =====
async function updateMonthStats(){
  const seq = ++msSeq;
  const r = msRange();
  $('#ms-month').textContent = r.label;
  if (msGran !== 'month') {                       // 年：先补拉缺失日期（幂等：已有日期不发请求）
    try { await ensureRangeLoaded(YMD(r.y0, r.m0, 1), YMD(r.y0, r.m1, dim(r.y0, r.m1))); }
    catch (e) { /* 补拉失败静默降级：用已缓存数据渲染 */ }
  }
  if (seq !== msSeq) return;                       // 过期渲染丢弃（切换粒度/翻月期间）
  let total = 0, done = 0, active = 0;
  const bars = [];
  const pushBucket = (y, m, d1, d2, label) => {
    let bt = 0, bd = 0;
    for (let d = d1; d <= d2; d++){
      const ds = YMD(y, m, d);
      const arr = (state.days.get(ds) || {}).tasks;
      const tasks = Array.isArray(arr) ? arr : [];
      total += tasks.length; done += tasks.filter(t => t.completed).length;
      const chk = hasCheckinDay(state.days.get(ds)); if (chk) active++;
      bt += tasks.length; bd += tasks.filter(t => t.completed).length;
    }
    bars.push({ label, done: bd, total: bt, y, m, d: d1 === d2 ? d1 : null });
  };
  if (msGran === 'month') for (let d = 1; d <= dim(r.y0, r.m0); d++) pushBucket(r.y0, r.m0, d, d, `${r.m0+1} 月 ${d} 日`);
  else for (let m = r.m0; m <= r.m1; m++) pushBucket(r.y0, m, 1, dim(r.y0, m), `${m+1} 月`);
  $('#ms-total').textContent = total;
  $('#ms-done').textContent = done;
  $('#ms-rate').textContent = total ? Math.round(done / total * 100) + '%' : '—';
  $('#ms-days').textContent = active;
  const chart = $('#ms-chart'); chart.innerHTML = '';
  bars.forEach(b => {
    const el = document.createElement('div');
    el.className = 'ms-bar' + (b.total && b.done === b.total ? ' full' : '') + ' clickable';
    el.title = `${b.label} · ${b.done}/${b.total}`;
    el.style.height = (b.total ? Math.max(6, Math.round(b.done / b.total * 36)) : 3) + 'px';
    el.dataset.y = b.y; el.dataset.m = b.m;
    if (msGran === 'month') el.dataset.d = b.d;
    chart.appendChild(el);
  });
}
// R5-4：年粒度柱点击 → 主日历跳该月（loadMonth → renderCalendar → updateMonthStats 自动刷新）
$('#ms-chart').addEventListener('click', e => {
  const bar = e.target.closest('.ms-bar.clickable');
  if (!bar) return;
  // R7-x：月粒度日柱 → 复用主日历日格路径打开该日计划抽屉（空数据柱同样可点）
  if (bar.dataset.d) { openDayDrawer(Number(bar.dataset.d)); return; }
  const y = Number(bar.dataset.y), m = Number(bar.dataset.m);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 0 || m > 11) return;
  viewYear = y; viewMonth = m; loadMonth(y, m);
});
// R5-4v2：统计粒度下拉（标题点击，参照 monthPop 模式）
const MS_NAMES = { month:'月度统计', year:'年度统计' };
function openMsPop(){ $$('#msPop .ms-opt').forEach(o => o.classList.toggle('active', o.dataset.g === msGran)); $('#msPop').hidden = false; $('#ms-title').classList.add('open'); }
function closeMsPop(){ $('#msPop').hidden = true; $('#ms-title').classList.remove('open'); }
$('#ms-title').addEventListener('click', e => { e.stopPropagation(); $('#msPop').hidden ? openMsPop() : closeMsPop(); });
$('#msPop').addEventListener('click', e => { const o = e.target.closest('.ms-opt'); if (!o) return; msGran = o.dataset.g; $('#ms-title-text').textContent = MS_NAMES[msGran]; updateMonthStats(); closeMsPop(); });
document.addEventListener('mousedown', e => { if ($('#msPop').hidden) return; if (!e.target.closest('#msPop') && !e.target.closest('#ms-title')) closeMsPop(); });
// ===== 月份导航 =====
function shiftMonth(delta){
  let y = viewYear, m = viewMonth + delta;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  viewYear = y; viewMonth = m;
  loadMonth(y, m);
}
function goToday(){ viewYear = TODAY.getFullYear(); viewMonth = TODAY.getMonth(); loadMonth(viewYear, viewMonth); }
$('#cal-prev').addEventListener('click', () => shiftMonth(-1));
$('#cal-next').addEventListener('click', () => shiftMonth(1));
$('#cal-today').addEventListener('click', goToday);
// ===== 年月选择器（主日历 & 迷你日历共用，popTarget 决定目标）=====
function popYM(){ return popTarget === 'pick' ? [pickYear, pickMonth] : [viewYear, viewMonth]; }
function renderMonthPop(){
  const [y, m] = popYM();
  const box = $('#pop-months');
  box.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('button');
    b.className = 'm-cell' + (i === m ? ' cur' : '');
    b.textContent = (i + 1) + ' 月';
    b.addEventListener('click', async () => {
      const yy = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Number($('#pop-year').value) || y));
      if (popTarget === 'pick') { pickYear = yy; pickMonth = i; pickSet.clear(); renderMiniCal(); await updatePreview(); }
      else { viewYear = yy; viewMonth = i; loadMonth(yy, i); }
      closeMonthPop();
    });
    box.appendChild(b);
  }
  $('#pop-year').value = y;
}
function openMonthPop(target){
  popTarget = target || 'main';
  // 把选单节点挂到触发者所在宿主下，absolute 定位才跟随触发者（否则永远锚定主标题）
  const host = target === 'pick' ? $('#mini-cal-head-wrap') : document.querySelector('.cal-header');
  host.appendChild($('#monthPop'));
  renderMonthPop();
  $('#monthPop').hidden = false;
  $('#cal-title').classList.toggle('open', popTarget === 'main');
  $('#mini-cal-head').classList.toggle('open', popTarget === 'pick');
}
function closeMonthPop(){ $('#monthPop').hidden = true; $('#cal-title').classList.remove('open'); $('#mini-cal-head').classList.remove('open'); }
$('#cal-title').addEventListener('click', e => {
  e.stopPropagation();
  $('#monthPop').hidden ? openMonthPop('main') : closeMonthPop();
});
$('#mini-cal-head').addEventListener('click', e => {
  e.stopPropagation();
  $('#monthPop').hidden ? openMonthPop('pick') : closeMonthPop();
});
$('#pop-prev').addEventListener('click', e => { e.stopPropagation(); $('#pop-year').value = Math.max(MIN_YEAR, Number($('#pop-year').value) - 1); });
$('#pop-next').addEventListener('click', e => { e.stopPropagation(); $('#pop-year').value = Math.min(MAX_YEAR, Number($('#pop-year').value) + 1); });
$('#pop-year').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Number($('#pop-year').value) || popYM()[0]));
  if (popTarget === 'pick') { pickYear = y; pickMonth = 0; pickSet.clear(); renderMiniCal(); await updatePreview(); }
  else { viewYear = y; viewMonth = 0; loadMonth(y, 0); }
  closeMonthPop();
});
document.addEventListener('mousedown', e => {
  if ($('#monthPop').hidden) return;
  if (!e.target.closest('#monthPop') && !e.target.closest('#cal-title') && !e.target.closest('#mini-cal-head')) closeMonthPop();
});
function bindCalendarEvents(){
  $$('#grid .cell[data-d]').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('.pill')) return;
      openDayDrawer(Number(c.dataset.d));
    });
  });
  $$('#grid .pill').forEach(p => {
    p.addEventListener('click', e => {
      e.stopPropagation();
      taskReturn = { type: 'grid' };
      openTaskDrawer(YMD(viewYear, viewMonth, Number(p.dataset.d)), Number(p.dataset.i));
    });
  });
}

// ===== 日计划抽屉 =====
function openDayDrawer(d){
  const dt = new Date(viewYear, viewMonth, d);
  const dateStr = YMD(viewYear, viewMonth, d);
  $('#d-date').textContent = `${viewMonth+1} 月 ${d} 日`;
  $('#d-sub').textContent = `${WDS[dt.getDay()]} · ${viewYear}`;
  $('#drawer').dataset.d = d;
  $('#drawer').dataset.date = dateStr;
  const data = state.days.get(dateStr) || { tasks: [], summary: '' };
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  // 占位由 CSS :empty::before 展示，textContent 只放真实内容（空则留空，避免占位文本被误当摘要保存）
  $('#d-summary').textContent = (data.summary && String(data.summary).trim()) ? data.summary : '';
  const box = $('#d-tasks');
  box.innerHTML = '';
  tasks.forEach((t, i) => appendTaskRow(box, dateStr, i, t));
  resetDAdd();
  openDrawer('drawer');
}
function appendTaskRow(box, dateStr, i, t){
  const row = document.createElement('div');
  row.className = 'task-row' + (t.completed ? ' done' : '');
  const note = t.note && String(t.note).trim();      // R5-3：备注预览（有才渲染；空/无 note 不渲染）
  row.innerHTML = `<div class="task-row-main"><div class="check">${t.completed?'✓':''}</div><span class="t">${esc(t.title)}</span></div>`
    + (note ? `<div class="task-note-preview">${esc(note)}</div>` : '');
  row.querySelector('.check').addEventListener('click', e => {
    e.stopPropagation();
    t.completed = !t.completed;
    row.classList.toggle('done', t.completed);
    row.querySelector('.check').textContent = t.completed ? '✓' : '';
    renderCalendar(); updateToday();
    queueDaySave(dateStr);
  });
  row.addEventListener('click', () => { taskReturn = { type: 'day', dateStr }; closeAll(); openTaskDrawer(dateStr, i); });
  box.appendChild(row);
}
// 「+ 添加任务」：按钮 ↔ 输入行切换，空输入/Esc 取消恢复按钮，提交后就地追加可连续添加
function resetDAdd(){
  $('#d-add-row').style.display = 'none';
  $('#d-add-task').style.display = '';
}
$('#d-add-task').addEventListener('click', () => {
  $('#d-add-task').style.display = 'none';
  const row = $('#d-add-row');
  row.style.display = 'flex';
  const input = $('#d-add-input');
  input.value = ''; input.focus();
});
function commitDAdd(){
  const input = $('#d-add-input');
  const v = input.value.trim();
  const dateStr = $('#drawer').dataset.date;
  if (!v || !dateStr) { resetDAdd(); return; }
  let day = state.days.get(dateStr);
  if (!day) { day = { date: dateStr, tasks: [], summary: '' }; state.days.set(dateStr, day); }
  if (!Array.isArray(day.tasks)) day.tasks = [];
  day.tasks.push({ title: v, completed: false });
  appendTaskRow($('#d-tasks'), dateStr, day.tasks.length - 1, day.tasks[day.tasks.length - 1]);
  renderCalendar(); updateToday();
  input.value = ''; input.focus();
  toast('已添加任务');
  queueDaySave(dateStr);
}
$('#d-add-confirm').addEventListener('click', commitDAdd);
$('#d-add-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') commitDAdd();
  if (e.key === 'Escape') resetDAdd();
});
// d-save 语义 = saveDayNow：摘要（contenteditable）+ 任务一起保存（按真实结果 toast，不做假成功）
$('#d-save').addEventListener('click', async () => {
  const dateStr = $('#drawer').dataset.date;
  if (!dateStr) return;
  let day = state.days.get(dateStr);
  if (!day) { day = { date: dateStr, tasks: [], summary: '' }; state.days.set(dateStr, day); }
  if (!Array.isArray(day.tasks)) day.tasks = [];
  const raw = ($('#d-summary').textContent || '').trim();
  day.summary = raw; // trim 后为空 → 视为无摘要（占位文本由 CSS :empty 展示，不写入）
  const epochAtStart = sessionEpoch;
  try {
    await saveDayNow(dateStr);
    if (sessionEpoch !== epochAtStart) return;
    renderCalendar(); updateToday();
    closeAll();
    toast('已保存');
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    ErrorHandler.handle(err, '保存日计划');
  }
});

// R3-2：Chrome 全选删除后残留 <br>/纯空格 → :empty 不匹配、占位不显示；清空 innerHTML 恢复占位（不影响正常输入）
$('#d-summary').addEventListener('input', e => {
  const el = e.currentTarget;
  if (!el.innerText.trim()) el.innerHTML = '';
});

// ===== 批量添加 =====
$$('.tab').forEach(tab => tab.addEventListener('click', async () => {
  $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
  $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tab.dataset.pane));
  await updatePreview();
}));
// 迷你日历（指定日期：独立年月 pickYear/pickMonth，切月时清空选择）
function renderMiniCal(){
  const cal = $('#mini-cal');
  cal.innerHTML = '';
  $('#mini-cal-head').innerHTML = `${pickYear} 年 ${pickMonth+1} 月 <span class="cal-caret">▾</span>`;
  ['日','一','二','三','四','五','六'].forEach(w => cal.insertAdjacentHTML('beforeend', `<div class="mini-wd">${w}</div>`));
  const firstDay = new Date(pickYear, pickMonth, 1).getDay();
  for (let i = 0; i < (firstDay + 6) % 7; i++) cal.insertAdjacentHTML('beforeend', '<div class="mini-d empty"></div>');
  for (let d = 1; d <= dim(pickYear, pickMonth); d++) {
    const b = document.createElement('button');
    b.className = 'mini-d'; b.textContent = d;
    if (pickSet.has(d)) b.classList.add('sel');
    b.addEventListener('click', async () => {
      if (pickSet.has(d)) pickSet.delete(d); else pickSet.add(d);
      b.classList.toggle('sel', pickSet.has(d));
      $('#pick-summary').textContent = `已选 ${pickSet.size} 天`;
      await updatePreview();
    });
    cal.appendChild(b);
  }
  $('#pick-summary').textContent = `已选 ${pickSet.size} 天`;
}
// 任务 chips
function renderChips(){
  const box = $('#batch-chips');
  box.innerHTML = '';
  batchTasks.forEach((t, i) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `${esc(t)}<span class="x">✕</span>`;
    c.querySelector('.x').addEventListener('click', async () => { batchTasks.splice(i,1); renderChips(); await updatePreview(); });
    box.appendChild(c);
  });
}
async function addBatchTask(){
  const input = $('#batch-task-input');
  const v = input.value.trim();
  if (!v) return;
  batchTasks.push(v); input.value = '';
  renderChips(); await updatePreview();
}
$('#batch-add-task').addEventListener('click', addBatchTask);
$('#batch-task-input').addEventListener('keydown', e => { if (e.key === 'Enter') addBatchTask(); });
// 清除组合
const clearOpt = $('#clear-opt');
clearOpt.addEventListener('click', async () => { clearOpt.classList.toggle('on'); await updatePreview(); });
// 选日集合
function getSelectedDates(){
  const pane = $('.tab.active').dataset.pane;
  if (pane === 'pane-range') {
    // 纯日期串按 UTC 解析会因时区回退一天 → 统一补 T00:00:00 按本地时区解析
    const a = new Date($('#range-from').value + 'T00:00:00'), b = new Date($('#range-to').value + 'T00:00:00');
    const out = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)) out.push(fmtD(d));
    return out;
  }
  if (pane === 'pane-pick') return [...pickSet].sort((x,y)=>x-y).map(d => YMD(pickYear, pickMonth, d));
  const a = new Date($('#week-from').value + 'T00:00:00'), b = new Date($('#week-to').value + 'T00:00:00');
  const wds = new Set($$('.wd-chip.on').map(c => Number(c.dataset.wd)));
  const out = [];
  for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)) {
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    if (wds.has(wd)) out.push(fmtD(d));
  }
  return out;
}
// 预览（清除模式下先补拉未缓存日期，保证「将被清除」清单准确；拉取失败 toast 提示）
// previewSeq：updatePreview 序号。勾选清除后触发的补拉是异步的，若在拉取完成前取消勾选，
// 过期调用恢复执行时会用旧状态重新显示警告列表 → 序号变化即丢弃过期结果（R6-1）
let previewSeq = 0;
async function updatePreview(){
  const seq = ++previewSeq;
  const dates = getSelectedDates();
  $('#pv-days').textContent = dates.length;
  $('#pv-tasks').textContent = batchTasks.length;
  const clearBox = $('#pv-clear');
  if (clearOpt.classList.contains('on')) {
    if (dates.length) {
      try {
        await ensureRangeLoaded(dates[0], dates[dates.length - 1]);
      } catch (err) {
        if (seq === previewSeq) {
          ErrorHandler.handle(err, '加载日计划', { silent: true });
          toast('部分日期加载失败，清除预览可能不完整');
        }
      }
    }
    if (seq !== previewSeq) return; // 勾选态/选择已变，丢弃过期预览结果
    const items = [];
    dates.forEach(ds => {
      const day = state.days.get(ds);
      const tasks = (day && Array.isArray(day.tasks)) ? day.tasks : [];
      tasks.forEach(t => items.push(`${ds.slice(5)} · ${t.title}`));
    });
    clearBox.style.display = 'block';
    clearBox.innerHTML = '⚠ 以下日期现有任务将被清除：' + items.slice(0,8).map(i => `<div class="pv-citem">· ${esc(i)}</div>`).join('') + (items.length > 8 ? `<div class="pv-citem">… 等 ${items.length} 项</div>` : '');
  } else clearBox.style.display = 'none';
}
['range-from','range-to','week-from','week-to'].forEach(id => $('#'+id).addEventListener('change', async () => { await updatePreview(); }));
$$('.wd-chip').forEach(c => c.addEventListener('click', async () => { c.classList.toggle('on'); await updatePreview(); }));
// 构造批量 payload：clearing=false 合并现有任务（先补拉缺失日期）；payload 只含 {date, tasks}（D2）
async function buildBatchPayload(dates, taskTitles, clearing){
  const newTasks = taskTitles.map(t => ({ title: t, completed: false }));
  if (!clearing && dates.length) {
    await ensureRangeLoaded(dates[0], dates[dates.length - 1]);
  }
  return dates.map(ds => {
    const existing = clearing ? [] : (state.days.get(ds) || {}).tasks;
    const base = Array.isArray(existing) ? existing : [];
    return { date: ds, tasks: clearing ? newTasks.slice() : base.concat(newTasks) };
  });
}
// 提交：100 条/批串行（后端 MAX_BATCH_SIZE=100）
$('#batch-submit').addEventListener('click', async () => {
  const dates = getSelectedDates();
  if (!dates.length) return toast('请先选择日期');
  if (!batchTasks.length) return toast('请先添加任务');
  const clearing = clearOpt.classList.contains('on');
  const chunks = Math.ceil(dates.length / 100);
  const epochAtStart = sessionEpoch;
  toast(`正在写入 ${dates.length} 天…`, true);
  try {
    const payload = await buildBatchPayload(dates, batchTasks, clearing);
    if (sessionEpoch !== epochAtStart) return;
    for (let i = 0; i < payload.length; i += 100) {
      const chunk = payload.slice(i, i + 100);
      const res = await api.batchUpdateDays(chunk);
      if (sessionEpoch !== epochAtStart) return;
      mergeServerDays(res && res.data);
    }
    renderCalendar(); updateToday(); closeAll();
    toast(`✓ 已写入 ${dates.length} 天 × ${batchTasks.length} 条任务${clearing ? '（含清除）' : ''}${chunks > 1 ? ` · 分 ${chunks} 批` : ''}`);
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    ErrorHandler.handle(err, '批量写入');
  }
});

// ===== 搜索 =====
let debounceTimer = null;
$('#search-input').addEventListener('input', e => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSearch(e.target.value.trim()), 300);
});
function highlight(text, kw){
  const i = text.toLowerCase().indexOf(kw.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0,i)) + '<mark>' + esc(text.slice(i, i+kw.length)) + '</mark>' + esc(text.slice(i+kw.length));
}
async function runSearch(kw){
  const box = $('#search-results');
  if (!kw) { box.innerHTML = '<div class="sr-empty"><div class="big">🔍</div>输入关键词搜索全库备注与任务</div>'; return; }
  if (kw.length < 2) { box.innerHTML = '<div class="sr-empty"><div class="big">✏️</div>至少输入 2 个字</div>'; return; }
  const seq = ++searchSeq;
  const epochAtStart = sessionEpoch;
  box.innerHTML = '<div class="sr-empty"><div class="big">⏳</div>搜索中…</div>';
  try {
    const res = await api.searchNotes(kw);
    if (sessionEpoch !== epochAtStart || seq !== searchSeq) return;
    const hits = (res && res.data) || [];
    if (!hits.length) { box.innerHTML = `<div class="sr-empty"><div class="big">🕳️</div>没有找到与「${esc(kw)}」相关的内容</div>`; return; }
    const byDay = {};
    hits.forEach(h => (byDay[h.date] = byDay[h.date] || []).push(h));
    box.innerHTML = '';
    Object.keys(byDay).sort().forEach(ds => {
      const dt = new Date(ds + 'T00:00:00');
      const g = document.createElement('div');
      g.className = 'sr-group';
      g.innerHTML = `<div class="sr-date">${Number(ds.slice(5,7))} 月 ${Number(ds.slice(8))} 日 · ${WDS[dt.getDay()]} · ${ds.slice(0,4)}</div>`;
      byDay[ds].forEach(h => {
        const item = document.createElement('div');
        item.className = 'sr-item';
        item.innerHTML = `<span class="sr-type">${h.type === 'task' ? '任务' : '备注'}</span><span class="sr-text">${highlight(h.content || h.text || '', kw)}</span>`;
        item.addEventListener('click', async () => {
          const yy = Number(ds.slice(0,4)), mm = Number(ds.slice(5,7)) - 1, dd = Number(ds.slice(8));
          viewYear = yy; viewMonth = mm;
          await loadMonth(yy, mm);
          if (sessionEpoch !== epochAtStart) return;
          closeAll(); openDayDrawer(dd);
        });
        g.appendChild(item);
      });
      box.appendChild(g);
    });
  } catch (err) {
    if (sessionEpoch !== epochAtStart || seq !== searchSeq) return;
    box.innerHTML = `<div class="sr-empty"><div class="big">⚠️</div>搜索失败</div>`;
    ErrorHandler.handle(err, '搜索', { silent: true });
  }
}

// ===== 任务编辑 =====
function openTaskDrawer(dateStr, i){
  const day = state.days.get(dateStr);
  const t = day && Array.isArray(day.tasks) ? day.tasks[i] : null;
  if (!t) return;
  editingTask = { dateStr, i };
  // 有上一层（来自日计划抽屉）→ 显示返回按钮；否则隐藏（功能与 ✕ 相同）
  $('#t-back').classList.toggle('show', !!(taskReturn && taskReturn.type === 'day'));
  const dt = new Date(dateStr + 'T00:00:00');
  $('#t-meta').textContent = `${dt.getMonth()+1} 月 ${dt.getDate()} 日 · ${WDS[dt.getDay()]}`;
  $('#t-name').textContent = t.title;
  $('#t-input').value = t.title;
  $('#t-done').classList.toggle('on', !!t.completed);
  $('#t-note-input').value = (t.note && String(t.note)) || '';   // R5-3：备注回填（旧数据无 note → 空）
  openDrawer('taskDrawer');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAll();
});
$('#t-back').addEventListener('click', () => {
  // 返回上一层：从日计划抽屉进入 → 回到该日计划抽屉；从格子进入 → 回到格子页
  const ret = taskReturn;
  taskReturn = null;
  closeAll();
  if (ret && ret.type === 'day') openDayDrawer(Number(ret.dateStr.slice(-2)));
});
$('#t-done').addEventListener('click', () => $('#t-done').classList.toggle('on'));
$('#t-save').addEventListener('click', () => {
  if (!editingTask) return;
  const { dateStr, i } = editingTask;
  const v = $('#t-input').value.trim();
  if (!v) return toast('任务内容不能为空');
  const day = state.days.get(dateStr);
  if (!day || !Array.isArray(day.tasks) || !day.tasks[i]) return;
  day.tasks[i].title = v;
  day.tasks[i].completed = $('#t-done').classList.contains('on');
  const nv = $('#t-note-input').value.trim();        // R5-3：备注非空写入，空则删字段（数据干净）
  if (nv) day.tasks[i].note = nv; else delete day.tasks[i].note;
  renderCalendar(); updateToday();
  closeAll(); toast('任务已保存 ✓');
  queueDaySave(dateStr);
});
$('#t-delete').addEventListener('click', () => {
  if (!editingTask) return;
  const { dateStr, i } = editingTask;
  const day = state.days.get(dateStr);
  if (!day || !Array.isArray(day.tasks)) return;
  day.tasks.splice(i, 1);
  renderCalendar(); updateToday();
  closeAll(); toast('任务已删除');
  queueDaySave(dateStr);
});

// ===== 设置（localStorage 按用户持久化 + 1.0 迁移） =====
function settingsKeyFor(userId){ return `timetrace2.settings.${userId}`; }
function loadSettings(){
  const uid = appData.user && appData.user.id;
  if (uid === null || uid === undefined) return;
  settingsKey = settingsKeyFor(uid);
  let s = null;
  try { s = JSON.parse(localStorage.getItem(settingsKey)); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') {
    // 1.0 迁移：userSettings_${userId}（showWeekends 反相 → hideWeekend）
    try {
      const old = JSON.parse(localStorage.getItem(`userSettings_${uid}`));
      if (old && typeof old === 'object') {
        s = {
          theme: (old.theme === 'blue' || old.theme === 'green') ? old.theme : 'default',
          hideWeekend: old.showWeekends === false,
          startMonday: !!old.startWeekMonday,
          notify: !!old.enableNotifications
        };
      }
    } catch (e) { s = null; }
  }
  settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
  if (!THEMES.includes(settings.theme)) settings.theme = 'default'; // 未知旧值兜底
  applySettings();
  // 迁移成功即写入 2.0 key，避免每次启动重复走 1.0 迁移
  saveSettings();
}
function saveSettings(){
  if (!settingsKey) return;
  try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch (e) { /* 配额满则忽略 */ }
}
function applySettings(){
  document.body.dataset.theme = THEMES.includes(settings.theme) ? settings.theme : 'default';
  $$('.theme-card').forEach(c => c.classList.toggle('on', c.dataset.theme === settings.theme));
  $('#set-weekend').querySelector('.switch').classList.toggle('on', settings.hideWeekend);
  $('#set-monday').querySelector('.switch').classList.toggle('on', settings.startMonday);
  $('#set-notify').querySelector('.switch').classList.toggle('on', settings.notify);
  renderCalendar();
}
$$('.theme-card').forEach(c => c.addEventListener('click', () => {
  if (!THEMES.includes(c.dataset.theme)) return;
  $$('.theme-card').forEach(x => x.classList.remove('on'));
  c.classList.add('on');
  settings.theme = c.dataset.theme;
  saveSettings();
  applySettings();
}));
// ===== 头像（设置抽屉上传/移除 + 顶栏/抽屉预览） =====
function renderAvatar(){
  const av = appData.user && appData.user.avatar;
  const letter = (appData.user && appData.user.username ? appData.user.username.charAt(0) : 'T') || 'T';
  [$('#settings-open'), $('#avatar-preview')].forEach(el => {
    if (!el) return;
    if (av) {
      el.style.backgroundImage = `url("${av}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.textContent = letter;
    }
  });
  const rm = $('#avatar-remove-btn');
  if (rm) rm.style.display = av ? '' : 'none';
}
// 选图 → canvas 等比居中裁剪 128×128 → jpeg 0.85 → POST /api/auth/avatar（api.js 零 diff，复用 api.request 的 token/refresh）
function readAvatarFile(file){
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const S = 128, s = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      canvas.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, S, S);
      uploadAvatar(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => toast('图片解析失败，请换一张图');
    img.src = reader.result;
  };
  reader.onerror = () => toast('文件读取失败');
  reader.readAsDataURL(file);
}
async function uploadAvatar(dataUrl){
  try {
    const res = await api.request('/auth/avatar', { method: 'POST', body: JSON.stringify({ avatar: dataUrl }) });
    if (res && res.success) {
      if (appData.user) appData.user.avatar = res.avatar || (res.data && res.data.avatar) || dataUrl;
      renderAvatar();
      toast('头像已更新');
    } else {
      toast('头像上传失败');
    }
  } catch (err) {
    const r = ErrorHandler.handle(err, '上传头像', { silent: true });
    toast(r.message || '头像上传失败');
  }
}
async function removeAvatar(){
  try {
    const res = await api.request('/auth/avatar', { method: 'POST', body: JSON.stringify({ avatar: '' }) });
    if (res && res.success) {
      if (appData.user) appData.user.avatar = null;
      renderAvatar();
      toast('头像已移除');
    } else {
      toast('移除头像失败');
    }
  } catch (err) {
    const r = ErrorHandler.handle(err, '移除头像', { silent: true });
    toast(r.message || '移除头像失败');
  }
}
// 登录/注册响应不含 avatar（后端仅 getMe 暴露）→ 登录后补拉一次，头像持久化由服务端保障
async function refreshAvatar(){
  const epochAtStart = sessionEpoch;
  try {
    const res = await api.auth.getMe();
    if (sessionEpoch !== epochAtStart || !appData.user) return;
    if (res && res.data) {
      appData.user.avatar = res.data.avatar != null ? res.data.avatar : null;
      renderAvatar();
    }
  } catch (err) { /* 头像非关键路径：失败静默，首字母兜底 */ }
}
$('#avatar-upload-btn').addEventListener('click', () => $('#avatar-file').click());
$('#avatar-file').addEventListener('change', e => { readAvatarFile(e.target.files && e.target.files[0]); e.target.value = ''; });
$('#avatar-remove-btn').addEventListener('click', removeAvatar);

function bindToggle(sel, key, cb){
  $(sel).addEventListener('click', () => {
    const sw = $(sel).querySelector('.switch');
    sw.classList.toggle('on');
    settings[key] = sw.classList.contains('on');
    saveSettings();
    if (cb) cb();
  });
}
bindToggle('#set-weekend', 'hideWeekend', () => { renderCalendar(); toast(settings.hideWeekend ? '已隐藏周末' : '已显示周末'); });
bindToggle('#set-monday', 'startMonday', () => { renderCalendar(); toast(settings.startMonday ? '周一起始' : '周日起始'); });
bindToggle('#set-notify', 'notify', () => toast(settings.notify ? '每日提醒已开启（提醒功能将在后续版本支持）' : '每日提醒已关闭'));

// ===== 统计与连续打卡 =====
function calcStreak(daysMap, today){
  let streak = 0;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // 今天未打卡则从昨天回溯（今日尚未结束时不断连）
  if (!hasCheckin(daysMap, fmtD(d))) d.setDate(d.getDate() - 1);
  while (hasCheckin(daysMap, fmtD(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function calcLongestStreak(daysMap){
  const dates = [...daysMap.keys()].filter(ds => hasCheckin(daysMap, ds)).sort();
  if (!dates.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(dates[i-1] + 'T00:00:00'), b = new Date(dates[i] + 'T00:00:00');
    const gap = Math.round((b - a) / 86400000);
    cur = gap === 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}
function weekCheckinCount(daysMap, today){
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = now.getDay();
  const offset = settings.startMonday ? (dow + 6) % 7 : dow; // 本周已过天数（周一起始 / 周日起始）
  let count = 0;
  for (let i = 0; i <= offset; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    if (hasCheckin(daysMap, fmtD(d))) count++;
  }
  return count;
}
function updateStreakCards(){
  $('#streak-num').textContent = `${calcStreak(state.days, TODAY)} 天`;
  $('#streak-longest').textContent = `最长 ${calcLongestStreak(state.days)} 天`;
}
// ===== 今日卡 =====
function updateToday(){
  const dateStr = fmtD(TODAY);
  const day = state.days.get(dateStr);
  const tasks = (day && Array.isArray(day.tasks)) ? day.tasks : [];
  const done = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  $('#today-title').textContent = `今日 · ${TODAY.getMonth()+1}月${TODAY.getDate()}日 ${WDS[TODAY.getDay()]}`;
  $('#today-num').textContent = `${done} / ${total}`;
  $('#today-pct').textContent = `${total ? Math.round(done/total*100) : 0}% 完成`;
  $('#today-fill').style.width = (total ? Math.round(done/total*100) : 0) + '%';
  $('#today-week').textContent = `本周 ⚡ 连续 ${weekCheckinCount(state.days, TODAY)} 天`;
  const box = $('#mini-tasks');
  box.innerHTML = '';
  tasks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'mini-task' + (t.completed ? ' done' : '');
    row.innerHTML = `<div class="dot-check">${t.completed?'✓':''}</div><span class="t">${esc(t.title)}</span>`;
    row.addEventListener('click', () => {
      t.completed = !t.completed;
      updateToday();
      renderCalendar();
      queueDaySave(dateStr);
    });
    box.appendChild(row);
  });
  updateStreakCards();
}

// ===== 认证 =====
function showAuth(){
  $('#auth-container').style.display = '';
  $('#app-container').style.display = 'none';
  // 重置为登录表单（按钮状态复位：上次登录成功后按钮为 disabled，登出回来必须可点）
  $('#login-form').style.display = 'block';
  $('#register-form').style.display = 'none';
  $('#login-btn').disabled = false;
  $('#register-btn').disabled = false;
  // 默认设置态（无用户）
  settingsKey = null;
  settings = Object.assign({}, DEFAULT_SETTINGS);
  applySettings();
  // 表单残留清零（安全）：登出后不留上一账号的用户名/邮箱/密码
  $('#login-email').value = '';
  $('#login-password').value = '';
  $('#register-username').value = '';
  $('#register-email').value = '';
  $('#register-password').value = '';
}
function showApp(){
  $('#auth-container').style.display = 'none';
  $('#app-container').style.display = '';
  if (appData.user) {
    $('#account-name').textContent = appData.user.username || '—';
    $('#account-email').textContent = appData.user.email || '—';
    $('#account-block').style.display = '';
  }
  renderAvatar();
  loadSettings();
  preheat();
}
// 启动预热：无参 getDays（最近一年 → streak/今日卡）+ 目标 + 当月
async function preheat(){
  const epochAtStart = sessionEpoch;
  renderGoals();
  try {
    const res = await api.getDays();
    if (sessionEpoch !== epochAtStart) return;
    mergeServerDays(res && res.data);
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    ErrorHandler.handle(err, '加载数据', { silent: true });
  }
  if (sessionEpoch !== epochAtStart) return;
  updateStreakCards();
  updateToday();
  await loadMonth(viewYear, viewMonth);
  updateToday();
}
async function handleLogin(e){
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true;
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email || !password) { btn.disabled = false; toast('请输入邮箱和密码'); return; }
  const epochAtStart = sessionEpoch;
  try {
    const data = await api.auth.login({ email, password });
    if (sessionEpoch !== epochAtStart) return;
    appData.user = data.user;
    showApp();
    refreshAvatar();
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    btn.disabled = false;
    ErrorHandler.handle(err, '登录');
  }
}
async function handleRegister(e){
  e.preventDefault();
  const btn = $('#register-btn');
  btn.disabled = true;
  const username = $('#register-username').value.trim();
  const email = $('#register-email').value.trim();
  const password = $('#register-password').value;
  if (!username || !email || !password) { btn.disabled = false; toast('请填写所有必填字段'); return; }
  if (password.length < 6) { btn.disabled = false; toast('密码长度至少为6位'); return; }
  const epochAtStart = sessionEpoch;
  try {
    const data = await api.auth.register({ username, email, password });
    if (sessionEpoch !== epochAtStart) return;
    appData.user = data.user;
    showApp();
    refreshAvatar();
  } catch (err) {
    if (sessionEpoch !== epochAtStart) return;
    btn.disabled = false;
    ErrorHandler.handle(err, '注册');
  }
}
async function handleLogout(e){
  if (e) e.preventDefault();
  const btn = $('#logout-btn');
  btn.disabled = true; // 防连点：完成/失败后恢复
  const epochAtStart = sessionEpoch;
  try { await api.auth.logout(); } catch (err) { /* 登出尽力而为：本地令牌由 api.js finally 清理 */ }
  if (sessionEpoch !== epochAtStart) { btn.disabled = false; return; } // 强制登出已清理
  resetSessionState();
  showAuth();
  btn.disabled = false;
}
// 会话清理：登出 / 强制登出共用。递增 sessionEpoch 丢弃在飞行中的异步写回，
// 清空队列与 state，防止旧账号数据串入下一个登录账号
function resetSessionState(){
  sessionEpoch++;
  closeAll();
  clearGoalTimers();
  state.days.clear();
  daySaveQueue.clear();
  daySaveAttempts.clear();
  daySaveFlyingDates.clear();
  daysDirty.clear();
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } // R3-1：取消挂起的失败重试定时器
  appData.goals = [];
  goalsByDate = new Map();
  editingGoal = null; editingGoalId = null;
  editingTask = null; taskReturn = null;
  msGran = 'month'; msSeq++;                          // R5-4：登出复位粒度（在途补拉渲染作废）
  $('#ms-title-text').textContent = '月度统计';
  closeMsPop();
  appData.user = null;
  // 头像复位：顶栏/预览回退首字母占位（下一账号登录后由 renderAvatar 按新用户重绘）
  [$('#settings-open'), $('#avatar-preview')].forEach(el => {
    if (el) { el.style.backgroundImage = ''; el.textContent = 'T'; }
  });
  const rmBtn = $('#avatar-remove-btn');
  if (rmBtn) rmBtn.style.display = 'none';
  viewYear = TODAY.getFullYear(); viewMonth = TODAY.getMonth();
  // 批量/清除/搜索等视图状态复位：换账号不残留上一账号的输入与选择
  batchTasks = [];
  pickSet.clear();
  clearOpt.classList.remove('on');
  $('#batch-chips').innerHTML = '';
  $('#batch-task-input').value = '';
  $('#search-input').value = '';
  $('#search-results').innerHTML = '<div class="sr-empty"><div class="big">🔍</div>输入关键词搜索全库备注与任务</div>';
  $('#pick-summary').textContent = '已选 0 天';
  renderMiniCal();
}
// 强制登出（api.js 401→refresh 失败时 removeTokens 后派发）
window.addEventListener('auth:force-logout', () => {
  resetSessionState();
  showAuth();
});
function bootstrap(){
  const token = api.getToken();
  if (token) {
    const epochAtStart = sessionEpoch;
    api.auth.getMe()
      .then(res => {
        if (sessionEpoch !== epochAtStart) return; // 期间发生强制登出，丢弃本次结果
        const user = res && res.data;
        if (!user) { api.removeTokens(); resetSessionState(); showAuth(); return; }
        appData.user = user;
        showApp();
      })
      .catch(err => {
        if (sessionEpoch !== epochAtStart) return;
        // 仅认证失败（AUTH_002 / HTTP 401）销毁令牌；网络瞬时故障保留令牌，刷新页面可恢复会话
        const isAuthFail = !!(err && (err.errorCode === 'AUTH_002' || err.statusCode === 401));
        if (isAuthFail) api.removeTokens();
        resetSessionState();
        showAuth();
      });
  } else {
    showAuth();
  }
}
$('#switch-to-register').addEventListener('click', e => { e.preventDefault(); $('#login-form').style.display = 'none'; $('#register-form').style.display = 'block'; });
$('#switch-to-login').addEventListener('click', e => { e.preventDefault(); $('#register-form').style.display = 'none'; $('#login-form').style.display = 'block'; });
$('#login-form').addEventListener('submit', handleLogin);
$('#register-form').addEventListener('submit', handleRegister);
$('#logout-btn').addEventListener('click', handleLogout);

// ===== 入口 =====
$('#batch-open').addEventListener('click', async () => {
  closeMonthPop();
  pickSet.clear();
  const todayStr = fmtD(TODAY);
  $('#range-from').value = todayStr;
  const to = new Date(TODAY); to.setDate(to.getDate() + 6);
  $('#range-to').value = fmtD(to);
  const wfrom = todayStr;
  const wto = new Date(TODAY); wto.setDate(wto.getDate() + 30);
  $('#week-from').value = wfrom;
  $('#week-to').value = fmtD(wto);
  pickYear = TODAY.getFullYear(); pickMonth = TODAY.getMonth();
  renderMiniCal();
  await updatePreview();
  openDrawer('batchDrawer');
});
$('#search-open').addEventListener('click', () => {
  $('#search-input').value = '';
  $('#search-results').innerHTML = '<div class="sr-empty"><div class="big">🔍</div>输入关键词搜索全库备注与任务</div>';
  openDrawer('searchDrawer');
  setTimeout(() => $('#search-input').focus(), 120);
});
$('#settings-open').addEventListener('click', () => openDrawer('settingsDrawer'));

bootstrap();
