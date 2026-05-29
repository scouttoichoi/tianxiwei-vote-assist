import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const POLL_INTERVAL_MS = 5000; // Quét lại sau mỗi 5 giây

// Cache lưu trữ các kết nối IMAP trường tồn
const activeClients = new Map();

// Tải tất cả cấu hình Gmail từ tham số dòng lệnh hoặc file vote-assist.config.json cục bộ
async function loadGmailConfigs() {
  // 1. Kiểm tra tham số dòng lệnh --config-json phục vụ đóng gói app
  const configJsonIdx = process.argv.indexOf('--config-json');
  if (configJsonIdx !== -1 && process.argv[configJsonIdx + 1]) {
    try {
      const parsed = JSON.parse(process.argv[configJsonIdx + 1]);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const validConfigs = list
        .filter(item => item && item.user && item.pass)
        .map(item => ({
          user: item.user.trim(),
          pass: item.pass.replace(/\s+/g, '').trim(),
          configPath: 'CLI Arguments'
        }));
      if (validConfigs.length > 0) return validConfigs;
    } catch (err) {
      console.error(`⚠️ Lỗi phân tích cú pháp cấu hình Gmail từ đối số CLI: ${err.message}`);
    }
  }

  // 2. Dự phòng: Tải từ file cấu hình cục bộ
  const configPath = path.resolve('vote-assist.config.json');
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    
    // Hỗ trợ cấu hình nhiều Gmail dưới dạng Mảng (Array)
    if (Array.isArray(parsed.gmail)) {
      const validConfigs = parsed.gmail
        .filter(item => item && item.user && item.pass)
        .map(item => ({
          user: item.user.trim(),
          pass: item.pass.replace(/\s+/g, '').trim(), // Xóa khoảng trắng mật khẩu
          configPath
        }));
      if (validConfigs.length > 0) return validConfigs;
    }
    
    // Hỗ trợ cấu hình đơn lẻ
    if (parsed.gmail && parsed.gmail.user && parsed.gmail.pass) {
      return [{
        user: parsed.gmail.user.trim(),
        pass: parsed.gmail.pass.replace(/\s+/g, '').trim(),
        configPath
      }];
    }
  } catch {
    // Bỏ qua nếu lỗi
  }

  // Dự phòng từ biến môi trường
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return [{
      user: process.env.GMAIL_USER.trim(),
      pass: process.env.GMAIL_PASS.replace(/\s+/g, '').trim(),
      configPath: 'Environment Variables'
    }];
  }

  return [];
}

// Giải mã HTML Entities thông dụng
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Hàm mở trình duyệt tránh Cloudflare bằng cloakbrowser hoặc headed playwright
async function launchSmartBrowser() {
  try {
    const cloak = await import('cloakbrowser').then(m => m.default || m);
    
    // Tạo thư mục tạm để lưu profile sạch cho mỗi lần chạy
    const tempProfileDir = path.join(os.tmpdir(), `bugs-auth-profile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    
    let browserInstance;
    if (typeof cloak.launchPersistentContext === 'function') {
      browserInstance = await cloak.launchPersistentContext({
        headless: false, // Để false để vượt qua Cloudflare tự động
        humanize: true,
        userDataDir: tempProfileDir,
        viewport: { width: 1280, height: 820 },
        deviceScaleFactor: 1,
        launchOptions: {
          args: ['--window-size=1280,820']
        }
      });
    } else {
      browserInstance = await cloak.launch({
        headless: false,
        humanize: true,
        args: ['--window-size=1280,820']
      });
    }
    return { browser: browserInstance, isCloak: true, tempProfileDir };
  } catch (error) {
    console.log(`   ⚠️ [Browser] Dùng Playwright Headed làm dự phòng: ${error.message}`);
    const browser = await chromium.launch({
      headless: false, // BẮT BUỘC để false để giải Cloudflare tự động
      args: ['--window-size=1280,820']
    });
    return { browser, isCloak: false };
  }
}

// Hàm vote cho TIAN Xiwei ngay lập tức sau khi xác thực thành công để tránh bị xóa account sau đó
const BUGS_FAVORITE_URL = 'https://favorite.bugs.co.kr/3922';
const SCORE_HISTORY_PATH = path.resolve('data/vote-score-history.csv');
const VOTE_RETRY_TIMEOUT_MS = 180_000;

// Helper sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function isVoteLoginRequired(page) {
  return await page
    .locator('text=/requires login|A service that requires login|로그인/i')
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);
}

async function hasFavoriteCandidate(page) {
  const voteButton = page.locator('li:has-text("TIAN Xiwei") button.btnVote').first();
  if (await voteButton.count().catch(() => 0)) {
    return true;
  }
  const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
  return await candidate.count().catch(() => 0);
}

async function prepareFavoritePage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.locator('text=/ENG/i').first().click().catch(() => {});
  const voteButton = page.locator('li:has-text("TIAN Xiwei") button.btnVote').first();
  if (await voteButton.count().catch(() => 0)) {
    await voteButton.scrollIntoViewIfNeeded().catch(() => {});
    return;
  }
  const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
  if (await candidate.count().catch(() => 0)) {
    await candidate.scrollIntoViewIfNeeded().catch(() => {});
  }
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
    console.warn('   ⚠️ [VOTE OPTIMIZE] Không đọc được đầy đủ score vote để ghi CSV.');
    return;
  }

  await prependScoreHistory({
    checkedAt,
    tianXiweiVotes: scores.tianXiweiVotes,
    top1Votes: scores.top1Votes
  }).catch(() => {});
  console.log(`   🗳️ [VOTE OPTIMIZE] Đã ghi score: TIAN Xiwei ${scores.tianXiweiVotes}, top 1 ${scores.top1Votes}.`);
}

async function voteBugsFavorite(page) {
  console.log(`   🗳️ [VOTE OPTIMIZE] Phát hiện tài khoản đã xác thực xong. Bắt đầu điều hướng tới trang vote để bảo toàn tim: ${BUGS_FAVORITE_URL}`);
  
  const voteState = {
    lastDialogMessage: '',
    dialogReceived: false
  };

  // Đăng ký bộ lắng nghe dialog trên trang vote để auto-dismiss các cảnh báo
  page.on('dialog', async (dialog) => {
    const msg = dialog.message();
    voteState.lastDialogMessage = msg;
    voteState.dialogReceived = true;
    console.log(`   💬 [VOTE OPTIMIZE] Phát hiện popup thông báo: [${msg}]`);
    await dialog.dismiss().catch(() => {});
  });

  let scoreRecorded = false;
  const deadline = Date.now() + VOTE_RETRY_TIMEOUT_MS;

  try {
    await page.goto(BUGS_FAVORITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    for (let attempt = 1; Date.now() < deadline; attempt += 1) {
      console.log(`   🗳️ [VOTE OPTIMIZE] Lần thử ${attempt}: kiểm tra trạng thái trang vote...`);

      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await sleep(2000);

      const loginRequired = await isVoteLoginRequired(page);
      if (loginRequired) {
        console.warn('   ⚠️ [VOTE OPTIMIZE] Trang vote chưa nhận session login hoặc vẫn đang hiện thông báo login. Chờ thêm...');
        await sleep(4000);
        continue;
      }

      const candidateVisible = await hasFavoriteCandidate(page);
      if (!candidateVisible) {
        console.warn('   ⚠️ [VOTE OPTIMIZE] Chưa thấy candidate TIAN Xiwei hoặc nút vote. Giữ nguyên trang và chờ load thêm...');
        await sleep(4000);
        continue;
      }

      await prepareFavoritePage(page);

      if (!scoreRecorded) {
        await recordVoteScores(page).catch(() => {});
        scoreRecorded = true;
      }

      console.log('   🗳️ [VOTE OPTIMIZE] Đã thấy candidate TIAN Xiwei. Thử bấm vote...');
      
      const candidate = page.locator('li:has-text("TIAN Xiwei")').first();
      const voteButton = candidate.locator('button.btnVote[data-action="vote_candidate"]').first();

      await candidate.waitFor({ state: 'visible', timeout: 10000 });
      await voteButton.waitFor({ state: 'visible', timeout: 10000 });
      await voteButton.scrollIntoViewIfNeeded().catch(() => {});
      await voteButton.click({ timeout: 8000, force: true });

      console.log('   🗳️ [VOTE OPTIMIZE] Đợi popup chọn số tim hiển thị...');
      const popupOpened = await page
        .locator('button[data-ga-params="Favorite_투표하기-모두사용"], button:has-text("Use All")')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (!popupOpened) {
        console.warn('   ⚠️ [VOTE OPTIMIZE] Popup chưa mở qua click trực tiếp, thử click bằng evaluate...');
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

      console.log('   🗳️ [VOTE OPTIMIZE] Đợi nút Use All (모두사용) hiển thị và click...');
      await useAllButton.waitFor({ state: 'visible', timeout: 10000 });
      await useAllButton.click({ timeout: 8000, force: true }).catch(async () => {
        console.warn('   ⚠️ [VOTE OPTIMIZE] Click Use All trực tiếp thất bại, thử click bằng evaluate...');
        await useAllButton.evaluate((button) => button.click());
      });
      console.log('   🗳️ [VOTE OPTIMIZE] Đã click nút Use All (모두사용).');

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

      console.log('   🗳️ [VOTE OPTIMIZE] Đợi nút VOTING (투표하기) hiển thị và click...');
      await popupVotingButton.waitFor({ state: 'visible', timeout: 10000 });
      
      // Reset trạng thái dialog trước khi click
      voteState.lastDialogMessage = '';
      voteState.dialogReceived = false;

      await popupVotingButton.click({ timeout: 8000, force: true }).catch(async () => {
        console.warn('   ⚠️ [VOTE OPTIMIZE] Click VOTING trực tiếp thất bại, thử click bằng evaluate...');
        await popupVotingButton.evaluate((button) => button.click());
      });
      console.log('   🗳️ [VOTE OPTIMIZE] Đã click nút VOTING (투표하기).');

      console.log('   🗳️ [VOTE OPTIMIZE] Chờ 5 giây để website xử lý phiếu vote...');
      await sleep(5000);
      console.log('   ✅ [VOTE OPTIMIZE] Hoàn tất quá trình bỏ phiếu vote tối ưu!');
      return true;
    }
    
    console.warn('   ⚠️ [VOTE OPTIMIZE] Hết thời gian retry vote mà vẫn chưa xác nhận được vote tự động.');
    return false;
  } catch (error) {
    console.warn(`   ⚠️ [VOTE OPTIMIZE] Lỗi hoặc không có tim để vote: ${error.message}`);
    return false;
  }
}

// Hàm xác thực link Bugs bằng Playwright ẩn danh
async function authenticateBugsLink(authUrl) {
  console.log(`   🤖 [SmartBrowser] Khởi chạy trình duyệt chống chặn để click xác thực...`);
  
  let browserState = null;
  try {
    browserState = await launchSmartBrowser();
    const context = browserState.isCloak ? browserState.browser : await browserState.browser.newContext({
      viewport: { width: 1280, height: 820 }
    });
    const page = await context.newPage();

    console.log(`   🔗 [Browser] Điều hướng tới: ${authUrl}`);
    await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const confirmSelectors = [
      'a.btnJoin[href*="music.bugs.co.kr/member/register/after/welcome"]',
      'a.btnJoin:has-text("Confirm")',
      'a.btnJoin:has-text("확인")',
      'a:has-text("Confirm")',
      'text=/Confirm/i',
      'a.btnJoin'
    ];

    let clicked = false;
    for (const selector of confirmSelectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0) > 0) {
        console.log(`   👉 [Browser] Nhấp nút xác thực: "${selector}"`);
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 5000, force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        clicked = true;
        break;
      }
    }

    await page.waitForTimeout(4000); // Đợi server xử lý
    const currentUrl = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const isSuccess = /bugs\.co\.kr/.test(currentUrl) || 
                      /authenticated|complete|welcome|success|인증|확인|완료/i.test(bodyText);

    if (isSuccess) {
      console.log(`   ✅ [Browser] Kích hoạt thành công trên trang chủ Bugs!`);
      // Thực hiện bỏ phiếu vote ngay lập tức khi session của tài khoản mới đang đăng nhập trên trình duyệt
      await voteBugsFavorite(page).catch((err) => {
        console.warn(`   ⚠️ [VOTE OPTIMIZE] Lỗi khi thực hiện vote tối ưu: ${err.message}`);
      });
      return true;
    } else {
      console.log(`   ❌ [Browser] Thất bại. URL: ${currentUrl}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ [Browser] Lỗi xác thực: ${error.message}`);
    return false;
  } finally {
    if (browserState && browserState.browser) {
      await browserState.browser.close().catch(() => {});
    }
    if (browserState && browserState.tempProfileDir) {
      await fs.rm(browserState.tempProfileDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// Khởi tạo hoặc tái sử dụng kết nối IMAP trường tồn
async function getOrCreateConnectedClient(gmailConfig) {
  let client = activeClients.get(gmailConfig.user);

  // Nếu kết nối cũ không còn khả dụng, tiến hành dọn dẹp và kết nối lại
  if (client && !client.usable) {
    console.log(`🔌 [IMAP] Kết nối tới ${gmailConfig.user} đã bị ngắt. Đang kết nối lại...`);
    try { await client.logout(); } catch {}
    activeClients.delete(gmailConfig.user);
    client = null;
  }

  if (!client) {
    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: gmailConfig.user,
        pass: gmailConfig.pass
      },
      logger: false
    });

    console.log(`🔌 [IMAP] Đang thiết lập kết nối TRƯỜNG TỒN (Persistent Connection) tới: ${gmailConfig.user}...`);
    await client.connect();
    console.log(`✅ [IMAP] Đã đăng nhập thành công vào ${gmailConfig.user}.`);
    activeClients.set(gmailConfig.user, client);
  }

  return client;
}

// Xử lý quét và xác thực cho 1 tài khoản Gmail cụ thể
async function processGmailAccount(gmailConfig) {
  const timeStr = new Date().toLocaleTimeString();
  let client = null;

  try {
    // Lấy kết nối trường tồn từ cache
    client = await getOrCreateConnectedClient(gmailConfig);

    let lock = await client.getMailboxLock('INBOX');
    try {
      await client.noop();
      const messages = await client.search({ seen: false, from: 'admin@bugs.co.kr' });

      // Log siêu gọn nếu không có thư mới
      if (messages.length === 0) {
        console.log(`[${timeStr}] 📬 [${gmailConfig.user}] Trạng thái: Yên lặng (0 thư mới từ admin@bugs.co.kr)`);
        return;
      }

      console.log(`\n[${timeStr}] 🎉 [${gmailConfig.user}] PHÁT HIỆN ${messages.length} THƯ MỚI CHƯA ĐỌC! Đang xử lý...`);

      let processedCount = 0;
      let successCount = 0;

      for (const msgId of messages) {
        try {
          const message = await client.fetchOne(msgId, { source: true, flags: true });
          const parsed = await simpleParser(message.source);

          const subject = parsed.subject || '';
          const htmlContent = parsed.html || parsed.textAsHtml || '';

          processedCount++;
          console.log(` 📬 [Thư ${processedCount}] Tiêu đề: "${subject}"`);

          // Tìm link xác thực trong nội dung HTML
          const authUrlPattern = /https:\/\/secure\.bugs\.co\.kr\/member\/join\/authCode\/check[^"'<\s]+/i;
          const match = htmlContent.match(authUrlPattern);

          if (match) {
            const rawAuthUrl = match[0];
            const authUrl = decodeHtmlEntities(rawAuthUrl);

            // Xác định email nhận thư
            const toAddress = parsed.to?.value?.[0]?.address || '';
            const deliveredTo = parsed.headers?.get?.('delivered-to') || '';
            let targetEmail = toAddress || deliveredTo || '';

            if (typeof targetEmail === 'object') {
              targetEmail = targetEmail.initial || targetEmail.value || '';
            }
            targetEmail = String(targetEmail).trim().toLowerCase();

            if (!targetEmail || !targetEmail.includes('@')) {
              const matchEmail = htmlContent.match(/[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+@gmail\.com/i);
              if (matchEmail) targetEmail = matchEmail[0].toLowerCase();
            }

            console.log(`   ✉️ Người nhận (Alias): ${targetEmail || 'Không rõ'}`);

            // Chạy Playwright để xác thực
            const isOk = await authenticateBugsLink(authUrl);

            if (isOk) {
              successCount++;
              // Đánh dấu email đã đọc
              await client.messageFlagsAdd(msgId, ['\\Seen']);
              console.log(`   👁️ Đã đánh dấu thư của [${targetEmail}] là ĐÃ ĐỌC (Seen).`);
            } else {
              console.log(`   ❌ Giữ trạng thái email Chưa đọc để xử lý sau.`);
            }
          } else {
            console.log(`   ⚠️ Không tìm thấy link xác thực trong thư này.`);
          }
        } catch (msgError) {
          console.error(` ❌ Lỗi xử lý email: ${msgError.message}`);
        }
      }

      console.log(`📊 Kết quả lượt quét: Đã xử lý ${processedCount} thư | Xác thực thành công: ${successCount} tài khoản.`);

    } finally {
      lock.release();
    }
  } catch (error) {
    console.error(`[${timeStr}] ❌ Lỗi khi quét hòm thư ${gmailConfig.user}: ${error.message}`);
    // Đứt kết nối hoặc lỗi socket -> Xóa kết nối cache để chu kỳ sau robot tự kết nối lại
    activeClients.delete(gmailConfig.user);
    if (client) {
      try { await client.logout(); } catch {}
    }
  }
}

async function main() {
  console.log(`=======================================================`);
  console.log(`🚀 KHỞI CHẠY THIẾT BỊ LỌC VÀ XÁC THỰC EMAIL TỰ ĐỘNG`);
  console.log(`⏱️  Chế độ: Chạy liên tục (Quét tuần hoàn mỗi 5 giây)`);
  console.log(`📡 Kết nối: Trường tồn (Persistent Connection - Không rớt session)`);
  console.log(`=======================================================`);

  // 1. Nạp tất cả cấu hình Gmail
  const gmailConfigs = await loadGmailConfigs();
  if (gmailConfigs.length === 0) {
    console.error(`❌ Lỗi: Chưa cấu hình thông tin Gmail & App Password ở file "vote-assist.config.json".`);
    console.error(`💡 Hướng dẫn: Vui lòng điền thông tin Gmail vào file "vote-assist.config.json" ở gốc dự án.`);
    process.exit(1);
  }

  console.log(`📂 Đã nạp thành công cấu hình cho ${gmailConfigs.length} hòm thư Gmail.`);
  console.log(`💡 Nhấn Ctrl + C để dừng dịch vụ.\n`);

  // 2. Vòng lặp quét vô hạn
  while (true) {
    for (const config of gmailConfigs) {
      await processGmailAccount(config);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(console.error);
