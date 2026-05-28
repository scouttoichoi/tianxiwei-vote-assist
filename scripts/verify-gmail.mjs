import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

// Tải tất cả cấu hình Gmail từ file vote-assist.config.json cục bộ
async function loadGmailConfigs() {
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

// Hàm xác thực link Bugs bằng Playwright ẩn danh
async function authenticateBugsLink(authUrl) {
  console.log(`🤖 [Playwright] Khởi chạy trình duyệt để xác thực link...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 }
  });
  const page = await context.newPage();

  try {
    console.log(`🔗 [Playwright] Điều hướng tới: ${authUrl}`);
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
        console.log(`👉 [Playwright] Phát hiện và nhấp nút xác thực: "${selector}"`);
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 5000, force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      console.log(`⚠️ [Playwright] Không tìm thấy nút xác thực Confirm đặc thù, kiểm tra trạng thái trang...`);
    }

    await page.waitForTimeout(4000); // Đợi server xử lý
    const currentUrl = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const isSuccess = /bugs\.co\.kr/.test(currentUrl) || 
                      /authenticated|complete|welcome|success|인증|확인|완료/i.test(bodyText);

    if (isSuccess) {
      console.log(`✅ [Playwright] Xác thực thành công trên Bugs!`);
      return true;
    } else {
      console.log(`❌ [Playwright] Xác thực thất bại hoặc trang báo lỗi. URL hiện tại: ${currentUrl}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ [Playwright] Lỗi trong quá trình xác thực: ${error.message}`);
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Xử lý quét và xác thực cho 1 tài khoản Gmail cụ thể
async function processGmailAccount(gmailConfig) {
  console.log(`\n-------------------------------------------------------`);
  console.log(`📧 KẾT NỐI HÒM THƯ: ${gmailConfig.user}`);
  console.log(`-------------------------------------------------------`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: gmailConfig.user,
      pass: gmailConfig.pass
    },
    logger: false
  });

  try {
    console.log(`🔌 Đang kết nối tới IMAP Gmail...`);
    await client.connect();
    console.log(`✅ Kết nối thành công.`);

    let lock = await client.getMailboxLock('INBOX');
    try {
      console.log(`🔍 Đang quét email CHƯA ĐỌC (UNSEEN) từ Bugs...`);
      const messages = await client.search({ unseen: true });
      console.log(`📨 Tìm thấy ${messages.length} email chưa đọc từ hòm thư này.`);

      let processedCount = 0;
      let successCount = 0;

      for (const msgId of messages) {
        try {
          const message = await client.fetchOne(msgId, { source: true, flags: true });
          const parsed = await simpleParser(message.source);

          const subject = parsed.subject || '';
          const fromText = parsed.from?.text || '';
          const htmlContent = parsed.html || parsed.textAsHtml || '';

          // Chỉ quét các thư gửi từ admin@bugs.co.kr
          const fromAddress = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
          const isFromBugsAdmin = fromAddress === 'admin@bugs.co.kr' || fromText.toLowerCase().includes('admin@bugs.co.kr');

          if (isFromBugsAdmin) {
            processedCount++;
            console.log(`\n📬 [Thư ${processedCount}] Tiêu đề: "${subject}"`);

            // Tìm link xác thực trong nội dung HTML
            const authUrlPattern = /https:\/\/secure\.bugs\.co\.kr\/member\/join\/authCode\/check[^"'<\s]+/i;
            const match = htmlContent.match(authUrlPattern);

            if (match) {
              const rawAuthUrl = match[0];
              const authUrl = decodeHtmlEntities(rawAuthUrl);

              // Xác định email nhận thư (để ghi nhận trong log)
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

              console.log(`✉️ Người nhận (Alias): ${targetEmail || 'Không rõ'}`);

              // Chạy Playwright để xác thực
              const isOk = await authenticateBugsLink(authUrl);

              if (isOk) {
                successCount++;
                // Đánh dấu email đã đọc
                await client.messageFlagsAdd(msgId, ['\\Seen']);
                console.log(`👁️ Đã đánh dấu email của [${targetEmail}] là ĐÃ ĐỌC (Seen).`);
              } else {
                console.log(`❌ Không thể xác thực tự động email này. Giữ trạng thái Chưa đọc để xử lý sau.`);
              }
            } else {
              console.log(`⚠️ Không tìm thấy link xác thực trong email này.`);
            }
          }
        } catch (msgError) {
          console.error(`❌ Lỗi khi xử lý email msgId=${msgId}: ${msgError.message}`);
        }
      }

      console.log(`✨ Hoàn tất quét hòm thư: ${gmailConfig.user}`);
      console.log(`📊 Đã xử lý: ${processedCount} thư của Bugs | Kích hoạt thành công: ${successCount} tài khoản.`);

    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error(`❌ Lỗi khi kết nối hòm thư ${gmailConfig.user}: ${error.message}`);
  }
}

async function main() {
  console.log(`=======================================================`);
  console.log(`🚀 BẮT ĐẦU QUÉT VÀ XÁC THỰC EMAIL ALIAS TỰ ĐỘNG`);
  console.log(`=======================================================`);

  // 1. Nạp tất cả cấu hình Gmail
  const gmailConfigs = await loadGmailConfigs();
  if (gmailConfigs.length === 0) {
    console.error(`❌ Lỗi: Chưa cấu hình thông tin Gmail & App Password ở file "vote-assist.config.json".`);
    console.error(`💡 Hướng dẫn: Vui lòng điền thông tin Gmail vào file "vote-assist.config.json" ở gốc dự án.`);
    process.exit(1);
  }

  console.log(`📂 Đã nạp thành công cấu hình cho ${gmailConfigs.length} hòm thư Gmail.`);

  // 2. Chạy quét tuần tự từng hòm thư
  for (const config of gmailConfigs) {
    await processGmailAccount(config);
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 TOÀN BỘ TIẾN TRÌNH XÁC THỰC HOÀN TẤT!`);
  console.log(`=======================================================`);
}

main().catch(console.error);
