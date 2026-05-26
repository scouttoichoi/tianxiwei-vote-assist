const { app, BrowserWindow, ipcMain, nativeImage, Notification, utilityProcess, dialog, screen, session } = require('electron'); const path = require('node:path');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const fs = require('node:fs/promises');
const XLSX = require('xlsx');

app.setPath('userData', path.join(app.getPath('appData'), 'TianXiweiVoteAssistApp'));

let mainWindow;
const activeWorkers = new Map(); // key: instanceId, value: childProcess
const stoppingWorkers = new Set(); // key: instanceId, true when user intentionally stops a worker
const activeAdbDevices = new Map(); // // adbLockKey -> instanceId
let lastNotificationKey = '';
let setupPromise = null;
let ipBlockStopInProgress = false;

const rootDir = app.getAppPath();
const runtimeDir = app.getPath('userData');
const globalSettingsPath = path.join(runtimeDir, 'global-settings.json');
const fsSync = require('node:fs');

// Tự động phát hiện và cấu hình đường dẫn Chromium cục bộ (nếu có)
function detectLocalBinary() {
  const binaryNames = {
    win32: 'chrome.exe',
    darwin: 'Chromium.app/Contents/MacOS/Chromium',
    linux: 'chrome'
  };
  const binName = binaryNames[process.platform] || 'chrome';

  // 1. Kiểm tra thư mục bin/ bên cạnh thư mục cài đặt ứng dụng (rootDir)
  const path1 = path.join(rootDir, 'bin', binName);
  if (fsSync.existsSync(path1)) return path1;

  // 2. Kiểm tra thư mục bin/ trong thư mục dữ liệu ứng dụng (runtimeDir)
  const path2 = path.join(runtimeDir, 'bin', binName);
  if (fsSync.existsSync(path2)) return path2;

  // 3. Kiểm tra trong thư mục tài nguyên gốc nếu đang chạy chế độ dev
  const path3 = path.join(rootDir, 'app', 'assets', 'bin', binName);
  if (fsSync.existsSync(path3)) return path3;

  return null;
}

const localBinaryPath = detectLocalBinary();
if (localBinaryPath) {
  process.env.CLOAKBROWSER_BINARY_PATH = localBinaryPath;
  console.log(`[TianXiweiApp] Tự động phát hiện Chromium cục bộ tại: ${localBinaryPath}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: 'Tian Xiwei Vote Assist - Multi-Instance',
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

function notifyIfNeeded(text, instanceName = '') {
  const nextKey = text.trim();
  if (!nextKey || nextKey === lastNotificationKey) return;

  const prefix = instanceName ? `[${instanceName}] ` : '';

  if (/Bạn nhập captcha và bấm Sign Up thủ công/i.test(text)) {
    lastNotificationKey = nextKey;
    if (Notification.isSupported()) {
      new Notification({
        title: `${prefix}Đã tới lúc nhập Captcha`,
        body: 'Công cụ đã đi tới bước đăng ký. Mở trình duyệt và nhập captcha rồi bấm Sign Up.'
      }).show();
    }
    return;
  }

  if (/Đã mở form Bugs và điền ID\/password|Verify you are human/i.test(text)) {
    lastNotificationKey = nextKey;
    if (Notification.isSupported()) {
      new Notification({
        title: `${prefix}Đã tới bước đăng nhập Bugs`,
        body: 'Công cụ đã mở form Bugs và đang tự chờ xác thực hoàn tất để bấm Log in.'
      }).show();
    }
  }
}

function isIpTemporarilyBlockedLog(text) {
  return /Your IP is temporarily unavailable for membership/i.test(text || '');
}

function stopAllActiveWorkers(reason = '') {
  if (ipBlockStopInProgress) return;
  ipBlockStopInProgress = true;

  const runningInstanceIds = [...activeWorkers.keys()];
  console.warn(`[System] Dừng toàn bộ worker do phát hiện IP bị block.${reason ? ` Lý do: ${reason}` : ''}`);

  for (const instanceId of runningInstanceIds) {
    for (const [deviceId, ownerInstanceId] of activeAdbDevices.entries()) {
      if (ownerInstanceId === instanceId) {
        activeAdbDevices.delete(deviceId);
      }
    }

    const child = activeWorkers.get(instanceId);
    if (!child) continue;
    stoppingWorkers.add(instanceId);
    child.kill();
    activeWorkers.delete(instanceId);
    send('run-state', { instanceId, running: false });
  }

  send('worker-log', {
    instanceId: 'system',
    text: '[System] Phát hiện lỗi "Your IP is temporarily unavailable for membership". Đã dừng toàn bộ tiến trình đang chạy.\n'
  });

  if (Notification.isSupported()) {
    new Notification({
      title: 'Đã dừng toàn bộ tiến trình',
      body: 'Phát hiện IP đang bị Bugs chặn tạm thời. App đã dừng tất cả worker.'
    }).show();
  }

  ipBlockStopInProgress = false;
}

function runUtility(modulePath, args = [], cwd, instanceId, instanceName = '', onStart = null) {
  return new Promise((resolve, reject) => {
    const child = fork(modulePath, args, {
      cwd: cwd,
      stdio: 'pipe'
    });

    if (onStart) onStart(child);
    activeWorkers.set(instanceId, child);

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      console.log(`[Worker:${instanceId}] ${text.trim()}`);
      send('worker-log', { instanceId, text });
      notifyIfNeeded(text, instanceName);
      if (isIpTemporarilyBlockedLog(text)) {
        stopAllActiveWorkers(text.trim());
      }
    });
    child.stderr?.on('data', (data) => {
      const text = data.toString();
      console.error(`[Worker:${instanceId}:stderr] ${text.trim()}`);
      send('worker-log', { instanceId, text });
      notifyIfNeeded(text, instanceName);
      if (isIpTemporarilyBlockedLog(text)) {
        stopAllActiveWorkers(text.trim());
      }
    });
    child.on('error', (error) => {
      activeWorkers.delete(instanceId);
      stoppingWorkers.delete(instanceId);
      send('run-state', { instanceId, running: false });
      send('data-updated', { instanceId });
      reject(error);
    });
    child.on('exit', (code, signal) => {
      const wasStopped = stoppingWorkers.delete(instanceId);
      activeWorkers.delete(instanceId);
      send('run-state', { instanceId, running: false });
      send('data-updated', { instanceId });

      if (wasStopped) {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `code ${code}`;
      reject(new Error(`Worker exited with ${reason}`));
    });
  });
}

async function ensureRuntimeDirs() {
  await fs.mkdir(path.join(runtimeDir, 'instances'), { recursive: true });

  // Tự động kiểm tra và di chuyển dữ liệu phiên bản cũ (Migration)
  try {
    let legacyAccountsPath = '';
    let legacyScorePath = '';
    let legacyProfilePath = '';
    let legacyConfigPath = '';

    // 1. Kiểm tra thư mục local workspace trước (trong chế độ dev)
    if (!app.isPackaged) {
      const localAccounts = path.join(rootDir, 'data', 'accounts.json');
      try {
        await fs.access(localAccounts);
        legacyAccountsPath = localAccounts;
        legacyScorePath = path.join(rootDir, 'data', 'vote-score-history.csv');
        legacyProfilePath = path.join(rootDir, '.cloakbrowser-profile');
        legacyConfigPath = path.join(rootDir, 'vote-assist.config.json');
      } catch { }
    }

    // 2. Nếu không có hoặc đang chạy app build, quét thư mục userData
    if (!legacyAccountsPath) {
      const packagedAccounts = path.join(runtimeDir, 'data', 'accounts.json');
      try {
        await fs.access(packagedAccounts);
        legacyAccountsPath = packagedAccounts;
        legacyScorePath = path.join(runtimeDir, 'data', 'vote-score-history.csv');
        legacyProfilePath = path.join(runtimeDir, '.cloakbrowser-profile');
        legacyConfigPath = path.join(runtimeDir, 'vote-assist.config.json');
      } catch { }
    }

    if (legacyAccountsPath) {
      const settings = await loadGlobalSettings();
      // Chỉ thực hiện di chuyển dữ liệu khi danh sách instances hiện tại đang rỗng
      if (!settings.instances || settings.instances.length === 0) {
        const legacyId = 'inst_legacy';
        const legacyDir = path.join(runtimeDir, 'instances', legacyId);

        await fs.mkdir(legacyDir, { recursive: true });
        await fs.mkdir(path.join(legacyDir, 'data'), { recursive: true });

        // Sao chép tài khoản
        await fs.copyFile(legacyAccountsPath, path.join(legacyDir, 'data', 'accounts.json'));

        // Sao chép lịch sử điểm vote nếu có
        if (legacyScorePath) {
          try {
            await fs.access(legacyScorePath);
            await fs.copyFile(legacyScorePath, path.join(legacyDir, 'data', 'vote-score-history.csv'));
          } catch { }
        }

        // Sao chép Profile Cloakbrowser cũ nếu có (bỏ qua thông báo nếu không có)
        if (legacyProfilePath) {
          try {
            await fs.access(legacyProfilePath);
            await fs.cp(legacyProfilePath, path.join(legacyDir, '.cloakbrowser-profile'), { recursive: true });
          } catch (err) {
            if (err.code !== 'ENOENT') {
              console.warn('Không thể sao chép profile cloakbrowser cũ:', err);
            }
          }
        }

        // Sao chép cấu hình cũ nếu có
        if (legacyConfigPath) {
          try {
            await fs.access(legacyConfigPath);
            await fs.copyFile(legacyConfigPath, path.join(legacyDir, 'vote-assist.config.json'));
          } catch {
            await fs.writeFile(
              path.join(legacyDir, 'vote-assist.config.json'),
              JSON.stringify({
                freshProfilePerRun: true,
                randomizeTempMail: true,
                proxy: null
              }, null, 2)
            );
          }
        }

        // Đăng ký luồng gốc vào danh sách quản lý
        settings.instances = [{
          id: legacyId,
          name: 'Bản gốc (Legacy)',
          proxy: '',
          createdAt: new Date().toISOString()
        }];
        await saveGlobalSettings(settings);
      }
    }
  } catch (error) {
    console.error('Lỗi trong quá trình tự động migration dữ liệu cũ:', error);
  }
}
//
async function ensureInstanceConfig(instanceId, settings) {
  const instanceDir = getInstanceDir(instanceId);
  const configPath = path.join(instanceDir, 'vote-assist.config.json');

  const index = Math.max(
    0,
    settings.instances.findIndex((item) => item.id === instanceId)
  );

  let currentConfig = {};
  try {
    currentConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch { }

  const nextConfig = {
    freshProfilePerRun: true,
    randomizeTempMail: true,
    autoFocusBrowser: false,
    viewport: {
      width: 600,
      height: 460,
      ...(currentConfig.viewport || {})
    },
    ...currentConfig,
    args: currentConfig.args || getBrowserTileArgs(index, settings.instances.length)
  };

  await fs.mkdir(instanceDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2));
}
//
//
function getBundledAdbPath() {
  const exeName = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const platformDir = process.platform === 'win32' ? 'win' : 'mac';

  let adbPath = path.join(__dirname, 'assets', 'bin', platformDir, exeName);

  if (adbPath.includes('app.asar')) {
    adbPath = adbPath.replace('app.asar', 'app.asar.unpacked');
  }

  return adbPath;
}
//
function isTcpAdbDeviceId(deviceId) {
  return /^127\.0\.0\.1:\d+$/.test(deviceId);
}

function isEmulatorAlias(deviceId) {
  return /^emulator-\d+$/.test(deviceId);
}

function shouldShowFarmAdbDevice(deviceId) {
  return isTcpAdbDeviceId(deviceId) || isEmulatorAlias(deviceId);
}

function preferAdbDeviceId(nextId, currentId) {
  if (isTcpAdbDeviceId(nextId) && !isTcpAdbDeviceId(currentId)) {
    return true;
  }

  return false;
}

async function getAdbDeviceLockKey(adbPath, deviceId) {
  try {
    const { stdout } = await execFileAsync(
      adbPath,
      ['-s', deviceId, 'shell', 'settings', 'get', 'secure', 'android_id'],
      { timeout: 2500 }
    );

    const androidId = stdout.trim();

    if (androidId && androidId !== 'null') {
      return `android:${androidId}`;
    }
  } catch { }

  try {
    const { stdout } = await execFileAsync(
      adbPath,
      ['-s', deviceId, 'shell', 'getprop', 'ro.serialno'],
      { timeout: 2500 }
    );

    const serialNo = stdout.trim();

    if (serialNo && serialNo !== 'unknown') {
      return `serial:${serialNo}`;
    }
  } catch { }

  return `device:${deviceId}`;
}
//

//
function getEmulatorLabel(deviceId) {
  if (deviceId.includes('62001')) {
    return `NoxPlayer - ${deviceId}`;
  }

  if (isTcpAdbDeviceId(deviceId)) {
    return `BlueStacks / LDPlayer - ${deviceId}`;
  }

  if (isEmulatorAlias(deviceId)) {
    return `Android Emulator - ${deviceId}`;
  }

  return `Android Emulator - ${deviceId}`;
}
//
//
async function readBlueStacksAdbPorts() {
  const baseDirs = Array.from(new Set([
    process.env.ProgramData,
    'C:\\ProgramData',
    'D:\\ProgramData',
    'E:\\ProgramData',
    'F:\\ProgramData'
  ].filter(Boolean)));

  const configPaths = [];

  for (const baseDir of baseDirs) {
    configPaths.push(
      path.join(baseDir, 'BlueStacks_nxt', 'bluestacks.conf'),
      path.join(baseDir, 'BlueStacks', 'bluestacks.conf'),
      path.join(baseDir, 'BlueStacks_msi5', 'bluestacks.conf')
    );
  }

  const ports = new Set();

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, 'utf8');

      for (const match of content.matchAll(/adb_port\s*=\s*"?(\d+)"?/gi)) {
        const port = Number(match[1]);

        if (Number.isInteger(port) && port > 0 && port < 65536) {
          ports.add(port);
        }
      }
    } catch { }
  }

  return Array.from(ports);
}

async function getAdbScanPorts() {
  const blueStacksPorts = await readBlueStacksAdbPorts();

  return Array.from(new Set([
    ...blueStacksPorts,

    // BlueStacks common ADB ports
    5555,
    5575,
    5595,
    5615,
    5635,
    5655,
    5675,
    5695,
    5605,

    // Android emulator aliases / nearby ports
    5554,
    5556,
    5558,
    5560,
    5562,
    5564,

    // Nox / others
    62001
  ]));
}
//

async function connectAdbPort(adbPath, port) {
  try {
    await execFileAsync(
      adbPath,
      ['connect', `127.0.0.1:${port}`],
      { timeout: 1200 }
    );
  } catch { }
}

async function scanOnlineAdbDevices() {
  const adbPath = getBundledAdbPath();

  const ports = await getAdbScanPorts();

  await Promise.all(
    ports.map((port) => connectAdbPort(adbPath, port))
  );

  const { stdout } = await execFileAsync(adbPath, ['devices']);
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const devices = lines
    .slice(1)
    .map((line) => {
      const [id, state] = line.split(/\s+/);
      return { id, state };
    })
    .filter((device) => device.state === 'device')
    .filter((device) => shouldShowFarmAdbDevice(device.id));

  const uniqueDevices = new Map();

  for (const device of devices) {
    const lockKey = await getAdbDeviceLockKey(adbPath, device.id);
    const current = uniqueDevices.get(lockKey);

    if (!current || preferAdbDeviceId(device.id, current.id)) {
      uniqueDevices.set(lockKey, {
        ...device,
        lockKey
      });
    }
  }

  return Array.from(uniqueDevices.values()).map((device) => {
    const usedBy =
      activeAdbDevices.get(device.lockKey) ||
      activeAdbDevices.get(device.id) ||
      '';

    return {
      id: device.id,
      lockKey: device.lockKey,
      label: getEmulatorLabel(device.id),
      available: !usedBy,
      usedBy
    };
  });
}
//

function runSetupWorker(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'setup-worker.cjs'), [], {
      cwd: runtimeDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      console.log(`[Setup-Worker] ${text.trim()}`);

      const progressMatch = text.match(/Download progress:\s*(\d+%\s*\([^)]+\))/i);
      const mirrorMatch = text.match(/Tải qua mirror:\s*(.+)/i);

      if (progressMatch) {
        send('setup-status', `progress:${progressMatch[1]}`);
      } else if (mirrorMatch) {
        const urlStr = mirrorMatch[1];
        let cleanUrl = urlStr;
        try {
          const urlObj = new URL(urlStr);
          cleanUrl = urlObj.hostname;
        } catch { }
        send('setup-status', `mirror:${cleanUrl}`);
      } else {
        send('setup-status', 'browserDownloading');
      }

      send('worker-log', { instanceId: 'setup', text });
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      console.error(`[Setup-Worker-Error] ${text.trim()}`);
      send('worker-log', { instanceId: 'setup', text });
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Setup worker failed with code ${code}`));
    });
  });
}

function ensureSetupWorkerReady() {
  if (!setupPromise) {
    setupPromise = (async () => {
      send('setup-status', 'setupCheckingBrowser');

      let systemProxy = null;
      try {
        if (session && session.defaultSession) {
          const resolved = await session.defaultSession.resolveProxy('https://github.com');
          if (resolved && resolved.trim() !== '' && !resolved.toUpperCase().includes('DIRECT')) {
            const parts = resolved.split(';');
            for (const part of parts) {
              const trimmed = part.trim();
              const match = trimmed.match(/^(PROXY|SOCKS|SOCKS5)\s+(.+)$/i);
              if (match) {
                const type = match[1].toLowerCase();
                const addr = match[2];
                if (type === 'proxy') {
                  systemProxy = `http://${addr}`;
                  break;
                } else if (type === 'socks5' || type === 'socks') {
                  systemProxy = `socks5://${addr}`;
                  break;
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[TianXiweiApp] Lỗi khi nhận diện proxy hệ thống:', err);
      }

      if (systemProxy) {
        console.log(`[TianXiweiApp] Nhận diện proxy hệ thống từ Electron: ${systemProxy}`);
      }

      try {
        // setup-worker handles all mirrors internally and automatically
        await runSetupWorker({
          DETECTED_SYSTEM_PROXY: systemProxy || ''
        });
      } catch (error) {
        console.error('[TianXiweiApp] Thiết lập trình duyệt thất bại hoàn toàn:', error);
        throw error;
      }
      send('setup-status', 'browserReady');
    })().finally(() => {
      setupPromise = null;
    });
  }

  return setupPromise;
}

// Cấu hình Global
async function loadGlobalSettings() {
  try {
    const content = await fs.readFile(globalSettingsPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return { instances: [] };
  }
}

async function saveGlobalSettings(settings) {
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(globalSettingsPath, JSON.stringify(settings, null, 2));
}

// Cấu hình của từng Instance
function getInstanceDir(instanceId) {
  return path.join(runtimeDir, 'instances', instanceId);
}

function getAccountsPath(instanceId) {
  return path.join(getInstanceDir(instanceId), 'data', 'accounts.json');
}

function getScorePath(instanceId) {
  return path.join(getInstanceDir(instanceId), 'data', 'vote-score-history.csv');
}

async function readScoreSummary(instanceId) {
  const scorePath = getScorePath(instanceId);
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

async function readAccounts(instanceId) {
  const accountsPath = getAccountsPath(instanceId);
  try {
    return JSON.parse(await fs.readFile(accountsPath, 'utf8'));
  } catch {
    return [];
  }
}

async function saveAccounts(instanceId, accounts) {
  const accountsPath = getAccountsPath(instanceId);
  await fs.mkdir(path.dirname(accountsPath), { recursive: true });
  await fs.writeFile(accountsPath, `${JSON.stringify(accounts, null, 2)}\n`);
}

function parseProxyString(proxyStr) {
  if (!proxyStr || !proxyStr.trim()) return null;
  let str = proxyStr.trim();
  // Nếu không có scheme, mặc định là http://
  if (!/^[a-zA-Z0-9]+:\/\//.test(str)) {
    str = 'http://' + str;
  }
  try {
    const url = new URL(str);
    const proxyObj = {
      server: `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`
    };
    if (url.username) proxyObj.username = url.username;
    if (url.password) proxyObj.password = url.password;
    return proxyObj;
  } catch {
    return { server: proxyStr.trim() };
  }
}

function formatProxyObjToString(proxyObj) {
  if (!proxyObj || !proxyObj.server) return '';
  let str = proxyObj.server;
  if (proxyObj.username && proxyObj.password) {
    // Chèn user:pass vào sau protocol
    const match = str.match(/^([a-zA-Z0-9]+:\/\/)(.+)$/);
    if (match) {
      str = `${match[1]}${proxyObj.username}:${proxyObj.password}@${match[2]}`;
    }
  }
  return str;
}
//
function getBrowserTileArgs(index, total = 1) {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;

  const columns = Math.min(3, Math.max(1, total));
  const width = 600;
  const height = 460;
  const gapX = 16;
  const gapY = 24;

  const rows = Math.ceil(total / columns);
  const gridWidth = columns * width + (columns - 1) * gapX;
  const gridHeight = rows * height + (rows - 1) * gapY;

  const startX = area.x + Math.max(0, Math.floor((area.width - gridWidth) / 2));
  const startY = area.y + Math.max(0, Math.floor((area.height - gridHeight) / 2));

  const col = index % columns;
  const row = Math.floor(index / columns);

  const x = startX + col * (width + gapX);
  const y = startY + row * (height + gapY);

  return [
    `--window-size=${width},${height}`,
    `--window-position=${x},${y}`
  ];
}
//
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

function koreaDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function hasVotedTodayKorea(lastVotedAt) {
  if (!lastVotedAt) return false;
  return koreaDateKey(lastVotedAt) === koreaDateKey();
}

function accountToExportRow(account) {
  return {
    user: account.email || '',
    pass: account.password || '',
    voted_today: hasVotedTodayKorea(account.lastVotedAt) ? 'yes' : 'no'
  };
}

// --- IPC HANDLERS ---

//
ipcMain.handle('instances:scan-emulators', async () => {
  const devices = await scanOnlineAdbDevices();

  return {
    devices
  };
});
//
ipcMain.handle('setup:first-run', async () => {
  send('setup-status', 'setupPreparingData');
  await ensureRuntimeDirs();
  await ensureSetupWorkerReady();
  send('setup-status', 'setupDone');
  return true;
});

// Quản lý Instance
ipcMain.handle('instances:list', async () => {
  const settings = await loadGlobalSettings();
  const list = settings.instances || [];

  // Bổ sung thông tin trạng thái chạy động và thống kê vote
  const result = await Promise.all(list.map(async (inst) => {
    const running = activeWorkers.has(inst.id);
    const accounts = await readAccounts(inst.id);
    const summary = await readScoreSummary(inst.id);

    const votedTodayCount = accounts.filter(acc => hasVotedTodayKorea(acc.lastVotedAt)).length;

    return {
      ...inst,
      running,
      totalAccounts: accounts.length,
      votedTodayCount,
      latestScore: summary.latest
    };
  }));

  return result;
});

ipcMain.handle('instances:create', async (_event, name, proxyStr = '') => {
  const settings = await loadGlobalSettings();
  const instanceId = 'inst_' + Date.now();
  const instanceDir = getInstanceDir(instanceId);

  await fs.mkdir(instanceDir, { recursive: true });
  await fs.mkdir(path.join(instanceDir, 'data'), { recursive: true });
  await fs.mkdir(path.join(instanceDir, 'logs'), { recursive: true });

  const proxyObj = parseProxyString(proxyStr);
  const index = settings.instances.length;
  const configContent = {
    freshProfilePerRun: true,
    randomizeTempMail: true,
    autoFocusBrowser: false,
    proxy: proxyObj,
    viewport: {
      width: 600,
      height: 460
    },
    args: getBrowserTileArgs(index, settings.instances.length + 1)
  };

  await fs.writeFile(
    path.join(instanceDir, 'vote-assist.config.json'),
    JSON.stringify(configContent, null, 2)
  );

  const newInst = {
    id: instanceId,
    name: name || `Luồng ${settings.instances.length + 1}`,
    proxy: proxyStr || '',
    createdAt: new Date().toISOString()
  };

  settings.instances.push(newInst);
  await saveGlobalSettings(settings);

  send('instances-updated');
  return newInst;
});

ipcMain.handle('instances:delete', async (_event, instanceId) => {
  // Nếu đang chạy thì bắt buộc stop trước
  if (activeWorkers.has(instanceId)) {
    const child = activeWorkers.get(instanceId);
    child.kill();
    activeWorkers.delete(instanceId);
  }

  const settings = await loadGlobalSettings();
  settings.instances = settings.instances.filter(inst => inst.id !== instanceId);
  await saveGlobalSettings(settings);

  const instanceDir = getInstanceDir(instanceId);
  await fs.rm(instanceDir, { recursive: true, force: true }).catch(() => { });

  send('instances-updated');
  return true;
});

ipcMain.handle('instances:update-config', async (_event, instanceId, name, proxyStr) => {
  const settings = await loadGlobalSettings();
  const inst = settings.instances.find(i => i.id === instanceId);
  if (!inst) throw new Error('Không tìm thấy instance');

  inst.name = name || inst.name;
  inst.proxy = proxyStr;

  await saveGlobalSettings(settings);

  // Ghi đè config json của instance
  const instanceDir = getInstanceDir(instanceId);
  const configPath = path.join(instanceDir, 'vote-assist.config.json');
  let configContent = {};
  try {
    configContent = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch { }

  configContent.proxy = parseProxyString(proxyStr);
  const index = settings.instances.findIndex((item) => item.id === instanceId);
  configContent.autoFocusBrowser = false;
  configContent.viewport = {
    width: 600,
    height: 460
  };
  configContent.args = getBrowserTileArgs(Math.max(index, 0), settings.instances.length);
  await fs.mkdir(instanceDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(configContent, null, 2));

  send('instances-updated');
  return true;
});

// Điều khiển tiến trình của Instance
ipcMain.handle('instances:start', async (_event, instanceId, mode, options = {}) => {
  if (activeWorkers.has(instanceId)) {
    return {
      ok: false,
      error: 'Phiên bản này đang chạy.'
    };
  }

  const settings = await loadGlobalSettings();
  const inst = settings.instances.find(i => i.id === instanceId);
  const instanceName = inst ? inst.name : '';

  let command = 'signup';
  if (mode === 'login') command = 'login';
  else if (mode === 'ads') command = 'ads';
  const uiMode = mode === 'signup-manual' ? 'signup-manual' : command;

  const adbDeviceId = command === 'ads' ? String(options.emulatorDevice || '').trim() : '';
  let adbDeviceLocks = [];

  if (command === 'ads' && !adbDeviceId) {
    return {
      ok: false,
      error: 'Chưa chọn giả lập đang online.'
    };
  }

  if (command === 'ads') {
    const adbPath = getBundledAdbPath();
    const adbDeviceLockKey = await getAdbDeviceLockKey(adbPath, adbDeviceId);

    adbDeviceLocks = Array.from(new Set([
      adbDeviceId,
      adbDeviceLockKey
    ].filter(Boolean)));

    const usedLock = adbDeviceLocks.find((lock) => {
      const usedBy = activeAdbDevices.get(lock);
      return usedBy && usedBy !== instanceId;
    });

    if (usedLock) {
      return {
        ok: false,
        error: `Giả lập ${adbDeviceId} đang được instance khác sử dụng.`
      };
    }

    for (const lock of adbDeviceLocks) {
      activeAdbDevices.set(lock, instanceId);
    }
  }

  const runnerArgs = [command];
  if (command === 'signup' && options.count) {
    runnerArgs.push(String(options.count));
    if (options.manualCaptcha || mode === 'signup-manual') {
      runnerArgs.push('manual-captcha');
    }
  } else if (command === 'ads') {
    runnerArgs.push(options.emulatorType || 'adb_device');
    runnerArgs.push(adbDeviceId);
  }

  const instanceDir = getInstanceDir(instanceId);
  await fs.mkdir(path.join(instanceDir, 'data'), { recursive: true });
  await fs.mkdir(path.join(instanceDir, 'logs'), { recursive: true });

  // Thiết lập placeholder trong activeWorkers ngay lập tức
  let startingChild = null;
  activeWorkers.set(instanceId, {
    kill: () => {
      if (startingChild) startingChild.kill();
    }
  });

  send('run-state', { instanceId, running: true, mode: uiMode });

  try {
    await ensureSetupWorkerReady();
    await ensureInstanceConfig(instanceId, settings);

    if (stoppingWorkers.has(instanceId)) {
      return {
        ok: false,
        stopped: true
      };
    }

    await runUtility(
      path.join(__dirname, 'runner.cjs'),
      runnerArgs,
      instanceDir,
      instanceId,
      instanceName,
      (child) => {
        startingChild = child;
      }
    );
    return {
      ok: true
    };
  } catch (error) {
    const message = error?.stack || error?.message || String(error);
    send('worker-log', {
      instanceId,
      text: `\n${message}\n`
    });
    return {
      ok: false,
      error: error?.message || String(error)
    };
  } finally {
    for (const lock of adbDeviceLocks) {
      activeAdbDevices.delete(lock);
    }
    activeWorkers.delete(instanceId);
    stoppingWorkers.delete(instanceId);
    send('data-updated', { instanceId });
    send('run-state', { instanceId, running: false, mode: uiMode });
  }
});

ipcMain.handle('instances:stop', async (_event, instanceId) => {

  for (const [deviceId, ownerInstanceId] of activeAdbDevices.entries()) {
    if (ownerInstanceId === instanceId) {
      activeAdbDevices.delete(deviceId);
    }
  }

  if (!activeWorkers.has(instanceId)) return false;
  const child = activeWorkers.get(instanceId);
  stoppingWorkers.add(instanceId);
  child.kill();
  activeWorkers.delete(instanceId);
  send('run-state', { instanceId, running: false });
  return true;
});

// Đọc ghi dữ liệu theo Instance
ipcMain.handle('instances:get-summary', async (_event, instanceId) => readScoreSummary(instanceId));
ipcMain.handle('instances:get-accounts', async (_event, instanceId) => readAccounts(instanceId));

ipcMain.handle('instances:import-accounts', async (_event, instanceId) => {
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
  const accounts = await readAccounts(instanceId);
  const byEmail = new Map(accounts.map((account) => [String(account.email || '').toLowerCase(), account]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let duplicated = 0;
  const seenEmails = new Set();

  for (const row of rows) {
    const nextAccount = importedAccountFromRow(row, importedAt);

    if (!nextAccount) {
      skipped += 1;
      continue;
    }

    const key = nextAccount.email.toLowerCase();
    if (seenEmails.has(key)) {
      duplicated += 1;
      skipped += 1;
      continue;
    }
    seenEmails.add(key);

    const existing = byEmail.get(key);

    if (existing) {
      duplicated += 1;
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

  await saveAccounts(instanceId, accounts);
  send('data-updated', { instanceId });

  return {
    cancelled: false,
    created,
    updated,
    skipped,
    duplicated
  };
});

ipcMain.handle('instances:export-accounts', async (_event, instanceId) => {
  const settings = await loadGlobalSettings();
  const inst = settings.instances.find((item) => item.id === instanceId);
  const safeName = String(inst?.name || instanceId || 'instance')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 60);

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export accounts to Excel',
    defaultPath: `${safeName || 'instance'}-accounts.xlsx`,
    filters: [
      { name: 'Excel Files', extensions: ['xlsx'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { cancelled: true };
  }

  const accounts = await readAccounts(instanceId);
  const rows = accounts.map(accountToExportRow);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ['user', 'pass', 'voted_today']
  });

  sheet['!cols'] = [
    { wch: 32 },
    { wch: 24 },
    { wch: 14 }
  ];

  XLSX.utils.book_append_sheet(workbook, sheet, 'accounts');
  XLSX.writeFile(workbook, result.filePath);

  return {
    cancelled: false,
    filePath: result.filePath,
    count: rows.length
  };
});

ipcMain.handle('instances:mark-voted', async (_event, instanceId, email) => {
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!targetEmail) {
    throw new Error('Missing account email');
  }

  const accounts = await readAccounts(instanceId);
  const account = accounts.find((entry) => String(entry.email || '').trim().toLowerCase() === targetEmail);

  if (!account) {
    throw new Error('Account not found');
  }

  account.lastVotedAt = new Date().toISOString();
  account.status = account.status || 'active';
  account.lastError = '';

  await saveAccounts(instanceId, accounts);
  send('data-updated', { instanceId });

  return {
    ok: true,
    account
  };
});

ipcMain.handle('instances:toggle-account-status', async (_event, instanceId, email, newStatus) => {
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!targetEmail) {
    throw new Error('Missing account email');
  }

  const accounts = await readAccounts(instanceId);
  const account = accounts.find((entry) => String(entry.email || '').trim().toLowerCase() === targetEmail);

  if (!account) {
    throw new Error('Account not found');
  }

  account.status = newStatus;
  if (newStatus === 'active') {
    account.lastError = ''; // Clear error on activation
    delete account.lastAdWatchAt; // Xóa mốc xem ad để reset cooldown lập tức
  }

  await saveAccounts(instanceId, accounts);
  send('data-updated', { instanceId });

  return {
    ok: true,
    account
  };
});

ipcMain.handle('instances:download-template', async (_event, language = 'vi') => {
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
