const splash = document.getElementById('splash');
const appRoot = document.getElementById('app');
const setupStatus = document.getElementById('setupStatus');
const tianVotes = document.getElementById('tianVotes');
const topVotes = document.getElementById('topVotes');
const gapVotes = document.getElementById('gapVotes');
const updatedAt = document.getElementById('updatedAt');
const emptyScoreHint = document.getElementById('emptyScoreHint');
const logOutput = document.getElementById('logOutput');
const signupButton = document.getElementById('signupButton');
const loginButton = document.getElementById('loginButton');
const stopButton = document.getElementById('stopButton');
const historyButton = document.getElementById('historyButton');
const accountsButton = document.getElementById('accountsButton');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const countDialog = document.getElementById('countDialog');
const signupCountInput = document.getElementById('signupCountInput');
const confirmCountDialog = document.getElementById('confirmCountDialog');
const closeCountDialog = document.getElementById('closeCountDialog');
const languageSelect = document.getElementById('languageSelect');//
const importAccountsButton = document.getElementById('importAccountsButton');//
const downloadTemplateButton = document.getElementById('downloadTemplateButton');//

let currentLanguage = localStorage.getItem('language') || 'vi';

function t(key) {
  return window.I18N?.[currentLanguage]?.[key] || window.I18N?.en?.[key] || key;
}

function applyLanguage(language) {
  currentLanguage = language;
  localStorage.setItem('language', language);
  document.documentElement.lang = language;

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });

  if (languageSelect) {
    languageSelect.value = language;
  }

  const idleTexts = Object.values(window.I18N).map((languagePack) => languagePack.idleLog);
  const currentLog = logOutput.textContent.trim();

  if (idleTexts.includes(currentLog)) {
    logOutput.textContent = t('idleLog');
  }
}

const numberFormat = new Intl.NumberFormat('en-US');
const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function formatVote(value) {
  return value ? numberFormat.format(value) : '-';
}

function normalizeVoteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateTimeFormat.format(date);
}

function formatDateTimeStack(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${timeFormat.format(date)}\n${dateFormat.format(date)}`;
}

function appendLog(text) {
  logOutput.textContent += text;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setIdleLog() {
  if (!logOutput.textContent.trim()) {
    logOutput.textContent = t('idleLog');
  }
}

function setRunning(running, mode) {
  signupButton.disabled = running;
  loginButton.disabled = running;
  stopButton.classList.toggle('hidden', !running);
  if (running && !logOutput.textContent.trim()) {
    appendLog(`${mode === 'login' ? t('runningLogin') : t('runningSignup')}\n`);
  }
  if (!running) setIdleLog();
}

async function refreshSummary() {
  const summary = await window.txw.getSummary();
  const latest = summary.latest;
  tianVotes.textContent = formatVote(latest?.tianXiweiVotes);
  topVotes.textContent = formatVote(latest?.top1Votes);
  const gap = latest ? latest.tianXiweiVotes - latest.top1Votes : 0;
  gapVotes.textContent = latest ? numberFormat.format(gap) : '-';
  updatedAt.textContent = formatDateTimeStack(latest?.checkedAt);
  emptyScoreHint.classList.toggle('hidden', Boolean(latest));
  return summary;
}

function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.showModal();
}

async function showHistory() {
  const summary = await window.txw.getSummary();
  const rows = summary.history.map((row) => `
    <tr>
      <td>${formatDateTime(row.checkedAt)}</td>
      <td>${formatVote(row.tianXiweiVotes)}</td>
      <td>${formatVote(row.top1Votes)}</td>
    </tr>
  `).join('');

  openModal(t('historyTitle'), `
    <table>
      <thead>
        <tr>
          <th>${t('time')}</th>
          <th>${t('tianXiwei')}</th>
          <th>${t('top1')}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="3">${t('noHistory')}</td></tr>`}</tbody>
    </table>
  `);
}

async function showAccounts() {
  const accounts = await window.txw.getAccounts();
  const activeAccounts = accounts.filter((account) => (account.status || '').toLowerCase() === 'active');
  const deactiveAccounts = accounts.filter((account) => (account.status || '').toLowerCase() === 'deactive');
  const totalVotes = accounts.reduce((sum, account) => sum + normalizeVoteCount(account.lastVoteCount), 0);

  const renderRows = (items) => items.map((account) => `
  <tr>
    <td>${account.email || '-'}</td>
    <td>${account.password || '-'}</td>
    <td>${formatDateTime(account.lastVotedAt)}</td>
    <td>${numberFormat.format(normalizeVoteCount(account.lastVoteCount))}</td>
    <td>${account.lastError || ''}</td>
    <td>
      <button
        type="button"
        class="miniButton"
        data-mark-voted-email="${account.email || ''}"
      >
        ${t('markVotedToday')}
      </button>
    </td>
  </tr>
`).join('');

  openModal(t('accountsTitle'), `
    <div class="accountsSummary">
      <div class="accountsSummaryCard">
        <span>${t('totalAccounts')}</span>
        <strong>${numberFormat.format(accounts.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('active')}</span>
        <strong>${numberFormat.format(activeAccounts.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('deactive')}</span>
        <strong>${numberFormat.format(deactiveAccounts.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('totalVotes')}</span>
        <strong>${numberFormat.format(totalVotes)}</strong>
      </div>
    </div>

    <div class="accountsTabs" role="tablist" aria-label="Trạng thái tài khoản">
      <button type="button" class="accountsTab is-active" data-tab-trigger="active">${t('active')} (${numberFormat.format(activeAccounts.length)})</button>
      <button type="button" class="accountsTab" data-tab-trigger="deactive">${t('deactive')} (${numberFormat.format(deactiveAccounts.length)})</button>
    </div>

    <div class="accountsTabPanel is-active" data-tab-panel="active">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>${t('password')}</th>
            <th>${t('lastVote')}</th>
            <th>${t('totalVotes')}</th>
            <th>${t('error')}</th>
            <th>${t('actions')}</th>
          </tr>
        </thead>
        <tbody>${renderRows(activeAccounts) || `<tr><td colspan="6">${t('noActiveAccounts')}</td></tr>`}</tbody>
      </table>
    </div>

    <div class="accountsTabPanel" data-tab-panel="deactive">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>${t('password')}</th>
            <th>${t('lastVote')}</th>
            <th>${t('totalVotes')}</th>
            <th>${t('error')}</th>
            <th>${t('actions')}</th>
          </tr>
        </thead>
        <tbody>${renderRows(deactiveAccounts) || `<tr><td colspan="6">${t('noDeactiveAccounts')}</td></tr>`}</tbody>
      </table>
    </div>
  `);

  const triggers = [...modalBody.querySelectorAll('[data-tab-trigger]')];
  const panels = [...modalBody.querySelectorAll('[data-tab-panel]')];
  const activateTab = (tabName) => {
    for (const trigger of triggers) {
      trigger.classList.toggle('is-active', trigger.dataset.tabTrigger === tabName);
    }
    for (const panel of panels) {
      panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
    }
  };
//
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => activateTab(trigger.dataset.tabTrigger));
  }
  for (const button of markButtons) {
    button.addEventListener('click', async () => {
      const email = button.dataset.markVotedEmail;

      const ok = window.confirm(t('markVotedConfirm').replace('{email}', email));
      if (!ok) return;

      await window.txw.markAccountVotedToday(email);
      await showAccounts();
    });
  }
  //
}

function showHelp() {
  openModal(t('helpTitle'), `
    <p><strong>${t('helpSignupTitle')}</strong>: ${t('helpSignupBody')}</p>
    <p><strong>${t('helpLoginTitle')}</strong>: ${t('helpLoginBody')}</p>
    <p><strong>${t('helpImportTitle')}</strong>: ${t('helpImportBody')}</p>
    <p><strong>${t('helpImportTemplateTitle')}</strong>: ${t('helpImportTemplateBody')}</p>
    <p><strong>${t('helpImportPrivacyTitle')}</strong>: ${t('helpImportPrivacyBody')}</p>
    <p><strong>${t('helpCaptchaTitle')}</strong>: ${t('helpCaptchaBody')}</p>
    <p><strong>${t('helpAccountTitle')}</strong>: ${t('helpAccountBody')}</p>
    <p><strong>${t('helpNoteTitle')}</strong>: ${t('helpNoteBody')}</p>
  `);
}

async function start(mode) {
  let options = {};
  if (mode === 'signup') {
    const count = await requestSignupCount();
    if (count === null) return;
    if (!Number.isInteger(count) || count < 1) {
      openModal(t('invalidCountTitle'), `<p>${t('invalidCountMessage')}</p>`);
      return;
    }
    options.count = count;
  }

  logOutput.textContent = '';
  setRunning(true, mode);
  try {
    await window.txw.start(mode, options);
  } catch (error) {
    appendLog(`\n${error.message || error}\n`);
  } finally {
    setRunning(false);
    await refreshSummary();
  }
}

function requestSignupCount() {
  signupCountInput.value = '1';
  countDialog.showModal();
  signupCountInput.focus();
  signupCountInput.select();

  return new Promise((resolve) => {
    let wrappedConfirm;
    let wrappedClose;
    let onKeyDown;

    const cleanup = () => {
      confirmCountDialog.removeEventListener('click', wrappedConfirm);
      closeCountDialog.removeEventListener('click', wrappedClose);
      countDialog.removeEventListener('cancel', wrappedClose);
      signupCountInput.removeEventListener('keydown', onKeyDown);
    };

    const onConfirm = () => {
      const count = Number(signupCountInput.value);
      countDialog.close();
      cleanup();
      resolve(count);
    };

    const onClose = () => {
      countDialog.close();
      cleanup();
      resolve(null);
    };

    onKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        wrappedConfirm();
      }
    };

    wrappedClose = () => {
      onClose();
    };

    wrappedConfirm = () => {
      onConfirm();
    };

    signupCountInput.addEventListener('keydown', onKeyDown);
    confirmCountDialog.addEventListener('click', wrappedConfirm, { once: true });
    closeCountDialog.addEventListener('click', wrappedClose, { once: true });
    countDialog.addEventListener('cancel', wrappedClose, { once: true });
  });
}

window.txw.onSetupStatus((value) => {
  setupStatus.textContent = t(value);
});

// 
function translateWorkerError(errorText) {
  const normalized = errorText.trim();

  if (normalized.includes('Không lấy được email từ temp-mail UI')) {
    return t('workerErrorTempMailReadFailed');
  }

  if (normalized.includes('page.goto: Target page, context or browser has been closed')) {
    return t('workerErrorBrowserClosed');
  }

  return errorText;
}

function translateWorkerLog(text) {
  const lines = text.split('\n');

  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed === 'Trình duyệt đã sẵn sàng.' || trimmed.includes('Tr矛nh duy')) {
      return t('browserReady');
    }

    if (trimmed.includes('Đang tải dữ liệu trình duyệt lần đầu') || trimmed.includes('膼ang t')) {
      return t('browserDownloading');
    }

    const signupMatch = trimmed.match(/signup-vote.*?(\d+)\/(\d+)/i);
    if (signupMatch && /Bắt đầu|B岷痶|Starting/i.test(trimmed)) {
      return t('workerSignupStarted')
        .replace('{current}', signupMatch[1])
        .replace('{total}', signupMatch[2]);
    }

    const signupCompleteMatch = trimmed.match(/signup-vote:\s*(\d+)\/(\d+)/i);
    if (signupCompleteMatch && /Hoàn tất|Ho脿n|complete/i.test(trimmed)) {
      return t('workerSignupComplete')
        .replace('{completed}', signupCompleteMatch[1])
        .replace('{total}', signupCompleteMatch[2]);
    }

    const loginCompleteMatch = trimmed.match(/login-vote:\s*(\d+)\/(\d+)/i);
    if (loginCompleteMatch) {
      return t('workerLoginComplete')
        .replace('{completed}', loginCompleteMatch[1])
        .replace('{total}', loginCompleteMatch[2]);
    }

    if (trimmed.includes('không dùng proxy') || trimmed.includes('kh么ng d霉ng proxy') || trimmed.includes('not using a separate proxy')) {
      return t('workerNoProxy');
    }

    const proxyMatch = trimmed.match(/proxy.*?:\s*(.+)$/i);
    if (proxyMatch && /Dùng|D霉ng|proxy/i.test(trimmed)) {
      return t('workerUsingProxy').replace('{proxy}', proxyMatch[1]);
    }

    if (trimmed.startsWith('[cloakbrowser] Newer Chromium available')) {
      return t('cloakNewerChromium');
    }

    if (trimmed.startsWith('[cloakbrowser] Update available')) {
      return t('cloakUpdateAvailable');
    }

    if (trimmed.startsWith('[cloakbrowser] Downloading from')) {
      return t('cloakDownloading');
    }

    if (trimmed.startsWith('[cloakbrowser] Download progress')) {
      return t('cloakDownloadProgress');
    }

    if (trimmed.startsWith('[cloakbrowser] Downloaded')) {
      return t('cloakDownloaded');
    }

    const tempMailProviderMatch = trimmed.match(/Temp mail provider.*?:\s*(.+)$/);
    if (tempMailProviderMatch) {
      return t('workerTempMailProvider').replace('{provider}', tempMailProviderMatch[1]);
    }

    const tempMailMatch = trimmed.match(/^Temp mail:\s*(.+)$/);
    if (tempMailMatch) {
      return t('workerTempMailAddress').replace('{email}', tempMailMatch[1]);
    }

    const signupErrorMatch = trimmed.match(/Lỗi signup-vote.*?(\d+):\s*(.+)$/);
    if (signupErrorMatch) {
      return t('workerSignupError')
        .replace('{run}', signupErrorMatch[1])
        .replace('{error}', translateWorkerError(signupErrorMatch[2]));
    }

    if (trimmed === 'Call log:') {
      return t('workerCallLog');
    }

    const navigatingMatch = trimmed.match(/navigating to "([^"]+)"/);
    if (navigatingMatch) {
      return t('workerNavigatingTo').replace('{url}', navigatingMatch[1]);
    }

    if (trimmed.includes('Đã điền form Bugs') || trimmed.includes('focus') && trimmed.includes('Captcha')) {
      return t('workerSignupFormFilled');
    }

    if (trimmed.includes('Vui lòng') && trimmed.includes('Captcha')) {
      return t('workerCaptchaRequired');
    }

    if (trimmed.includes('Đang chờ email xác thực')) {
      return t('workerWaitingEmail');
    }

    if (trimmed.includes('Không nhận được email xác thực')) {
      return t('workerEmailTimeout');
    }

    if (trimmed.includes('Đã bấm Email Authentication')) {
      return t('workerEmailAuthenticated');
    }

    if (trimmed.includes('Đã mở trang vote')) {
      return t('workerVotePageOpened');
    }

    const scoreMatch = trimmed.match(/TIAN Xiwei\s+([\d,]+),?\s*top 1\s+([\d,]+)/i);
    if (scoreMatch) {
      return t('workerScoreRecorded')
        .replace('{tian}', scoreMatch[1].replace(/,$/, ''))
        .replace('{top}', scoreMatch[2].replace(/,$/, ''));
    }

    if (trimmed.includes('Đã bấm Use All') || trimmed.includes('VOTING')) {
      return t('workerVoteSubmitted');
    }

    if (trimmed.includes('Không hoàn tất được bước vote')) {
      return t('workerVoteFailed');
    }

    if (trimmed.includes('Hoàn tất đăng ký + vote')) {
      return t('workerSignupVoteSaved');
    }

    const loginMatch = trimmed.match(/Đang login account:\s*(.+)$/);
    if (loginMatch) {
      return t('workerLoginAccount').replace('{email}', loginMatch[1]);
    }

    if (trimmed.includes('Đã mở đúng form Bugs')) {
      return t('workerLoginFormSubmitted');
    }

    if (trimmed.includes('Không có account cũ nào cần vote hôm nay')) {
      return t('workerNoEligibleAccounts');
    }

    const dialogMatch = trimmed.match(/^💬 Phát hiện thông báo từ trang web: \[(.+)\]$/);
    if (dialogMatch) {
      return t('workerWebsiteDialog').replace('{message}', dialogMatch[1]);
    }

    return line;
  }).join('\n');
}

window.txw.onLog((value) => {
  appendLog(translateWorkerLog(value));
});

window.txw.onRunState((state) => {
  setRunning(state.running, state.mode);
});

window.txw.onDataUpdated(async () => {
  await refreshSummary();
});

//
importAccountsButton.addEventListener('click', async () => {
  const result = await window.txw.importAccounts();

  if (!result || result.cancelled) {
    openModal(t('importDoneTitle'), `<p>${t('importCancelled')}</p>`);
    return;
  }

  const message = t('importDoneMessage')
    .replace('{created}', result.created)
    .replace('{updated}', result.updated)
    .replace('{skipped}', result.skipped);

  openModal(t('importDoneTitle'), `<p>${message}</p>`);
  await refreshSummary();
});
//
downloadTemplateButton?.addEventListener('click', async () => {
  const result = await window.txw.downloadAccountsTemplate(currentLanguage);

  if (!result || result.cancelled) {
    openModal(t('downloadTemplateDoneTitle'), `<p>${t('downloadTemplateCancelled')}</p>`);
    return;
  }

  openModal(
    t('downloadTemplateDoneTitle'),
    `<p>${t('downloadTemplateDoneMessage').replace('{path}', result.filePath)}</p>`
  );
});

languageSelect?.addEventListener('change', (event) => {
  applyLanguage(event.target.value);
});
signupButton.addEventListener('click', () => start('signup'));
loginButton.addEventListener('click', () => start('login'));
stopButton.addEventListener('click', () => window.txw.stop());
historyButton.addEventListener('click', showHistory);
accountsButton.addEventListener('click', showAccounts);
document.getElementById('helpButton').addEventListener('click', showHelp);
document.getElementById('helpButtonMain').addEventListener('click', showHelp);
document.getElementById('closeModal').addEventListener('click', () => modal.close());

(async () => {
  applyLanguage(currentLanguage);

  try {
    await window.txw.setup();
  } catch (error) {
    setupStatus.textContent = t('setupFailed');
    console.error(error);
  }

  await refreshSummary();
  splash.classList.add('hidden');
  appRoot.classList.remove('hidden');
  setIdleLog();
})();