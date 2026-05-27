#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import Tesseract from 'tesseract.js';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_MAIL_URL = 'https://temp-mail.io/en';
const BLOCKED_TEMP_MAIL_DOMAINS = new Set(['gmeenramy.com']);
const TEMP_MAIL_PROVIDERS = [
  {
    id: 'temp-mail-io',
    label: 'temp-mail.io',
    url: TEMP_MAIL_URL,
    rotateSelectors: [
      'button:has-text("random")',
      'button:has-text("Random")',
      'text=random',
      'text=Random',
      '[aria-label*="random" i]'
    ],
    refreshSelectors: [
      'button:has-text("refresh")',
      'button:has-text("Refresh")',
      'text=refresh',
      'text=Refresh',
      '[aria-label*="refresh" i]'
    ]
  },
  // {
  //   id: 'mail-tm',
  //   label: 'mail.tm',
  //   url: 'https://mail.tm/en/',
  //   rotateSelectors: [
  //     'button:has-text("Create an account")',
  //     'button:has-text("Delete account")',
  //     'text=Create an account',
  //     'text=Delete account'
  //   ],
  //   refreshSelectors: [
  //     'button:has-text("Refresh")',
  //     'a:has-text("Refresh")',
  //     'text=Refresh'
  //   ],
  //   emailSelectors: [
  //     'input[type="email"][readonly]',
  //     'input[readonly][value*="@"]',
  //     '[data-grace-area-trigger] input[value*="@"]'
  //   ],
  //   inboxRowSelectors: [
  //     'div.mt-6 ul > li > a[href*="/view/"]',
  //     'div.mt-6 a[href*="/view/"]'
  //   ]
  // }
];
const BUGS_SIGNUP_URL = 'https://secure.bugs.co.kr/member/join/foreignerMemberMain';
const BUGS_LOGIN_URL = 'https://music.bugs.co.kr/member/loginview';
const BUGS_MUSIC_URL = 'https://music.bugs.co.kr/';
const BUGS_FAVORITE_URL = 'https://favorite.bugs.co.kr/3922';
const PASSWORD = 'Abcd@1234';
const LOG_PATH = path.resolve('logs/vote-assist-runs.jsonl');
const ACCOUNTS_PATH = path.resolve('data/accounts.json');
const SCORE_HISTORY_PATH = path.resolve('data/vote-score-history.csv');
const USER_DATA_DIR = path.resolve('.cloakbrowser-profile');
const PROXY_STATE_PATH = path.resolve('data/proxy-rotation-state.json');
const DEFAULT_VIEWPORT = { width: 1280, height: 820 };
const EMAIL_VERIFY_TIMEOUT_MS = 30_000;
const VOTE_RETRY_TIMEOUT_MS = 180_000;
const INVALID_LOGIN_MESSAGE = '아이디 또는 비밀번호를 확인해 주세요.';
const LOGIN_NOT_CONFIRMED_ERROR = 'login-not-confirmed';
const BUGS_VOTE_TIMEZONE = 'Asia/Seoul';

let activeBrowser = null;
let isPythonSupported = null;

let captchaSolverProcess = null;
let isCaptchaSolverReady = false;
let captchaSolverReadyPromise = null;
let captchaSolverReadyResolver = null;
let currentCaptchaResolver = null;

async function initCaptchaSolver(config) {
  if (captchaSolverProcess) return;

  isCaptchaSolverReady = false;
  captchaSolverReadyPromise = new Promise((resolve) => {
    captchaSolverReadyResolver = resolve;
  });

  let solverCmd = '';
  let solverArgs = [];

  if (process.platform !== 'win32') {
    if (isPythonSupported === null) {
      try {
        await execAsync(`python3 -c "import ddddocr"`);
        isPythonSupported = true;
        console.log('[DEBUG Solver] Phát hiện Python 3 & ddddocr hoạt động tốt.');
      } catch (e) {
        isPythonSupported = false;
        console.log('[DEBUG Solver] Không có sẵn Python 3 / ddddocr. Dùng file nhị phân làm phương án chạy.');
      }
    }

    if (isPythonSupported) {
      let solverPy = path.join(__dirname, 'solve_captcha.py');
      if (solverPy.includes('app.asar')) {
        solverPy = solverPy.replace('app.asar', 'app.asar.unpacked');
      }
      solverCmd = 'python3';
      solverArgs = [solverPy];
    }
  }

  if (!solverCmd) {
    if (process.platform === 'win32') {
      let solverExe = path.join(__dirname, 'solve_captcha.exe');
      if (solverExe.includes('app.asar')) {
        solverExe = solverExe.replace('app.asar', 'app.asar.unpacked');
      }
      solverCmd = solverExe;
    } else if (process.platform === 'darwin') {
      let solverMac = path.join(__dirname, 'solve_captcha_mac');
      if (solverMac.includes('app.asar')) {
        solverMac = solverMac.replace('app.asar', 'app.asar.unpacked');
      }
      solverCmd = solverMac;
    } else {
      let solverPy = path.join(__dirname, 'solve_captcha.py');
      if (solverPy.includes('app.asar')) {
        solverPy = solverPy.replace('app.asar', 'app.asar.unpacked');
      }
      solverCmd = 'python3';
      solverArgs = [solverPy];
    }
  }

  console.log(`[AI Solver] Khởi chạy bộ giải Captcha ngầm: ${solverCmd} ${solverArgs.join(' ')}`);

  try {
    captchaSolverProcess = spawn(solverCmd, solverArgs);
  } catch (error) {
    console.error('[AI Solver] Lỗi nghiêm trọng khi khởi chạy tiến trình bộ giải:', error);
    isCaptchaSolverReady = false;
    if (captchaSolverReadyResolver) captchaSolverReadyResolver();
    return;
  }

  captchaSolverProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line === 'READY') {
        isCaptchaSolverReady = true;
        if (captchaSolverReadyResolver) {
          captchaSolverReadyResolver();
        }
        console.log('[AI Solver] Bộ giải CAPTCHA đã sẵn sàng nhận ảnh!');
      } else if (line.startsWith('INIT_ERROR:')) {
        console.error('[AI Solver] Lỗi khởi tạo mô hình AI từ phía Python:', line);
        if (captchaSolverReadyResolver) captchaSolverReadyResolver();
      } else {
        if (currentCaptchaResolver) {
          currentCaptchaResolver(line);
          currentCaptchaResolver = null;
        }
      }
    }
  });

  captchaSolverProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('UserWarning') && !msg.includes('onnxruntime')) {
      console.warn(`[AI Solver Log]: ${msg}`);
    }
  });

  captchaSolverProcess.on('exit', (code) => {
    console.log(`[AI Solver] Tiến trình đã thoát với mã: ${code}`);
    captchaSolverProcess = null;
    isCaptchaSolverReady = false;
    if (captchaSolverReadyResolver) captchaSolverReadyResolver();
  });
}

function stopCaptchaSolver() {
  if (captchaSolverProcess) {
    console.log('[AI Solver] Đang đóng bộ giải Captcha ngầm...');
    try {
      captchaSolverProcess.stdin.write('EXIT\n');
    } catch (e) {
      try {
        captchaSolverProcess.kill();
      } catch (err) { }
    }
    captchaSolverProcess = null;
    isCaptchaSolverReady = false;
  }
}

async function handleExit() {
  console.log('\n[System] Nhận tín hiệu dừng (SIGTERM/SIGINT), đang đóng trình duyệt...');
  if (activeBrowser) {
    try {
      await activeBrowser.close();
      console.log('[System] Đã đóng trình duyệt sạch sẽ.');
    } catch (e) {
      // Ignore
    }
  }
  process.exit(0);
}
process.on('SIGTERM', handleExit);
process.on('SIGINT', handleExit);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hàm xóa quảng cáo che khuất và phục hồi scroll
async function removeAdOverlay(page) {
  await page.evaluate(() => {
    // Xóa hộp thoại Monetization Ads, Funding Choices và Google Ads cản trở nhấp chuột
    const overlays = document.querySelectorAll(
      '.fc-monetization-dialog-container, .fc-dialog-container, div[class*="monetization"], [id*="google_ads_iframe"], [class*="google_ads_iframe"]'
    );
    let removedCount = 0;
    for (const el of overlays) {
      el.remove();
      removedCount++;
    }
    if (removedCount > 0) {
      // Phục hồi lại khả năng cuộn trang của body/html nếu bị adblock khóa cuộn
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      document.body.style.pointerEvents = 'auto';
    }
  }).catch(() => {});
}

async function cleanupCaptchaImages() {
  const logsDir = path.resolve('logs');

  try {
    const files = await fs.readdir(logsDir).catch(() => []);

    for (const file of files) {
      const isCaptchaImage =
        /^captcha_current_\d+\.png$/i.test(file) ||
        /^ocr-section-.*\.png$/i.test(file);

      if (isCaptchaImage) {
        await fs.rm(path.join(logsDir, file), { force: true });
      }
    }
  } catch {
    // Ignore cleanup errors because this should not block the vote flow.
  }
}

async function main() {
  const command = process.argv[2] ?? 'signup';
  const config = await loadConfig();
  if (command === 'signup') {
    await runSignupCommand(config);
    return;
  }
  if (command === 'login') {
    await runLoginCommand(config);
    return;
  }
  throw new Error(`Lệnh không hợp lệ: ${command}. Dùng "signup" hoặc "login".`);
}

async function runSignupCommand(config) {
  await cleanupCaptchaImages();

  const totalRuns = Number(process.argv[3] ?? config.signupRuns ?? 1);
  const manualCaptcha = process.argv[4] === 'manual-captcha';

  // Khởi động tiến trình giải captcha ngầm
  await initCaptchaSolver(config);

  try {
    const browserApi = await loadBrowserApi();
    let completed = 0;

    for (let runIndex = 1; runIndex <= totalRuns; runIndex += 1) {
      await cleanupCaptchaImages();
      console.log(`\nBắt đầu signup-vote lượt ${runIndex}/${totalRuns}`);
      const ok = await runSingleSignupAndVote(browserApi, config, { manualCaptcha }).catch(async (error) => {
        console.warn(`Lỗi signup-vote lượt ${runIndex}: ${error.message}`);
        await appendLog({ status: 'signup-failed', error: error.message, failedAt: new Date().toISOString() }).catch(() => { });
        return false;
      });
      completed += ok ? 1 : 0;
    }

    console.log(`Hoàn tất signup-vote: ${completed}/${totalRuns} lượt.`);
  } finally {
    // Luôn đóng tiến trình giải captcha ngầm sạch sẽ
    stopCaptchaSolver();
  }
}

async function runSingleSignupAndVote(browserApi, config, options = {}) {
  if (config.freshProfilePerRun ?? true) {
    await fs.rm(USER_DATA_DIR, { recursive: true, force: true });
  }
  const runConfig = await resolveRunConfig(config);
  const browser = await launchBrowser(browserApi, runConfig);
  const context = await browser.newContext?.({ deviceScaleFactor: 1 }) ?? browser;
  const state = {
    email: '',
    identificationEmail: '',
    nickname: '',
    dob: randomAdultDob(),
    startedAt: new Date().toISOString(),
    tempMailProvider: ''
  };

  try {
    const tempMailProvider = pickTempMailProvider(config);
    state.tempMailProvider = tempMailProvider.id;
    console.log(`Temp mail provider lượt này: ${tempMailProvider.label}`);

    const tempPage = await context.newPage();
    await tempPage.goto(tempMailProvider.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    if (config.randomizeTempMail === true) {
      await randomizeTempMail(tempPage, tempMailProvider);
    }
    state.email = await getTempMailAddress(tempPage, tempMailProvider);
    state.identificationEmail = randomIdentificationEmail(state.email);
    state.nickname = randomNickname();
    console.log(`Temp mail: ${state.email}`);

    const signupPage = await context.newPage();
    signupPage.on('dialog', async (dialog) => {
      console.log(`💬 Phát hiện thông báo từ trang web: [${dialog.message()}]`);
      await dialog.dismiss();
    });
    await signupPage.goto(BUGS_SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await fillBugsSignup(signupPage, state);

    // console.log('\nĐã điền form Bugs. Đang mở ảnh Captcha ở tab riêng để bạn đọc dễ hơn...');
    // await openCaptchaImageTab(context, signupPage);

    // console.log('✍️ Captcha đang được mở ở tab riêng. Hãy đọc mã, tự quay lại tab Sign Up, nhập Captcha và bấm Sign Up.');

    // const registered = await waitForRegistrationSuccess(signupPage);
    // if (!registered) {
    //   await waitEnter('Chưa phát hiện đăng ký thành công. Nhấn Enter sau khi bạn thấy trang báo đã gửi email xác thực...');
    // }
    let registered = false;

    if (options.manualCaptcha) {
      console.log('\nĐã điền form Bugs. Vui lòng tự nhập captcha trên Bugs và bấm Sign Up.');
      await signupPage.bringToFront().catch(() => { });
      await signupPage.locator('#captchaText, input[name="captchaText"]').first().scrollIntoViewIfNeeded().catch(() => { });
      await signupPage.locator('#captchaText, input[name="captchaText"]').first().focus().catch(() => { });

      registered = await waitForRegistrationSuccess(signupPage);
      if (!registered) {
        throw new Error('Quá thời gian chờ bạn nhập captcha thủ công.');
      }
    } else {
      console.log('\nĐã điền form Bugs. Bắt đầu giải mã CAPTCHA tự động...');

      // Vòng lặp Retry: Cho phép tool đoán sai và thử lại liên tục cho đến khi giải thành công
      for (let attempt = 1; ; attempt++) {
        const attemptStart = Date.now();
        console.log(`\n[Lần ${attempt}] --- Bắt đầu chu kỳ xử lý CAPTCHA ---`);

        const solveStart = Date.now();
        const captchaText = await autoSolveCaptcha(signupPage);
        const solveDuration = Date.now() - solveStart;

        if (!captchaText) {
          console.warn(`[Lần ${attempt}] Không giải được ảnh (Mất ${solveDuration}ms). Yêu cầu đổi ảnh mới...`);
          await clickFirstAvailable(signupPage, ['#btnCaptchaRefresh', '.btnRefresh']).catch(() => { });
          await sleep(2000);
          continue;
        }

        // --- Cải tiến lọc định dạng CAPTCHA để tiết kiệm thời gian ---
        const normalizedText = captchaText.trim().toUpperCase();
        // Kiểm tra: Phải có 4 hoặc 5 ký tự, và chỉ gồm chữ cái viết hoa & số
        const isValidFormat = /^[A-Z0-9]{4,5}$/.test(normalizedText);

        if (!isValidFormat) {
          console.warn(`[Lần ${attempt}] CAPTCHA đoán được [${normalizedText}] không đúng định dạng (Phải có 4-5 ký tự hoa/số). Tự động bỏ qua và đổi ảnh mới để tránh hết session...`);
          await clickFirstAvailable(signupPage, ['#btnCaptchaRefresh', '.btnRefresh']).catch(() => { });
          await sleep(2000);
          continue;
        }

        console.log(`🤖 AI đoán CAPTCHA hợp lệ: [${normalizedText}] (Thời gian từ lúc lấy ảnh đến giải xong: ${solveDuration}ms)`);

        const actionStart = Date.now();
        // 1. Điền mã vào ô Input (Đã cập nhật đúng ID #captchaText)
        await fillBySelectors(signupPage, ['#captchaText', 'input[name="captchaText"]'], normalizedText);

        // 2. Bấm nút Sign Up (Đã cập nhật đúng ID #btnJoinComplete)
        await scrollSignupButtonIntoView(signupPage);
        await clickFirstAvailable(signupPage, ['#btnJoinComplete', 'a.btnJoin']).catch(() => { });
        const fillAndSubmitDuration = Date.now() - actionStart;

        console.log(`Đã bấm Sign Up (Lần ${attempt}), thời gian điền & submit: ${fillAndSubmitDuration}ms. Đang chờ kết quả...`);

        // 3. Đợi xem có thành công hay báo lỗi sai CAPTCHA
        let checkStart = Date.now();
        for (let i = 0; i < 6; i++) {
          await sleep(1000); // Đợi 1 giây mỗi nhịp
          const url = signupPage.url();
          const text = await signupPage.locator('body').innerText().catch(() => '');

          // Dấu hiệu thành công: Đổi URL hoặc hiện chữ báo check email
          if (!url.includes('foreignerMemberMain') || (/authentication|e-?mail|sent|complete|가입|인증|메일/i.test(text) && !/captcha/i.test(text))) {
            registered = true;
            break;
          }
        }
        const checkDuration = Date.now() - checkStart;
        const totalAttemptDuration = Date.now() - attemptStart;

        if (registered) {
          console.log(`✅ Đăng ký thành công! (Tổng thời gian chu kỳ: ${totalAttemptDuration}ms, thời gian đợi web duyệt: ${checkDuration}ms)`);
          break;
        } else {
          // Nếu web báo sai Captcha -> Bấm Refresh để tải ảnh mới và thử lại
          console.warn(`[Lần ${attempt}] Đăng ký chưa thành công (Đoán sai Captcha hoặc hết hạn session). Tổng thời gian đã mất: ${totalAttemptDuration}ms. Thử lại...`);
          await clickFirstAvailable(signupPage, ['#btnCaptchaRefresh']).catch(() => { });
          await sleep(3000); // Chờ ảnh mới load ra
        }
      }
    }
    //

    //
    if (config.autoFocusBrowser !== false) {
      await tempPage.bringToFront().catch(() => { });
    }
    const emailVerified = await verifyEmail(tempPage, tempMailProvider, config);
    if (!emailVerified) {
      state.status = 'email-timeout';
      await appendLog({ ...state, failedAt: new Date().toISOString(), status: 'email-timeout', error: 'Không nhận được email xác thực trong 30 giây' });
      console.warn('Không nhận được email xác thực trong 30 giây. Bỏ qua lượt hiện tại và chuyển sang lượt tiếp theo.');
      return false;
    }

    console.log('Đăng nhập thành công, bắt đầu mở trang vote...');
    const voted = await voteFavorite(context, config);
    state.lastVotedAt = voted ? new Date().toISOString() : '';
    state.lastVoteCount = voted ? 5 : 0;
    state.status = 'active';
    state.lastError = voted ? '' : 'vote-not-confirmed';
    await saveAccount(state);
    await appendLog({ ...state, completedAt: new Date().toISOString(), status: 'completed' });
    console.log(`Hoàn tất đăng ký + vote. Đã lưu account vào: ${ACCOUNTS_PATH}`);
    return voted;
  } finally {
    if (activeBrowser) {
      await activeBrowser.close?.().catch(() => {});
      activeBrowser = null;
    }
    if (config.freshProfilePerRun ?? true) {
      await fs.rm(USER_DATA_DIR, { recursive: true, force: true }).catch(() => { });
    }
  }
}

async function runLoginCommand(config) {
  const accounts = await loadAccounts();
  const runnable = accounts.filter((account) => !['disabled', 'deactive'].includes(account.status) && !votedToday(account.lastVotedAt));
  const limit = Number(process.argv[3] ?? config.loginLimit ?? runnable.length);

  if (!runnable.length) {
    console.log('Không có account cũ nào cần vote hôm nay.');
    return;
  }

  // Khởi động tiến trình giải captcha ngầm
  await initCaptchaSolver(config);

  try {
    const browserApi = await loadBrowserApi();
    let completed = 0;

    for (const account of runnable.slice(0, limit)) {
      const latestAccounts = await loadAccounts();
      if (!latestAccounts.some((entry) => entry.email === account.email)) {
        console.log(`Bỏ qua account đã bị xóa khỏi file: ${account.email}`);
        continue;
      }

      if (config.freshProfilePerRun ?? true) {
        await fs.rm(USER_DATA_DIR, { recursive: true, force: true });
      }

      const runConfig = await resolveRunConfig(config);
      const browser = await launchBrowser(browserApi, runConfig);
      const context = await browser.newContext?.({ deviceScaleFactor: 1 }) ?? browser;

      try {
        console.log(`\nĐang login account: ${account.email}`);
        const loginPage = await context.newPage();
        await loginPage.goto(BUGS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        const initialLoginUrl = loginPage.url();
        await fillBugsLogin(loginPage, account);

        console.log('Đã mở đúng form Bugs, điền ID/password, rồi tự bấm Log in ngay.');
        await waitAfterLoginSubmit(context, loginPage, initialLoginUrl);

        const voted = await voteFavorite(context, config);
        account.lastVotedAt = voted ? new Date().toISOString() : account.lastVotedAt;
        account.lastVoteCount = voted ? nextVoteCount(account.lastVoteCount, 5) : normalizeVoteCount(account.lastVoteCount);
        account.lastError = voted ? '' : 'vote-not-confirmed';
        account.status = account.status || 'active';
        completed += voted ? 1 : 0;
        await saveAccounts(accounts);
        await appendLog({ email: account.email, completedAt: new Date().toISOString(), status: voted ? 'login-voted' : 'login-vote-failed' });
      } catch (error) {
        if (error.message === INVALID_LOGIN_MESSAGE) {
          account.status = 'deactive';
          account.lastError = error.message;
          await saveAccounts(accounts);
          await appendLog({ email: account.email, failedAt: new Date().toISOString(), status: 'login-invalid-deactive', error: error.message }).catch(() => { });
          console.warn(`Chuyển account lỗi sang deactive: ${account.email}`);
          continue;
        }
        account.lastError = error.message;
        await saveAccounts(accounts);
        await appendLog({ email: account.email, failedAt: new Date().toISOString(), status: 'login-failed', error: error.message }).catch(() => { });
        console.warn(`Lỗi account ${account.email}: ${error.message}`);
      } finally {
        if (activeBrowser) {
          await activeBrowser.close?.().catch(() => {});
          activeBrowser = null;
        }
        if (config.freshProfilePerRun ?? true) {
          await fs.rm(USER_DATA_DIR, { recursive: true, force: true }).catch(() => { });
        }
      }
    }

    console.log(`Hoàn tất login-vote: ${completed}/${Math.min(limit, runnable.length)} account.`);
  } finally {
    // Luôn đóng tiến trình giải captcha ngầm sạch sẽ
    stopCaptchaSolver();
  }
}

async function loadConfig() {
  const configPath = path.resolve('vote-assist.config.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    return {};
  }
}

async function loadBrowserApi() {
  try {
    return await import('cloakbrowser');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    console.error('Thiếu dependency. Chạy: npm install');
    process.exit(1);
  }
}

async function resolveRunConfig(config) {
  const proxy = await pickProxyForRun(config);
  if (proxy) {
    console.log(`Dùng IP/proxy cho lượt này: ${formatProxyForLog(proxy)}`);
  } else {
    console.log('Lượt này chạy không dùng proxy riêng.');
  }
  return { ...config, proxy };
}

async function pickProxyForRun(config) {
  const pool = normalizeProxyPool(config.proxyPool);
  if (!pool.length) {
    return normalizeProxyEntry(config.proxy);
  }

  const strategy = config.proxyRotation === 'random' ? 'random' : 'sequential';
  if (strategy === 'random') {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const state = await loadProxyRotationState();
  const nextIndex = state.nextIndex % pool.length;
  await saveProxyRotationState({ nextIndex: (nextIndex + 1) % pool.length });
  return pool[nextIndex];
}

function normalizeProxyPool(proxyPool) {
  if (!Array.isArray(proxyPool)) return [];
  return proxyPool
    .map((entry) => normalizeProxyEntry(entry))
    .filter(Boolean);
}

function normalizeProxyEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed ? { server: trimmed } : null;
  }

  if (typeof entry !== 'object') return null;
  if (typeof entry.server === 'string' && entry.server.trim()) {
    return {
      server: entry.server.trim(),
      ...(entry.username ? { username: entry.username } : {}),
      ...(entry.password ? { password: entry.password } : {}),
      ...(entry.bypass ? { bypass: entry.bypass } : {})
    };
  }

  return null;
}

function formatProxyForLog(proxy) {
  if (!proxy?.server) return 'N/A';
  return proxy.username ? `${proxy.server} (${proxy.username})` : proxy.server;
}

async function loadProxyRotationState() {
  try {
    return JSON.parse(await fs.readFile(PROXY_STATE_PATH, 'utf8'));
  } catch {
    return { nextIndex: 0 };
  }
}

async function saveProxyRotationState(state) {
  await fs.mkdir(path.dirname(PROXY_STATE_PATH), { recursive: true });
  await fs.writeFile(PROXY_STATE_PATH, JSON.stringify(state, null, 2));
}

async function launchBrowser(api, config) {
  if (config.executablePath) {
    process.env.CLOAKBROWSER_BINARY_PATH = config.executablePath;
  }

  const browserArgs = Array.isArray(config.args) && config.args.length
    ? config.args
    : [
      '--window-size=1280,820',
      '--window-position=80,20'
    ];

  let browserInstance;
  if (typeof api.launchPersistentContext === 'function') {
    browserInstance = await api.launchPersistentContext({
      headless: false,
      humanize: true,
      userDataDir: config.userDataDir ?? USER_DATA_DIR,
      proxy: config.proxy,
      viewport: config.viewport ?? DEFAULT_VIEWPORT,
      deviceScaleFactor: 1,
      launchOptions: {
        args: browserArgs
      }
    });
  } else if (typeof api.launchContext === 'function') {
    browserInstance = await api.launchContext({
      headless: false,
      humanize: true,
      proxy: config.proxy,
      viewport: config.viewport ?? DEFAULT_VIEWPORT,
      deviceScaleFactor: 1,
      args: browserArgs
    });
  } else if (typeof api.launch === 'function') {
    browserInstance = await api.launch({
      headless: false,
      humanize: true,
      proxy: config.proxy,
      args: browserArgs
    });
  } else {
    throw new Error('Không tìm thấy API launch tương thích từ cloakbrowser.');
  }

  activeBrowser = browserInstance;
  return browserInstance;
}

async function getTempMailAddress(page, provider = TEMP_MAIL_PROVIDERS[0]) {
  await page.waitForLoadState('domcontentloaded');

  // Hỗ trợ sinh email tự động cho tempmail.id.vn trên một trình duyệt mới hoàn toàn
  if (provider.id === 'tempmail-id-vn') {
    await removeAdOverlay(page);
    const randomBtn = page.locator('button:has-text("Tạo ngẫu nhiên")').first();
    if (await randomBtn.count().catch(() => 0)) {
      if (await randomBtn.isVisible().catch(() => false)) {
        console.log('[tempmail.id.vn] Đang click "Tạo ngẫu nhiên" để kích hoạt email...');
        await randomBtn.click({ force: true }).catch(() => { });
        await page.waitForTimeout(5000); // Đợi Livewire sinh mail
      }
    }
  }

  for (let randomAttempt = 0; randomAttempt < 8; randomAttempt += 1) {
    await removeAdOverlay(page);
    const email = await readTempMailAddress(page, provider);
    if (!isBlockedTempMailDomain(email)) return email;

    console.warn(`Temp mail ${email} đang dùng domain lỗi trên ${provider.label}, thử đổi mail khác...`);
    const randomized = await randomizeTempMail(page, provider);
    if (!randomized) {
      throw new Error(`Email ${email} dùng domain lỗi nhưng không tìm thấy nút đổi mail trên ${provider.label}.`);
    }
  }

  throw new Error('Đã random temp-mail nhiều lần nhưng vẫn gặp domain lỗi.');
}

async function readTempMailAddress(page, provider = TEMP_MAIL_PROVIDERS[0]) {
  await page.waitForLoadState('domcontentloaded');

  const selectors = [
    ...(provider.emailSelectors ?? []),
    'input[value*="@"]',
    '[data-qa="current-email"]',
    '[data-testid="email"]',
    'button:has-text("@")',
    'div:has-text("@")'
  ];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await removeAdOverlay(page);
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0)) {
        const value = await locator.inputValue().catch(async () => locator.innerText().catch(() => ''));
        const email = extractEmail(value);
        if (email) return email;
      }
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const email = extractEmail(bodyText);
    if (email) return email;
    await page.waitForTimeout(250);
  }

  throw new Error('Không lấy được email từ temp-mail UI.');
}

async function fillBugsSignup(page, state) {
  await page.waitForSelector('input', { timeout: 60_000 });
  await fillBySelectors(page, ['#userId', 'input[name="userId"]'], state.email);
  await fillBySelectors(page, ['#password', 'input[name="password"]'], PASSWORD);
  await fillBySelectors(page, ['#passwordCheck', 'input[name="passwordCheck"]'], PASSWORD);
  await fillBySelectors(page, ['#nickName', 'input[name="nickName"]'], state.nickname);
  await fillBySelectors(page, ['#birthDt', 'input[name="birthDt"]'], state.dob);
  await selectAnyGender(page);
  await fillBySelectors(page, ['#divEmail input', '#email', '#emailId', 'input[name="email"]', 'input[name="emailId"]'], state.identificationEmail);
  await tickRequiredTerms(page);
  await scrollSignupButtonIntoView(page);
}



async function waitForTurnstileSuccess(page, timeoutMs = 90_000) {
  console.log('[Cloudflare Turnstile] Đang kiểm tra trạng thái xác minh Captcha...');
  const start = Date.now();
  let lastCheckboxAttemptAt = 0;
  let lastProgressLogAt = 0;
  while (Date.now() - start < timeoutMs) {
    let solved = false;

    // Cách 1: Kiểm tra độ dài của Turnstile response token trên trang chính
    const tokenLength = await page.evaluate(() => {
      const el = document.querySelector('[name="cf-turnstile-response"]');
      return el ? el.value.length : 0;
    }).catch(() => 0);

    if (tokenLength > 10) {
      solved = true;
    }

    // Cách 2: Sử dụng Playwright Frame Locator (Bypass mọi giới hạn Sandbox/Cross-Origin)
    if (!solved) {
      try {
        const turnstileIframe = page.frameLocator('iframe[src*="cloudflare"], iframe[src*="challenges"]').first();
        const successCircle = turnstileIframe.locator('.success-circle');
        if (await successCircle.count().catch(() => 0) > 0) {
          solved = true;
        }
      } catch (e) {
        // Ignore
      }
    }

    // Cách 3: Dự phòng quét tất cả frames bằng evaluate
    if (!solved) {
      for (const frame of page.frames()) {
        try {
          const hasCircle = await frame.evaluate(() => {
            return !!document.querySelector('.success-circle');
          }).catch(() => false);
          if (hasCircle) {
            solved = true;
            break;
          }
        } catch {
          // Ignore
        }
      }
    }

    if (solved) {
      console.log('[Cloudflare Turnstile] Xác minh Captcha thành công! (Đã nhận diện trạng thái tích xanh)');
      return true;
    }

    if (Date.now() - lastProgressLogAt >= 5_000) {
      const challengeState = await detectTurnstileChallenge(page).catch(() => ({
        found: false,
        frameUrl: '',
        frameName: '',
        selector: '',
        tokenLength: 0,
        frameSummaries: []
      }));
      console.log(
        `[Cloudflare Turnstile] Polling... tokenLength=${challengeState.tokenLength || 0}, challengeFound=${challengeState.found ? 'yes' : 'no'}${challengeState.selector ? `, selector=${challengeState.selector}` : ''}${challengeState.frameName ? `, frameName=${challengeState.frameName}` : ''}${challengeState.frameUrl ? `, frame=${challengeState.frameUrl}` : ''}`
      );
      if (!challengeState.found && challengeState.frameSummaries?.length) {
        console.log(`[Cloudflare Turnstile] Frame scan: ${challengeState.frameSummaries.slice(0, 12).join(' || ')}`);
      }
      lastProgressLogAt = Date.now();
    }

    if (Date.now() - lastCheckboxAttemptAt >= 2_000) {
      const assisted = await tryClickTurnstileCheckbox(page).catch(() => ({
        clicked: false,
        selector: '',
        frameUrl: '',
        method: '',
        error: ''
      }));
      if (assisted.clicked) {
        console.log(
          `[Cloudflare Turnstile] Đã thử click checkbox hỗ trợ qua ${assisted.method || 'unknown'}${assisted.selector ? `, selector=${assisted.selector}` : ''}${assisted.frameUrl ? `, frame=${assisted.frameUrl}` : ''}`
        );
      } else if (assisted.error) {
        console.warn(`[Cloudflare Turnstile] Thử click checkbox thất bại: ${assisted.error}`);
      }
      lastCheckboxAttemptAt = Date.now();
    }

    await sleep(500);
  }
  console.warn('[Cloudflare Turnstile] Hết thời gian chờ xác minh Captcha (90s). Thử tiến hành đăng nhập.');
  return false;
}

async function detectTurnstileChallenge(page) {
  const candidateSelectors = [
    'label.cb-lb',
    '.cb-c label',
    '.cb-c',
    '#content',
    '#verifying',
    'div[role="alert"]',
    'input[type="checkbox"]',
    '[role="checkbox"]'
  ];

  const frames = [page.mainFrame(), ...page.frames()];
  const frameSummaries = [];
  for (const frame of frames) {
    const frameUrl = frame.url();
    const frameName = typeof frame.name === 'function' ? frame.name() : '';

    for (const selector of candidateSelectors) {
      const locator = frame.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) {
        frameSummaries.push(`${frameName || 'unnamed'}|${frameUrl || 'about:blank'}|${selector}|count=0`);
        continue;
      }

      const visible = await locator.isVisible().catch(() => false);
      frameSummaries.push(`${frameName || 'unnamed'}|${frameUrl || 'about:blank'}|${selector}|count=${count}|visible=${visible ? 'yes' : 'no'}`);
      if (!visible) continue;

      const tokenLength = await page.evaluate(() => {
        const el = document.querySelector('[name="cf-turnstile-response"]');
        return el ? el.value.length : 0;
      }).catch(() => 0);

      return { found: true, selector, frameUrl, frameName, tokenLength, frameSummaries };
    }
  }

  const tokenLength = await page.evaluate(() => {
    const el = document.querySelector('[name="cf-turnstile-response"]');
    return el ? el.value.length : 0;
  }).catch(() => 0);

  return { found: false, selector: '', frameUrl: '', frameName: '', tokenLength, frameSummaries };
}

async function tryClickTurnstileCheckbox(page) {
  const candidateSelectors = [
    'label.cb-lb',
    '.cb-c label',
    '.cb-c',
    '#content',
    '#verifying',
    'div[role="alert"]',
    'input[type="checkbox"]',
    '[role="checkbox"]',
    'label:has-text("Xác minh bạn là con người")',
    'label:has-text("Verify you are human")',
    'label:has-text("I am human")'
  ];

  const tryDispatchInFrame = async (frame) => {
    return frame.evaluate(() => {
      const selectors = [
        'label.cb-lb',
        '.cb-c label',
        '.cb-c',
        '#content',
        '#verifying',
        'div[role="alert"]',
        'input[type="checkbox"]',
        '[role="checkbox"]'
      ];

      const findTarget = () => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          return { element, rect };
        }
        return null;
      };

      const target = findTarget();
      if (!target) return { ok: false, reason: 'target-not-found' };

      const clickX = target.rect.left + Math.min(22, Math.max(10, target.rect.width / 2));
      const clickY = target.rect.top + Math.min(22, Math.max(10, target.rect.height / 2));
      const eventInit = { bubbles: true, cancelable: true, composed: true, clientX: clickX, clientY: clickY };
      const node = document.elementFromPoint(clickX, clickY) || target.element;

      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        node.dispatchEvent(new MouseEvent(type, eventInit));
      }

      if (node instanceof HTMLInputElement && node.type === 'checkbox') {
        node.checked = true;
        node.dispatchEvent(new Event('change', { bubbles: true }));
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }

      return { ok: true, method: 'frame-dispatch' };
    }).catch((error) => ({ ok: false, reason: error?.message || String(error) }));
  };

  const tryClickInFrame = async (frame) => {
    for (const selector of candidateSelectors) {
      const locator = frame.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const clicked = await locator.click({ timeout: 1_500, force: true }).then(() => ({
        clicked: true,
        selector,
        frameUrl: frame.url(),
        method: 'locator.click'
      })).catch(async () => {
        const dispatched = await tryDispatchInFrame(frame);
        if (dispatched.ok) {
          return {
            clicked: true,
            selector,
            frameUrl: frame.url(),
            method: dispatched.method || 'frame-dispatch'
          };
        }

        const box = await locator.boundingBox().catch(() => null);
        if (box && box.width >= 18 && box.height >= 18) {
          const targetX = box.x + Math.min(22, Math.max(10, box.width / 2));
          const targetY = box.y + Math.min(22, Math.max(10, box.height / 2));
          await page.mouse.move(targetX, targetY).catch(() => { });
          await page.mouse.click(targetX, targetY, { delay: 80 }).catch(() => { });
          return {
            clicked: true,
            selector,
            frameUrl: frame.url(),
            method: 'page.mouse'
          };
        }

        return {
          clicked: false,
          selector,
          frameUrl: frame.url(),
          method: '',
          error: dispatched.reason || 'all-click-methods-failed'
        };
      });

      if (clicked.clicked) return clicked;
    }

    return {
      clicked: false,
      selector: '',
      frameUrl: frame.url(),
      method: '',
      error: ''
    };
  };

  const frames = [page.mainFrame(), ...page.frames()];
  for (const frame of frames) {
    const clicked = await tryClickInFrame(frame).catch((error) => ({
      clicked: false,
      selector: '',
      frameUrl: frame.url(),
      method: '',
      error: error?.message || String(error)
    }));
    if (clicked.clicked) return clicked;
  }

  return {
    clicked: false,
    selector: '',
    frameUrl: '',
    method: '',
    error: ''
  };
}

async function fillBugsLogin(page, account) {
  await openBugsLoginForm(page);
  await page.waitForSelector('#user_id, input[name="user_id"]', { timeout: 60_000 });
  await fillBySelectors(page, ['#user_id', 'input[name="user_id"]'], account.email);
  await fillBySelectors(page, ['#passwd', 'input[name="passwd"]'], account.password ?? PASSWORD);
  
  // Polling liên tục chờ Cloudflare Turnstile tích xanh trước khi nhấn nút Đăng nhập
  await waitForTurnstileSuccess(page);
  
  await loginSubmitButton(page).scrollIntoViewIfNeeded().catch(() => { });
  await submitLogin(page);
}

async function openBugsLoginForm(page) {
  const bugsLoginButton = page.locator([
    'a.loginBtn.btnBugsLogin:has-text("벅스 아이디 또는 이메일로 로그인")',
    'a.loginBtn.btnBugsLogin',
    'a[href*="goBugs"]:has-text("벅스 아이디 또는 이메일로 로그인")'
  ].join(', ')).first();
  if (!(await bugsLoginButton.count().catch(() => 0))) return;

  const userIdField = page.locator('#user_id, input[name="user_id"]').first();
  const isFormVisible = await userIdField.isVisible().catch(() => false);
  if (isFormVisible) return;

  await bugsLoginButton.scrollIntoViewIfNeeded().catch(() => { });
  await bugsLoginButton.click({ timeout: 10_000, force: true }).catch(async () => {
    await bugsLoginButton.evaluate((element) => element.click());
  });
  await page.waitForFunction(() => {
    const userId = document.querySelector('#user_id, input[name="user_id"]');
    const password = document.querySelector('#passwd, input[name="passwd"]');
    return !!userId && !!password;
  }, { timeout: 5_000 }).catch(() => { });

  await page.waitForSelector('#user_id, input[name="user_id"]', {
    state: 'visible',
    timeout: 5_000
  });
}

async function randomizeTempMail(page, provider = TEMP_MAIL_PROVIDERS[0]) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_500);
  await removeAdOverlay(page);
  const clicked = await clickFirstAvailable(page, provider.rotateSelectors).catch(() => { });
  await page.waitForTimeout(2_000);
  return Boolean(clicked);
}

async function selectAnyGender(page) {
  const preferredInputs = ['#M', 'input[name="gender"][value="M"]', '#F', '#O'];
  for (const selector of preferredInputs) {
    const input = page.locator(selector).first();
    if (await input.count().catch(() => 0)) {
      await input.check({ force: true }).catch(async () => input.click({ force: true }));
      if (await input.isChecked().catch(() => false)) return;
    }
  }

  const radios = page.locator('input[type="radio"]');
  const count = await radios.count();
  for (let i = 0; i < count; i += 1) {
    const radio = radios.nth(i);
    if (await radio.isDisabled().catch(() => true)) continue;
    await radio.check({ force: true }).catch(() => { });
    if (await radio.isChecked().catch(() => false)) return;
  }
  throw new Error('Không chọn được gender radio.');
}

async function fillBySelectors(page, selectors, value) {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (!(await field.count().catch(() => 0))) continue;
    
    // Thử điền trực tiếp bằng evaluate (Siêu tốc độ <2ms, tránh Playwright check ổn định và animation)
    const filled = await field.evaluate((element, nextValue) => {
      try {
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        descriptor?.set?.call(element, nextValue);
        
        // Dispatch tất cả sự kiện để xóa placeholder trùng lặp của website
        element.focus();
        element.click();
        element.dispatchEvent(new Event('focus', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      } catch (e) {
        return false;
      }
    }, value).catch(() => false);

    if (filled) {
      const actual = await field.inputValue().catch(() => '');
      if (actual === value) return;
    }

    // Dự phòng (Fallback) nếu evaluate lỗi
    await field.scrollIntoViewIfNeeded().catch(() => { });
    await field.fill(value, { force: true }).catch(async () => {
      await field.click({ force: true });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.type(value, { delay: 20 });
    });
    const actual = await field.inputValue().catch(() => '');
    if (actual === value) return;
  }
  throw new Error(`Không fill được field bằng selectors: ${selectors.join(', ')}`);
}

async function scrollSignupButtonIntoView(page) {
  await page.evaluate(() => {
    const signUp = [...document.querySelectorAll('button, input[type="submit"], a')]
      .find((element) => /sign\s*up/i.test(element.textContent || element.value || ''));
    if (signUp) {
      signUp.scrollIntoView({ block: 'center', inline: 'nearest' });
      return;
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  // Giảm delay tối đa để nâng cao tốc độ phản hồi
  await page.waitForTimeout(50);
}

async function fillPasswordFields(page) {
  const fields = page.locator('input[type="password"]');
  const count = await fields.count();
  for (let i = 0; i < Math.min(count, 2); i += 1) {
    await fields.nth(i).fill(PASSWORD);
  }
}

async function fillByLabelOrPlaceholder(page, needles, value, index = 0) {
  const inputs = page.locator('input');
  const count = await inputs.count();
  const matches = [];

  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const type = await input.getAttribute('type').catch(() => '');
    if (['hidden', 'password', 'checkbox', 'radio'].includes(type ?? '')) continue;

    const placeholder = await input.getAttribute('placeholder').catch(() => '') ?? '';
    const name = await input.getAttribute('name').catch(() => '') ?? '';
    const id = await input.getAttribute('id').catch(() => '') ?? '';
    const text = `${placeholder} ${name} ${id}`;
    if (needles.some((needle) => text.toLowerCase().includes(needle.toLowerCase()))) {
      matches.push(input);
    }
  }

  const target = matches[index] ?? matches[0];
  if (!target) throw new Error(`Không tìm thấy field cho ${needles.join('/')}`);
  await target.fill(value);
}

async function fillVisibleInputByIndex(page, index, value) {
  const inputs = page.locator('input:visible');
  const count = await inputs.count();
  if (count <= index) {
    throw new Error(`Form chỉ có ${count} input visible, không có index ${index}`);
  }
  await inputs.nth(index).fill(value);
}

async function fillVisibleTextInputByIndex(page, index, value) {
  const handles = [];
  const count = await page.locator('input:visible').count();

  for (let i = 0; i < count; i += 1) {
    const input = page.locator('input:visible').nth(i);
    const type = (await input.getAttribute('type').catch(() => '') ?? 'text').toLowerCase();
    if (['radio', 'checkbox', 'hidden', 'button', 'submit', 'image'].includes(type)) continue;
    handles.push(input);
  }

  if (handles.length <= index) {
    throw new Error(`Form chỉ có ${handles.length} text/password input visible, không có index ${index}`);
  }
  if (index === 0) {
    console.log(`Detected ${handles.length} visible text/password inputs on Bugs signup.`);
  }
  await handles[index].fill(value);
}

async function tickRequiredTerms(page) {
  const allAgree = page.locator('label:has-text("I agree with all")').first();
  if (await allAgree.count().catch(() => 0)) {
    await allAgree.click().catch(() => { });
    return;
  }

  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i += 1) {
    const box = checkboxes.nth(i);
    const disabled = await box.isDisabled().catch(() => true);
    if (!disabled) await box.check().catch(() => { });
  }
}
//test đoán captcha
async function autoSolveCaptcha(page) {
  const startTime = Date.now();
  // 1. Tìm thẻ chứa ảnh CAPTCHA
  const captchaImage = page.locator('.captchaBox img, img[src*="api-captcha"], img[src*="captcha"]').first();
  await captchaImage.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => { });

  if (!(await captchaImage.count())) {
    console.warn('Không tìm thấy ảnh Captcha trên trang.');
    return null;
  }

  // 2. Ép kích thước thật và chụp ảnh (Tuyệt chiêu tránh lỗi bảo mật CORS)
  // 2. Cách ly ảnh, lót nền trắng và ép kích thước thật để chụp
  const imagePath = path.resolve(`logs/captcha_current_${Date.now()}.png`);

  await captchaImage.evaluate((img) => {
    // Nhấc bổng ảnh ra khỏi layout web, ghim lên góc trên cùng bên trái
    img.style.position = 'fixed';
    img.style.top = '0px';
    img.style.left = '0px';
    img.style.zIndex = '2147483647'; // Đưa lên lớp cao nhất, đè lên mọi thứ

    // Lót nền trắng tinh phía sau lưng để che lấp mọi chữ HTML bị lọt vào
    img.style.backgroundColor = '#FFFFFF';

    // Xóa viền, thêm một lớp đệm (padding) trắng nhỏ xung quanh để AI dễ nhận diện hơn
    img.style.padding = '8px';
    img.style.margin = '0px';
    img.style.border = 'none';

    // Ép bung kích thước về đúng độ phân giải gốc
    img.style.width = img.naturalWidth + 'px';
    img.style.height = img.naturalHeight + 'px';
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
  });

  // Chờ nửa giây để trình duyệt kịp dàn xếp lại cái ảnh
  await page.waitForTimeout(500);

  // Chụp ảnh cái khung thẻ img
  await captchaImage.screenshot({ path: imagePath });
  const captureDuration = Date.now() - startTime;
  console.log(`Đã chụp ảnh CAPTCHA nét căng, sạch bóng nhiễu HTML tại: ${imagePath} (Mất ${captureDuration}ms)`);

  // 3. Gọi công cụ giải CAPTCHA chạy ngầm (Siêu tốc độ, không tốn tài nguyên khởi chạy lại)
  try {
    if (!isCaptchaSolverReady) {
      console.log('[AI Solver] Bộ giải CAPTCHA chưa sẵn sàng, đang đợi nạp mô hình AI...');
      await captchaSolverReadyPromise;
    }

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        currentCaptchaResolver = null;
        reject(new Error('Timeout giải captcha (15 giây)'));
      }, 15_000);

      currentCaptchaResolver = (res) => {
        clearTimeout(timeout);
        resolve(res);
      };

      try {
        captchaSolverProcess.stdin.write(imagePath + '\n');
      } catch (err) {
        clearTimeout(timeout);
        currentCaptchaResolver = null;
        reject(new Error(`Không thể ghi vào stdin của bộ giải: ${err.message}`));
      }
    });

    console.log(`[DEBUG AI] Kết quả: ${result}`);

    if (result && !result.startsWith('ERROR:') && !result.startsWith('INIT_ERROR:')) {
      return result.toUpperCase();
    }

    if (result && result.startsWith('ERROR:')) {
      console.error(`[AI Solver Error]: ${result}`);
    }
    return null;
  } catch (error) {
    console.error('[CRITICAL ERROR] Lỗi khi gọi bộ giải CAPTCHA:', error.stack || error.message);
    return null;
  }
}
//
//
async function openCaptchaImageTab(context, page) {
  const captchaImage = page.locator('.captchaBox img, img[src*="api-captcha"], img[src*="captcha"]').first();

  await captchaImage.waitFor({
    state: 'visible',
    timeout: 15_000
  }).catch(() => { });

  const captchaSrc = await captchaImage.getAttribute('src').catch(() => '');

  if (!captchaSrc) {
    console.log('Không tìm thấy link ảnh Captcha để mở tab riêng.');
    return null;
  }

  const captchaUrl = new URL(captchaSrc, page.url()).href;

  const imagePage = await context.newPage();
  await imagePage.goto(captchaUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  }).catch(() => { });

  await imagePage.bringToFront().catch(() => { });

  console.log(`Đã mở ảnh Captcha ở tab riêng: ${captchaUrl}`);

  return imagePage;
}
//

async function waitForRegistrationSuccess(page) {
  const successPatterns = [
    /authentication/i,
    /e-?mail/i,
    /sent/i,
    /complete/i,
    /가입/,
    /인증/,
    /메일/
  ];

  for (let i = 0; i < 240; i += 1) {
    const text = await page.locator('body').innerText().catch(() => '');
    const url = page.url();
    if (successPatterns.some((pattern) => pattern.test(text)) && !/captcha/i.test(text)) return true;
    if (!url.includes('foreignerMemberMain')) return true;
    await sleep(1_000);
  }
  return false;
}

//
async function waitAfterLoginSubmit(context, page, initialLoginUrl) {
  const deadline = Date.now() + 4_000;

  while (Date.now() < deadline) {
    const loginErrorText = await readLoginErrorMessage(page);
    if (loginErrorText) {
      throw new Error(INVALID_LOGIN_MESSAGE);
    }

    const url = page.url();
    const stillOnLoginPath = /loginview|\/member\/login/i.test(url);

    const loginFormVisible = await page
      .locator('#user_id, input[name="user_id"], #passwd, input[name="passwd"]')
      .first()
      .isVisible({ timeout: 200 })
      .catch(() => false);

    if (!stillOnLoginPath || !loginFormVisible) {
      console.log('[LOGIN] Đăng nhập thành công (Đã chuyển hướng hoặc ẩn form login). Đợi 4 giây để load hoàn tất token/session...');
      await sleep(4_000);
      return true;
    }

    const pages = typeof context.pages === 'function' ? context.pages() : [page];
    for (const currentPage of pages) {
      if (await hasLoggedInIndicators(currentPage)) {
        console.log('[LOGIN] Phát hiện biểu tượng login thành công. Đợi 4 giây...');
        await sleep(4_000);
        return true;
      }
    }

    await sleep(300);
  }

  return true;
}
//

async function waitForLoginSuccess(context, page, initialLoginUrl) {
  for (let i = 0; i < 180; i += 1) {
    const pages = typeof context.pages === 'function' ? context.pages() : [page];

    for (const currentPage of pages) {
      const url = currentPage.url();

      if (!/bugs\.co\.kr/i.test(url)) {
        continue;
      }

      const loginErrorText = await readLoginErrorMessage(currentPage);
      if (loginErrorText) {
        throw new Error(INVALID_LOGIN_MESSAGE);
      }

      const stillOnLoginPath = /loginview|\/member\/login/i.test(url);

      if (!stillOnLoginPath && await hasLoggedInIndicators(currentPage)) {
        return true;
      }
    }

    await sleep(1_000);
  }

  return false;
}

async function hasLoggedInIndicators(page) {
  const url = page.url();
  if (!/bugs\.co\.kr/i.test(url)) return false;

  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const loggedInSelectors = [
      '.myinfo',
      '.user',
      '.profile',
      '.gnbUser',
      'a[href*="logout"]',
      'button[onclick*="logout"]'
    ];
    const hasLoggedInElement = loggedInSelectors.some((selector) => document.querySelector(selector));
    const hasLogoutText = /logout|로그아웃/i.test(text);
    const hasProfileText = /님|마이뮤직|구매한 음악|최근 들은 곡/i.test(text);
    return hasLoggedInElement || hasLogoutText || hasProfileText;
  }).catch(() => false);
}

async function readLoginErrorMessage(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');

  const invalidLoginPattern = /아이디\s*또는\s*비밀번호를\s*확인해\s*주세요\.?/i;

  if (invalidLoginPattern.test(bodyText)) {
    return '아이디 또는 비밀번호를 확인해 주세요.';
  }

  const errorText = await page
    .locator('#loginDesc, form#frmLoginLayer .validation, .validation, .error, .txtError')
    .first()
    .innerText({ timeout: 300 })
    .catch(() => '');

  if (invalidLoginPattern.test(errorText)) {
    return errorText.trim();
  }

  return '';
}

function loginSubmitButton(page) {
  return page.locator('form#frmLoginLayer button.submit[onclick*="loginProcess"]').first();
}

async function submitLogin(page) {
  const form = page.locator('form#frmLoginLayer').first();
  const formVisible = await form.isVisible().catch(() => false);
  if (!formVisible) return false;

  const button = loginSubmitButton(page);
  if (!(await button.count().catch(() => 0))) return false;

  const isVisible = await button.isVisible().catch(() => false);
  if (!isVisible) return false;

  const submitCount = await page.locator('form#frmLoginLayer button.submit[onclick*="loginProcess"]').count().catch(() => 0);
  if (submitCount !== 1) return false;

  await button.scrollIntoViewIfNeeded().catch(() => { });
  await page.evaluate(() => {
    const formElement = document.querySelector('form#frmLoginLayer');
    const buttonElement = formElement?.querySelector('button.submit[onclick*="loginProcess"]');
    if (!formElement || !buttonElement) return false;
    if (typeof window.loginProcess === 'function') {
      window.loginProcess();
      return true;
    }
    buttonElement.click();
    return true;
  }).catch(() => { });
  await page.waitForTimeout(500);
  return true;
}

async function verifyEmail(tempPage, provider = TEMP_MAIL_PROVIDERS[0], config = {}) {
  console.log('\nĐang chờ email xác thực Bugs trên temp-mail...');
  //
  if (config.autoFocusBrowser !== false) {
    await tempPage.bringToFront().catch(() => { });
  }

  const deadline = Date.now() + EMAIL_VERIFY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await removeAdOverlay(tempPage);
    await clickFirstAvailable(tempPage, provider.refreshSelectors).catch(() => { });
    await sleep(2_000);

    const opened = provider.id === 'mail-tm'
      ? await openMailTmVerificationEmail(tempPage, provider)
      : await openGenericVerificationEmail(tempPage);

    if (opened) {
      const authUrl = await findEmailAuthenticationUrl(tempPage);
      if (authUrl) {
        const authPage = await tempPage.context().newPage();
        await authPage.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await clickConfirmAfterAuth(authPage);
        await authPage.waitForTimeout(2_000);
        const authenticated = /bugs\.co\.kr/.test(authPage.url()) || /authenticated|complete|인증|확인/i.test(await authPage.locator('body').innerText().catch(() => ''));
        if (authenticated) {
          console.log('Đã bấm Email Authentication và qua trang xác thực.');
          return true;
        }
        console.log('Đã bấm Email Authentication nhưng chưa xác nhận được trang xác thực, tiếp tục chờ.');
      }
    }
  }

  return false;
}

async function openGenericVerificationEmail(tempPage) {
  const bugsMail = tempPage.locator('text=/\\[Bugs\\]|Please proceed|authentication/i').first();
  if (!(await bugsMail.count().catch(() => 0))) {
    return false;
  }

  await removeAdOverlay(tempPage);
  await bugsMail.click({ force: true }).catch(() => { });
  await tempPage.waitForTimeout(1_500);
  return true;
}

async function openMailTmVerificationEmail(tempPage, provider) {
  const row = await findInboxRowByText(tempPage, provider);
  if (!row) {
    return false;
  }

  await removeAdOverlay(tempPage);
  await row.scrollIntoViewIfNeeded().catch(() => { });
  await row.click({ force: true }).catch(async () => {
    await row.evaluate((element) => element.click());
  });
  await tempPage.waitForTimeout(1_500);
  return true;
}

async function openInboxRowVerificationEmail(tempPage, provider) {
  const row = await findInboxRowByText(tempPage, provider);
  if (!row) {
    return false;
  }

  await removeAdOverlay(tempPage);
  await row.scrollIntoViewIfNeeded().catch(() => { });
  await row.click({ force: true }).catch(async () => {
    await row.evaluate((element) => element.click());
  });
  await tempPage.waitForTimeout(1_500);
  return true;
}

async function findInboxRowByText(page, provider) {
  for (const selector of provider.inboxRowSelectors ?? []) {
    const rows = page.locator(selector);
    const count = await rows.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const text = await row.innerText().catch(() => '');
      if (/bugs|authentication|please proceed|verify|verification/i.test(text)) {
        return row;
      }
    }
  }

  return null;
}

async function findEmailAuthenticationUrl(page) {
  const authHrefPattern = /https:\/\/secure\.bugs\.co\.kr\/member\/join\/authCode\/check/i;
  const fromPage = await page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const link = [...document.querySelectorAll('a[href]')]
      .map((anchor) => anchor.href)
      .find((href) => pattern.test(href));
    return link || '';
  }, authHrefPattern.source).catch(() => '');
  if (fromPage) return fromPage;

  for (const frame of page.frames()) {
    const fromFrame = await frame.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource, 'i');
      const link = [...document.querySelectorAll('a[href]')]
        .map((anchor) => anchor.href)
        .find((href) => pattern.test(href));
      return link || '';
    }, authHrefPattern.source).catch(() => '');
    if (fromFrame) return fromFrame;
  }

  const html = await page.content().catch(() => '');
  return html.match(/https:\/\/secure\.bugs\.co\.kr\/member\/join\/authCode\/check[^"'<\s]+/i)?.[0] ?? '';
}

async function clickConfirmAfterAuth(page) {
  const confirmSelectors = [
    'a.btnJoin[href*="music.bugs.co.kr/member/register/after/welcome"]',
    'a.btnJoin:has-text("Confirm")',
    'a:has-text("Confirm")',
    'text=/Confirm/i'
  ];

  for (const selector of confirmSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.scrollIntoViewIfNeeded().catch(() => { });
      await locator.click({ timeout: 2_000, force: true });
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => { });
      return true;
    }
  }
  return false;
}

async function prepareFavoritePage(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.locator('text=/ENG/i').first().click().catch(() => { });
  const voteButton = page.locator('li:has-text("TIAN Xiwei") button.btnVote[data-candidate-id="11046"]').first();
  if (await voteButton.count().catch(() => 0)) {
    await voteButton.scrollIntoViewIfNeeded();
    await voteButton.highlight().catch(() => { });
    return;
  }

  const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
  if (await candidate.count().catch(() => 0)) {
    await candidate.scrollIntoViewIfNeeded();
    await candidate.highlight().catch(() => { });
  }
}

async function isVoteLoginRequired(page) {
  return await page
    .locator('text=/requires login|A service that requires login|로그인/i')
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
}

async function hasFavoriteCandidate(page) {
  const voteButton = page.locator('li:has-text("TIAN Xiwei") button.btnVote[data-candidate-id="11046"]').first();
  if (await voteButton.count().catch(() => 0)) {
    return true;
  }

  const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
  return await candidate.count().catch(() => 0);
}

async function voteFavorite(context, config = {}) {
  const votePage = await context.newPage();
  
  const voteState = {
    lastDialogMessage: '',
    dialogReceived: false
  };

  // Đăng ký bộ lắng nghe dialog trên trang vote để phát hiện thông báo lỗi (như hết tim, lỗi phiên...)
  votePage.on('dialog', async (dialog) => {
    const msg = dialog.message();
    voteState.lastDialogMessage = msg;
    voteState.dialogReceived = true;
    console.log(`💬 [VOTE] Phát hiện thông báo từ trang web: [${msg}]`);
    await dialog.dismiss().catch(() => {});
  });

  if (config.autoFocusBrowser !== false) {
    await votePage.bringToFront().catch(() => { });
  }
  const deadline = Date.now() + (Number(config.voteRetryTimeoutMs) || VOTE_RETRY_TIMEOUT_MS);
  let scoreRecorded = false;

  await votePage.goto(BUGS_FAVORITE_URL, { waitUntil: 'commit', timeout: 20_000 }).catch(() => { });
  await votePage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => { });

  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    console.log(`\n[VOTE] Lần thử ${attempt}: kiểm tra trạng thái trang vote...`);

    await votePage.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => { });
    await votePage.waitForTimeout(2_000);

    const loginRequired = await isVoteLoginRequired(votePage);
    if (loginRequired) {
      console.warn('[VOTE] Trang vote chưa nhận session login hoặc vẫn đang hiện thông báo login. Chờ thêm...');
      await sleep(4_000);
      continue;
    }

    const candidateVisible = await hasFavoriteCandidate(votePage);
    if (!candidateVisible) {
      console.warn('[VOTE] Chưa thấy candidate TIAN Xiwei hoặc nút vote. Giữ nguyên trang và chờ load thêm...');
      await sleep(4_000);
      continue;
    }

    await prepareFavoritePage(votePage);

    if (!scoreRecorded) {
      await recordVoteScores(votePage).catch(() => { });
      scoreRecorded = true;
    }

    console.log('[VOTE] Đã thấy candidate. Thử bấm vote...');
    const voted = await completeFavoriteVote(votePage, voteState);
    if (voted) {
      return true;
    }

    console.warn('[VOTE] Chưa hoàn tất được vote ở lần thử này. Giữ nguyên trang và thử lại...');
    await sleep(4_000);
  }

  console.warn('Hết thời gian retry vote mà vẫn chưa xác nhận được vote tự động.');
  return false;
}

async function recordVoteScores(page) {
  const checkedAt = new Date().toISOString();
  const scores = await page.evaluate(() => {
    const normalizeName = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const parseCount = (value) => Number((value || '').replace(/[^\d]/g, '')) || 0;
    const candidates = [...document.querySelectorAll('li')]
      .map((item) => {
        const name = normalizeName(item.querySelector('.info .title, p.title, .title')?.textContent);
        const votes = parseCount(item.querySelector('.info .count, span.count, .count')?.textContent);
        return { name, votes };
      })
      .filter((candidate) => candidate.name && candidate.votes);

    const tian = candidates.find((candidate) => /TIAN\s+Xiwei/i.test(candidate.name));
    const top1 = candidates[0] ?? candidates.reduce((best, candidate) => (
      candidate.votes > (best?.votes ?? 0) ? candidate : best
    ), null);

    return {
      tianXiweiVotes: tian?.votes ?? 0,
      top1Votes: top1?.votes ?? 0
    };
  });

  if (!scores.tianXiweiVotes || !scores.top1Votes) {
    console.warn('Không đọc được đầy đủ score vote để ghi CSV.');
    return;
  }

  await prependScoreHistory({
    checkedAt,
    tianXiweiVotes: scores.tianXiweiVotes,
    top1Votes: scores.top1Votes
  });
  console.log(`Đã ghi score: TIAN Xiwei ${scores.tianXiweiVotes}, top 1 ${scores.top1Votes}.`);
}

async function prependScoreHistory(row) {
  const header = 'checked_at,tian_xiwei_votes,top1_votes';
  const nextLine = [
    csvValue(row.checkedAt),
    row.tianXiweiVotes,
    row.top1Votes
  ].join(',');

  let existingLines = [];
  try {
    existingLines = (await fs.readFile(SCORE_HISTORY_PATH, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    existingLines = [];
  }

  const oldData = existingLines[0] === header ? existingLines.slice(1) : existingLines;
  await fs.mkdir(path.dirname(SCORE_HISTORY_PATH), { recursive: true });
  await fs.writeFile(SCORE_HISTORY_PATH, `${[header, nextLine, ...oldData].join('\n')}\n`);
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function completeFavoriteVote(page, voteState) {
  const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
  const voteButton = candidate
    .locator('button.btnVote[data-action="vote_candidate"][data-candidate-id="11046"]')
    .first();

  try {
    console.log('[VOTE PROCESS] Bước 1: Đợi candidate TIAN Xiwei hiển thị...');
    await candidate.waitFor({ state: 'visible', timeout: 15_000 });
    await voteButton.waitFor({ state: 'visible', timeout: 15_000 });
    await voteButton.scrollIntoViewIfNeeded();

    console.log('[VOTE PROCESS] Bước 2: Click nút vote candidate...');
    await voteButton.click({ timeout: 8_000, force: true });

    console.log('[VOTE PROCESS] Bước 3: Đợi popup chọn số tim hiển thị...');
    const popupOpened = await page
      .locator('button[data-ga-params="Favorite_투표하기-모두사용"], button:has-text("Use All")')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!popupOpened) {
      console.warn('[VOTE PROCESS] Popup chưa mở qua click trực tiếp, thử click bằng evaluate...');
      await voteButton.evaluate((button) => button.click());
    }

    // Tìm nút "Use All" (모두사용) trong popup
    const useAllButton = page
      .locator([
        'div[class*="layer"] button:has-text("Use All")',
        'div[class*="layer"] button:has-text("모두사용")',
        'div[class*="layer"] a:has-text("Use All")',
        'div[class*="layer"] a:has-text("모두사용")',
        '.layerBtn:has-text("Use All")',
        '.layerBtn:has-text("모두사용")',
        'button[data-ga-params*="모두사용"]',
        'button:has-text("Use All")',
        'button:has-text("모두사용")'
      ].join(', '))
      .filter({ visible: true })
      .first();

    console.log('[VOTE PROCESS] Bước 4: Đợi nút Use All (모두사용) hiển thị và click...');
    await useAllButton.waitFor({ state: 'visible', timeout: 10_000 });
    await useAllButton.click({ timeout: 8_000, force: true }).catch(async () => {
      console.warn('[VOTE PROCESS] Click Use All trực tiếp thất bại, thử click bằng evaluate...');
      await useAllButton.evaluate((button) => button.click());
    });
    console.log('[VOTE PROCESS] Đã click nút Use All (모두사용).');

    // Tìm nút "VOTING" / "투표하기" trong popup
    const popupVotingButton = page
      .locator([
        'div[class*="layer"] button:has-text("투표하기")',
        'div[class*="layer"] button:has-text("VOTING")',
        'div[class*="layer"] a:has-text("투표하기")',
        'div[class*="layer"] a:has-text("VOTING")',
        'button.layerBtn:has-text("투표하기")',
        'button.layerBtn:has-text("VOTING")',
        'a.layerBtn:has-text("투표하기")',
        'a.layerBtn:has-text("VOTING")',
        '.layerBtn:has-text("투표하기")',
        '.layerBtn:has-text("VOTING")',
        'button[data-ga-params="Favorite_투표하기-투표하기"]'
      ].join(', '))
      .filter({ visible: true })
      .first();

    console.log('[VOTE PROCESS] Bước 5: Đợi nút VOTING (투표하기) hiển thị và click...');
    await popupVotingButton.waitFor({ state: 'visible', timeout: 10_000 });
    
    // Reset trạng thái dialog trước khi click để bắt chính xác phản hồi từ cú click này
    voteState.lastDialogMessage = '';
    voteState.dialogReceived = false;

    await popupVotingButton.click({ timeout: 8_000, force: true }).catch(async () => {
      console.warn('[VOTE PROCESS] Click VOTING trực tiếp thất bại, thử click bằng evaluate...');
      await popupVotingButton.evaluate((button) => button.click());
    });
    console.log('[VOTE PROCESS] Đã click nút VOTING (투표하기).');

    console.log('[VOTE PROCESS] Bước 6: Đã click VOTING. Chờ 5 giây để website xử lý...');
    await page.waitForTimeout(5_000);
    console.log('[VOTE PROCESS] Bước 7: Kết thúc bước vote popup sau 5 giây chờ.');
    return true;
  } catch (error) {
    console.error(`❌ [VOTE PROCESS] Lỗi trong quá trình thực hiện click vote tự động: ${error.message}`);
    return false;
  }
}

async function logout(context) {
  const page = await context.newPage();
  await page.goto(BUGS_MUSIC_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.locator('text=/Logout|로그아웃/i').first().click().catch(async () => {
    await page.locator('[class*="logout"], a[href*="logout"]').first().click().catch(() => { });
  });
  await page.waitForTimeout(1_000);
}

async function clickFirstAvailable(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      // Click cưỡng bức bỏ qua mọi actionability checks của Playwright
      const clicked = await locator.click({ timeout: 1500, force: true }).then(() => true).catch(async () => {
        // Fallback gọi evaluate click trực tiếp trên browser
        return await locator.evaluate((el) => {
          el.click();
          return true;
        }).catch(() => false);
      });
      if (clicked) return true;
    }
  }
  return false;
}

async function loadAccounts() {
  try {
    const content = await fs.readFile(ACCOUNTS_PATH, 'utf8');
    if (!content.trim()) return [];
    const accounts = JSON.parse(content);
    return Array.isArray(accounts) ? accounts : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    console.error(`❌ [FATAL] Không thể đọc hoặc parse file accounts.json: ${error.message}`);
    throw error;
  }
}

async function saveAccounts(accounts) {
  const dir = path.dirname(ACCOUNTS_PATH);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${ACCOUNTS_PATH}.tmp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(accounts, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, ACCOUNTS_PATH);
  } catch (err) {
    console.error(`❌ [FATAL] Không thể ghi file accounts.json an toàn: ${err.message}`);
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

async function saveAccount(state) {
  const accounts = await loadAccounts();
  const nextAccount = {
    email: state.email,
    password: PASSWORD,
    identificationEmail: state.identificationEmail,
    nickname: state.nickname,
    dob: state.dob,
    createdAt: state.startedAt,
    lastVotedAt: state.lastVotedAt,
    lastVoteCount: state.lastVoteCount,
    status: state.status
  };
  const existingIndex = accounts.findIndex((account) => account.email === nextAccount.email);
  if (existingIndex >= 0) {
    accounts[existingIndex] = { ...accounts[existingIndex], ...nextAccount };
  } else {
    accounts.push(nextAccount);
  }
  await saveAccounts(accounts);
}

function votedToday(isoDate) {
  if (!isoDate) return false;
  const voteDate = new Date(isoDate);
  if (Number.isNaN(voteDate.getTime())) return false;
  return getDateKeyInTimeZone(voteDate, BUGS_VOTE_TIMEZONE) === getDateKeyInTimeZone(new Date(), BUGS_VOTE_TIMEZONE);
}

function getDateKeyInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function extractEmail(text) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
}

function normalizeVoteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function nextVoteCount(currentCount, increment = 5) {
  return normalizeVoteCount(currentCount) + increment;
}

function isBlockedTempMailDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? BLOCKED_TEMP_MAIL_DOMAINS.has(domain) : false;
}

function pickTempMailProvider(config) {
  const supportedProviders = TEMP_MAIL_PROVIDERS;
  const configuredProviderIds = Array.isArray(config.tempMailProviders)
    ? config.tempMailProviders.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
    : [];

  const pool = configuredProviderIds.length
    ? supportedProviders.filter((provider) => configuredProviderIds.includes(provider.id))
    : supportedProviders;

  if (!pool.length) {
    throw new Error('Không có temp mail provider hợp lệ trong cấu hình tempMailProviders.');
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

function randomNickname() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'DH';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function randomAdultDob() {
  const year = 1985 + Math.floor(Math.random() * 18);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${year}${month}${day}`;
}

function randomIdentificationEmail(primaryEmail) {
  const domain = primaryEmail.split('@')[1] || 'example.com';
  return `recover.${Date.now().toString(36)}@${domain}`;
}

async function appendLog(entry) {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

async function waitEnter(message) {
  const prompt = readline.createInterface({ input, output });
  try {
    await prompt.question(`${message}\n`);
  } finally {
    prompt.close();
  }
}

await main().catch(async (error) => {
  console.error(error.stack || error.message);
  await appendLog({ status: 'failed', error: error.message, failedAt: new Date().toISOString() }).catch(() => { });
  process.exit(1);
});
