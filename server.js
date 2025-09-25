const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));

// Add no-store cache control for critical static assets so updates are picked immediately during development
app.use((req, res, next) => {
  if (/\.(json|js|css|html)$/i.test(req.path)) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory and file exist
async function ensureStorage() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    try {
      await fsp.access(LEADERBOARD_FILE, fs.constants.F_OK);
    } catch {
      await fsp.writeFile(LEADERBOARD_FILE, JSON.stringify({}, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Failed to ensure storage', err);
  }
}

function isValidNickname(nick) {
  if (!nick || typeof nick !== 'string') return false;
  const trimmed = nick.trim();
  if (trimmed.length < 2 || trimmed.length > 20) return false;
  // Allow unicode letters, digits, space and _-. characters
  try {
    return /^[\p{L}\d _\-.]+$/u.test(trimmed);
  } catch {
    // Fallback if Unicode property escapes are not supported
    return /^[A-Za-z0-9 _\-.А-Яа-яЁёЙйЪъЩщЮюЯя]+$/.test(trimmed);
  }
}

async function readLeaderboard() {
  await ensureStorage();
  const content = await fsp.readFile(LEADERBOARD_FILE, 'utf8');
  try {
    const data = JSON.parse(content || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function writeLeaderboard(data) {
  await ensureStorage();
  const tmp = LEADERBOARD_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, LEADERBOARD_FILE);
}

// API: health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// API: submit result to leaderboard
// body: { nickname, attempts, dateISO, solved, slot? }  slot: 'A' (00:30) | 'B' (12:30)
app.post('/api/leaderboard/submit', async (req, res) => {
  try {
    let { nickname, attempts, dateISO, solved, slot } = req.body || {};
    if (!isValidNickname(nickname)) {
      return res.status(400).json({ error: 'Невалиден nickname. Позволени са букви, цифри, интервал и _-. (2-20 знака)' });
    }
    nickname = nickname.trim();
    const dateKey = String(dateISO || '').slice(0, 10);
    if (!dateKey || !/\d{4}-\d{2}-\d{2}/.test(dateKey)) {
      return res.status(400).json({ error: 'Невалидна дата' });
    }
    slot = (slot === 'A' || slot === 'B') ? slot : 'A';
    attempts = Number(attempts);
    if (!Number.isFinite(attempts) || attempts < 1 || attempts > 6) {
      return res.status(400).json({ error: 'Невалиден брой опити' });
    }
    solved = Boolean(solved);
    if (!solved) {
      // За класацията отчитаме само решени игри
      return res.json({ ok: true, ignored: true, reason: 'unsolved_not_counted' });
    }

    const lb = await readLeaderboard();
    const rec = lb[nickname] || {
      nickname,
      solved: 0,
      totalAttempts: 0,
      avgAttempts: 0,
      playedDates: {}, // ключ: YYYY-MM-DD-A/B
      lastUpdated: null,
    };

    // предотвратяване на дублиране за същата дата и слот
    const uniqueKey = `${dateKey}-${slot}`;
    if (rec.playedDates[uniqueKey]?.solved) {
      return res.json({ ok: true, duplicate: true, stats: rec });
    }

    rec.solved += 1;
    rec.totalAttempts += attempts;
    rec.avgAttempts = Number((rec.totalAttempts / rec.solved).toFixed(3));
    rec.playedDates[uniqueKey] = { attempts, solved: true, slot };
    rec.lastUpdated = new Date().toISOString();

    lb[nickname] = rec;
    await writeLeaderboard(lb);

    return res.json({ ok: true, stats: rec });
  } catch (err) {
    console.error('submit error', err);
    res.status(500).json({ error: 'Сървърна грешка' });
  }
});

// API: get leaderboard
// query: limit=50&minGames=1&nickname=optional
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const minGames = Math.max(1, Math.min(50, Number(req.query.minGames) || 1));
    const focusNick = req.query.nickname ? String(req.query.nickname) : null;

    const lb = await readLeaderboard();
    const arr = Object.values(lb).filter(r => (r.solved || 0) >= minGames);
    arr.sort((a, b) => {
      if (a.avgAttempts !== b.avgAttempts) return a.avgAttempts - b.avgAttempts;
      if ((b.solved || 0) !== (a.solved || 0)) return (b.solved || 0) - (a.solved || 0);
      return (a.nickname || '').localeCompare(b.nickname || '');
    });

    const ranked = arr.slice(0, limit).map((r, idx) => ({
      rank: idx + 1,
      nickname: r.nickname,
      avgAttempts: r.avgAttempts,
      games: r.solved,
      lastUpdated: r.lastUpdated,
    }));

    let me = null;
    if (focusNick && lb[focusNick]) {
      const i = arr.findIndex(r => r.nickname === focusNick);
      if (i >= 0) {
        const r = arr[i];
        me = {
          rank: i + 1,
          nickname: r.nickname,
          avgAttempts: r.avgAttempts,
          games: r.solved,
          lastUpdated: r.lastUpdated,
        };
      }
    }

    res.json({ ok: true, limit, minGames, leaderboard: ranked, me });
  } catch (err) {
    console.error('leaderboard error', err);
    res.status(500).json({ error: 'Сървърна грешка' });
  }
});

app.listen(PORT, () => {
  console.log(`SixWordsWordle server listening on http://localhost:${PORT}`);
});
