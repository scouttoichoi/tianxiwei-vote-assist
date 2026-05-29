const splash = document.getElementById('splash');
const appRoot = document.getElementById('app');
const setupStatus = document.getElementById('setupStatus');
const languageSelect = document.getElementById('languageSelect');

// Selected Instance DOMs
const selectedInstanceName = document.getElementById('selectedInstanceName');
const selectedInstanceProxy = document.getElementById('selectedInstanceProxy');
const tianVotes = document.getElementById('tianVotes');
const topVotes = document.getElementById('topVotes');
const gapVotes = document.getElementById('gapVotes');
const updatedAt = document.getElementById('updatedAt');
const emptyScoreHint = document.getElementById('emptyScoreHint');
const logOutput = document.getElementById('logOutput');
const emulatorScanStatus = document.getElementById('emulatorScanStatus');
const emulatorOptions = document.getElementById('emulatorOptions');

// Dialog & Modal DOMs
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const countDialog = document.getElementById('countDialog');
const signupCountInput = document.getElementById('signupCountInput');
const confirmCountDialog = document.getElementById('confirmCountDialog');
const closeCountDialog = document.getElementById('closeCountDialog');

// Instance Form DOMs
const instanceFormDialog = document.getElementById('instanceFormDialog');
const instanceFormTitle = document.getElementById('instanceFormTitle');
const instanceNameInput = document.getElementById('instanceNameInput');
const instanceProxyInput = document.getElementById('instanceProxyInput');
const confirmInstanceFormDialog = document.getElementById('confirmInstanceFormDialog');
const closeInstanceFormDialog = document.getElementById('closeInstanceFormDialog');

// Action Buttons
const signupButton = document.getElementById('signupButton');
const signupManualButton = document.getElementById('signupManualButton');
const signupAliasButton = document.getElementById('signupAliasButton');
const loginButton = document.getElementById('loginButton');
const adsButton = document.getElementById('adsButton');
const accountsButton = document.getElementById('accountsButton');
const importAccountsButton = document.getElementById('importAccountsButton');
const exportAccountsButton = document.getElementById('exportAccountsButton');
const downloadTemplateButton = document.getElementById('downloadTemplateButton');
const historyButton = document.getElementById('historyButton');
const helpButtonMain = document.getElementById('helpButtonMain');
const helpButton = document.getElementById('helpButton');

// Import Choice Dialog
const importChoiceDialog = document.getElementById('importChoiceDialog');
const closeImportChoiceDialog = document.getElementById('closeImportChoiceDialog');
const confirmImportChoiceDialog = document.getElementById('confirmImportChoiceDialog');

// Export Choice Dialog
const exportChoiceDialog = document.getElementById('exportChoiceDialog');
const closeExportChoiceDialog = document.getElementById('closeExportChoiceDialog');
const confirmExportChoiceDialog = document.getElementById('confirmExportChoiceDialog');

// Download Template Dialog
const templateChoiceDialog = document.getElementById('templateChoiceDialog');
const closeTemplateChoiceDialog = document.getElementById('closeTemplateChoiceDialog');
const confirmTemplateChoiceDialog = document.getElementById('confirmTemplateChoiceDialog');
const rootEmailContainer = document.getElementById('rootEmailContainer');
const templateRootEmail = document.getElementById('templateRootEmail');
const checkAliasVariantsButton = document.getElementById('checkAliasVariantsButton');
const aliasVariantSummary = document.getElementById('aliasVariantSummary');
const aliasConfigPanel = document.getElementById('aliasConfigPanel');
const templateAliasLimit = document.getElementById('templateAliasLimit');
const aliasRemainingSummary = document.getElementById('aliasRemainingSummary');
const aliasSuggestedSplitSummary = document.getElementById('aliasSuggestedSplitSummary');
const templateExcludeInstancePicker = document.getElementById('templateExcludeInstancePicker');
const templateExcludeInstanceSummary = document.getElementById('templateExcludeInstanceSummary');
const templateExcludeAllInstances = document.getElementById('templateExcludeAllInstances');
const templateExcludeInstanceOptions = document.getElementById('templateExcludeInstanceOptions');
const templateExcludedAliases = document.getElementById('templateExcludedAliases');

// Emulator Choice DOMs
const emulatorDialog = document.getElementById('emulatorDialog');
const closeEmulatorDialog = document.getElementById('closeEmulatorDialog');
const confirmEmulatorDialog = document.getElementById('confirmEmulatorDialog');

// Global controls
const addInstanceButton = document.getElementById('addInstanceButton');
const runAllSignupButton = document.getElementById('runAllSignupButton');
const runAllSignupManualButton = document.getElementById('runAllSignupManualButton');
const runAllSignupAliasButton = document.getElementById('runAllSignupAliasButton');
const runAllLoginButton = document.getElementById('runAllLoginButton');
const stopAllButton = document.getElementById('stopAllButton');

// Global states
let currentLanguage = localStorage.getItem('language') || 'vi';
let instances = [];
let selectedInstanceId = null;
const instanceLogs = new Map(); // key: instanceId, value: logText
let editingInstanceId = null; // null if creating, string id if editing
let emulatorPickerInstanceId = '';
let accountSelectionState = {
  active: new Set(),
  notRegister: new Set(),
  deactive: new Set()
};
let accountModalActiveTab = 'active';
let templateAliasVariantCount = 0;

function t(key) {
  return window.I18N?.[currentLanguage]?.[key] || window.I18N?.en?.[key] || key;
}

function calculateAliasVariantCount(rootEmail) {
  const parts = String(rootEmail || '').trim().split('@');
  if (parts.length !== 2) return 0;
  const localPart = parts[0].replace(/\./g, '');
  if (!localPart) return 0;
  if (localPart.length === 1) return 1;
  return 2 ** (localPart.length - 1);
}

function normalizeEmailParts(email) {
  const parts = String(email || '').trim().toLowerCase().split('@');
  if (parts.length !== 2) return null;
  return {
    local: parts[0],
    localWithoutDots: parts[0].replace(/\./g, ''),
    domain: parts[1]
  };
}

function isAliasVariantOfRoot(rootEmail, candidateEmail) {
  const root = normalizeEmailParts(rootEmail);
  const candidate = normalizeEmailParts(candidateEmail);
  if (!root || !candidate) return false;
  return root.domain === candidate.domain && root.localWithoutDots === candidate.localWithoutDots;
}

function getSelectedExcludedInstanceIds() {
  if (!templateExcludeInstanceOptions) return [];
  return [...templateExcludeInstanceOptions.querySelectorAll('input[type="checkbox"][data-instance-id]:checked')]
    .map((input) => input.dataset.instanceId)
    .filter(Boolean);
}

function updateExcludedInstanceSummary() {
  if (!templateExcludeInstanceSummary) return;
  const selectedIds = getSelectedExcludedInstanceIds();
  if (!selectedIds.length) {
    templateExcludeInstanceSummary.textContent = t('excludedInstanceNone');
    return;
  }
  if (selectedIds.length === instances.length) {
    templateExcludeInstanceSummary.textContent = t('allInstancesSelected');
    return;
  }
  const selectedNames = selectedIds
    .map((id) => instances.find((inst) => inst.id === id)?.name || id)
    .slice(0, 2);
  const remaining = selectedIds.length - selectedNames.length;
  templateExcludeInstanceSummary.textContent = remaining > 0
    ? `${selectedNames.join(', ')} +${remaining}`
    : selectedNames.join(', ');
}

function positionExcludedInstancePicker() {
  if (!templateExcludeInstancePicker) return;
  const menu = templateExcludeInstancePicker.querySelector('.instanceExcludeMenu');
  if (!menu || !templateExcludeInstancePicker.open) return;

  templateExcludeInstancePicker.classList.remove('open-upwards');
  menu.style.maxHeight = '';

  const rect = templateExcludeInstancePicker.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const gap = 12;
  const summaryGap = 6;
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap);
  const spaceAbove = Math.max(0, rect.top - gap);
  const prefersUpwards = spaceBelow < 180 && spaceAbove > spaceBelow;
  const availableSpace = Math.max(120, Math.min(180, (prefersUpwards ? spaceAbove : spaceBelow) - summaryGap));

  menu.style.maxHeight = `${availableSpace}px`;
  templateExcludeInstancePicker.classList.toggle('open-upwards', prefersUpwards);
}

async function updateAliasExportSummary() {
  if (!aliasRemainingSummary || !aliasSuggestedSplitSummary) return;
  if (!templateAliasVariantCount) {
    aliasRemainingSummary.textContent = '';
    aliasSuggestedSplitSummary.textContent = '';
    return;
  }

  const manualExcluded = new Set(
    String(templateExcludedAliases?.value || '')
      .split(';')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

  const selectedInstanceIds = getSelectedExcludedInstanceIds();
  for (const instanceId of selectedInstanceIds) {
    const accounts = await window.txw.getInstanceAccounts(instanceId);
    for (const account of accounts) {
      if (account.email) {
        manualExcluded.add(String(account.email).trim().toLowerCase());
      }
    }
  }

  const rootEmail = templateRootEmail?.value || '';
  const matchedExcludedCount = [...manualExcluded].filter((email) => isAliasVariantOfRoot(rootEmail, email)).length;
  const remaining = Math.max(0, templateAliasVariantCount - matchedExcludedCount);
  aliasRemainingSummary.textContent = t('aliasRemainingCountMessage').replace('{count}', new Intl.NumberFormat('en-US').format(remaining));

  const selectedInstanceCount = selectedInstanceIds.length;
  if (selectedInstanceCount > 0 && remaining > 0) {
    const suggestedEach = Math.max(1, Math.floor(remaining / selectedInstanceCount));
    aliasSuggestedSplitSummary.textContent = t('aliasSuggestedSplitMessage')
      .replace('{instances}', new Intl.NumberFormat('en-US').format(selectedInstanceCount))
      .replace('{each}', new Intl.NumberFormat('en-US').format(suggestedEach));
  } else {
    aliasSuggestedSplitSummary.textContent = '';
  }
}

function applyLanguage(language) {
  currentLanguage = language;
  localStorage.setItem('language', language);
  document.documentElement.lang = language;
  updateFormatters(language);

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });

  const imapInputUser = document.getElementById('imapInputUser');
  const imapInputPass = document.getElementById('imapInputPass');
  if (imapInputUser) imapInputUser.placeholder = t('imapInputUserPlaceholder') || 'username@gmail.com';
  if (imapInputPass) imapInputPass.placeholder = t('imapInputPassPlaceholder') || 'App Password (16 chars)';

  if (languageSelect) {
    languageSelect.value = language;
  }

  // Refresh instances to translate dynamic status badges
  renderInstancesList();

  if (selectedInstanceId) {
    const selected = instances.find((inst) => inst.id === selectedInstanceId);
    if (selected) {
      updateSelectedInstanceDashboard(selected);
    } else {
      const log = instanceLogs.get(selectedInstanceId) || '';
      if (!log.trim()) {
        logOutput.textContent = t('idleLog');
      }
    }
  }
}

const numberFormat = new Intl.NumberFormat('en-US');
let dateTimeFormat;
let dateFormat;
let timeFormat;

function updateFormatters(lang) {
  const localeMap = {
    vi: 'vi-VN',
    zh: 'zh-CN',
    en: 'en-US'
  };
  const locale = localeMap[lang] || 'vi-VN';
  dateTimeFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  dateFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// Initialize formatters
updateFormatters(currentLanguage);

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

function appendInstanceLog(instanceId, text) {
  const currentLog = instanceLogs.get(instanceId) || '';
  const nextLog = currentLog + text;
  instanceLogs.set(instanceId, nextLog);

  if (selectedInstanceId === instanceId) {
    logOutput.textContent = nextLog;
    logOutput.scrollTop = logOutput.scrollHeight;
  }
}

function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;

  if (!modal.open) {
    modal.showModal();
  }
}

// Render Instance List Table
function renderInstancesList() {
  const tbody = document.getElementById('instancesTableBody');
  const noInstancesHint = document.getElementById('noInstancesHint');
  tbody.innerHTML = '';

  if (instances.length === 0) {
    noInstancesHint.classList.remove('hidden');
    return;
  }
  noInstancesHint.classList.add('hidden');

  instances.forEach((inst) => {
    const tr = document.createElement('tr');
    tr.dataset.id = inst.id;
    if (inst.id === selectedInstanceId) {
      tr.classList.add('is-selected');
    }
    if (inst.running) {
      tr.classList.add('is-running');
    }

    // Determine badge status
    let statusClass = 'idle';
    let statusText = t('idle');
    const log = instanceLogs.get(inst.id) || '';
    if (inst.running) {
      statusClass = 'running';
      statusText = t('running');
      if (inst.runningMode === 'ads') {
        statusClass = 'runningAds';
        statusText = t('runningAds');
      } else if (inst.runningMode === 'signup-manual') {
        statusClass = 'waitingCaptcha';
        statusText = t('waitingCaptcha');
      } else if (inst.runningMode === 'signup' || inst.runningMode === 'login') {
        if (/Vui lòng tự nhập|nhập tay|chờ nhập tay/i.test(log)) {
          statusClass = 'waitingCaptcha';
          statusText = t('waitingCaptcha');
        }
      }
    }

    const proxyStr = inst.proxy ? inst.proxy.replace(/^[a-zA-Z0-9]+:\/\//, '') : '-';

    tr.innerHTML = `
      <td><strong>${inst.name}</strong></td>
      <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${proxyStr}</td>
      <td class="textCenter">${inst.votedTodayCount} / ${inst.totalAccounts}</td>
      <td class="textCenter">
        <span class="badgeStatus ${statusClass}">${statusText}</span>
      </td>
      <td class="textCenter">
        <div class="rowActions" onclick="event.stopPropagation()">
          ${inst.running ?
        `<button class="btnRowStop" data-action="stop" title="${t('stop')}">⏹</button>` :
        ''
      }
          <button class="btnRowEdit" data-action="edit" title="${t('edit')}">✏️</button>
          <button class="btnRowDelete" data-action="delete" title="${t('delete')}">🗑</button>
        </div>
      </td>
    `;

    tr.addEventListener('click', () => selectInstance(inst.id));

    // Event listeners inside the row actions
    tr.querySelectorAll('.rowActions button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        handleRowAction(inst.id, action);
      });
    });

    tbody.appendChild(tr);
  });
}

// Refresh Instances List from main.cjs
async function refreshInstances() {
  instances = await window.txw.getInstances();
  renderInstancesList();

  if (selectedInstanceId) {
    const selected = instances.find((inst) => inst.id === selectedInstanceId);
    if (selected) {
      updateSelectedInstanceDashboard(selected);
    } else {
      selectedInstanceId = null;
      showEmptySelection();
    }
  }
}

function showEmptySelection() {
  document.getElementById('emptySelection').classList.remove('hidden');
  document.getElementById('instanceDashboard').classList.add('hidden');
}

// Select specific instance
async function selectInstance(id) {
  selectedInstanceId = id;
  const selected = instances.find((inst) => inst.id === id);
  if (!selected) return;

  // Visual selection feedback
  document.querySelectorAll('#instancesTableBody tr').forEach((tr) => {
    tr.classList.toggle('is-selected', tr.dataset.id === id);
  });

  document.getElementById('emptySelection').classList.add('hidden');
  document.getElementById('instanceDashboard').classList.remove('hidden');

  updateSelectedInstanceDashboard(selected);
}

// Update Active Instance Details
async function updateSelectedInstanceDashboard(inst) {
  selectedInstanceName.textContent = inst.name;
  selectedInstanceProxy.textContent = inst.proxy || '-';

  // Load vote summary for this instance
  const summary = await window.txw.getInstanceSummary(inst.id);
  const latest = summary.latest;
  tianVotes.textContent = formatVote(latest?.tianXiweiVotes);
  topVotes.textContent = formatVote(latest?.top1Votes);
  const gap = latest ? latest.tianXiweiVotes - latest.top1Votes : 0;
  gapVotes.textContent = latest ? numberFormat.format(gap) : '-';
  updatedAt.textContent = formatDateTimeStack(latest?.checkedAt);
  emptyScoreHint.classList.toggle('hidden', Boolean(latest));

  // Load log text
  const log = instanceLogs.get(inst.id) || '';
  logOutput.textContent = log || t('idleLog');
  logOutput.scrollTop = logOutput.scrollHeight;

  // Cập nhật trạng thái các nút bấm trong dashboard dựa trên trạng thái chạy
  if (inst.running) {
    // Vô hiệu hóa các nút khác, chuyển nút đang chạy thành nút Dừng
    signupButton.disabled = inst.runningMode !== 'signup';
    signupManualButton.disabled = inst.runningMode !== 'signup-manual';
    signupAliasButton.disabled = inst.runningMode !== 'signup-alias';
    loginButton.disabled = inst.runningMode !== 'login';
    adsButton.disabled = inst.runningMode !== 'ads';

    if (inst.runningMode === 'signup') {
      signupButton.innerHTML = `<span>${t('stopSignup')}</span><small>${t('stopSignupHint')}</small>`;
      signupButton.classList.add('btnDashboardStop');
    } else if (inst.runningMode === 'signup-manual') {
      signupManualButton.innerHTML = `<span>${t('stopSignupManual')}</span><small>${t('stopSignupManualHint')}</small>`;
      signupManualButton.classList.add('btnDashboardStop');
    } else if (inst.runningMode === 'signup-alias') {
      signupAliasButton.innerHTML = `<span>${t('stopSignupAlias')}</span><small>${t('stopSignupAliasHint')}</small>`;
      signupAliasButton.classList.add('btnDashboardStop');
    } else if (inst.runningMode === 'login') {
      loginButton.innerHTML = `<span>${t('stopLogin')}</span><small>${t('stopLoginHint')}</small>`;
      loginButton.classList.add('btnDashboardStop');
    } else if (inst.runningMode === 'ads') {
      adsButton.innerHTML = `<span>${t('stopAds')}</span><small>${t('stopAdsHint')}</small>`;
      adsButton.classList.add('btnDashboardStop');
    }
  } else {
    // Trở lại trạng thái bình thường
    signupButton.disabled = false;
    signupManualButton.disabled = false;
    signupAliasButton.disabled = false;
    loginButton.disabled = false;
    adsButton.disabled = false;

    signupButton.classList.remove('btnDashboardStop');
    signupManualButton.classList.remove('btnDashboardStop');
    signupAliasButton.classList.remove('btnDashboardStop');
    loginButton.classList.remove('btnDashboardStop');
    adsButton.classList.remove('btnDashboardStop');

    signupButton.innerHTML = `<span>${t('signup')}</span><small>${t('signupHint')}</small>`;
    signupManualButton.innerHTML = `<span>${t('signupManual')}</span><small>${t('signupManualHint')}</small>`;
    signupAliasButton.innerHTML = `<span>${t('signupAlias')}</span><small>${t('signupAliasHint')}</small>`;
    loginButton.innerHTML = `<span>${t('loginVote')}</span><small>${t('loginVoteHint')}</small>`;
    adsButton.innerHTML = `<span>${t('farmAds')}</span><small>${t('farmAdsHint')}</small>`;
  }
}

// Handle instance table action button clicks
async function handleRowAction(instanceId, action) {
  const inst = instances.find((i) => i.id === instanceId);
  if (!inst) return;

  if (action === 'start-signup') {
    startInstanceProcess(instanceId, 'signup');
  } else if (action === 'start-login') {
    startInstanceProcess(instanceId, 'login');
  } else if (action === 'stop') {
    console.log(`[UI] handleRowAction 'stop' for instanceId: "${instanceId}"`);
    try {
      const res = await window.txw.stopInstance(instanceId);
      console.log(`[UI] handleRowAction 'stop' result:`, res);
    } catch (err) {
      console.error(`[UI] Error in handleRowAction 'stop':`, err);
    }
  } else if (action === 'edit') {
    openInstanceForm(instanceId);
  } else if (action === 'delete') {
    const confirmMsg = t('confirmDeleteInstance').replace('{name}', inst.name);
    if (window.confirm(confirmMsg)) {
      await window.txw.deleteInstance(instanceId);
    }
  }
}

// Open Instance edit/create form
function openInstanceForm(instanceId = null) {
  editingInstanceId = instanceId;
  if (instanceId) {
    const inst = instances.find((i) => i.id === instanceId);
    instanceFormTitle.textContent = t('editInstanceTitle');
    instanceNameInput.value = inst.name;
    instanceProxyInput.value = inst.proxy;
  } else {
    instanceFormTitle.textContent = t('createInstanceTitle');
    instanceNameInput.value = '';
    instanceProxyInput.value = '';
  }
  instanceFormDialog.showModal();
}

// Save Instance form
async function saveInstanceForm() {
  const name = instanceNameInput.value.trim();
  const proxy = instanceProxyInput.value.trim();

  if (editingInstanceId) {
    await window.txw.updateInstance(editingInstanceId, name, proxy);
  } else {
    await window.txw.createInstance(name, proxy);
  }

  instanceFormDialog.close();
}

// Start specific instance process
async function startInstanceProcess(instanceId, mode, optionsOverride = null, autoSelect = true) {
  let options = optionsOverride || {};

  if ((mode === 'signup' || mode === 'signup-manual' || mode === 'signup-alias') && !optionsOverride) {
    const isAlias = mode === 'signup-alias';
    const count = await requestSignupCount(isAlias);
    if (count === null) return;
    if (!Number.isInteger(count) || count < 1) {
      openModal(t('invalidCountTitle'), `<p>${t('invalidCountMessage')}</p>`);
      return;
    }
    options.count = count;
  }

  if (mode === 'signup-manual') {
    options.manualCaptcha = true;
  }

  // Clear previous log for clean start
  instanceLogs.set(instanceId, '');
  if (selectedInstanceId === instanceId) {
    logOutput.textContent = '';
  }

  let startLogText = '';
  if (mode === 'login') {
    startLogText = t('runningLogin');
  } else if (mode === 'ads') {
    startLogText = t('runningAds');
  } else if (mode === 'signup-manual') {
    startLogText = t('runningSignupManual');
  } else if (mode === 'signup-alias') {
    startLogText = t('runningSignupAlias');
  } else {
    startLogText = t('runningSignup');
  }
  appendInstanceLog(instanceId, `${startLogText}\n`);
  appendInstanceLog(instanceId, `[DEBUG UI] startInstanceProcess: instanceId = ${instanceId}, selected = ${selectedInstanceId}\n`);

  // Optimistic UI Update
  const inst = instances.find((i) => i.id === instanceId);
  appendInstanceLog(instanceId, `[DEBUG UI] inst object found: ${!!inst}\n`);
  if (inst) {
    inst.running = true;
    inst.runningMode = mode;
  }

  // --- TRỰC TIẾP CẬP NHẬT DOM ĐỒNG BỘ (Instant Visual Feedback) ---
  // 1. Cập nhật dòng trong bảng danh sách
  const row = document.querySelector(`#instancesTableBody tr[data-id="${instanceId}"]`);
  appendInstanceLog(instanceId, `[DEBUG UI] Row found: ${!!row}, instances size: ${instances.length}\n`);
  if (row) {
    row.classList.add('is-running');
    const badge = row.querySelector('.badgeStatus');
    if (badge) {
      let optClass = 'running';
      let optText = t('running');
      if (mode === 'ads') {
        optClass = 'runningAds';
        optText = t('runningAds');
      } else if (mode === 'signup-manual') {
        optClass = 'waitingCaptcha';
        optText = t('waitingCaptcha');
      }
      badge.className = `badgeStatus ${optClass}`;
      badge.textContent = optText;
    }
    const rowActions = row.querySelector('.rowActions');
    if (rowActions && !rowActions.querySelector('.btnRowStop')) {
      const stopBtn = document.createElement('button');
      stopBtn.className = 'btnRowStop';
      stopBtn.dataset.action = 'stop';
      stopBtn.title = t('stop') || 'Dừng';
      stopBtn.textContent = '⏹';
      stopBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        console.log(`[UI] stopBtn row clicked for instanceId: "${instanceId}"`);
        try {
          const res = await window.txw.stopInstance(instanceId);
          console.log(`[UI] stopInstance from row result:`, res);
        } catch (err) {
          console.error(`[UI] Error stopping instance from row:`, err);
        }
      });
      rowActions.insertBefore(stopBtn, rowActions.firstChild);
    }
  }

  // 2. Cập nhật trực tiếp các nút trên Dashboard bên phải
  appendInstanceLog(instanceId, `[DEBUG UI] selectedInstanceId === instanceId is ${selectedInstanceId === instanceId}\n`);
  if (selectedInstanceId === instanceId) {
    signupButton.disabled = mode !== 'signup';
    signupManualButton.disabled = mode !== 'signup-manual';
    signupAliasButton.disabled = mode !== 'signup-alias';
    loginButton.disabled = mode !== 'login';
    adsButton.disabled = mode !== 'ads';

    if (mode === 'signup') {
      signupButton.innerHTML = `<span>${t('stopSignup')}</span><small>${t('stopSignupHint')}</small>`;
      signupButton.classList.add('btnDashboardStop');
    } else if (mode === 'signup-manual') {
      signupManualButton.innerHTML = `<span>${t('stopSignupManual')}</span><small>${t('stopSignupManualHint')}</small>`;
      signupManualButton.classList.add('btnDashboardStop');
    } else if (mode === 'signup-alias') {
      signupAliasButton.innerHTML = `<span>${t('stopSignupAlias')}</span><small>${t('stopSignupAliasHint')}</small>`;
      signupAliasButton.classList.add('btnDashboardStop');
    } else if (mode === 'login') {
      loginButton.innerHTML = `<span>${t('stopLogin')}</span><small>${t('stopLoginHint')}</small>`;
      loginButton.classList.add('btnDashboardStop');
    } else if (mode === 'ads') {
      adsButton.innerHTML = `<span>${t('stopAds')}</span><small>${t('stopAdsHint')}</small>`;
      adsButton.classList.add('btnDashboardStop');
    }
  }

  try {
    // Select this instance so the user can watch the logs
    if (autoSelect) {
      selectInstance(instanceId);
    }

    const result = await window.txw.startInstance(instanceId, mode, options);
    if (result && result.ok === false && result.error) {
      appendInstanceLog(instanceId, `\n${result.error}\n`);
    }
  } catch (error) {
    appendInstanceLog(instanceId, `\n${error.message || error}\n`);
  } finally {
    await refreshInstances();
  }
}

function requestSignupCount(isAlias = false) {
  const titleKey = isAlias ? 'signupAliasCountTitle' : 'signupCountTitle';
  const questionKey = isAlias ? 'signupAliasCountQuestion' : 'signupCountQuestion';

  const titleEl = countDialog.querySelector('.modalHeader strong');
  const questionEl = countDialog.querySelector('#countDialogBody p');
  if (titleEl) titleEl.textContent = t(titleKey);
  if (questionEl) questionEl.textContent = t(questionKey);

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

async function instanceHasNotRegisterAccounts(instanceId) {
  const accounts = await window.txw.getInstanceAccounts(instanceId);
  return accounts.some((account) => (account?.status || '').toLowerCase() === 'not-register');
}

// Show Vote Account Tables
async function showAccounts() {
  if (!selectedInstanceId) return;

  const previousActivePanel = modalBody.querySelector('[data-tab-panel].is-active');
  const previousPanelScrollTop = previousActivePanel?.scrollTop || 0;
  const accounts = await window.txw.getInstanceAccounts(selectedInstanceId);
  const totalVotes = accounts.reduce((sum, account) => sum + normalizeVoteCount(account.lastVoteCount), 0);
  const groupedAccounts = {
    active: accounts.filter((account) => {
      const s = (account.status || 'active').toLowerCase();
      return s === 'active';
    }),
    notRegister: accounts.filter((account) => (account.status || '').toLowerCase() === 'not-register'),
    deactive: accounts.filter((account) => (account.status || '').toLowerCase() === 'deactive')
  };
  for (const [tabKey, items] of Object.entries(groupedAccounts)) {
    const validEmails = new Set(items.map((account) => account.email).filter(Boolean));
    accountSelectionState[tabKey] = new Set(
      [...(accountSelectionState[tabKey] || new Set())].filter((email) => validEmails.has(email))
    );
  }

  const tabEmptyKeys = {
    active: 'noActiveAccounts',
    notRegister: 'noNotRegisterAccounts',
    deactive: 'noDeactiveAccounts'
  };

  const activeTabState = accountModalActiveTab || 'active';
  const previousSearch = modalBody.querySelector('[data-account-search]')?.value || '';
  const selectedEmails = new Set(accountSelectionState[activeTabState] || []);

  const filterAccountsByKeyword = (items, keyword) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return !normalizedKeyword
      ? items
      : items.filter((account) =>
        [account.email, account.password, account.lastError]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedKeyword))
      );
  };

  const filteredItemsForActiveTab = filterAccountsByKeyword(groupedAccounts[activeTabState] || [], previousSearch);

  const getBulkActions = (tabType) => {
    const selectedCount = (accountSelectionState[tabType] || new Set()).size;
    if (!selectedCount) return [];
    if (tabType === 'active') {
      return [
        { action: 'mark-selected', label: `${t('bulkMarkVotedToday')} (${selectedCount})`, tone: 'primary' },
        { action: 'deactivate-selected', label: `${t('bulkDeactivateAccounts')} (${selectedCount})`, tone: 'danger' },
        { action: 'move-selected-not-register', label: `${t('bulkMoveToNotRegister')} (${selectedCount})`, tone: 'muted' }
      ];
    }
    if (tabType === 'deactive') {
      return [
        { action: 'activate-selected', label: `${t('bulkActivateAccounts')} (${selectedCount})`, tone: 'success' },
        { action: 'move-selected-not-register', label: `${t('bulkMoveToNotRegister')} (${selectedCount})`, tone: 'muted' }
      ];
    }
    if (tabType === 'notRegister') {
      return [
        { action: 'delete-selected', label: `${t('deleteSelectedAccounts')} (${selectedCount})`, tone: 'danger' }
      ];
    }
    return [];
  };

  const getBulkActionConfigs = (tabType) => {
    if (tabType === 'active') {
      return [
        { action: 'mark-selected', label: t('bulkMarkVotedToday'), tone: 'primary' },
        { action: 'deactivate-selected', label: t('bulkDeactivateAccounts'), tone: 'danger' },
        { action: 'move-selected-not-register', label: t('bulkMoveToNotRegister'), tone: 'muted' }
      ];
    }
    if (tabType === 'deactive') {
      return [
        { action: 'activate-selected', label: t('bulkActivateAccounts'), tone: 'success' },
        { action: 'move-selected-not-register', label: t('bulkMoveToNotRegister'), tone: 'muted' }
      ];
    }
    if (tabType === 'notRegister') {
      return [
        { action: 'delete-selected', label: t('deleteSelectedAccounts'), tone: 'danger' }
      ];
    }
    return [];
  };

  const getActionDescriptors = (tabType, account) => {
    const email = account.email || '';
    if (tabType === 'active') {
      return [
        { type: 'mark', icon: '✓', title: t('markVotedToday'), email },
        { type: 'toggle', icon: '⏸', title: t('deactivateAccount'), email, newStatus: 'deactive', tone: 'danger' },
        { type: 'toggle', icon: '↺', title: t('moveToNotRegister'), email, newStatus: 'not-register', tone: 'muted' }
      ];
    }
    if (tabType === 'notRegister') {
      return [
        { type: 'delete', icon: '🗑', title: t('deleteNotRegisterAccount'), email, tone: 'danger' }
      ];
    }
    if (tabType === 'deactive') {
      return [
        { type: 'toggle', icon: '▶', title: t('activateAccount'), email, newStatus: 'active', tone: 'success' },
        { type: 'toggle', icon: '↺', title: t('moveToNotRegister'), email, newStatus: 'not-register', tone: 'muted' }
      ];
    }
    return [];
  };

  const renderActionButton = (action) => {
    const sharedAttrs = [
      `type="button"`,
      `class="accountActionBtn${action.tone ? ` is-${action.tone}` : ''}"`,
      `title="${action.title}"`,
      `aria-label="${action.title}"`,
      `data-action-title="${action.title}"`
    ];

    if (action.type === 'mark') {
      sharedAttrs.push(`data-mark-voted-email="${action.email}"`);
    } else if (action.type === 'delete') {
      sharedAttrs.push(`data-delete-account-email="${action.email}"`);
    } else {
      sharedAttrs.push(`data-toggle-status-email="${action.email}"`);
      sharedAttrs.push(`data-new-status="${action.newStatus}"`);
    }

    return `<button ${sharedAttrs.join(' ')}><span aria-hidden="true">${action.icon}</span></button>`;
  };

  const renderRows = (items, tabType, searchValue = '') => {
    const filtered = filterAccountsByKeyword(items, searchValue);

    if (!filtered.length) {
      const emptyKey = searchValue.trim() ? 'noSearchResults' : tabEmptyKeys[tabType];
      return `<tr><td colspan="6">${t(emptyKey)}</td></tr>`;
    }

    return filtered.map((account) => `
      <tr>
        <td class="accountCheckboxCell">
          <input
            type="checkbox"
            class="accountRowCheckbox"
            data-account-select-email="${account.email || ''}"
            data-account-select-tab="${tabType}"
            ${selectedEmails.has(account.email || '') ? 'checked' : ''}
          >
        </td>
        <td>${account.email || '-'}</td>
        <td>${account.password || '-'}</td>
        <td>${formatDateTime(account.lastVotedAt)}</td>
        <td>${numberFormat.format(normalizeVoteCount(account.lastVoteCount))}</td>
        <td>${account.lastError || ''}</td>
        <td>
          <div class="accountActions">
            ${getActionDescriptors(tabType, account).map(renderActionButton).join('') || '<span class="accountActionEmpty">-</span>'}
          </div>
        </td>
      </tr>
    `).join('');
  };

  openModal(t('accountsTitle'), `
    <div class="accountsSummary" style="grid-template-columns: repeat(5, minmax(0, 1fr));">
      <div class="accountsSummaryCard">
        <span>${t('totalAccounts')}</span>
        <strong>${numberFormat.format(accounts.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('active')}</span>
        <strong>${numberFormat.format(groupedAccounts.active.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('notRegister')}</span>
        <strong>${numberFormat.format(groupedAccounts.notRegister.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('deactive')}</span>
        <strong>${numberFormat.format(groupedAccounts.deactive.length)}</strong>
      </div>
      <div class="accountsSummaryCard">
        <span>${t('totalVotes')}</span>
        <strong>${numberFormat.format(totalVotes)}</strong>
      </div>
    </div>

    <div class="accountsToolbar">
      <div class="accountsToolbarGroup">
        <input
          type="search"
          class="accountsSearchInput"
          data-account-search
          placeholder="${t('searchAccountsPlaceholder')}"
          value="${previousSearch.replace(/"/g, '&quot;')}"
        >
        ${getBulkActionConfigs(activeTabState).map((item) => `
          <button
            type="button"
            class="miniButton bulkActionBtn${item.tone ? ` is-${item.tone}` : ''}"
            data-bulk-action="${item.action}"
            data-bulk-label="${item.label}"
          >
            ${item.label} (${selectedEmails.size})
          </button>
        `).join('')}
      </div>
    </div>

    <div class="accountsTabs" role="tablist" aria-label="Trạng thái tài khoản">
      <button type="button" class="accountsTab${activeTabState === 'active' ? ' is-active' : ''}" data-tab-trigger="active">${t('active')} (${numberFormat.format(groupedAccounts.active.length)})</button>
      <button type="button" class="accountsTab${activeTabState === 'notRegister' ? ' is-active' : ''}" data-tab-trigger="notRegister">${t('notRegister')} (${numberFormat.format(groupedAccounts.notRegister.length)})</button>
      <button type="button" class="accountsTab${activeTabState === 'deactive' ? ' is-active' : ''}" data-tab-trigger="deactive">${t('deactive')} (${numberFormat.format(groupedAccounts.deactive.length)})</button>
    </div>

    <div class="accountsTabPanel${activeTabState === 'active' ? ' is-active' : ''}" data-tab-panel="active">
      <table>
        <thead>
          <tr>
            <th class="accountCheckboxCell">
              <input
                type="checkbox"
                class="accountRowCheckbox"
                data-select-all-tab="active"
                ${activeTabState === 'active' && filteredItemsForActiveTab.length > 0 && filteredItemsForActiveTab.every((account) => selectedEmails.has(account.email || '')) ? 'checked' : ''}
              >
            </th>
            <th>Email</th>
            <th>${t('password')}</th>
            <th>${t('lastVote')}</th>
            <th>${t('totalVotes')}</th>
            <th>${t('error')}</th>
            <th>${t('actions')}</th>
          </tr>
        </thead>
        <tbody>${renderRows(groupedAccounts.active, 'active', previousSearch)}</tbody>
      </table>
    </div>

    <div class="accountsTabPanel${activeTabState === 'notRegister' ? ' is-active' : ''}" data-tab-panel="notRegister">
      <table>
        <thead>
          <tr>
            <th class="accountCheckboxCell">
              <input
                type="checkbox"
                class="accountRowCheckbox"
                data-select-all-tab="notRegister"
                ${activeTabState === 'notRegister' && filteredItemsForActiveTab.length > 0 && filteredItemsForActiveTab.every((account) => selectedEmails.has(account.email || '')) ? 'checked' : ''}
              >
            </th>
            <th>Email</th>
            <th>${t('password')}</th>
            <th>${t('lastVote')}</th>
            <th>${t('totalVotes')}</th>
            <th>${t('error')}</th>
            <th>${t('actions')}</th>
          </tr>
        </thead>
        <tbody>${renderRows(groupedAccounts.notRegister, 'notRegister', previousSearch)}</tbody>
      </table>
    </div>

    <div class="accountsTabPanel${activeTabState === 'deactive' ? ' is-active' : ''}" data-tab-panel="deactive">
      <table>
        <thead>
          <tr>
            <th class="accountCheckboxCell">
              <input
                type="checkbox"
                class="accountRowCheckbox"
                data-select-all-tab="deactive"
                ${activeTabState === 'deactive' && filteredItemsForActiveTab.length > 0 && filteredItemsForActiveTab.every((account) => selectedEmails.has(account.email || '')) ? 'checked' : ''}
              >
            </th>
            <th>Email</th>
            <th>${t('password')}</th>
            <th>${t('lastVote')}</th>
            <th>${t('totalVotes')}</th>
            <th>${t('error')}</th>
            <th>${t('actions')}</th>
          </tr>
        </thead>
        <tbody>${renderRows(groupedAccounts.deactive, 'deactive', previousSearch)}</tbody>
      </table>
    </div>
  `);

  const searchInput = modalBody.querySelector('[data-account-search]');
  const triggers = [...modalBody.querySelectorAll('[data-tab-trigger]')];
  const panels = [...modalBody.querySelectorAll('[data-tab-panel]')];
  const markButtons = [...modalBody.querySelectorAll('[data-mark-voted-email]')];
  const toggleButtons = [...modalBody.querySelectorAll('[data-toggle-status-email]')];
  const deleteButtons = [...modalBody.querySelectorAll('[data-delete-account-email]')];
  const rowCheckboxes = [...modalBody.querySelectorAll('[data-account-select-email]')];
  const selectAllCheckbox = modalBody.querySelector(`[data-select-all-tab="${activeTabState}"]`);
  const bulkActionButtons = [...modalBody.querySelectorAll('[data-bulk-action]')];

  const activateTab = (tabName) => {
    accountModalActiveTab = tabName;
    showAccounts();
  };

  const currentActivePanel = modalBody.querySelector(`[data-tab-panel="${activeTabState}"]`);
  if (currentActivePanel) {
    currentActivePanel.scrollTop = previousPanelScrollTop;
  }

  const syncSelectionUiInPlace = () => {
    const currentSelection = accountSelectionState[activeTabState] || new Set();
    const currentRowCheckboxes = rowCheckboxes.filter((checkbox) => checkbox.dataset.accountSelectTab === activeTabState);
    for (const checkbox of currentRowCheckboxes) {
      checkbox.checked = currentSelection.has(checkbox.dataset.accountSelectEmail || '');
    }
    if (selectAllCheckbox) {
      const visibleEmails = currentRowCheckboxes
        .map((checkbox) => checkbox.dataset.accountSelectEmail)
        .filter(Boolean);
      selectAllCheckbox.checked = visibleEmails.length > 0 && visibleEmails.every((email) => currentSelection.has(email));
    }
    for (const button of bulkActionButtons) {
      const baseLabel = button.dataset.bulkLabel || '';
      button.textContent = `${baseLabel} (${currentSelection.size})`;
      button.disabled = currentSelection.size === 0;
    }
  };

  for (const trigger of triggers) {
    trigger.addEventListener('click', () => activateTab(trigger.dataset.tabTrigger));
  }

  searchInput?.addEventListener('input', async () => {
    await showAccounts();
    const nextInput = modalBody.querySelector('[data-account-search]');
    if (nextInput) {
      nextInput.focus();
      const nextValue = searchInput.value;
      nextInput.value = nextValue;
      nextInput.setSelectionRange(nextValue.length, nextValue.length);
    }
  });

  for (const checkbox of rowCheckboxes) {
    checkbox.addEventListener('change', () => {
      const email = checkbox.dataset.accountSelectEmail;
      const tabKey = checkbox.dataset.accountSelectTab;
      if (!email) return;
      if (!accountSelectionState[tabKey]) {
        accountSelectionState[tabKey] = new Set();
      }
      if (checkbox.checked) {
        accountSelectionState[tabKey].add(email);
      } else {
        accountSelectionState[tabKey].delete(email);
      }
      syncSelectionUiInPlace();
    });
  }

  selectAllCheckbox?.addEventListener('change', () => {
    const visibleEmails = rowCheckboxes
      .filter((checkbox) => checkbox.dataset.accountSelectTab === activeTabState)
      .map((checkbox) => checkbox.dataset.accountSelectEmail)
      .filter(Boolean);

    if (!accountSelectionState[activeTabState]) {
      accountSelectionState[activeTabState] = new Set();
    }
    if (selectAllCheckbox.checked) {
      for (const email of visibleEmails) accountSelectionState[activeTabState].add(email);
    } else {
      for (const email of visibleEmails) accountSelectionState[activeTabState].delete(email);
    }
    syncSelectionUiInPlace();
  });

  syncSelectionUiInPlace();

  for (const button of markButtons) {
    button.addEventListener('click', async () => {
      const email = button.dataset.markVotedEmail;
      const ok = window.confirm(t('markVotedConfirm').replace('{email}', email));
      if (!ok) return;

      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = '...';

      try {
        await window.txw.markInstanceAccountVoted(selectedInstanceId, email);
        await refreshInstances();
        await showAccounts();

        modalBody.insertAdjacentHTML(
          'afterbegin',
          `<div class="modalNotice success">
      ${t('markVotedDoneMessage').replace('{email}', email)}
    </div>`
        );
      } catch (error) {
        button.disabled = false;
        button.textContent = oldText;
        window.alert(error.message || error);
      }
    });
  }

  for (const button of toggleButtons) {
    button.addEventListener('click', async () => {
      const email = button.dataset.toggleStatusEmail;
      const newStatus = button.dataset.newStatus;
      const confirmMsg = newStatus === 'active'
        ? t('confirmActivateAccount').replace('{email}', email)
        : newStatus === 'not-register'
          ? t('confirmMoveToNotRegister').replace('{email}', email)
          : t('confirmDeactivateAccount').replace('{email}', email);

      const ok = window.confirm(confirmMsg);
      if (!ok) return;

      button.disabled = true;
      button.innerHTML = '<span aria-hidden="true">…</span>';

      try {
        await window.txw.toggleInstanceAccountStatus(selectedInstanceId, email, newStatus);
        await refreshInstances();
        await showAccounts();
      } catch (error) {
        button.disabled = false;
        button.title = newStatus === 'active'
          ? t('activateAccount')
          : newStatus === 'not-register'
            ? t('moveToNotRegister')
            : t('deactivateAccount');
        window.alert(error.message || error);
      }
    });
  }

  for (const button of deleteButtons) {
    button.addEventListener('click', async () => {
      const email = button.dataset.deleteAccountEmail;
      const ok = window.confirm(t('confirmDeleteNotRegisterAccount').replace('{email}', email));
      if (!ok) return;

      button.disabled = true;
      button.innerHTML = '<span aria-hidden="true">…</span>';

      try {
        await window.txw.deleteInstanceAccount(selectedInstanceId, email);
        await refreshInstances();
        await showAccounts();
      } catch (error) {
        button.disabled = false;
        button.title = t('deleteNotRegisterAccount');
        button.innerHTML = '<span aria-hidden="true">🗑</span>';
        window.alert(error.message || error);
      }
    });
  }

  for (const button of bulkActionButtons) {
    button.addEventListener('click', async () => {
      const action = button.dataset.bulkAction;
      const emails = [...(accountSelectionState[activeTabState] || new Set())];
      if (!emails.length) return;

      let confirmMessage = '';
      if (action === 'mark-selected') confirmMessage = t('confirmBulkMarkVotedToday').replace('{count}', String(emails.length));
      if (action === 'deactivate-selected') confirmMessage = t('confirmBulkDeactivateAccounts').replace('{count}', String(emails.length));
      if (action === 'activate-selected') confirmMessage = t('confirmBulkActivateAccounts').replace('{count}', String(emails.length));
      if (action === 'move-selected-not-register') confirmMessage = t('confirmBulkMoveToNotRegister').replace('{count}', String(emails.length));
      if (action === 'delete-selected') confirmMessage = t('confirmDeleteSelectedAccounts').replace('{count}', String(emails.length));

      const ok = window.confirm(confirmMessage);
      if (!ok) return;

      button.disabled = true;

      try {
        for (const email of emails) {
          if (action === 'mark-selected') {
            await window.txw.markInstanceAccountVoted(selectedInstanceId, email);
          } else if (action === 'deactivate-selected') {
            await window.txw.toggleInstanceAccountStatus(selectedInstanceId, email, 'deactive');
          } else if (action === 'activate-selected') {
            await window.txw.toggleInstanceAccountStatus(selectedInstanceId, email, 'active');
          } else if (action === 'move-selected-not-register') {
            await window.txw.toggleInstanceAccountStatus(selectedInstanceId, email, 'not-register');
          }
        }
        if (action === 'delete-selected') {
          await window.txw.deleteInstanceAccounts(selectedInstanceId, emails);
        }
        accountSelectionState[activeTabState]?.clear();
        await refreshInstances();
        await showAccounts();
      } catch (error) {
        button.disabled = false;
        window.alert(error.message || error);
      }
    });
  }
}

// Show Vote Score History Graph/Table
async function showHistory() {
  if (!selectedInstanceId) return;

  const summary = await window.txw.getInstanceSummary(selectedInstanceId);
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




//
async function openEmulatorPicker() {
  emulatorPickerInstanceId = selectedInstanceId;
  emulatorOptions.innerHTML = '';
  emulatorScanStatus.textContent = t('scanningEmulators');
  confirmEmulatorDialog.disabled = true;

  if (!emulatorDialog.open) {
    emulatorDialog.showModal();
  }

  try {
    const result = await window.txw.scanEmulators();
    const devices = result.devices || [];

    if (!devices.length) {
      emulatorScanStatus.textContent = t('noOnlineEmulators');
      return;
    }

    emulatorScanStatus.textContent = t('selectOnlineEmulator');

    emulatorOptions.innerHTML = devices.map((device, index) => `
      <label style="display: flex; align-items: center; gap: 10px; cursor: ${device.available ? 'pointer' : 'not-allowed'}; opacity: ${device.available ? '1' : '0.45'};">
        <input
          type="radio"
          name="emulatorDevice"
          value="${device.id}"
          data-emulator-type="${device.id.includes('62001') ? 'nox' : 'adb_device'}"
          ${device.available ? '' : 'disabled'}
          ${device.available && index === devices.findIndex((item) => item.available) ? 'checked' : ''}
          style="width: auto; height: auto;"
        >
        <span>${device.label}${device.available ? '' : ` (${t('emulatorInUse')})`}</span>
      </label>
    `).join('');

    confirmEmulatorDialog.disabled = !devices.some((device) => device.available);
  } catch (error) {
    emulatorScanStatus.textContent = error.message || String(error);
  }
}
//

// Smart logs translator
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

    // --- Ads Farm Logs Translation ---
    if (trimmed.includes('🚀 KHỞI ĐỘNG TIẾN TRÌNH FARM ADS TỰ ĐỘNG')) {
      return t('adsFarmStarted');
    }

    const emuMatch = trimmed.match(/Giả lập lựa chọn:\s*(.+)$/i);
    if (emuMatch) {
      return t('adsFarmEmulatorChoice').replace('{emulator}', emuMatch[1]);
    }

    if (trimmed.includes('Đang kết nối giả lập cổng 5555...')) {
      return t('adsFarmConnecting5555');
    }

    if (trimmed.includes('Đang kết nối giả lập cổng 62001 (Nox)...')) {
      return t('adsFarmConnecting62001');
    }

    if (trimmed.includes('Đang quét thiết bị giả lập...')) {
      return t('adsFarmScanningEmulators');
    }

    const connSuccessMatch = trimmed.match(/Kết nối thành công tới máy ảo:\s*\[(.+)\]/i);
    if (connSuccessMatch) {
      return t('adsFarmConnectSuccess').replace('{device}', connSuccessMatch[1]);
    }

    if (trimmed.includes('Đang tự động cấu hình cưỡng bức màn hình dọc (Portrait)...')) {
      return t('adsFarmForcePortrait');
    }

    const resMatch = trimmed.match(/Độ phân giải thực tế màn hình máy ảo:\s*(\d+)x(\d+)/i);
    if (resMatch) {
      return t('adsFarmResolution').replace('{width}', resMatch[1]).replace('{height}', resMatch[2]);
    }

    const adbTapMatch = trimmed.match(/ADB Tap: Tọa độ gốc \((\d+),\s*(\d+)\)\s*->\s*Tọa độ quy đổi thực tế \((\d+),\s*(\d+)\)/i);
    if (adbTapMatch) {
      return t('adsFarmAdbTap')
        .replace('{x}', adbTapMatch[1])
        .replace('{y}', adbTapMatch[2])
        .replace('{scaledX}', adbTapMatch[3])
        .replace('{scaledY}', adbTapMatch[4]);
    }

    if (trimmed.includes('Đang mở Cloudflare WARP trong giả lập để xoay IP...')) {
      return t('adsFarmWarpOpening');
    }

    if (trimmed.includes('Kiểm tra hệ thống: WARP hiện tại ĐANG KẾT NỐI')) {
      return t('adsFarmWarpConnected');
    }

    if (trimmed.includes('Kiểm tra hệ thống: WARP hiện tại ĐANG NGẮT KẾT NỐI')) {
      return t('adsFarmWarpDisconnected');
    }

    if (trimmed.includes('WARP đang bật -> Bấm để TẮT kết nối cũ...')) {
      return t('adsFarmWarpDisconnecting');
    }

    if (trimmed.includes('Đang kiểm tra hộp thoại tạm dừng của WARP...')) {
      return t('adsFarmWarpCheckingPause');
    }

    const pauseMatch = trimmed.match(/Phát hiện hộp thoại tạm dừng\. Bấm "Until I turn it back on" tại \((\d+),\s*(\d+)\)/i);
    if (pauseMatch) {
      return t('adsFarmWarpDetectedPauseDialog').replace('{x}', pauseMatch[1]).replace('{y}', pauseMatch[2]);
    }

    if (trimmed.includes('Không thấy hộp thoại tạm dừng (có thể đã tắt trực tiếp). Chờ thêm...')) {
      return t('adsFarmWarpNoPauseDialog');
    }

    if (trimmed.includes('Bấm để BẬT lại kết nối mới (Xoay IP sạch)...')) {
      return t('adsFarmWarpConnectingNew');
    }

    if (trimmed.includes('WARP đang tắt -> Chỉ bấm 1 lần duy nhất để BẬT kết nối mới...')) {
      return t('adsFarmWarpConnectingOnce');
    }

    if (trimmed.includes('Đang chờ WARP thiết lập kết nối VPN an toàn (15 giây)...')) {
      return t('adsFarmWarpWaitingConnection');
    }

    if (trimmed.includes('Dọn sạch dữ liệu cũ của ứng dụng vote...')) {
      return t('adsFarmClearingApp');
    }

    const fakeIdMatch = trimmed.match(/Đã fake Device ID mới:\s*\[(.+)\]/i);
    if (fakeIdMatch) {
      return t('adsFarmFakeDeviceID').replace('{id}', fakeIdMatch[1]);
    }

    if (trimmed.includes('Đang tự động cấu hình quyền & pin cho ứng dụng Bugs qua ADB...')) {
      return t('adsFarmConfiguringPermissions');
    }

    if (trimmed.includes('Khởi chạy ứng dụng vote...')) {
      return t('adsFarmLaunchingApp');
    }

    if (trimmed.includes('Khởi chạy lại ứng dụng...')) {
      return t('adsFarmRelaunchingApp');
    }

    if (trimmed.includes('Đang chờ app load hẳn vào màn hình chính (tránh kẹt)...')) {
      return t('adsFarmWaitingAppLoad');
    }

    if (trimmed.includes('Đang chờ app load hẳn vào màn hình chính...')) {
      return t('adsFarmWaitingAppLoadShort');
    }

    if (trimmed.includes('Bắt đầu tự động đăng nhập...')) {
      return t('adsFarmStartingLogin');
    }

    const openAccountMatch = trimmed.match(/Mở trang tài khoản \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (openAccountMatch) {
      return t('adsFarmOpeningAccountPage').replace('{x}', openAccountMatch[1]).replace('{y}', openAccountMatch[2]);
    }

    const openLoginMatch = trimmed.match(/Mở danh sách đăng nhập \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (openLoginMatch) {
      return t('adsFarmOpeningLoginList').replace('{x}', openLoginMatch[1]).replace('{y}', openLoginMatch[2]);
    }

    const chooseBugsMatch = trimmed.match(/Chọn đăng nhập Bugs \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (chooseBugsMatch) {
      return t('adsFarmSelectingBugsLogin').replace('{x}', chooseBugsMatch[1]).replace('{y}', chooseBugsMatch[2]);
    }

    const typeEmailMatch = trimmed.match(/Điền Email vào ô tài khoản \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (typeEmailMatch) {
      return t('adsFarmTypingEmail').replace('{x}', typeEmailMatch[1]).replace('{y}', typeEmailMatch[2]);
    }

    const typePassMatch = trimmed.match(/Điền Mật khẩu vào ô mật khẩu \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (typePassMatch) {
      return t('adsFarmTypingPassword').replace('{x}', typePassMatch[1]).replace('{y}', typePassMatch[2]);
    }

    const submitLoginMatch = trimmed.match(/Gửi đăng nhập \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (submitLoginMatch) {
      return t('adsFarmSubmittingLogin').replace('{x}', submitLoginMatch[1]).replace('{y}', submitLoginMatch[2]);
    }

    if (trimmed.includes('Đang kiểm tra trạng thái xác thực tài khoản...')) {
      return t('adsFarmCheckingAuthStatus');
    }

    if (trimmed.includes('Phát hiện vẫn kẹt ở màn hình Đăng nhập. Login thất bại!')) {
      return t('adsFarmAuthFailed');
    }

    if (trimmed.includes('Vượt qua màn hình Đăng nhập thành công!')) {
      return t('adsFarmAuthSuccess');
    }

    const deactiveMatch = trimmed.match(/Tài khoản\s*\[(.+)\]\s*đã bị xóa hoặc sai pass/i);
    if (deactiveMatch) {
      return t('adsFarmAccountDeactivated').replace('{email}', deactiveMatch[1]);
    }

    if (trimmed.includes('Đang điều hướng đến Trạm sạc tim...')) {
      return t('adsFarmNavigatingHeartStation');
    }

    if (trimmed.includes('Đang điều hướng lại đến Trạm sạc tim...')) {
      return t('adsFarmRonavigatingHeartStation');
    }

    const clickSettingsMatch = trimmed.match(/Nhấp vào Cài đặt \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (clickSettingsMatch) {
      return t('adsFarmClickingSettings').replace('{x}', clickSettingsMatch[1]).replace('{y}', clickSettingsMatch[2]);
    }

    const clickHeartMatch = trimmed.match(/Nhấp vào Trạm sạc tim \(tọa độ:\s*(\d+),\s*(\d+)\)/i);
    if (clickHeartMatch) {
      return t('adsFarmClickingHeartStation').replace('{x}', clickHeartMatch[1]).replace('{y}', clickHeartMatch[2]);
    }

    if (trimmed.includes('Bắt đầu xem quảng cáo lượt 1...')) {
      return t('adsFarmStartingAd1');
    }

    if (trimmed.includes('Bắt đầu xem quảng cáo lượt 2...')) {
      return t('adsFarmStartingAd2');
    }

    const ad1DumpMatch = trimmed.match(/Tìm thấy nút Ad 1 qua UI Dump tại \((\d+),\s*(\d+)\)/i);
    if (ad1DumpMatch) {
      return t('adsFarmFoundAd1Dump').replace('{x}', ad1DumpMatch[1]).replace('{y}', ad1DumpMatch[2]);
    }

    const ad2DumpMatch = trimmed.match(/Tìm thấy nút Ad 2 qua UI Dump tại \((\d+),\s*(\d+)\)/i);
    if (ad2DumpMatch) {
      return t('adsFarmFoundAd2Dump').replace('{x}', ad2DumpMatch[1]).replace('{y}', ad2DumpMatch[2]);
    }

    const ad1FallbackMatch = trimmed.match(/Không tìm thấy nút Ad 1 qua UI Dump.*?(\d+),\s*(\d+)/i);
    if (ad1FallbackMatch) {
      return t('adsFarmFallbackAd1').replace('{x}', ad1FallbackMatch[1]).replace('{y}', ad1FallbackMatch[2]);
    }

    const ad2FallbackMatch = trimmed.match(/Không tìm thấy nút Ad 2 qua UI Dump.*?(\d+),\s*(\d+)/i);
    if (ad2FallbackMatch) {
      return t('adsFarmFallbackAd2').replace('{x}', ad2FallbackMatch[1]).replace('{y}', ad2FallbackMatch[2]);
    }

    if (trimmed.includes('Đang chờ xem hết quảng cáo 1 trong 1 phút...')) {
      return t('adsFarmWaitingAd1');
    }

    if (trimmed.includes('Đang chờ xem hết quảng cáo 2 trong 1 phút...')) {
      return t('adsFarmWaitingAd2');
    }

    if (trimmed.includes('Hết thời gian quảng cáo 1 -> Diệt toàn bộ app Bugs, Play Store và Trình duyệt để dọn sạch màn hình...')) {
      return t('adsFarmAd1Timeout');
    }

    if (trimmed.includes('Hết thời gian quảng cáo 2 -> Diệt toàn bộ app Bugs, Play Store và Trình duyệt để chuẩn bị chu kỳ mới...')) {
      return t('adsFarmAd2Timeout');
    }

    const watchSuccessMatch = trimmed.match(/Tài khoản\s*\[(.+)\]\s*đã xem xong 2 Ads/i);
    if (watchSuccessMatch) {
      return t('adsFarmSuccess').replace('{email}', watchSuccessMatch[1]);
    }

    if (trimmed.includes('Đã lưu lịch sử Farm Ads của tài khoản vào database hệ thống.')) {
      return t('adsFarmSavedToDatabase');
    }

    if (trimmed.includes('Đang quét tìm popup quảng cáo trang chủ...')) {
      return t('adsFarmPopupScanning');
    }

    const scanAttemptMatch = trimmed.match(/Lần quét thứ\s*(\d+)\/6/i);
    if (scanAttemptMatch) {
      return t('adsFarmPopupScanAttempt').replace('{attempt}', scanAttemptMatch[1]);
    }

    const popupMatch = trimmed.match(/Phát hiện popup trang chủ Bugs.*?\((\d+),\s*(\d+)\)/i);
    if (popupMatch) {
      return t('adsFarmPopupDetected').replace('{x}', popupMatch[1]).replace('{y}', popupMatch[2]);
    }

    const closeBtnMatch = trimmed.match(/Bấm tiếp nút "닫기" tại \((\d+),\s*(\d+)\)/i);
    if (closeBtnMatch) {
      return t('adsFarmPopupClickClose').replace('{x}', closeBtnMatch[1]).replace('{y}', closeBtnMatch[2]);
    }

    if (trimmed.includes('Không phát hiện popup trang chủ Bugs sau 6 lần quét.')) {
      return t('adsFarmPopupNotDetected');
    }

    if (trimmed.includes('Không tìm thấy tài khoản nào trong dữ liệu. Chờ 1 phút rồi kiểm tra lại...')) {
      return t('adsFarmNoAccounts');
    }

    const cooldownMatch = trimmed.match(/Nghỉ ngơi tạm dừng\s*(\d+)\s*phút/i);
    if (cooldownMatch) {
      return t('adsFarmCooldown').replace('{minutes}', cooldownMatch[1]);
    }

    const newCycleMatch = trimmed.match(/BẮT ĐẦU CHU KỲ MỚI CHO:\s*\[(.+)\]/i);
    if (newCycleMatch) {
      return t('adsFarmNewCycle').replace('{email}', newCycleMatch[1]);
    }

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

    if (trimmed.includes('Đã điền form Bugs') || (trimmed.includes('focus') && trimmed.includes('Captcha'))) {
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

    if (trimmed.includes('[VOTE PROCESS] Đã click nút VOTING')) {
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

// --- IPC IPC EVENTS ---

window.txw.onSetupStatus((value) => {
  if (value.startsWith('progress:')) {
    const percent = value.substring('progress:'.length);
    setupStatus.textContent = `${t('browserDownloading')} ${percent}`;
  } else if (value.startsWith('mirror:')) {
    const mirror = value.substring('mirror:'.length);
    setupStatus.textContent = `${t('setupRetryingWithMirror')} (${mirror})`;
  } else {
    setupStatus.textContent = t(value);
  }
});

// Logs listener from worker process
window.txw.onLog(({ instanceId, text }) => {
  appendInstanceLog(instanceId, translateWorkerLog(text));
});

// Run state listener (running: true/false)
window.txw.onRunState(({ instanceId, running, mode }) => {
  const inst = instances.find((i) => i.id === instanceId);
  if (inst) {
    inst.running = running;
    inst.runningMode = running ? mode : null;
    renderInstancesList();
    if (selectedInstanceId === instanceId) {
      updateSelectedInstanceDashboard(inst);
    }
  }
});

// Accounts or summary updated
window.txw.onDataUpdated(async ({ instanceId }) => {
  await refreshInstances();
});

// Global list updated
window.txw.onInstancesUpdated(async () => {
  await refreshInstances();
});

// --- UI LISTENERS ---

languageSelect?.addEventListener('change', (event) => {
  applyLanguage(event.target.value);
});

// Modal Events
document.getElementById('closeModal').addEventListener('click', () => modal.close());

// Selected Instance Action Events
signupButton.addEventListener('click', async () => {
  if (!selectedInstanceId) return;
  appendInstanceLog(selectedInstanceId, `\n[DEBUG CLICK] Nút 'Đăng Ký và Vote' được click! Lớp btnDashboardStop: ${signupButton.classList.contains('btnDashboardStop')}, ID: ${selectedInstanceId}\n`);
  if (signupButton.classList.contains('btnDashboardStop')) {
    signupButton.disabled = true;
    signupButton.innerHTML = `<span>Đang dừng...</span><small>Vui lòng đợi giây lát</small>`;
    appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Gửi lệnh dừng qua IPC...\n`);
    try {
      const res = await window.txw.stopInstance(selectedInstanceId);
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Kết quả IPC dừng: ${res}\n`);
      console.log(`[UI] stopInstance (signup) result:`, res);
    } catch (err) {
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Lỗi IPC dừng: ${err.message}\n`);
      console.error(`[UI] Error stopping instance (signup):`, err);
    }
  } else {
    startInstanceProcess(selectedInstanceId, 'signup');
  }
});
signupManualButton.addEventListener('click', async () => {
  if (!selectedInstanceId) return;
  appendInstanceLog(selectedInstanceId, `\n[DEBUG CLICK] Nút 'Đăng Ký (tự nhập captcha)' được click! Lớp btnDashboardStop: ${signupManualButton.classList.contains('btnDashboardStop')}, ID: ${selectedInstanceId}\n`);
  if (signupManualButton.classList.contains('btnDashboardStop')) {
    signupManualButton.disabled = true;
    signupManualButton.innerHTML = `<span>Đang dừng...</span><small>Vui lòng đợi giây lát</small>`;
    appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Gửi lệnh dừng qua IPC...\n`);
    try {
      const res = await window.txw.stopInstance(selectedInstanceId);
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Kết quả IPC dừng: ${res}\n`);
      console.log(`[UI] stopInstance (signup-manual) result:`, res);
    } catch (err) {
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Lỗi IPC dừng: ${err.message}\n`);
      console.error(`[UI] Error stopping instance (signup-manual):`, err);
    }
  } else {
    startInstanceProcess(selectedInstanceId, 'signup-manual');
  }
});
signupAliasButton.addEventListener('click', async () => {
  if (!selectedInstanceId) return;
  appendInstanceLog(selectedInstanceId, `\n[DEBUG CLICK] Nút 'Đăng Ký Gmail Aliases' được click! Lớp btnDashboardStop: ${signupAliasButton.classList.contains('btnDashboardStop')}, ID: ${selectedInstanceId}\n`);
  if (signupAliasButton.classList.contains('btnDashboardStop')) {
    signupAliasButton.disabled = true;
    signupAliasButton.innerHTML = `<span>Đang dừng...</span><small>Vui lòng đợi giây lát</small>`;
    appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Gửi lệnh dừng qua IPC...\n`);
    try {
      const res = await window.txw.stopInstance(selectedInstanceId);
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Kết quả IPC dừng: ${res}\n`);
      console.log(`[UI] stopInstance (signup-alias) result:`, res);
    } catch (err) {
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Lỗi IPC dừng: ${err.message}\n`);
      console.error(`[UI] Error stopping instance (signup-alias):`, err);
    }
  } else {
    startInstanceProcess(selectedInstanceId, 'signup-alias');
  }
});
loginButton.addEventListener('click', async () => {
  if (!selectedInstanceId) return;
  appendInstanceLog(selectedInstanceId, `\n[DEBUG CLICK] Nút 'Dừng Vote Tài Khoản Cũ' được click! Lớp btnDashboardStop: ${loginButton.classList.contains('btnDashboardStop')}, ID: ${selectedInstanceId}\n`);
  if (loginButton.classList.contains('btnDashboardStop')) {
    loginButton.disabled = true;
    loginButton.innerHTML = `<span>Đang dừng...</span><small>Vui lòng đợi giây lát</small>`;
    appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Gửi lệnh dừng qua IPC...\n`);
    try {
      const res = await window.txw.stopInstance(selectedInstanceId);
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Kết quả IPC dừng: ${res}\n`);
      console.log(`[UI] stopInstance (login) result:`, res);
    } catch (err) {
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Lỗi IPC dừng: ${err.message}\n`);
      console.error(`[UI] Error stopping instance (login):`, err);
    }
  } else {
    startInstanceProcess(selectedInstanceId, 'login');
  }
});
adsButton.addEventListener('click', async () => {
  if (!selectedInstanceId) return;
  appendInstanceLog(selectedInstanceId, `\n[DEBUG CLICK] Nút 'Xem Quảng Cáo' được click! Lớp btnDashboardStop: ${adsButton.classList.contains('btnDashboardStop')}, ID: ${selectedInstanceId}\n`);
  if (adsButton.classList.contains('btnDashboardStop')) {
    adsButton.disabled = true;
    adsButton.innerHTML = `<span>Đang dừng...</span><small>Vui lòng đợi giây lát</small>`;
    appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Gửi lệnh dừng qua IPC...\n`);
    try {
      const res = await window.txw.stopInstance(selectedInstanceId);
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Kết quả IPC dừng: ${res}\n`);
      console.log(`[UI] stopInstance (ads) result:`, res);
    } catch (err) {
      appendInstanceLog(selectedInstanceId, `[DEBUG CLICK] Lỗi IPC dừng: ${err.message}\n`);
      console.error(`[UI] Error stopping instance (ads):`, err);
    }
  } else {
    openEmulatorPicker();
  }
});
accountsButton.addEventListener('click', showAccounts);
historyButton.addEventListener('click', showHistory);
helpButton.addEventListener('click', () => window.txw.openHelp(currentLanguage));
helpButtonMain.addEventListener('click', () => window.txw.openHelp(currentLanguage));

// Emulator Selection Dialog Events
closeEmulatorDialog.addEventListener('click', () => emulatorDialog.close());
confirmEmulatorDialog.addEventListener('click', () => {
  const selectedRadio = emulatorDialog.querySelector('input[name="emulatorDevice"]:checked');
  if (!selectedRadio) return;

  const emulatorDevice = selectedRadio.value;
  const emulatorType = selectedRadio.dataset.emulatorType || 'adb_device';

  emulatorDialog.close();
  const targetInstanceId = emulatorPickerInstanceId;

  if (!targetInstanceId) return;

  confirmEmulatorDialog.disabled = true;

  startInstanceProcess(targetInstanceId, 'ads', {
    emulatorType,
    emulatorDevice
  });
});

// Download Excel Template
downloadTemplateButton?.addEventListener('click', () => {
  if (templateRootEmail) templateRootEmail.value = '';
  templateAliasVariantCount = 0;
  if (aliasVariantSummary) aliasVariantSummary.textContent = '';
  if (aliasRemainingSummary) aliasRemainingSummary.textContent = '';
  if (aliasSuggestedSplitSummary) aliasSuggestedSplitSummary.textContent = '';
  if (aliasConfigPanel) aliasConfigPanel.style.display = 'none';
  if (templateAliasLimit) templateAliasLimit.value = '2048';
  if (templateExcludedAliases) templateExcludedAliases.value = '';
  if (confirmTemplateChoiceDialog) {
    confirmTemplateChoiceDialog.disabled = true;
  }
  if (templateExcludeInstancePicker) {
    templateExcludeInstancePicker.open = false;
  }
  if (templateExcludeAllInstances) {
    templateExcludeAllInstances.checked = false;
  }
  if (templateExcludeInstanceOptions) {
    templateExcludeInstanceOptions.innerHTML = instances.map((inst) => `
      <label class="instanceExcludeOption">
        <input type="checkbox" data-instance-id="${inst.id}" style="width:auto; height:auto; accent-color:#d1a8ff;">
        <span>${inst.name || inst.id}</span>
      </label>
    `).join('');
    for (const checkbox of templateExcludeInstanceOptions.querySelectorAll('input[type="checkbox"][data-instance-id]')) {
      checkbox.addEventListener('change', async () => {
        const selectedCount = getSelectedExcludedInstanceIds().length;
        if (templateExcludeAllInstances) {
          templateExcludeAllInstances.checked = instances.length > 0 && selectedCount === instances.length;
        }
        updateExcludedInstanceSummary();
        await updateAliasExportSummary();
      });
    }
  }
  updateExcludedInstanceSummary();
  if (rootEmailContainer) rootEmailContainer.style.display = 'none';
  const defaultRadio = document.querySelector('input[name="templateType"][value="created"]');
  if (defaultRadio) defaultRadio.checked = true;
  templateChoiceDialog.showModal();
});

// Toggle root email container depending on selected template type
document.querySelectorAll('input[name="templateType"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (rootEmailContainer) {
      rootEmailContainer.style.display = e.target.value === 'uncreated' ? 'flex' : 'none';
    }
    if (confirmTemplateChoiceDialog) {
      confirmTemplateChoiceDialog.disabled = e.target.value === 'uncreated';
    }
  });
});

checkAliasVariantsButton?.addEventListener('click', () => {
  const rootEmail = templateRootEmail?.value || '';
  const variantCount = calculateAliasVariantCount(rootEmail);
  templateAliasVariantCount = variantCount;

  if (!variantCount) {
    if (aliasVariantSummary) {
      aliasVariantSummary.textContent = t('aliasVariantInvalidEmail');
    }
    if (aliasConfigPanel) {
      aliasConfigPanel.style.display = 'none';
    }
    if (confirmTemplateChoiceDialog) {
      confirmTemplateChoiceDialog.disabled = true;
    }
    return;
  }

  if (aliasVariantSummary) {
    aliasVariantSummary.textContent = t('aliasVariantCountMessage').replace('{count}', new Intl.NumberFormat('en-US').format(variantCount));
  }
  if (aliasConfigPanel) {
    aliasConfigPanel.style.display = 'flex';
  }
  if (templateAliasLimit) {
    const suggested = Math.min(2048, variantCount);
    templateAliasLimit.value = String(suggested);
    templateAliasLimit.max = String(Math.min(2048, variantCount));
  }
  updateAliasExportSummary();
  if (confirmTemplateChoiceDialog) {
    confirmTemplateChoiceDialog.disabled = false;
  }
});

templateExcludeAllInstances?.addEventListener('change', async () => {
  if (!templateExcludeInstanceOptions) return;
  for (const checkbox of templateExcludeInstanceOptions.querySelectorAll('input[type="checkbox"][data-instance-id]')) {
    checkbox.checked = templateExcludeAllInstances.checked;
  }
  updateExcludedInstanceSummary();
  await updateAliasExportSummary();
});

templateExcludedAliases?.addEventListener('input', () => {
  updateAliasExportSummary();
});

templateAliasLimit?.addEventListener('input', () => {
  updateAliasExportSummary();
});

templateExcludeInstancePicker?.addEventListener('toggle', () => {
  positionExcludedInstancePicker();
});

window.addEventListener('resize', () => {
  positionExcludedInstancePicker();
});

// Download Template Choice Dialog Modal Events
closeTemplateChoiceDialog?.addEventListener('click', () => templateChoiceDialog.close());
templateChoiceDialog?.addEventListener('cancel', () => templateChoiceDialog.close());

confirmTemplateChoiceDialog?.addEventListener('click', async () => {
  templateChoiceDialog.close();
  const templateType = document.querySelector('input[name="templateType"]:checked')?.value || 'created';
  const rootEmail = templateRootEmail?.value || '';
  const aliasLimitMax = Math.min(2048, templateAliasVariantCount || 2048);
  const aliasLimit = Math.min(aliasLimitMax, Math.max(1, Number.parseInt(templateAliasLimit?.value || '2048', 10) || 2048));
  const excludedAliases = templateExcludedAliases?.value || '';
  const excludedInstanceIds = getSelectedExcludedInstanceIds();
  let mergedExcludedAliases = excludedAliases;

  if (templateType === 'uncreated' && excludedInstanceIds.length) {
    const excludedInstanceAliasChunks = [];
    for (const instanceId of excludedInstanceIds) {
      const excludedInstanceAccounts = await window.txw.getInstanceAccounts(instanceId);
      const excludedInstanceEmails = excludedInstanceAccounts
        .map((account) => String(account.email || '').trim())
        .filter(Boolean);
      excludedInstanceAliasChunks.push(...excludedInstanceEmails);
    }

    mergedExcludedAliases = [excludedAliases, ...excludedInstanceAliasChunks].filter(Boolean).join(';');
  }

  const result = await window.txw.downloadTemplate(currentLanguage, templateType, rootEmail, mergedExcludedAliases, aliasLimit);

  if (!result || result.cancelled) {
    openModal(t('downloadTemplateDoneTitle'), `<p>${t('downloadTemplateCancelled')}</p>`);
    return;
  }

  openModal(
    t('downloadTemplateDoneTitle'),
    `<p>${t('downloadTemplateDoneMessage').replace('{path}', result.filePath)}</p>`
  );
});

// Import Choice Dialog Modal Events
closeImportChoiceDialog?.addEventListener('click', () => importChoiceDialog.close());
importChoiceDialog?.addEventListener('cancel', () => importChoiceDialog.close());

confirmImportChoiceDialog?.addEventListener('click', async () => {
  importChoiceDialog.close();
  const importType = document.querySelector('input[name="importType"]:checked')?.value || 'created';

  if (!selectedInstanceId) return;
  const result = await window.txw.importInstanceAccounts(selectedInstanceId, importType);

  if (!result || result.cancelled) {
    openModal(t('importDoneTitle'), `<p>${t('importCancelled')}</p>`);
    return;
  }

  const importMessageTemplate = t('importDoneMessage');
  let message = importMessageTemplate
    .replace('{created}', result.created)
    .replace('{updated}', result.updated)
    .replace('{skipped}', result.skipped)
    .replace('{duplicated}', result.duplicated || 0);

  if (!importMessageTemplate.includes('{duplicated}')) {
    message += ` ${t('importDuplicateSummary').replace('{duplicated}', result.duplicated || 0)}`;
  }

  openModal(t('importDoneTitle'), `<p>${message}</p>`);
  await refreshInstances();
});

// Import Excel Accounts
importAccountsButton?.addEventListener('click', () => {
  if (!selectedInstanceId) return;
  importChoiceDialog.showModal();
});

closeExportChoiceDialog?.addEventListener('click', () => exportChoiceDialog.close());
exportChoiceDialog?.addEventListener('cancel', () => exportChoiceDialog.close());

confirmExportChoiceDialog?.addEventListener('click', async () => {
  exportChoiceDialog.close();
  if (!selectedInstanceId) return;
  const exportType = document.querySelector('input[name="exportType"]:checked')?.value || 'created';
  const result = await window.txw.exportInstanceAccounts(selectedInstanceId, exportType);

  if (!result || result.cancelled) {
    openModal(t('exportDoneTitle'), `<p>${t('exportCancelled')}</p>`);
    return;
  }

  const message = t('exportDoneMessage')
    .replace('{count}', result.count || 0)
    .replace('{path}', result.filePath);

  openModal(t('exportDoneTitle'), `<p>${message}</p>`);
});

exportAccountsButton?.addEventListener('click', () => {
  if (!selectedInstanceId) return;
  exportChoiceDialog.showModal();
});

// Global instances management
addInstanceButton.addEventListener('click', () => openInstanceForm(null));

// Instance Form Modal Events
closeInstanceFormDialog.addEventListener('click', () => instanceFormDialog.close());
confirmInstanceFormDialog.addEventListener('click', saveInstanceForm);

// Run/Stop All Actions
runAllSignupButton.addEventListener('click', async () => {
  const count = await requestSignupCount();
  if (count === null) return;

  if (!Number.isInteger(count) || count < 1) {
    openModal(t('invalidCountTitle'), `<p>${t('invalidCountMessage')}</p>`);
    return;
  }

  const snapshot = [...instances];
  for (const inst of snapshot) {
    const latest = instances.find((item) => item.id === inst.id) || inst;
    if (!latest.running) {
      await startInstanceProcess(inst.id, 'signup', { count }, false);
      await refreshInstances();
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }
});

runAllSignupManualButton.addEventListener('click', async () => {
  const count = await requestSignupCount();
  if (count === null) return;

  if (!Number.isInteger(count) || count < 1) {
    openModal(t('invalidCountTitle'), `<p>${t('invalidCountMessage')}</p>`);
    return;
  }

  const snapshot = [...instances];
  for (const inst of snapshot) {
    const latest = instances.find((item) => item.id === inst.id) || inst;
    if (!latest.running) {
      await startInstanceProcess(inst.id, 'signup-manual', { count, manualCaptcha: true }, false);
      await refreshInstances();
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }
});

runAllSignupAliasButton.addEventListener('click', async () => {
  const count = await requestSignupCount(true);
  if (count === null) return;

  if (!Number.isInteger(count) || count < 1) {
    openModal(t('invalidCountTitle'), `<p>${t('invalidCountMessage')}</p>`);
    return;
  }

  const snapshot = [...instances];
  let started = 0;

  for (const inst of snapshot) {
    const latest = instances.find((item) => item.id === inst.id) || inst;
    if (latest.running) {
      continue;
    }

    const hasNotRegisterAccounts = await instanceHasNotRegisterAccounts(inst.id);
    if (!hasNotRegisterAccounts) {
      continue;
    }

    await startInstanceProcess(inst.id, 'signup-alias', { count }, false);
    started += 1;
    await refreshInstances();
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }

  if (started === 0) {
    openModal(t('noNotRegisterAccountsTitle'), `<p>${t('noNotRegisterAccountsMessage')}</p>`);
  }
});

runAllLoginButton.addEventListener('click', async () => {
  const snapshot = [...instances];
  for (const inst of snapshot) {
    const latest = instances.find((item) => item.id === inst.id) || inst;
    if (!latest.running) {
      await startInstanceProcess(inst.id, 'login', {}, false);
      await refreshInstances();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
});

stopAllButton.addEventListener('click', async () => {
  await window.txw.stopAllInstances();
});

// =========================================================
// Gmail IMAP Auto-Verification & Accounts Manager Handlers
// =========================================================

// IMAP Auto-Verification Elements
const mailAuthButton = document.getElementById('mailAuthButton');
const imapDialog = document.getElementById('imapDialog');
const closeImapDialog = document.getElementById('closeImapDialog');
const imapStatusBadge = document.getElementById('imapStatusBadge');
const imapServiceToggleBtn = document.getElementById('imapServiceToggleBtn');
const imapInputUser = document.getElementById('imapInputUser');
const imapInputPass = document.getElementById('imapInputPass');
const imapAddAccountBtn = document.getElementById('imapAddAccountBtn');
const imapAccountsTableBody = document.getElementById('imapAccountsTableBody');
const imapTerminalOutput = document.getElementById('imapTerminalOutput');
const imapClearLogsBtn = document.getElementById('imapClearLogsBtn');

let imapAccountsList = [];
let imapRunning = false;
let imapLogUnsubscribe = null;

// Render Gmail accounts list in table
function renderImapAccountsTable() {
  imapAccountsTableBody.innerHTML = '';
  
  if (imapAccountsList.length === 0) {
    imapAccountsTableBody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; color: rgba(255,255,255,0.4); padding: 20px;">
          ${t('imapNoAccounts')}
        </td>
      </tr>
    `;
    return;
  }

  imapAccountsList.forEach((acc, index) => {
    const row = document.createElement('tr');
    
    // Mask App Password for premium security feel
    const maskedPass = acc.pass ? '•••• •••• •••• ••••' : '—';
    
    row.innerHTML = `
      <td style="font-weight: 700;">${escapeHtml(acc.user)}</td>
      <td style="font-family: monospace; letter-spacing: 1px;">${maskedPass}</td>
      <td class="textCenter">
        <button class="miniButton btnRowDelete" data-index="${index}" style="min-height: 24px; padding: 2px 8px; font-size:11px;">
          Xóa
        </button>
      </td>
    `;
    
    // Delete event listener
    row.querySelector('.btnRowDelete').addEventListener('click', async (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      imapAccountsList.splice(idx, 1);
      
      // Save changes immediately
      await window.txw.imap.saveConfig({
        accounts: imapAccountsList,
        running: imapRunning
      });
      
      renderImapAccountsTable();
    });

    imapAccountsTableBody.appendChild(row);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Update the UI controls based on active status
function updateImapStatusUI(running) {
  imapRunning = running;
  
  if (running) {
    imapStatusBadge.className = 'badgeStatus running';
    imapStatusBadge.textContent = t('imapStatusOn');
    imapStatusBadge.setAttribute('data-i18n', 'imapStatusOn');
    
    imapServiceToggleBtn.className = 'imapToggleBtn stop';
    imapServiceToggleBtn.textContent = t('imapStopBtn');
    imapServiceToggleBtn.setAttribute('data-i18n', 'imapStopBtn');
  } else {
    imapStatusBadge.className = 'badgeStatus idle';
    imapStatusBadge.textContent = t('imapStatusOff');
    imapStatusBadge.setAttribute('data-i18n', 'imapStatusOff');
    
    imapServiceToggleBtn.className = 'imapToggleBtn start';
    imapServiceToggleBtn.textContent = t('imapStartBtn');
    imapServiceToggleBtn.setAttribute('data-i18n', 'imapStartBtn');
  }
}

// Open/Close Dialog Events
mailAuthButton?.addEventListener('click', async () => {
  // Load current configuration
  const config = await window.txw.imap.getConfig();
  imapAccountsList = config.accounts || [];
  updateImapStatusUI(config.running);
  
  // Render table
  renderImapAccountsTable();
  
  // Open dialog modal
  imapDialog.showModal();

  // Stream logs
  if (imapLogUnsubscribe) imapLogUnsubscribe();
  imapLogUnsubscribe = window.txw.imap.onLog((text) => {
    imapTerminalOutput.textContent += text;
    // Auto-scroll logs
    imapTerminalOutput.scrollTop = imapTerminalOutput.scrollHeight;
  });
});

closeImapDialog?.addEventListener('click', () => {
  if (imapLogUnsubscribe) {
    imapLogUnsubscribe();
    imapLogUnsubscribe = null;
  }
  imapDialog.close();
});

imapDialog?.addEventListener('cancel', () => {
  if (imapLogUnsubscribe) {
    imapLogUnsubscribe();
    imapLogUnsubscribe = null;
  }
  imapDialog.close();
});

// Clear logs button
imapClearLogsBtn?.addEventListener('click', () => {
  imapTerminalOutput.textContent = '';
});

// Add account action
imapAddAccountBtn?.addEventListener('click', async () => {
  const user = imapInputUser.value.trim();
  const pass = imapInputPass.value.trim();
  
  if (!user || !user.includes('@')) {
    openModal('Lỗi', '<p>Vui lòng nhập địa chỉ Gmail hợp lệ.</p>');
    return;
  }
  
  if (pass.length < 8) {
    openModal('Lỗi', '<p>App Password phải có độ dài hợp lệ (thường là 16 ký tự).</p>');
    return;
  }

  // Check if account already exists
  if (imapAccountsList.some(acc => acc.user.toLowerCase() === user.toLowerCase())) {
    openModal('Lỗi', '<p>Tài khoản Gmail này đã được cấu hình.</p>');
    return;
  }

  imapAccountsList.push({ user, pass });
  
  // Clear inputs
  imapInputUser.value = '';
  imapInputPass.value = '';
  
  // Save changes
  await window.txw.imap.saveConfig({
    accounts: imapAccountsList,
    running: imapRunning
  });
  
  renderImapAccountsTable();
});

// Start/Stop service button
imapServiceToggleBtn?.addEventListener('click', async () => {
  if (imapRunning) {
    // Stop Service
    const res = await window.txw.imap.stop();
    if (res.ok) {
      updateImapStatusUI(false);
    } else {
      openModal('Lỗi', `<p>${res.error}</p>`);
    }
  } else {
    // Start Service
    if (imapAccountsList.length === 0) {
      openModal('Lỗi', '<p>Vui lòng thêm ít nhất một tài khoản Gmail trước khi bắt đầu.</p>');
      return;
    }

    const res = await window.txw.imap.start();
    if (res.ok) {
      updateImapStatusUI(true);
    } else {
      openModal('Lỗi', `<p>${res.error}</p>`);
    }
  }
});

// First Init app
(async () => {
  applyLanguage(currentLanguage);

  try {
    await window.txw.setup();
  } catch (error) {
    setupStatus.textContent = t('setupFailed');
    console.error(error);
  }

  // Query initial IMAP service status
  try {
    const imapConfig = await window.txw.imap.getConfig();
    updateImapStatusUI(imapConfig.running);
  } catch (err) {
    console.error('Failed to fetch IMAP service status:', err);
  }

  await refreshInstances();
  splash.classList.add('hidden');
  appRoot.classList.remove('hidden');
})();
