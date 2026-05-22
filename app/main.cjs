const { app, BrowserWindow, ipcMain, nativeImage, Notification, utilityProcess, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const XLSX = require('xlsx');

app.setPath('userData', path.join(app.getPath('appData'), 'TianXiweiVoteAssistApp'));

let mainWindow;
let activeWorker = null;
let lastNotificationKey = '';
let setupPromise = null;

const rootDir = app.getAppPath();
const runtimeDir = app.getPath('userData');
const dataDir = path.join(runtimeDir, 'data');
const scorePath = path.join(dataDir, 'vote-score-history.csv');
const accountsPath = path.join(dataDir, 'accounts.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    title: 'Tian Xiwei Vote Assist',
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

function send(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function notifyIfNeeded(text) {
  const nextKey = text.trim();
  if (!nextKey || nextKey === lastNotificationKey) return;

  if (/Bạn nhập captcha và bấm Sign Up thủ công/i.test(text)) {
    lastNotificationKey = nextKey;
    if (Notification.isSupported()) {
      new Notification({
        title: 'Đã tới lúc nhập Captcha',
        body: 'Công cụ đã đi tới bước đăng ký. Mở trình duyệt và nhập captcha rồi bấm Sign Up.'
      }).show();
    }
    return;
  }

  if (/Đã mở form Bugs và điền ID\/password|Verify you are human/i.test(text)) {
    lastNotificationKey = nextKey;
    if (Notification.isSupported()) {
      new Notification({
        title: 'Đã tới bước đăng nhập Bugs',
        body: 'Công cụ đã mở form Bugs và đang tự chờ xác thực hoàn tất để bấm Log in.'
      }).show();
    }
  }
}

function runUtility(modulePath, args = []) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(modulePath, args, {
      cwd: runtimeDir,
      stdio: 'pipe'
    });

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      send('worker-log', text);
      notifyIfNeeded(text);
    });
    child.stderr?.on('data', (data) => {
      const text = data.toString();
      send('worker-log', text);
      notifyIfNeeded(text);
    });
    child.on('exit', (code) => {
      if (activeWorker === child) activeWorker = null;
      code === 0 ? resolve() : reject(new Error(`Worker exited with code ${code}`));
    });
    activeWorker = child;
  });
}

async function ensureRuntimeDirs() {
  await fs.mkdir(path.join(runtimeDir, 'data'), { recursive: true });
  await fs.mkdir(path.join(runtimeDir, 'logs'), { recursive: true });
}

function ensureWorkerReady() {
  if (!setupPromise) {
    setupPromise = (async () => {
      send('setup-status', 'setupCheckingBrowser');
      await runUtility(path.join(__dirname, 'setup-worker.cjs'));
      send('setup-status', 'browserReady');
    })().finally(() => {
      setupPromise = null;
    });
  }

  return setupPromise;
}

async function readScoreSummary() {
  try {
    const lines = (await fs.readFile(scorePath, 'utf8')).trim().split(/\r?\n/);
    const [latest] = lines.slice(1);
    if (!latest) return { latest: null, history: [] };
    const history = lines.slice(1).map((line) => {
      const [checkedAt, tianXiweiVotes, top1Votes] = line.split(',');
      return {
        checkedAt,
        tianXiweiVotes: Number(tianXiweiVotes) || 0,
        top1Votes: Number(top1Votes) || 0
      };
    });
    return { latest: history[0], history };
  } catch {
    return { latest: null, history: [] };
  }
}

async function readAccounts() {
  try {
    return JSON.parse(await fs.readFile(accountsPath, 'utf8'));
  } catch {
    return [];
  }
}

//
async function saveAccounts(accounts) {
  await fs.mkdir(path.dirname(accountsPath), { recursive: true });
  await fs.writeFile(accountsPath, `${JSON.stringify(accounts, null, 2)}\n`);
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function parseVotedToday(value) {
  const text = String(value || '').trim().toLowerCase();

  if (['1', 'yes', 'y', 'true', 'co', 'có', 'da', 'đã', 'roi', 'rồi', 'x'].includes(text)) {
    return true;
  }

  if (['0', 'no', 'n', 'false', 'khong', 'không', 'chua', 'chưa', ''].includes(text)) {
    return false;
  }

  return null;
}

function randomImportedNickname(email) {
  const name = String(email || '').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  return `import_${name || Date.now().toString(36)}`;
}

function importedAccountFromRow(row, importedAt) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value;
  }

  const email = String(
    normalized.user ||
    normalized.email ||
    normalized.username ||
    ''
  ).trim();

  const password = String(
    normalized.pass ||
    normalized.password ||
    normalized.mat_khau ||
    ''
  ).trim();

  const votedRaw =
    normalized.voted_today ??
    normalized.vote_today ??
    normalized.voted ??
    normalized.da_vote_hom_nay_hay_chua ??
    normalized.da_vote_hom_nay;

  const votedToday = parseVotedToday(votedRaw);

  if (!email || !password || votedToday === null) {
    return null;
  }

  const lastVotedAt = new Date(importedAt.getTime() - (votedToday ? 0 : 24 * 60 * 60 * 1000)).toISOString();

  return {
    email,
    password,
    identificationEmail: '',
    nickname: randomImportedNickname(email),
    dob: '',
    createdAt: importedAt.toISOString(),
    lastVotedAt,
    lastVoteCount: votedToday ? 5 : 0,
    status: 'active',
    lastError: ''
  };
}
//

ipcMain.handle('setup:first-run', async () => {
  send('setup-status', 'setupPreparingData');
  await ensureRuntimeDirs();
  send('setup-status', 'setupDone');
  return true;
});

ipcMain.handle('data:summary', async () => readScoreSummary());
ipcMain.handle('data:accounts', async () => readAccounts());

ipcMain.handle('run:start', async (_event, mode, options = {}) => {
  if (activeWorker) throw new Error('Đang có tiến trình chạy.');
  const command = mode === 'login' ? 'login' : 'signup';
  const runnerArgs = [command];
  if (command === 'signup' && options.count) {
    runnerArgs.push(String(options.count));
  }
  await ensureRuntimeDirs();
  send('run-state', { running: true, mode: command });
  try {
    await ensureWorkerReady();
    await runUtility(path.join(__dirname, 'runner.cjs'), runnerArgs);
  } finally {
    send('data-updated');
    send('run-state', { running: false, mode: command });
  }
});

ipcMain.handle('run:stop', async () => {
  if (!activeWorker) return false;
  activeWorker.kill();
  activeWorker = null;
  send('run-state', { running: false });
  return true;
});

//
ipcMain.handle('accounts:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import accounts from Excel',
    filters: [
      { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths.length) {
    return { cancelled: true };
  }

  const workbook = XLSX.readFile(result.filePaths[0]);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const importedAt = new Date();
  const accounts = await readAccounts();
  const byEmail = new Map(accounts.map((account) => [String(account.email || '').toLowerCase(), account]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const nextAccount = importedAccountFromRow(row, importedAt);

    if (!nextAccount) {
      skipped += 1;
      continue;
    }

    const key = nextAccount.email.toLowerCase();
    const existing = byEmail.get(key);

    if (existing) {
      Object.assign(existing, {
        ...existing,
        password: nextAccount.password,
        lastVotedAt: nextAccount.lastVotedAt,
        lastVoteCount: existing.lastVoteCount || nextAccount.lastVoteCount,
        status: 'active',
        lastError: ''
      });
      updated += 1;
    } else {
      accounts.push(nextAccount);
      byEmail.set(key, nextAccount);
      created += 1;
    }
  }

  await saveAccounts(accounts);
  send('data-updated');

  return {
    cancelled: false,
    created,
    updated,
    skipped
  };
});
//
//
ipcMain.handle('accounts:mark-voted-today', async (_event, email) => {
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!targetEmail) {
    throw new Error('Missing account email');
  }

  const accounts = await readAccounts();
  const account = accounts.find((entry) => String(entry.email || '').trim().toLowerCase() === targetEmail);

  if (!account) {
    throw new Error('Account not found');
  }

  account.lastVotedAt = new Date().toISOString();
  account.status = account.status || 'active';
  account.lastError = '';

  await saveAccounts(accounts);
  send('data-updated');

  return {
    ok: true,
    account
  };
});
//
ipcMain.handle('accounts:download-template', async (_event, language = 'vi') => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save account import template',
    defaultPath: 'bugs-accounts-template.xlsx',
    filters: [
      { name: 'Excel Files', extensions: ['xlsx'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { cancelled: true };
  }

  const workbook = XLSX.utils.book_new();

  const templateTexts = {
    vi: {
      no: 'chưa',
      yes: 'có',
      notes: 'Lưu ý',
      userNote: 'user = tài khoản Bugs',
      passNote: 'pass = mật khẩu tài khoản Bugs, không phải mật khẩu email',
      votedNote: 'voted_today có thể nhập: yes/no, true/false, 1/0 hoặc có/chưa',
      deleteNote: 'Trước khi import vào app, vui lòng xóa toàn bộ phần Lưu ý này và chỉ giữ lại bảng 3 cột phía trên.'
    },
    en: {
      no: 'no',
      yes: 'yes',
      notes: 'Notes',
      userNote: 'user = Bugs account',
      passNote: 'pass = Bugs account password, not email password',
      votedNote: 'voted_today can be: yes/no, true/false, 1/0',
      deleteNote: 'Before importing into the app, please delete this entire Notes section and keep only the 3-column table above.'
    },
    zh: {
      no: 'no',
      yes: 'yes',
      notes: '注意',
      userNote: 'user = Bugs 账号',
      passNote: 'pass = Bugs 账号密码，不是邮箱密码',
      votedNote: 'voted_today 可填写：yes/no、true/false、1/0',
      deleteNote: '导入应用前，请删除整个注意说明区域，只保留上方的 3 列表格。'
    },
    ko: {
      no: 'no',
      yes: 'yes',
      notes: '주의',
      userNote: 'user = Bugs 계정',
      passNote: 'pass = Bugs 계정 비밀번호, 이메일 비밀번호가 아님',
      votedNote: 'voted_today 입력 가능: yes/no, true/false, 1/0',
      deleteNote: '앱으로 가져오기 전에 이 주의 안내 영역 전체를 삭제하고 위의 3개 열 표만 남겨 주세요.'
    }
  };

  const templateText = templateTexts[language] || templateTexts.en;

  const rows = [
    ['user', 'pass', 'voted_today'],
    ['example1@bugs.com', 'BugsPassword123', templateText.no],
    ['example2@bugs.com', 'BugsPassword456', templateText.yes],
    [],
    [templateText.notes],
    [templateText.userNote],
    [templateText.passNote],
    [templateText.votedNote],
    [templateText.deleteNote]
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);

  sheet['!cols'] = [
    { wch: 28 },
    { wch: 24 },
    { wch: 30 }
  ];

  XLSX.utils.book_append_sheet(workbook, sheet, 'accounts');

  XLSX.writeFile(workbook, result.filePath);

  return {
    cancelled: false,
    filePath: result.filePath
  };
});
//

app.whenReady().then(createWindow);

app.whenReady().then(() => {
  const iconPath = path.join(__dirname, 'assets', 'icon-source.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty() && process.platform === 'darwin') {
    app.dock.setIcon(icon);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
