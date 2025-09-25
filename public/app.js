// Шестбуквен Wordle (BG)
// Дъска 6x6, дневни издания (включително предишни дни),
// локални статистики, nickname и глобална класация.

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_MS = 12 * 60 * 60 * 1000;
const ANCHOR_ISO = '2022-01-01'; // запазено за съвместимост
// Котва за 12-часовите издания: 2022-01-01 00:30 локално (граници: 00:30 и 12:30 всеки ден)
const ANCHOR_LOCAL = new Date(2022, 0, 1, 0, 30, 0, 0);

const BG_ALPHABET = [
  'Я','В','Е','Р','Т','Ъ','У','И','О','П','Ю',
  'А','С','Д','Ф','Г','Х','Й','К','Л','Ш','Щ',
  'З','Ь','Ц','Ж','Б','Н','М','Ч'
];
const LETTER_SET = new Set(BG_ALPHABET);

// UI елементи
const boardEl = document.getElementById('board');
const keyboardEl = document.getElementById('keyboard');
const toastEl = document.getElementById('toast');
const btnHelp = document.getElementById('btnHelp');
const btnStats = document.getElementById('btnStats');
const btnSettings = document.getElementById('btnSettings');
const btnLeaderboard = document.getElementById('btnLeaderboard');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const dateLabel = document.getElementById('dateLabel');
const timerLabel = document.getElementById('timerLabel');
const btnTheme = document.getElementById('btnTheme');
const btnShareStats = document.getElementById('btnShareStats');

const modalHelp = document.getElementById('modalHelp');
const modalStats = document.getElementById('modalStats');
const modalSettings = document.getElementById('modalSettings');
const modalLeaderboard = document.getElementById('modalLeaderboard');
const nicknameInput = document.getElementById('nicknameInput');
const saveNicknameBtn = document.getElementById('saveNickname');
const stPlayed = document.getElementById('stPlayed');
const stWins = document.getElementById('stWins');
const stWinRate = document.getElementById('stWinRate');
const stStreak = document.getElementById('stStreak');
const stAvg = document.getElementById('stAvg');
const distEl = document.getElementById('dist');
const lbBody = document.getElementById('leaderboardBody');
const lbMe = document.getElementById('leaderboardMe');

let WORDS = null; // зареден речник
let periodOffset = 0; // 0 = текущо издание; -1 = предишното издание (12ч), и т.н.
let solution = '';
let guesses = []; // списък от низове
let currentRow = 0;
let currentCol = 0;
let keyboardStates = {}; // буква -> absent|present|correct
let gameOver = false; // не позволява игра след победа/загуба

// ТЕМА (dark/light)
const THEME_KEY = 'sw_theme';
function applyTheme(t){ document.documentElement.setAttribute('data-theme', t); }

// Съобщения при победа според опита
function winMessage(attempts){
  switch(Number(attempts)){
    case 1: return 'Най-после';
    case 2: return 'Пак си я решавал на телефона Янчо!';
    case 3: return 'Яяяяя Гений!';
    case 4: return 'От умните си.';
    case 5: return 'Не си от най-умните';
    case 6: return 'Далеч си от умните';
    case 7: return 'Тъп си';
    default: return 'Браво!';
  }
}

// Споделяне на статистика (ползва Web Share или копира в клипборда)
function shareStats(){
  const s = getStats();
  const wr = s.played? Math.round(100*s.wins/s.played):0;
  const avg = (s.wins? (s.dist.reduce((sum, n,i)=>sum+n*(i+1),0)/s.wins) : 0).toFixed(2);
  const lines = [];
  lines.push('SixWordsWordle — Статистика');
  lines.push(`Игри: ${s.played}  Победи: ${s.wins}  Познати %: ${wr}%`);
  lines.push(`Подред: ${s.streak}  Средно опити: ${avg}`);
  lines.push('Разпределение по опити:');
  for(let i=0;i<7;i++){ lines.push(`${i+1}: ${s.dist[i]}`); }
  const pidx=currentPeriodIndex();
  const g = loadLocal(storageKeyForPeriod(pidx), null);
  if(g && g.solved){ lines.push(`Днес: ${winMessage(g.attempts)} (${g.attempts}/7)`); }
  const text = lines.join('\n');
  if(navigator.share){ navigator.share({ text }).catch(()=>copyText(text)); }
  else { copyText(text); }
  showToast('Статистиката е споделена/копирана');
}

function copyText(text){
  try{ navigator.clipboard.writeText(text); }catch{}
}
function getTheme(){ return localStorage.getItem(THEME_KEY) || 'dark'; }
function setTheme(t){ localStorage.setItem(THEME_KEY, t); applyTheme(t); }

// Помощни
const today = () => new Date();
const toISODate = (d) => {
  // ISO за дата (локално, без часове)
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
};

// 12-часов периодов индекс
function periodIndexFromDate(d){
  return Math.floor((d.getTime() - ANCHOR_LOCAL.getTime()) / HALF_MS);
}
function periodStartFromIndex(idx){
  return new Date(ANCHOR_LOCAL.getTime() + idx * HALF_MS);
}
function currentBasePeriodIndex(){ return periodIndexFromDate(new Date()); }
function currentPeriodIndex(){ return currentBasePeriodIndex() + periodOffset; }
function periodSlotFromIndex(idx){
  // A: старт 00:30, B: старт 12:30
  const start = periodStartFromIndex(idx);
  return start.getHours() < 12 ? 'A' : 'B';
}
function periodDateISOFromIndex(idx){
  const d = periodStartFromIndex(idx);
  return toISODate(d);
}
function bgMonth(m){
  return ['януари','февруари','март','април','май','юни','юли','август','септември','октомври','ноември','декември'][m];
}
function formatBGDate(d){
  return `${d.getDate()} ${bgMonth(d.getMonth())} ${d.getFullYear()}`;
}
function timeToNextBoundary(now=new Date()){
  const curr = periodIndexFromDate(now);
  const nextStart = periodStartFromIndex(curr+1);
  return Math.max(0, nextStart.getTime() - now.getTime());
}

function norm(s){
  // Нормализиране: главни букви, премахване на интервали и уеднаквяване на латински двойници към кирилица
  let u = (s||'').toUpperCase().replace(/\s+/g,'');
  // Превод на латински двойници (A,B,C,E,H,K,M,O,P,T,X,Y) към кирилица (А,В,С,Е,Н,К,М,О,Р,Т,Х,У)
  const MAP = { A:'А', B:'В', C:'С', E:'Е', H:'Н', K:'К', M:'М', O:'О', P:'Р', T:'Т', X:'Х', Y:'У' };
  u = u.replace(/[ABCEHKMOPTXY]/g, ch => MAP[ch] || ch);
  // Руски/варианти
  u = u.replace('Ё','Е');
  try{ u = u.normalize('NFC'); }catch{}
  return u;
}

function showToast(msg, ms=1400){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), ms);
}

function saveLocal(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function loadLocal(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch{ return def; } }

// Подпис на речника, за да занулим стари записани игри при промяна на думите
const WORDS_SIG_KEY = 'sw_words_sig_v1';
function wordsSignature(){
  const list = WORDS?.list || [];
  if(!list.length) return 'empty';
  return `n:${list.length}|first:${list[0]}|last:${list[list.length-1]}`;
}
function ensureWordsSignature(){
  try{
    const sig = wordsSignature();
    const prev = localStorage.getItem(WORDS_SIG_KEY);
    if(prev !== sig){
      // Списъкът е сменен: чистим само текущата игра, но запазваме историята
      const currentPidx = currentPeriodIndex();
      const currentGameKey = storageKeyForPeriod(currentPidx);
      localStorage.removeItem(currentGameKey);
      localStorage.setItem(WORDS_SIG_KEY, sig);
      console.info('Words changed -> cleared only current game, history preserved');
    }
  }catch{}
}

function storageKeyForDate(iso){ return `sw_game_${iso}`; }
function statsKey(){ return 'sw_stats_v1'; }
function nickKey(){ return 'sw_nickname'; }

function getStats(){
  return loadLocal(statsKey(), { played:0, wins:0, streak:0, lastWin:null, dist:[0,0,0,0,0,0,0] });
}
function setStats(s){ saveLocal(statsKey(), s); }

function setNickname(n){ localStorage.setItem(nickKey(), n || ''); }
function getNickname(){ return localStorage.getItem(nickKey()) || ''; }

// Оценка на опит спрямо решение (двупроходен алгоритъм за повтарящи се букви)
function scoreGuess(guess, sol){
  const n=6; const res=Array(n).fill('absent');
  const solArr=[...sol];
  const count={};
  for(const ch of solArr){ count[ch]=(count[ch]||0)+1; }
  // pass 1: correct
  for(let i=0;i<n;i++){
    if(guess[i]===sol[i]){ res[i]='correct'; count[guess[i]]--; }
  }
  // pass 2: present
  for(let i=0;i<n;i++){
    if(res[i]==='correct') continue;
    const ch=guess[i];
    if((count[ch]||0)>0){ res[i]='present'; count[ch]--; }
  }
  return res;
}

function applyKeyboard(guess, feedback){
  for(let i=0;i<guess.length;i++){
    const l=guess[i];
    const s=feedback[i];
    const prev=keyboardStates[l];
    if(prev==='correct') continue;
    if(s==='correct') keyboardStates[l]='correct';
    else if(s==='present' && prev!=='correct') keyboardStates[l]='present';
    else if(!prev) keyboardStates[l]='absent';
  }
  // repaint
  paintKeyboardFromState();
}

function paintKeyboardFromState(){
  document.querySelectorAll('.key').forEach(k=>{
    const l=k.dataset.key;
    k.classList.remove('correct','present','absent');
    if(l && keyboardStates[l]) k.classList.add(keyboardStates[l]);
  });
}

function updateEnterButtonState(){
  const enterBtn = document.querySelector('.key[data-key="ENTER"]');
  if(!enterBtn) return;
  
  const currentWord = norm(guesses[currentRow] || '');
  const isComplete = currentWord.length === 6;
  const isValid = isComplete && isValidWord(currentWord);
  
  // Премахваме предишни класове
  enterBtn.classList.remove('valid-word', 'invalid-word');
  
  if(isComplete){
    if(isValid){
      enterBtn.classList.add('valid-word');
    } else {
      enterBtn.classList.add('invalid-word');
    }
  }
}

function updateDateLabelForPeriod(idx){
  const start = periodStartFromIndex(idx);
  dateLabel.textContent = formatBGDate(start);
  btnNext.disabled = (periodOffset===0);
}

function buildBoard(){
  boardEl.innerHTML='';
  for(let r=0;r<7;r++){
    for(let c=0;c<6;c++){
      const div=document.createElement('div');
      div.className='tile';
      div.dataset.row=r; div.dataset.col=c;
      boardEl.appendChild(div);
    }
  }
}

function buildKeyboard(){
  keyboardEl.innerHTML='';
  const rows=[
    ['Я','В','Е','Р','Т','Ъ','У','И','О','П','Ю'],
    ['А','С','Д','Ф','Г','Х','Й','К','Л','Ш','Щ'],
    ['ENTER','З','Ь','Ц','Ж','Б','Н','М','Ч','DEL']
  ];
  rows.forEach((row)=>{
    const r=document.createElement('div'); r.className='krow';
    row.forEach(k=>{
      const b=document.createElement('button');
      b.className='key';
      if(k==='ENTER' || k==='DEL') b.classList.add('wide');
      b.textContent=(k==='ENTER'?'Ашфикен':(k==='DEL'?'⌫':k));
      b.dataset.key = (k==='ENTER'||k==='DEL')?k:k;
      b.addEventListener('click',()=>handleKey(k));
      r.appendChild(b);
    });
    keyboardEl.appendChild(r);
  });
  paintKeyboardFromState();
}

function redraw(){
  // изписване на текущи опити
  const allTiles=[...boardEl.querySelectorAll('.tile')];
  allTiles.forEach(t=>{ t.textContent=''; t.className='tile'; });

  // Разкриваме само вече подадените (затвърдени) редове: 0..currentRow-1
  for(let r=0; r<currentRow; r++){
    const g=guesses[r];
    if(!g) continue;
    const fb=scoreGuess(g, solution);
    for(let c=0;c<6;c++){
      const idx=r*6+c; const t=allTiles[idx];
      t.textContent=g[c]||''; t.classList.add('revealed', fb[c]);
    }
  }
  // Текущ ред (в процес на въвеждане)
  if(currentRow<7){
    const g=guesses[currentRow]||'';
    for(let c=0;c<6;c++){
      const idx=currentRow*6+c; const t=allTiles[idx];
      const ch=g[c];
      if(ch){ t.textContent=ch; t.classList.add('filled'); }
    }
  }
  
  // Актуализираме състоянието на ENTER бутона
  updateEnterButtonState();
}

function isValidWord(w){ return WORDS && WORDS.wordsSet.has(w); }

function pushLetter(ch){
  if(gameOver) return;
  if(currentRow>=7) return;
  if(currentCol<6){
    const cur=guesses[currentRow]||'';
    guesses[currentRow]=(cur+ch).slice(0,6);
    currentCol++;
    redraw();
  }
}

function popLetter(){
  if(gameOver) return;
  if(currentRow>=7) return;
  if(currentCol>0){
    const cur=guesses[currentRow]||'';
    guesses[currentRow]=cur.slice(0,currentCol-1);
    currentCol--;
    redraw();
  }
}

function submitRow(){
  if(gameOver) return;
  if(currentRow>=7) return;
  const cur=norm(guesses[currentRow]||'');
  if(cur.length!==6){ showToast('Думата трябва да е от 6 букви'); return; }
  if(!isValidWord(cur)){
    try{ console.warn('Rejected word:', cur, 'inDict?', WORDS?.wordsSet?.has(cur)); }catch{}
    showToast('Невалидна дума');
    return;
  }

  const fb=scoreGuess(cur, solution);
  applyKeyboard(cur, fb);

  const won = fb.every(x=>x==='correct');
  // запазване на състояние
  const pidx = currentPeriodIndex();
  const iso = periodDateISOFromIndex(pidx);
  const game = loadLocal(storageKeyForPeriod(pidx), { guesses:[], solved:false, attempts:0 });
  if(!game.guesses.includes(cur)){
    game.guesses.push(cur);
    game.attempts = game.guesses.length;
  }
  if(won){ game.solved=true; }
  saveLocal(storageKeyForPeriod(pidx), game);

  // Разкриваме реда веднага чрез инкремент на currentRow и redraw
  currentRow++;
  currentCol=0;
  redraw();

  if(won){
    finishWin(game.attempts, iso);
  } else if(currentRow>=7){
    finishLoss();
  }
}

function finishWin(attempts, iso){
  showToast(winMessage(attempts));
  showCelebration(); // Показваме заря ефект
  updateStats(true, attempts, iso);
  gameOver = true;
  // изпращане към класация
  const nickname = getNickname().trim();
  if(nickname){
    const pidx = currentPeriodIndex();
    const slot = periodSlotFromIndex(pidx);
    fetch('/api/leaderboard/submit',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ nickname, attempts, dateISO: iso, slot, solved:true })
    }).catch(()=>{});
  }
}

function finishLoss(){
  showToast(`Да беше опитал на телефона.... Думата беше: ${solution}`);
  updateStats(false, null, periodDateISOFromIndex(currentPeriodIndex()));
  gameOver = true;
}

function updateStats(won, attempts, iso){
  const s=getStats();
  s.played++;
  if(won){
    s.wins++;
    s.streak = (s.lastWin===iso? s.streak : (s.lastWin && nextISO(s.lastWin)===iso ? s.streak+1 : 1));
    s.lastWin = iso;
    if(attempts>=1 && attempts<=7){ s.dist[attempts-1]++; }
  } else {
    s.streak = 0;
  }
  setStats(s);
  updateStatsUI();
}

function nextISO(iso){ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return toISODate(d); }

function updateStatsUI(){
  const s=getStats();
  stPlayed.textContent=String(s.played);
  stWins.textContent=String(s.wins);
  const wr = s.played? Math.round(100*s.wins/s.played):0;
  stWinRate.textContent=`${wr}%`;
  stStreak.textContent=String(s.streak);
  const totalWins=s.wins;
  const avg = totalWins? (s.dist.reduce((sum, n,i)=>sum+n*(i+1),0)/totalWins) : 0;
  stAvg.textContent=avg.toFixed(2);
  // разпределение
  distEl.innerHTML='';
  const max = Math.max(1, ...s.dist);
  for(let i=0;i<7;i++){
    const row=document.createElement('div'); row.className='bar';
    const label=document.createElement('div'); label.className='label'; label.textContent=String(i+1);
    const meter=document.createElement('div'); meter.className='meter'; meter.style.width='100%';
    const fill=document.createElement('div'); fill.className='fill';
    const w = Math.round(100 * (s.dist[i]/max));
    fill.style.width=Math.max(4,w)+'%';
    fill.textContent=s.dist[i];
    meter.appendChild(fill);
    row.appendChild(label); row.appendChild(meter);
    distEl.appendChild(row);
  }
}

// Ключ за локално състояние: по индекс на период
function storageKeyForPeriod(idx){ return `sw_game_period_${idx}`; }

async function loadWords(){
  if(WORDS) return WORDS;
  // Опит за зареждане и обединяване на няколко файла
  // Първо новия файл (v2), пробваме относителен и абсолютен път, после стари имена като fallback
  const paths = [
    'words-bg-6v2.json','/words-bg-6v2.json','./words-bg-6v2.json',
    'words-bg-6.json','/words-bg-6.json',
    'words-bg-6-.json','/words-bg-6-.json'
  ];
  const seen = new Set();
  const list = [];
  let lastError = null;
  let sourceUsed = null;
  for (const p of paths){
    try{
      const url = `${p}?v=${Date.now()}`; // bust cache aggressively
      try{ console.info('loadWords: trying', url); }catch{}
      const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control':'no-cache' } });
      if(!res.ok) { lastError = new Error(`HTTP ${res.status} for ${p}`); continue; }
      const data = await res.json();
      const arr = Array.isArray(data?.words) ? data.words : [];
      try{ console.info('loadWords: got', arr.length, 'items from', p); }catch{}
      for (const raw of arr){
        const w = norm(raw);
        if (w.length !== 6) continue; // приемаме всички 6-буквени записи от файла
        if (seen.has(w)) continue; // премахване на дубликати
        seen.add(w);
        list.push(w);
      }
      if(arr.length>0 && sourceUsed===null){ sourceUsed = p; }
    }catch(err){ lastError = err; /* игнорирай 404/JSON грешки */ }
  }
  if(list.length===0){
    try{ console.error('Неуспешно зареждане на списъка с думи от всички пътища.', lastError); }catch{}
    try{ showToast('Грешка: не успях да заредя списъка с думи'); }catch{}
    throw lastError || new Error('No words loaded');
  }
  const set=new Set(list);
  WORDS={ list, wordsSet:set };
  try{ console.info('Заредени думи:', WORDS.list.length, 'от', sourceUsed); }catch{}
  try{ window.__WORDS = WORDS; window.__hasWord = (w)=>WORDS.wordsSet.has(norm(w)); }catch{}
  return WORDS;
}

function pickSolutionForPeriodIndex(pidx){
  const n = WORDS.list.length;
  
  // Използваме псевдослучаен генератор с периодовия индекс като seed
  // за да гарантираме, че всички играчи имат същата дума за даден период
  function seededRandom(seed) {
    // Linear congruential generator (LCG) за псевдослучайни числа
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    return ((a * seed + c) % m) / m;
  }
  
  // Създаваме детерминистично разбъркан списък с думи
  // Всички играчи ще имат същия разбъркан списък
  function shuffleArrayWithSeed(array, seed) {
    const shuffled = [...array];
    let currentSeed = seed;
    
    for (let i = shuffled.length - 1; i > 0; i--) {
      currentSeed = (currentSeed * 1103515245 + 12345) % Math.pow(2, 31);
      const j = Math.floor((currentSeed / Math.pow(2, 31)) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled;
  }
  
  // Използваме константен seed за разбъркване, за да всички играчи имат същия ред
  const shuffleSeed = 42; // константа за всички играчи
  const shuffledWords = shuffleArrayWithSeed(WORDS.list, shuffleSeed);
  
  // Сега избираме дума по цикличен принцип от разбърканият списък
  // Това гарантира, че няма да има повторения докато не минат всички думи
  const i = pidx % n;
  
  return shuffledWords[i];
}

function loadSavedGameByPeriod(idx){
  const g=loadLocal(storageKeyForPeriod(idx), null);
  if(!g) return null;
  return g;
}

function restoreFromSaved(pidx){
  const g=loadSavedGameByPeriod(pidx);
  guesses = [];
  currentRow=0; currentCol=0; keyboardStates={};
  gameOver = false;
  paintKeyboardFromState(); // изчистване на цветове по клавиатурата
  if(g){
    // play-through на вече записаните опити
    const arr = g.guesses || [];
    arr.forEach(x=>{ guesses.push(x); });
    currentRow = arr.length;
    currentCol = 0;
    // apply keyboard states
    arr.forEach(x=> applyKeyboard(x, scoreGuess(x, solution)) );
    if (g.solved || (arr.length>=6)) gameOver = true;
  }
  buildBoard();
  redraw();
  updateEnterButtonState(); // актуализираме състоянието на ENTER бутона
}

async function changePeriod(delta){
  periodOffset += delta;
  if(periodOffset>0) periodOffset=0; // не позволяваме бъдещи
  updateDateLabelForPeriod(currentPeriodIndex());
}

async function initGame(){
  // Рендираме UI веднага, за да не изглежда празно при забавяне
  buildBoard();
  buildKeyboard();
  updateDateLabelForPeriod(currentPeriodIndex());

  // тема
  setTheme(getTheme());
  if(btnTheme){ btnTheme.addEventListener('click', ()=> setTheme(getTheme()==='dark'?'light':'dark')); }

  // Въвеждане от хардуерна клавиатура – прикачаме веднага
  window.addEventListener('keydown', (e)=>{
    const key = e.key;
    if(key==='Enter') submitRow();
    else if(key==='Backspace') popLetter();
    else{
      const ch = norm(key);
      if(ch.length===1 && LETTER_SET.has(ch)) pushLetter(ch);
    }
  });

  // Зареждаме речника след първоначалното UI
  await loadWords();
  ensureWordsSignature();

  const pidx=currentPeriodIndex();
  solution = pickSolutionForPeriodIndex(pidx);
  restoreFromSaved(pidx);

  btnHelp.addEventListener('click', ()=>modalHelp.showModal());
  btnStats.addEventListener('click', ()=>{ updateStatsUI(); modalStats.showModal(); });
  btnSettings.addEventListener('click', ()=>{ nicknameInput.value=getNickname(); modalSettings.showModal();});
  btnLeaderboard.addEventListener('click', openLeaderboard);
  btnPrev.addEventListener('click', async ()=>{ await changePeriod(-1); await reloadSolutionForCurrent(); });
  btnNext.addEventListener('click', async ()=>{ await changePeriod(+1); await reloadSolutionForCurrent(); });
  saveNicknameBtn.addEventListener('click', ()=>{
    const v=nicknameInput.value.trim();
    if(v.length<2||v.length>20){ showToast('Невалиден nickname'); return; }
    setNickname(v); modalSettings.close(); showToast('Запазено');
  });
  if (btnShareStats) btnShareStats.addEventListener('click', shareStats);

  // Затваряне на модал при клик върху backdrop (самият <dialog>)
  [modalHelp, modalStats, modalSettings, modalLeaderboard].filter(Boolean)
    .forEach(dlg=>{
      const onBackdrop = (e)=>{
        if (e.target === dlg){ dlg.close(); return; }
        const rect = dlg.getBoundingClientRect();
        const x = (e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0);
        const y = (e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0);
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (!inside) dlg.close();
      };
      dlg.addEventListener('click', onBackdrop);
      dlg.addEventListener('mousedown', onBackdrop);
      dlg.addEventListener('touchstart', onBackdrop);
    });

  // Таймер за оставащо време и авто-обновяване при смяна на изданието
  startTimerLoop();
}

async function reloadSolutionForCurrent(){
  const pidx=currentPeriodIndex();
  solution = pickSolutionForPeriodIndex(pidx);
  restoreFromSaved(pidx);
}

function handleKey(k){
  if(k==='ENTER') submitRow();
  else if(k==='DEL') popLetter();
  else pushLetter(k);
}

async function openLeaderboard(){
  lbBody.innerHTML=''; lbMe.textContent='';
  const nickname=getNickname().trim();
  try{
    const url = new URL('/api/leaderboard', window.location.origin);
    url.searchParams.set('limit','50');
    url.searchParams.set('minGames','1');
    if(nickname) url.searchParams.set('nickname', nickname);
    const res = await fetch(url.toString());
    const data = await res.json();
    if(data.ok){
      for(const r of data.leaderboard){
        const tr=document.createElement('tr');
        tr.innerHTML=`<td>${r.rank}</td><td>${escapeHtml(r.nickname)}</td><td>${r.avgAttempts.toFixed(2)}</td><td>${r.games}</td>`;
        lbBody.appendChild(tr);
      }
      if(data.me){
        lbMe.textContent = `Вашата позиция: #${data.me.rank} · средно ${data.me.avgAttempts.toFixed(2)} от ${data.me.games} игри`;
      } else if(nickname){
        lbMe.textContent = 'Нямате достатъчно резултати за класацията.';
      }
    }
  }catch{}
  modalLeaderboard.showModal();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
}

// Заря ефект при победа - 10 секунди с много повече ефекти
function showCelebration(){
  const overlay = document.getElementById('celebrationOverlay');
  if(!overlay) return;
  
  overlay.innerHTML = ''; // изчистваме предишни ефекти
  overlay.classList.add('show');
  
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#FF69B4', '#00CED1', '#32CD32', '#FF4500', '#9370DB', '#20B2AA'];
  
  // Функция за създаване на фойерверк
  function createFirework(delay = 0) {
    setTimeout(() => {
      const firework = document.createElement('div');
      firework.className = 'firework';
      firework.style.left = (20 + Math.random() * 60) + '%'; // По-централизирани позиции
      firework.style.top = (20 + Math.random() * 60) + '%';
      firework.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      overlay.appendChild(firework);
      
      // Добавяме повече искри около фойерверка (12 вместо 8)
      for(let j = 0; j < 12; j++){
        const spark = document.createElement('div');
        spark.className = 'spark';
        spark.style.left = firework.style.left;
        spark.style.top = firework.style.top;
        spark.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        
        const angle = (j / 12) * 2 * Math.PI;
        const distance = 60 + Math.random() * 80; // По-големи искри
        spark.style.setProperty('--dx', Math.cos(angle) * distance + 'px');
        spark.style.setProperty('--dy', Math.sin(angle) * distance + 'px');
        
        overlay.appendChild(spark);
      }
    }, delay);
  }
  
  // Създаваме 50 фойерверка в продължение на 8 секунди
  for(let i = 0; i < 50; i++){
    createFirework(i * 160); // Всеки 160ms
  }
  
  // Добавяме още фойерверки в последните 2 секунди за финал
  for(let i = 0; i < 20; i++){
    createFirework(8000 + i * 100); // Финални фойерверки всеки 100ms
  }
  
  // Скриваме ефекта след 10 секунди
  setTimeout(() => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.innerHTML = '', 500);
  }, 10000);
}

// Старт
initGame().catch(err=>{ console.error(err); showToast('Грешка при инициализация'); });

// Таймер и лейбъл
let timerHandle = null;
function startTimerLoop(){
  if(timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(()=>{
    if(periodOffset!==0){ timerLabel.textContent=''; return; }
    const now=new Date();
    const ms=timeToNextBoundary(now);
    const h=Math.floor(ms/3600000);
    const m=Math.floor((ms%3600000)/60000);
    const s=Math.floor((ms%60000)/1000);
    timerLabel.textContent = `Остава: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    // Автоматична смяна при преминаване на границата
    if(ms===0){
      // ресет към текущо издание (offset 0) и презареждане
      periodOffset = 0;
      updateDateLabelForPeriod(currentPeriodIndex());
      reloadSolutionForCurrent();
    }
  }, 1000);
}
