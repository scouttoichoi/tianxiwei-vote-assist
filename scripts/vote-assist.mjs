#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import Tesseract from 'tesseract.js';

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
  {
    id: 'tempail',
    label: 'tempail.com',
    url: 'https://tempail.com/',
    rotateSelectors: [
      'button:has-text("new")',
      'button:has-text("New")',
      'text=new',
      'text=New',
      '[aria-label*="new" i]'
    ],
    refreshSelectors: [
      'button:has-text("refresh")',
      'button:has-text("Refresh")',
      'text=refresh',
      'text=Refresh',
      '[aria-label*="refresh" i]'
    ]
  },
  {
    id: 'tempmailo',
    label: 'tempmailo.com',
    url: 'https://tempmailo.com/',
    rotateSelectors: [
      'button:has-text("new")',
      'button:has-text("New")',
      'button:has-text("random")',
      'button:has-text("Random")',
      'text=new',
      'text=New',
      'text=random',
      'text=Random',
      '[aria-label*="new" i]',
      '[aria-label*="random" i]'
    ],
    refreshSelectors: [
      'button:has-text("refresh")',
      'button:has-text("Refresh")',
      'text=refresh',
      'text=Refresh',
      '[aria-label*="refresh" i]'
    ]
  }
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
const INVALID_LOGIN_MESSAGE = '아이디 또는 비밀번호를 확인해 주세요.';
const LOGIN_NOT_CONFIRMED_ERROR = 'login-not-confirmed';
const BUGS_VOTE_TIMEZONE = 'Asia/Seoul';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // Dọn dẹp các tệp ảnh OCR cũ còn sót lại trong logs trước khi bắt đầu tiến trình
  try {
    const files = await fs.readdir('logs').catch(() => []);
    for (const file of files) {
      if (file.startsWith('ocr-section-') && file.endsWith('.png')) {
        await fs.rm(path.join('logs', file), { force: true });
      }
    }
  } catch (err) { }

  const totalRuns = Number(process.argv[3] ?? config.signupRuns ?? 1);
  const browserApi = await loadBrowserApi();
  let completed = 0;

  for (let runIndex = 1; runIndex <= totalRuns; runIndex += 1) {
    console.log(`\nBắt đầu signup-vote lượt ${runIndex}/${totalRuns}`);
    const ok = await runSingleSignupAndVote(browserApi, config).catch(async (error) => {
      console.warn(`Lỗi signup-vote lượt ${runIndex}: ${error.message}`);
      await appendLog({ status: 'signup-failed', error: error.message, failedAt: new Date().toISOString() }).catch(() => { });
      return false;
    });
    completed += ok ? 1 : 0;
  }

  console.log(`Hoàn tất signup-vote: ${completed}/${totalRuns} lượt.`);
}

async function runSingleSignupAndVote(browserApi, config) {
  if (config.freshProfilePerRun ?? true) {
    await fs.rm(USER_DATA_DIR, { recursive: true, force: true });
  }
  const runConfig = await resolveRunConfig(config);
  const browser = await launchBrowser(browserApi, runConfig);
  const context = await browser.newContext?.() ?? browser;
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

    console.log('\nĐã điền form Bugs. Đang tự động focus vào ô nhập mã Captcha...');
    await signupPage.locator('#captchaText').focus().catch(() => { });
    await signupPage.locator('#captchaText').scrollIntoViewIfNeeded().catch(() => { });

    console.log('✍️ Vui lòng tự nhập mã Captcha trên màn hình trình duyệt và bấm nút Sign Up (#btnJoinComplete) để tiếp tục.');

    const registered = await waitForRegistrationSuccess(signupPage);
    if (!registered) {
      await waitEnter('Chưa phát hiện đăng ký thành công. Nhấn Enter sau khi bạn thấy trang báo đã gửi email xác thực...');
    }

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
    state.status = voted ? 'active' : 'needs-review';
    await saveAccount(state);
    await appendLog({ ...state, completedAt: new Date().toISOString(), status: 'completed' });
    console.log(`Hoàn tất đăng ký + vote. Đã lưu account vào: ${ACCOUNTS_PATH}`);
    return true;
  } finally {
    await browser.close?.();
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
    const context = await browser.newContext?.() ?? browser;

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
      await browser.close?.();
      if (config.freshProfilePerRun ?? true) {
        await fs.rm(USER_DATA_DIR, { recursive: true, force: true }).catch(() => { });
      }
    }
  }

  console.log(`Hoàn tất login-vote: ${completed}/${Math.min(limit, runnable.length)} account.`);
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

  if (typeof api.launchPersistentContext === 'function') {
    return api.launchPersistentContext({
      headless: false,
      humanize: true,
      userDataDir: config.userDataDir ?? USER_DATA_DIR,
      proxy: config.proxy,
      viewport: config.viewport ?? DEFAULT_VIEWPORT,
      launchOptions: {
        args: browserArgs
      }
    });
  }

  if (typeof api.launchContext === 'function') {
    return api.launchContext({
      headless: false,
      humanize: true,
      proxy: config.proxy,
      viewport: config.viewport ?? DEFAULT_VIEWPORT,
      args: browserArgs

    });
  }

  if (typeof api.launch === 'function') {
    return api.launch({
      headless: false,
      humanize: true,
      proxy: config.proxy,
      args: browserArgs

    });
  }

  throw new Error('Không tìm thấy API launch tương thích từ cloakbrowser.');
}

async function getTempMailAddress(page, provider = TEMP_MAIL_PROVIDERS[0]) {
  await page.waitForLoadState('domcontentloaded');

  for (let randomAttempt = 0; randomAttempt < 8; randomAttempt += 1) {
    const email = await readTempMailAddress(page);
    if (!isBlockedTempMailDomain(email)) return email;

    console.warn(`Temp mail ${email} đang dùng domain lỗi trên ${provider.label}, thử đổi mail khác...`);
    const randomized = await randomizeTempMail(page, provider);
    if (!randomized) {
      throw new Error(`Email ${email} dùng domain lỗi nhưng không tìm thấy nút đổi mail trên ${provider.label}.`);
    }
  }

  throw new Error('Đã random temp-mail nhiều lần nhưng vẫn gặp domain lỗi.');
}

async function readTempMailAddress(page) {
  await page.waitForLoadState('domcontentloaded');

  const selectors = [
    'input[value*="@"]',
    '[data-qa="current-email"]',
    '[data-testid="email"]',
    'button:has-text("@")',
    'div:has-text("@")'
  ];

  for (let attempt = 0; attempt < 20; attempt += 1) {
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



async function fillBugsLogin(page, account) {
  await openBugsLoginForm(page);
  await page.waitForSelector('#user_id, input[name="user_id"]', { timeout: 60_000 });
  await fillBySelectors(page, ['#user_id', 'input[name="user_id"]'], account.email);
  await fillBySelectors(page, ['#passwd', 'input[name="passwd"]'], account.password ?? PASSWORD);
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
    const title = document.body?.innerText || '';
    const userId = document.querySelector('#user_id, input[name="user_id"]');
    const password = document.querySelector('#passwd, input[name="passwd"]');
    return title.includes('벅스 아이디 또는 이메일로 로그인') && !!userId && !!password;
  }, { timeout: 30_000 }).catch(() => { });
  await page.waitForSelector('#user_id, input[name="user_id"]', { state: 'visible', timeout: 30_000 });
}

async function randomizeTempMail(page, provider = TEMP_MAIL_PROVIDERS[0]) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_500);
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
    await field.scrollIntoViewIfNeeded().catch(() => { });
    await field.fill(value, { force: true }).catch(async () => {
      await field.click({ force: true });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.type(value, { delay: 20 });
    });
    await field.evaluate((element, nextValue) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(element, nextValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    }, value).catch(() => { });
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
  await page.waitForTimeout(500);
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
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const loginErrorText = await readLoginErrorMessage(page);
    if (loginErrorText) {
      throw new Error(INVALID_LOGIN_MESSAGE);
    }

    await sleep(500);
  }

  const finalLoginErrorText = await readLoginErrorMessage(page);
  if (finalLoginErrorText) {
    throw new Error(INVALID_LOGIN_MESSAGE);
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
    .innerText()
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
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => { });
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
    await clickFirstAvailable(tempPage, provider.refreshSelectors).catch(() => { });
    await sleep(2_000);

    const bugsMail = tempPage.locator('text=/\\[Bugs\\]|Please proceed|authentication/i').first();
    if (await bugsMail.count().catch(() => 0)) {
      await bugsMail.click().catch(() => { });
      await tempPage.waitForTimeout(1_500);
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

async function voteFavorite(context, config = {}) {
  const votePage = await context.newPage();
  if (config.autoFocusBrowser !== false) {
    await votePage.bringToFront().catch(() => { });
  }
  // await votePage.goto(BUGS_FAVORITE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await votePage.goto(BUGS_FAVORITE_URL, { waitUntil: 'commit', timeout: 15_000 });
  await votePage.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => { });
  //
  let loginRequired = await votePage
    .locator('text=/requires login|A service that requires login|로그인/i')
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (loginRequired) {
    console.warn('Trang vote báo chưa nhận session login. Đợi thêm rồi thử mở lại trang vote...');
    await sleep(3_000);

    await votePage.goto(BUGS_FAVORITE_URL, { waitUntil: 'commit', timeout: 15_000 });
    await votePage.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => { });
    // await votePage.goto(BUGS_FAVORITE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    loginRequired = await votePage
      .locator('text=/requires login|A service that requires login|로그인/i')
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (loginRequired) {
      console.warn('Trang vote vẫn báo chưa đăng nhập sau khi thử lại. Bỏ qua account này, giữ active để lần sau chạy lại.');
      return false;
    }
  }
  //
  await prepareFavoritePage(votePage);
  await recordVoteScores(votePage);

  console.log('\nĐã mở trang vote và tìm nút Voting của TIAN Xiwei.');
  const voted = await completeFavoriteVote(votePage);
  if (!voted) {
    console.warn('Chưa xác nhận được vote tự động. Bạn kiểm tra thủ công xong thì nhấn Enter để tiếp tục...');//await waitEnter
  }
  return voted;
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

async function completeFavoriteVote(page) {
  const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
  const voteButton = candidate
    .locator('button.btnVote[data-action="vote_candidate"][data-candidate-id="11046"]')
    .first();

  try {
    await candidate.waitFor({ state: 'visible', timeout: 15_000 });
    await voteButton.waitFor({ state: 'visible', timeout: 15_000 });
    await voteButton.scrollIntoViewIfNeeded();
    await voteButton.click({ timeout: 8_000, force: true });

    const popupOpened = await page
      .locator('button[data-ga-params="Favorite_투표하기-모두사용"], button:has-text("Use All")')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!popupOpened) {
      await voteButton.evaluate((button) => button.click());
    }

    const useAllButton = page
      .locator('button[data-ga-params="Favorite_투표하기-모두사용"], button:has-text("Use All")')
      .first();
    await useAllButton.waitFor({ state: 'visible', timeout: 10_000 });
    await useAllButton.click({ timeout: 10_000 });

    const popupVotingButton = page
      .locator('button.layerBtn[data-ga-params="Favorite_투표하기-투표하기"], button.layerBtn:has-text("VOTING")')
      .first();
    await popupVotingButton.waitFor({ state: 'visible', timeout: 10_000 });
    await popupVotingButton.click({ timeout: 10_000 });

    await page.waitForTimeout(2_000);
    console.log('Đã bấm Use All và VOTING trong popup.');
    return true;
  } catch (error) {
    console.warn(`Không hoàn tất được bước vote tự động: ${error.message}`);
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
      await locator.click({ timeout: 3_000 });
      return true;
    }
  }
  return false;
}

async function loadAccounts() {
  try {
    const content = await fs.readFile(ACCOUNTS_PATH, 'utf8');
    const accounts = JSON.parse(content);
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
}

async function saveAccounts(accounts) {
  await fs.mkdir(path.dirname(ACCOUNTS_PATH), { recursive: true });
  await fs.writeFile(ACCOUNTS_PATH, `${JSON.stringify(accounts, null, 2)}\n`);
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
