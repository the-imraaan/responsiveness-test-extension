const APP_CHANNEL = 'responsive-tester';
const extensionApi = globalThis.ExtensionApi;
const STORAGE_KEYS = {
  scale: 'responsiveTesterScale',
  scrollSync: 'responsiveTesterScrollSyncEnabled',
  deviceGroup: 'responsiveTesterDeviceGroup',
  customDevices: 'responsiveTesterCustomDevices'
};
const DEFAULT_DEVICE_GROUP_ID = 'mobile-small';
const DEFAULT_SCALE = 0.5;
const MOBILE_GROUP_DEFAULT_SCALE = 0.7;
const GROUP_DEFAULT_SCALES = {
  [DEFAULT_DEVICE_GROUP_ID]: MOBILE_GROUP_DEFAULT_SCALE,
  medium: DEFAULT_SCALE,
  desktop: DEFAULT_SCALE,
  custom: MOBILE_GROUP_DEFAULT_SCALE
};
const CAPTURE_PROFILE = {
  tabCaptureFormat: 'png',
  tabCaptureQuality: 90,
  scrollDurationMs: 224,
  scrollSettleMs: 160,
  captureQuietWindowMs: 80,
  captureMaxWaitMs: 350,
  tileOverlapPx: 120,
  stitchSearchPx: 24,
  stitchBandPx: 64
};
const MIN_SCALE = 0.2;
const MAX_SCALE = 1;
const SCALE_STEP = 0.1;
const INITIAL_STRIP_LOCK_MS = 1200;
const SCROLL_LEADER_TTL_MS = 350;
const CAPTURE_SCROLL_TIMEOUT_MS = 1000;
const CAPTURE_SCROLL_EPSILON_PX = 0;

const urlParams = new URLSearchParams(window.location.search);
const testUrl = urlParams.get('testUrl');

const DEVICE_GROUPS = [
  {
    id: 'mobile-small',
    label: 'Mobile and small',
    devices: [
      { id: 'mobile-360', name: '360px', width: 360, height: 800, heightMode: 'device' },
      { id: 'mobile-390', name: '390px', width: 390, height: 844, heightMode: 'device' },
      { id: 'mobile-428', name: '428px', width: 428, height: 926, heightMode: 'device' }
    ]
  },
  {
    id: 'medium',
    label: 'Medium screen',
    devices: [
      { id: 'medium-768', name: '768px', width: 768, heightMode: 'viewport' },
      { id: 'medium-820', name: '820px', width: 820, heightMode: 'viewport' },
      { id: 'medium-1024', name: '1024px', width: 1024, heightMode: 'viewport' }
    ]
  },
  {
    id: 'desktop',
    label: 'Desktop',
    devices: [
      { id: 'desktop-1440', name: '1440px', width: 1440, heightMode: 'viewport' },
      { id: 'desktop-1728', name: '1728px', width: 1728, heightMode: 'viewport' },
      { id: 'desktop-2560', name: '2560px', width: 2560, heightMode: 'viewport' }
    ]
  },
  {
    id: 'custom',
    label: 'Custom',
    devices: [
      { id: 'custom-375', name: '375px', width: 375, height: 812, heightMode: 'device' },
      { id: 'custom-1280', name: '1280px', width: 1280, heightMode: 'viewport' }
    ]
  }
];
const DEVICE_GROUPS_BY_ID = Object.fromEntries(DEVICE_GROUPS.map((group) => [group.id, group]));

const screens = document.getElementById('screens');
const toolbar = document.querySelector('.toolbar');
const screenshotButton = document.getElementById('screenshot');
const screenshotFullPageButton = document.getElementById('screenshotFullPage');
const recordButton = document.getElementById('record');
const stopRecordButton = document.getElementById('stopRecord');
const scrollSyncToggleButton = document.getElementById('scrollSyncToggle');
const zoomOutButton = document.getElementById('zoomOut');
const zoomInButton = document.getElementById('zoomIn');
const zoomFitButton = document.getElementById('zoomFit');
const zoomValue = document.getElementById('zoomValue');
const deviceGroupButtons = Array.from(document.querySelectorAll('[data-device-group]'));
const deviceBar = document.getElementById('deviceBar');

let devices = [];
let currentScale = MOBILE_GROUP_DEFAULT_SCALE;
let frameEntries = [];
let scrollSyncEnabled = false;
let selectedGroupId = DEFAULT_DEVICE_GROUP_ID;

let recorder = null;
let recordingStream = null;
let recordedChunks = [];
let recordingDonePromise = null;

let isRecordingStarting = false;
let isRecordingActive = false;
let screensPinnedToStartUntil = 0;
let activeScrollLeaderKey = '';
let activeScrollLeaderUntil = 0;
let customDeviceOverrides = {};

function logError(context, error) {
  console.error(`[Responsive Tester] ${context}`, error);
}

function cloneDevices(list) {
  return list
    .map((device) => ({ ...device }))
    .sort((left, right) => left.width - right.width);
}

function getDeviceGroup(groupId) {
  return DEVICE_GROUPS_BY_ID[groupId] || DEVICE_GROUPS_BY_ID[DEFAULT_DEVICE_GROUP_ID];
}

function getDefaultScaleForGroup(groupId) {
  return clampScale(GROUP_DEFAULT_SCALES[getDeviceGroup(groupId).id] ?? DEFAULT_SCALE);
}

function formatDeviceBadge(device) {
  if (device.heightMode === 'device' && device.height) {
    return `${device.width}px x ${device.height}px`;
  }

  return `${device.width}px x 100dvh`;
}

function cloneDefaultDevices() {
  return cloneDevices(getDeviceGroup(DEFAULT_DEVICE_GROUP_ID).devices);
}

function cloneGroupDevices(groupId) {
  const group = getDeviceGroup(groupId);
  const overrides = customDeviceOverrides[group.id];
  if (overrides && Array.isArray(overrides)) {
    return cloneDevices(overrides);
  }
  return cloneDevices(group.devices);
}

function getDefaultDevicesForGroup(groupId) {
  return getDeviceGroup(groupId).devices;
}

async function persistCustomDevices() {
  await storageSet({ [STORAGE_KEYS.customDevices]: customDeviceOverrides });
}

function makeDeviceId(width, height, heightMode) {
  const prefix = selectedGroupId.split('-')[0] || 'custom';
  return `${prefix}-${width}${heightMode === 'device' && height ? '-' + height : ''}`;
}

function renderDeviceBar() {
  deviceBar.innerHTML = '';
  if (!testUrl) return;

  const isCustomGroup = selectedGroupId === 'custom';

  devices.forEach((device) => {
    const chip = document.createElement('span');
    chip.className = 'device-chip';
    chip.textContent = formatDeviceBadge(device);

    if (isCustomGroup) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'device-chip-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = `Remove ${device.name}`;
      removeBtn.addEventListener('click', () => removeDevice(device.id));
      chip.appendChild(removeBtn);
    }

    deviceBar.appendChild(chip);
  });

  if (isCustomGroup) {
    const addBtn = document.createElement('button');
    addBtn.className = 'device-add-btn';
    addBtn.textContent = '+ Add device';
    addBtn.addEventListener('click', () => showAddDeviceForm(addBtn));
    deviceBar.appendChild(addBtn);
  }
}

function showAddDeviceForm(addBtn) {
  addBtn.style.display = 'none';

  const form = document.createElement('span');
  form.className = 'device-add-form';

  const widthInput = document.createElement('input');
  widthInput.type = 'number';
  widthInput.placeholder = 'Width';
  widthInput.min = '200';
  widthInput.max = '5120';

  const group = getDeviceGroup(selectedGroupId);
  const groupUsesDeviceHeight = group.devices.some((d) => d.heightMode === 'device');

  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.placeholder = 'Height';
  heightInput.min = '200';
  heightInput.max = '5120';
  if (!groupUsesDeviceHeight) heightInput.style.display = 'none';

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Add';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'device-add-cancel';
  cancelBtn.textContent = 'Cancel';

  function close() {
    form.remove();
    addBtn.style.display = '';
  }

  function submit() {
    const w = parseInt(widthInput.value, 10);
    if (!w || w < 200 || w > 5120) return;
    let h = null;
    let hMode = 'viewport';
    if (groupUsesDeviceHeight) {
      h = parseInt(heightInput.value, 10);
      if (!h || h < 200 || h > 5120) {
        h = null;
      } else {
        hMode = 'device';
      }
    }
    close();
    addDevice(w, h, hMode);
  }

  confirmBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  widthInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
  heightInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });

  form.append(widthInput, heightInput, confirmBtn, cancelBtn);
  deviceBar.appendChild(form);
  widthInput.focus();
}

async function addDevice(width, height, heightMode) {
  const id = makeDeviceId(width, height, heightMode);
  const existing = devices.find((d) => d.width === width && (heightMode !== 'device' || d.height === height));
  if (existing) return;

  const newDevice = {
    id,
    name: `${width}px`,
    width,
    heightMode
  };
  if (heightMode === 'device' && height) {
    newDevice.height = height;
  }

  devices.push(newDevice);
  devices.sort((a, b) => a.width - b.width);
  customDeviceOverrides[selectedGroupId] = devices.map((d) => ({ ...d }));
  await persistCustomDevices();
  renderScreens();
  renderDeviceBar();
}

async function removeDevice(deviceId) {
  devices = devices.filter((d) => d.id !== deviceId);
  customDeviceOverrides[selectedGroupId] = devices.map((d) => ({ ...d }));
  await persistCustomDevices();
  renderScreens();
  renderDeviceBar();
}

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value) || DEFAULT_SCALE));
}

function buildFilename(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.${extension}`;
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function waitForTimeout(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the captured screenshot.'));
    image.src = src;
  });
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not prepare the screenshot file.'));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB

async function canvasToJpegBlobWithSizeLimit(canvas) {
  let blob = null;

  // Keep screenshot exports as JPG while still respecting the size cap.
  const qualities = [0.92, 0.85, 0.75, 0.6, 0.45];
  for (const q of qualities) {
    blob = await canvasToBlob(canvas, 'image/jpeg', q);
    if (blob.size <= MAX_SCREENSHOT_BYTES) {
      return { blob, extension: 'jpg' };
    }
  }

  // If still too large, scale down the canvas.
  let scale = 0.75;
  while (scale >= 0.25) {
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = Math.round(canvas.width * scale);
    smallCanvas.height = Math.round(canvas.height * scale);
    const ctx = smallCanvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
    blob = await canvasToBlob(smallCanvas, 'image/jpeg', 0.7);
    if (blob.size <= MAX_SCREENSHOT_BYTES) {
      return { blob, extension: 'jpg' };
    }
    scale -= 0.15;
  }

  // Return whatever we have as last resort
  return { blob, extension: 'jpg' };
}

function storageGet(defaults) {
  return extensionApi.storageGet(defaults);
}

function storageSet(values) {
  return extensionApi.storageSet(values);
}

function sendRuntimeMessage(message) {
  return extensionApi.sendMessage(message).then((response) => {
    if (response?.error) {
      throw new Error(response.error);
    }

    return response;
  });
}

function downloadFile(options) {
  return extensionApi.download(options);
}

async function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    await downloadFile({
      url: objectUrl,
      filename,
      saveAs: false
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

function getPreviewDeviceLabels(deviceList = []) {
  return deviceList.map((device) => formatDeviceBadge(device));
}

function buildDeviceLabelSlotsFromEntries(entries = []) {
  return entries.map((entry) => ({
    label: formatDeviceBadge(entry.device),
    x: Math.round(entry.screen.offsetLeft),
    width: Math.round(entry.screen.offsetWidth)
  }));
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function getDeviceLabelOverlayMetrics(canvasWidth) {
  const fontSize = Math.max(12, Math.min(20, Math.round(canvasWidth / 90)));
  const horizontalPadding = Math.max(10, Math.round(fontSize * 0.7));
  const verticalPadding = Math.max(6, Math.round(fontSize * 0.42));
  const pillHeight = fontSize + verticalPadding * 2;
  const radius = Math.round(pillHeight / 2);
  const topOffset = Math.max(12, Math.round(fontSize * 0.65));
  const sideInset = Math.max(8, Math.round(fontSize * 0.45));
  const stripHeight = pillHeight + topOffset * 2;

  return {
    fontSize,
    horizontalPadding,
    verticalPadding,
    pillHeight,
    radius,
    topOffset,
    sideInset,
    stripHeight
  };
}

function drawDeviceLabelsOnCanvas(canvas, deviceSlots = []) {
  if (!deviceSlots.length) {
    return 0;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return 0;
  }

  const {
    fontSize,
    horizontalPadding,
    pillHeight,
    radius,
    topOffset,
    sideInset,
    stripHeight
  } = getDeviceLabelOverlayMetrics(canvas.width);

  context.save();
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  deviceSlots.forEach((slot) => {
    if (!slot?.label || !slot.width) {
      return;
    }

    const textWidth = context.measureText(slot.label).width;
    const maxPillWidth = Math.max(48, slot.width - sideInset * 2);
    const pillWidth = Math.max(
      Math.min(maxPillWidth, Math.ceil(textWidth + horizontalPadding * 2)),
      Math.min(maxPillWidth, 48)
    );
    const pillX = Math.round(slot.x + Math.max(sideInset, (slot.width - pillWidth) / 2));
    const pillY = topOffset;

    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    drawRoundedRect(context, pillX, pillY, pillWidth, pillHeight, radius);
    context.fill();

    context.strokeStyle = 'rgba(148, 163, 184, 0.9)';
    context.lineWidth = 1;
    drawRoundedRect(context, pillX, pillY, pillWidth, pillHeight, radius);
    context.stroke();

    context.fillStyle = '#102033';
    context.fillText(slot.label, pillX + pillWidth / 2, pillY + pillHeight / 2 + 0.5);
  });

  context.restore();
  return stripHeight;
}

async function openBlobInNewTab(blob, deviceLabels = []) {
  const blobUrl = URL.createObjectURL(blob);
  const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;

  try {
    await sendRuntimeMessage({
      type: 'open-image-preview',
      blobUrl,
      filename,
      deviceLabels
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60_000);
  }
}

function getAvailableHeight() {
  return Math.max(200, window.innerHeight - toolbar.offsetHeight - deviceBar.offsetHeight - 24);
}

function updateZoomDisplay() {
  zoomValue.textContent = `${Math.round(currentScale * 100)}%`;
}

function updateScrollSyncToggle() {
  scrollSyncToggleButton.textContent = scrollSyncEnabled ? 'Scroll Sync On' : 'Scroll Sync Off';
  scrollSyncToggleButton.dataset.active = scrollSyncEnabled ? 'true' : 'false';
  scrollSyncToggleButton.setAttribute('aria-pressed', scrollSyncEnabled ? 'true' : 'false');
}

function updateDeviceGroupButtons() {
  deviceGroupButtons.forEach((button) => {
    const isActive = button.dataset.deviceGroup === selectedGroupId;
    button.dataset.active = isActive ? 'true' : 'false';
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function refreshControls() {
  const hasUrl = Boolean(testUrl);
  const hasDevices = devices.length > 0;
  const disableEditing = !hasUrl || isRecordingStarting || isRecordingActive;

  screenshotButton.disabled = !hasUrl || !hasDevices || isRecordingStarting || isRecordingActive;
  screenshotFullPageButton.disabled = !hasUrl || !hasDevices || isRecordingStarting || isRecordingActive;
  recordButton.disabled = !hasUrl || !hasDevices || isRecordingStarting || isRecordingActive;

  recordButton.style.display = isRecordingActive ? 'none' : '';
  stopRecordButton.style.display = isRecordingActive ? '' : 'none';
  stopRecordButton.disabled = !isRecordingActive;

  zoomOutButton.disabled = disableEditing || !hasDevices;
  zoomInButton.disabled = disableEditing || !hasDevices;
  zoomFitButton.disabled = disableEditing || !hasDevices;
  scrollSyncToggleButton.disabled = !hasUrl || !hasDevices;
  deviceGroupButtons.forEach((button) => {
    button.disabled = !hasUrl || disableEditing;
  });

  updateScrollSyncToggle();
  updateDeviceGroupButtons();
}

function keepScreensPinnedToStart() {
  if (Date.now() > screensPinnedToStartUntil) {
    return;
  }

  screens.scrollLeft = 0;
  window.requestAnimationFrame(() => {
    if (Date.now() <= screensPinnedToStartUntil) {
      screens.scrollLeft = 0;
    }
  });
}

function clearScrollLeader() {
  activeScrollLeaderKey = '';
  activeScrollLeaderUntil = 0;
}

function getActiveScrollLeaderKey() {
  if (!activeScrollLeaderKey || Date.now() > activeScrollLeaderUntil) {
    clearScrollLeader();
    return '';
  }

  return activeScrollLeaderKey;
}

function claimScrollLeader(frameKey) {
  activeScrollLeaderKey = frameKey;
  activeScrollLeaderUntil = Date.now() + SCROLL_LEADER_TTL_MS;
}

function postToFrame(entry, type, payload = {}) {
  entry.iframe.contentWindow?.postMessage(
    {
      source: APP_CHANNEL,
      type,
      payload
    },
    '*'
  );
}

function initializeFrame(entry) {
  postToFrame(entry, 'tester-init', {
    frameKey: entry.frameKey,
    scrollSyncEnabled
  });
}

function applyEntryScale(entry, scale) {
  const availableHeight = getAvailableHeight();
  const usesDeviceHeight = entry.device.heightMode === 'device' && Number.isFinite(entry.device.height) && entry.device.height > 0;
  const iframeHeight = usesDeviceHeight ? entry.device.height : Math.round(availableHeight / scale);
  const screenHeight = usesDeviceHeight ? entry.device.height * scale : availableHeight;

  entry.screen.style.width = `${entry.device.width * scale}px`;
  entry.screen.style.height = `${screenHeight}px`;
  entry.iframe.style.width = `${entry.device.width}px`;
  entry.iframe.style.height = `${iframeHeight}px`;
  entry.iframe.style.transform = `scale(${scale})`;
  entry.iframe.style.transformOrigin = 'top left';
}

function createScreen(device, index) {
  const screen = document.createElement('div');
  screen.className = 'screen';

  const header = document.createElement('div');
  header.className = 'screen-header';

  const badge = document.createElement('div');
  badge.className = 'screen-badge';
  badge.textContent = formatDeviceBadge(device);

  const iframe = document.createElement('iframe');
  iframe.src = testUrl;
  iframe.name = `responsive-${device.id}-${index}`;
  iframe.title = `${device.name} preview`;
  iframe.setAttribute('loading', 'eager');
  iframe.style.border = 'none';

  const entry = {
    frameKey: iframe.name,
    device,
    screen,
    iframe,
    ready: false
  };

  iframe.addEventListener('load', () => {
    entry.ready = false;
    initializeFrame(entry);
    keepScreensPinnedToStart();
  });

  header.append(badge);
  screen.append(iframe, header);
  screens.appendChild(screen);
  frameEntries.push(entry);

  applyEntryScale(entry, currentScale);
  window.setTimeout(() => initializeFrame(entry), 900);
}

function renderScreens() {
  frameEntries = [];
  screens.innerHTML = '';
  screensPinnedToStartUntil = Date.now() + INITIAL_STRIP_LOCK_MS;
  clearScrollLeader();

  if (!testUrl) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Open the tester from the extension icon on a page you want to inspect.';
    screens.appendChild(emptyState);
    screens.style.height = `${getAvailableHeight()}px`;
    refreshControls();
    renderDeviceBar();
    return;
  }

  if (!devices.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No devices in this group. Add one below.';
    screens.appendChild(emptyState);
    screens.style.height = `${getAvailableHeight()}px`;
    refreshControls();
    renderDeviceBar();
    return;
  }

  devices.forEach(createScreen);
  updateScreenLayout();
  keepScreensPinnedToStart();
  refreshControls();
  renderDeviceBar();
}

function updateScreenLayout() {
  screens.style.height = `${getAvailableHeight()}px`;

  frameEntries.forEach((entry) => {
    applyEntryScale(entry, currentScale);
  });
}

async function persistScale() {
  await storageSet({
    [STORAGE_KEYS.scale]: currentScale
  });
}

async function persistScrollSync() {
  await storageSet({
    [STORAGE_KEYS.scrollSync]: scrollSyncEnabled
  });
}

function broadcastScrollSyncState() {
  frameEntries.forEach((entry) => {
    postToFrame(entry, 'set-scroll-sync', { enabled: scrollSyncEnabled });
  });
}

function applyScrollSyncState(nextValue, refresh = true) {
  scrollSyncEnabled = Boolean(nextValue);

  if (!scrollSyncEnabled) {
    clearScrollLeader();
  }

  updateScrollSyncToggle();
  broadcastScrollSyncState();

  if (refresh) {
    refreshControls();
  }
}

async function setScrollSyncEnabled(nextValue, persist = true) {
  applyScrollSyncState(nextValue, true);

  if (persist) {
    await persistScrollSync();
  }
}

async function runWithSuspendedScrollSync(task) {
  const shouldRestore = scrollSyncEnabled;

  if (shouldRestore) {
    applyScrollSyncState(false, false);
  }

  try {
    return await task();
  } finally {
    if (shouldRestore) {
      applyScrollSyncState(true, false);
    }
  }
}

async function setScale(nextScale, persist = true) {
  currentScale = clampScale(nextScale);
  updateZoomDisplay();
  updateScreenLayout();

  if (persist) {
    await persistScale();
  }
}

function getFitScale() {
  if (!devices.length) {
    return getDefaultScaleForGroup(selectedGroupId);
  }

  const widestDevice = Math.max(...devices.map((device) => device.width));
  const availableWidth = Math.max(320, screens.clientWidth - 24);
  return clampScale(Math.min(1, availableWidth / widestDevice));
}

async function captureVisibleTab(captureProfile = CAPTURE_PROFILE) {
  const response = await sendRuntimeMessage({
    type: 'capture-visible-tab',
    format: captureProfile.tabCaptureFormat,
    quality: captureProfile.tabCaptureQuality
  });
  return response.dataUrl;
}

function getCaptureOffsets(totalWidth, viewportWidth, overlap = 0) {
  const offsets = [0];
  const maxOffset = Math.max(0, totalWidth - viewportWidth);
  const step = Math.max(1, viewportWidth - overlap);
  let nextOffset = 0;

  while (nextOffset < maxOffset) {
    nextOffset = Math.min(maxOffset, nextOffset + step);
    if (nextOffset === offsets[offsets.length - 1]) {
      break;
    }

    offsets.push(nextOffset);
  }

  return offsets;
}

async function settleBeforeCapture(options = {}) {
  const { frames = 1, delayMs = 18 } = options;

  for (let index = 0; index < frames; index += 1) {
    await waitForNextFrame();
  }

  if (delayMs > 0) {
    await waitForTimeout(delayMs);
  }
}

function getTileOverlap(previousOffset, offset, viewportSize) {
  if (!Number.isFinite(previousOffset)) {
    return 0;
  }

  return Math.max(0, previousOffset + viewportSize - offset);
}

function setScreensCaptureMode(enabled) {
  screens.classList.toggle('is-capturing-screenshot', Boolean(enabled));
  document.body.classList.toggle('is-capturing-screenshot', Boolean(enabled));
}

function getScreensCaptureMetrics() {
  const styles = window.getComputedStyle(screens);
  const gap = parseFloat(styles.columnGap || styles.gap) || 0;

  return {
    gap
  };
}

function isScrollNearTarget(element, left, top, epsilon = CAPTURE_SCROLL_EPSILON_PX) {
  return Math.abs(element.scrollLeft - left) <= epsilon && Math.abs(element.scrollTop - top) <= epsilon;
}

async function scrollScreensForCapture(
  left = screens.scrollLeft,
  top = screens.scrollTop,
  settleMs = CAPTURE_PROFILE.scrollSettleMs
) {
  const targetLeft = Math.max(0, Math.round(left));
  const targetTop = Math.max(0, Math.round(top));

  if (!isScrollNearTarget(screens, targetLeft, targetTop)) {
    screens.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: 'smooth'
    });

    await new Promise((resolve) => {
      const start = performance.now();
      let lastLeft = screens.scrollLeft;
      let lastTop = screens.scrollTop;
      let stableFrames = 0;

      function tick(now) {
        const currentLeft = screens.scrollLeft;
        const currentTop = screens.scrollTop;
        const atTarget = isScrollNearTarget(screens, targetLeft, targetTop);
        const barelyMoving =
          Math.abs(currentLeft - lastLeft) <= CAPTURE_SCROLL_EPSILON_PX &&
          Math.abs(currentTop - lastTop) <= CAPTURE_SCROLL_EPSILON_PX;

        stableFrames = atTarget && barelyMoving ? stableFrames + 1 : 0;
        lastLeft = currentLeft;
        lastTop = currentTop;

        if (stableFrames >= 2 || now - start >= CAPTURE_SCROLL_TIMEOUT_MS) {
          screens.scrollTo({
            left: targetLeft,
            top: targetTop,
            behavior: 'auto'
          });
          resolve();
          return;
        }

        window.requestAnimationFrame(tick);
      }

      window.requestAnimationFrame(tick);
    });
  }

  await waitForTimeout(settleMs);
}

function applyEntryFullPageCaptureStyles(entry, scrollInfo, scale) {
  const viewportHeight = scrollInfo.viewportHeight;
  const scaledHeight = Math.round(viewportHeight * scale);

  entry.iframe.style.width = `${entry.device.width}px`;
  entry.iframe.style.height = `${viewportHeight}px`;
  entry.iframe.style.transform = `scale(${scale})`;
  entry.iframe.style.transformOrigin = 'top left';

  entry.screen.style.width = `${Math.round(entry.device.width * scale)}px`;
  entry.screen.style.height = `${scaledHeight}px`;
  entry.screen.style.overflow = 'hidden';
}

function restoreEntryCaptureStyles(entry, saved) {
  entry.screen.style.width = saved.screenWidth;
  entry.screen.style.height = saved.screenHeight;
  entry.screen.style.overflow = saved.screenOverflow;
  entry.iframe.style.width = saved.iframeWidth;
  entry.iframe.style.height = saved.iframeHeight;
  entry.iframe.style.transform = saved.iframeTransform;
  entry.iframe.style.transformOrigin = saved.iframeTransformOrigin;
}

function createCapturedTileCanvas(image, sourceX, sourceY, sourceWidth, sourceHeight, tileWidth, tileHeight) {
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = Math.max(1, tileWidth);
  tileCanvas.height = Math.max(1, tileHeight);

  const tileContext = tileCanvas.getContext('2d', { willReadFrequently: true });
  if (!tileContext) {
    throw new Error('Could not prepare the screenshot tile canvas.');
  }

  tileContext.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    tileCanvas.width,
    tileCanvas.height
  );

  return tileCanvas;
}

function growCanvasHeight(canvas, nextHeight) {
  const targetHeight = Math.max(canvas.height, Math.round(nextHeight));
  if (targetHeight === canvas.height) {
    return canvas;
  }

  const expandedCanvas = document.createElement('canvas');
  expandedCanvas.width = canvas.width;
  expandedCanvas.height = targetHeight;

  const expandedContext = expandedCanvas.getContext('2d');
  if (!expandedContext) {
    throw new Error('Could not resize the screenshot canvas.');
  }

  expandedContext.fillStyle = '#eef2f6';
  expandedContext.fillRect(0, 0, expandedCanvas.width, expandedCanvas.height);
  expandedContext.drawImage(canvas, 0, 0);

  return expandedCanvas;
}

async function captureDeviceFullPageCanvas(entry, scrollInfo, captureProfile) {
  const initialRect = entry.iframe.getBoundingClientRect();
  const deviceWidth = Math.max(1, Math.round(initialRect.width));
  const viewportHeightDisplay = Math.max(1, Math.round(initialRect.height));
  const displayScaleY = viewportHeightDisplay / Math.max(1, scrollInfo.viewportHeight);
  const overlapContentY = Math.max(0, Math.round(captureProfile.tileOverlapPx / Math.max(displayScaleY, 0.01)));
  const verticalOffsets = getCaptureOffsets(scrollInfo.scrollHeight, scrollInfo.viewportHeight, overlapContentY);

  let canvas = null;
  let context = null;

  try {
    for (let rowIndex = 0; rowIndex < verticalOffsets.length; rowIndex += 1) {
      const vOffset = verticalOffsets[rowIndex];

      if (rowIndex === 1) {
        postToFrame(entry, 'set-fixed-elements-hidden', { hidden: true });
        await settleBeforeCapture({ frames: 1, delayMs: 40 });
      }

      const scrollResult = await requestSetScrollTop(entry, {
        scrollTop: vOffset,
        smooth: true,
        durationMs: captureProfile.scrollDurationMs
      });
      const readyInfo = await requestCaptureReady(entry, {
        minQuietMs: captureProfile.captureQuietWindowMs,
        maxWaitMs: captureProfile.captureMaxWaitMs
      });
      const settledOffset = Number.isFinite(Number(readyInfo?.scrollTop))
        ? Number(readyInfo.scrollTop)
        : Number.isFinite(Number(scrollResult?.scrollTop))
          ? Number(scrollResult.scrollTop)
          : vOffset;
      const settledScrollHeight = Number.isFinite(Number(readyInfo?.scrollHeight))
        ? Number(readyInfo.scrollHeight)
        : scrollInfo.scrollHeight;

      const dataUrl = await captureVisibleTab(captureProfile);
      const image = await loadImage(dataUrl);
      const iframeRect = entry.iframe.getBoundingClientRect();
      const screenshotScaleX = image.naturalWidth / window.innerWidth;
      const screenshotScaleY = image.naturalHeight / window.innerHeight;
      const sourceX = Math.max(0, iframeRect.left * screenshotScaleX);
      const sourceY = Math.max(0, iframeRect.top * screenshotScaleY);

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = deviceWidth;
        canvas.height = Math.max(
          viewportHeightDisplay,
          Math.round(Math.max(scrollInfo.scrollHeight, settledScrollHeight) * displayScaleY)
        );

        context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Could not prepare the screenshot canvas.');
        }

        context.fillStyle = '#eef2f6';
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else if (settledScrollHeight > scrollInfo.scrollHeight) {
        canvas = growCanvasHeight(canvas, Math.round(settledScrollHeight * displayScaleY));
        context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Could not prepare the expanded screenshot canvas.');
        }
      }

      const tileCanvas = createCapturedTileCanvas(
        image,
        sourceX,
        sourceY,
        deviceWidth * screenshotScaleX,
        viewportHeightDisplay * screenshotScaleY,
        deviceWidth,
        viewportHeightDisplay
      );
      const destinationY = Math.max(0, Math.round(settledOffset * displayScaleY));
      const remainingHeight = Math.max(0, canvas.height - destinationY);
      const drawHeight = Math.max(0, Math.min(tileCanvas.height, remainingHeight));

      if (!drawHeight) {
        continue;
      }

      context.drawImage(tileCanvas, 0, 0, deviceWidth, drawHeight, 0, destinationY, deviceWidth, drawHeight);
    }
  } finally {
    postToFrame(entry, 'set-fixed-elements-hidden', { hidden: false });
  }

  if (!canvas) {
    throw new Error('Could not capture that device.');
  }

  return canvas;
}

function getEntryHorizontalCaptureTarget(entry) {
  const entryLeft = Math.round(entry.screen.offsetLeft);
  const entryWidth = Math.round(entry.screen.offsetWidth);
  const currentLeft = Math.round(screens.scrollLeft);
  const viewportWidth = Math.max(1, Math.round(screens.clientWidth));
  const entryRight = entryLeft + entryWidth;
  const visibleRight = currentLeft + viewportWidth;
  const maxScrollLeft = Math.max(0, Math.round(screens.scrollWidth - viewportWidth));

  let targetLeft = currentLeft;

  if (entryLeft < currentLeft) {
    targetLeft = entryLeft;
  } else if (entryRight > visibleRight) {
    targetLeft = entryRight - viewportWidth;
  }

  return Math.max(0, Math.min(maxScrollLeft, targetLeft));
}

async function scrollEntryIntoViewForCapture(entry, settleMs) {
  const targetLeft = getEntryHorizontalCaptureTarget(entry);
  await scrollScreensForCapture(targetLeft, screens.scrollTop, settleMs);
}

async function captureAllDeviceViews() {
  const captureProfile = CAPTURE_PROFILE;
  const originalScrollLeft = screens.scrollLeft;
  const originalScrollTop = screens.scrollTop;
  const captures = [];
  const deviceSlots = buildDeviceLabelSlotsFromEntries(frameEntries);

  try {
    setScreensCaptureMode(true);
    await settleBeforeCapture({ delayMs: 8 });

    const totalWidth = Math.round(screens.scrollWidth);
    const viewportWidth = Math.round(screens.clientWidth);
    const viewportHeight = Math.round(screens.clientHeight);

    if (!totalWidth || !viewportWidth || !viewportHeight) {
      throw new Error('There is no device strip available to capture.');
    }

    const captureRect = screens.getBoundingClientRect();
    const offsets = getCaptureOffsets(totalWidth, viewportWidth, captureProfile.tileOverlapPx);

    for (const offset of offsets) {
      await scrollScreensForCapture(offset, originalScrollTop, captureProfile.scrollSettleMs);
      const dataUrl = await captureVisibleTab(captureProfile);
      const image = await loadImage(dataUrl);
      captures.push({ offset, image });
    }
    await waitForNextFrame();

    const firstCapture = captures[0];
    const scaleX = firstCapture.image.naturalWidth / window.innerWidth;
    const scaleY = firstCapture.image.naturalHeight / window.innerHeight;
    const sourceX = Math.max(0, captureRect.left * scaleX);
    const sourceY = Math.max(0, captureRect.top * scaleY);
    const stitchedWidth = Math.max(1, totalWidth);
    const labelStripHeight = deviceSlots.length ? getDeviceLabelOverlayMetrics(stitchedWidth).stripHeight : 0;

    const canvas = document.createElement('canvas');
    canvas.width = stitchedWidth;
    canvas.height = Math.max(1, viewportHeight + labelStripHeight);

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not prepare the screenshot canvas.');
    }

    context.fillStyle = '#eef2f6';
    context.fillRect(0, 0, canvas.width, canvas.height);

    captures.forEach(({ offset, image }, index) => {
      const overlapLeft = getTileOverlap(offsets[index - 1], offset, viewportWidth);
      const availableWidth = Math.max(0, totalWidth - offset);
      const tileWidth = Math.max(0, Math.min(viewportWidth, availableWidth) - overlapLeft);
      const tileHeight = Math.max(1, Math.min(viewportHeight, canvas.height));
      const destinationX = offset + overlapLeft;
      const drawWidth = Math.max(1, Math.min(tileWidth, canvas.width - destinationX));
      const drawHeight = Math.max(1, Math.min(tileHeight, canvas.height));
      const tileSourceX = sourceX + overlapLeft * scaleX;

      context.drawImage(
        image,
        tileSourceX,
        sourceY,
        drawWidth * scaleX,
        drawHeight * scaleY,
        destinationX,
        labelStripHeight,
        drawWidth,
        drawHeight
      );
    });

    drawDeviceLabelsOnCanvas(canvas, deviceSlots);

    return canvasToJpegBlobWithSizeLimit(canvas);
  } finally {
    screens.scrollTo({
      left: originalScrollLeft,
      top: originalScrollTop,
      behavior: 'auto'
    });
    setScreensCaptureMode(false);
  }
}

async function handleScreenshot() {
  screenshotButton.disabled = true;

  try {
    await waitForFramesCaptureReady(frameEntries, CAPTURE_PROFILE);
    const { blob: screenshotBlob } = await runWithSuspendedScrollSync(() => captureAllDeviceViews());
    await openBlobInNewTab(screenshotBlob, getPreviewDeviceLabels(frameEntries.map((entry) => entry.device)));
  } catch (error) {
    logError('Screenshot failed.', error);
  } finally {
    refreshControls();
  }
}

function requestScrollInfo(entry) {
  return new Promise((resolve) => {
    function onMessage(event) {
      const data = event.data;
      if (!data || data.source !== APP_CHANNEL || data.type !== 'scroll-info') return;
      if (event.source !== entry.iframe.contentWindow) return;
      window.removeEventListener('message', onMessage);
      resolve(data.payload);
    }
    window.addEventListener('message', onMessage);
    postToFrame(entry, 'get-scroll-info');
    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, 3000);
  });
}

function requestSetScrollTop(entry, scrollTop) {
  return new Promise((resolve) => {
    function onMessage(event) {
      const data = event.data;
      if (!data || data.source !== APP_CHANNEL || data.type !== 'scroll-top-applied') return;
      if (event.source !== entry.iframe.contentWindow) return;
      window.removeEventListener('message', onMessage);
      resolve(data.payload);
    }
    window.addEventListener('message', onMessage);
    const payload = typeof scrollTop === 'object' && scrollTop !== null ? scrollTop : { scrollTop };
    postToFrame(entry, 'set-scroll-top', payload);
    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, 3000);
  });
}

function requestCaptureReady(entry, options = {}) {
  return new Promise((resolve) => {
    function onMessage(event) {
      const data = event.data;
      if (!data || data.source !== APP_CHANNEL || data.type !== 'capture-ready') return;
      if (event.source !== entry.iframe.contentWindow) return;
      window.removeEventListener('message', onMessage);
      resolve(data.payload || null);
    }

    window.addEventListener('message', onMessage);
    postToFrame(entry, 'await-capture-ready', options);
    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, Math.max(2500, Number(options.maxWaitMs) + 500 || 2500));
  });
}

async function waitForFramesCaptureReady(entries, captureProfile = CAPTURE_PROFILE) {
  const readyEntries = entries.filter((entry) => entry?.ready);
  if (!readyEntries.length) {
    return;
  }

  await Promise.all(
    readyEntries.map((entry) =>
      requestCaptureReady(entry, {
        minQuietMs: captureProfile.captureQuietWindowMs,
        maxWaitMs: captureProfile.captureMaxWaitMs
      }).catch(() => null)
    )
  );
}

async function captureFullPageScreenshot() {
  const captureProfile = CAPTURE_PROFILE;
  const readyEntries = frameEntries.filter((e) => e.ready);
  if (!readyEntries.length) {
    throw new Error('No device frames are ready for capture.');
  }

  const scrollInfos = await Promise.all(readyEntries.map((entry) => requestScrollInfo(entry)));

  const originalStyles = readyEntries.map((entry) => ({
    screenWidth: entry.screen.style.width,
    screenHeight: entry.screen.style.height,
    screenOverflow: entry.screen.style.overflow,
    iframeWidth: entry.iframe.style.width,
    iframeHeight: entry.iframe.style.height,
    iframeTransform: entry.iframe.style.transform,
    iframeTransformOrigin: entry.iframe.style.transformOrigin
  }));
  try {
    setScreensCaptureMode(true);
    const scale = currentScale;
    const capturedDevices = [];

    for (let index = 0; index < readyEntries.length; index += 1) {
      const entry = readyEntries[index];
      const scrollInfo = scrollInfos[index];
      if (!scrollInfo) {
        continue;
      }

      applyEntryFullPageCaptureStyles(entry, scrollInfo, scale);
      postToFrame(entry, 'set-overflow', { hidden: true });
      postToFrame(entry, 'set-fixed-elements-hidden', { hidden: false });
      await scrollEntryIntoViewForCapture(entry, captureProfile.scrollSettleMs);
      await requestSetScrollTop(entry, { scrollTop: 0, smooth: false });
      const readyInfo = await requestCaptureReady(entry, {
        minQuietMs: captureProfile.captureQuietWindowMs,
        maxWaitMs: captureProfile.captureMaxWaitMs
      });
      const captureScrollInfo = {
        ...scrollInfo,
        scrollHeight: Number.isFinite(Number(readyInfo?.scrollHeight))
          ? Math.max(scrollInfo.scrollHeight, Number(readyInfo.scrollHeight))
          : scrollInfo.scrollHeight
      };

      const canvas = await captureDeviceFullPageCanvas(entry, captureScrollInfo, captureProfile);
      capturedDevices.push({
        canvas,
        device: entry.device
      });

      restoreEntryCaptureStyles(entry, originalStyles[index]);
      postToFrame(entry, 'set-overflow', { hidden: false });
      postToFrame(entry, 'set-fixed-elements-hidden', { hidden: false });
      await settleBeforeCapture({ delayMs: 10 });
    }

    if (!capturedDevices.length) {
      throw new Error('Could not capture any device screenshots.');
    }

    const { gap } = getScreensCaptureMetrics();
    const mergedGap = Math.round(gap);
    const deviceSlots = [];
    const stitchedWidth = capturedDevices.reduce((total, capturedDevice, index) => {
      return total + capturedDevice.canvas.width + (index > 0 ? mergedGap : 0);
    }, 0);
    const stitchedHeight = capturedDevices.reduce((maxHeight, capturedDevice) => {
      return Math.max(maxHeight, capturedDevice.canvas.height);
    }, 0);
    const labelStripHeight = capturedDevices.length ? getDeviceLabelOverlayMetrics(stitchedWidth).stripHeight : 0;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, stitchedWidth);
    canvas.height = Math.max(1, stitchedHeight + labelStripHeight);

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not prepare the screenshot canvas.');
    }

    context.fillStyle = '#eef2f6';
    context.fillRect(0, 0, canvas.width, canvas.height);

    let currentX = 0;
    capturedDevices.forEach((capturedDevice, index) => {
      if (index > 0) {
        currentX += mergedGap;
      }

      const deviceCanvas = capturedDevice.canvas;
      context.drawImage(deviceCanvas, currentX, labelStripHeight);
      deviceSlots.push({
        label: formatDeviceBadge(capturedDevice.device),
        x: currentX,
        width: deviceCanvas.width
      });
      currentX += deviceCanvas.width;
    });

    drawDeviceLabelsOnCanvas(canvas, deviceSlots);

    return canvasToJpegBlobWithSizeLimit(canvas);
  } finally {
    readyEntries.forEach((entry, i) => {
      restoreEntryCaptureStyles(entry, originalStyles[i]);
      postToFrame(entry, 'set-overflow', { hidden: false });
      postToFrame(entry, 'set-fixed-elements-hidden', { hidden: false });
    });

    updateScreenLayout();
    setScreensCaptureMode(false);
  }
}

async function handleFullPageScreenshot() {
  screenshotFullPageButton.disabled = true;

  try {
    const readyEntries = frameEntries.filter((entry) => entry.ready);
    const { blob: screenshotBlob } = await runWithSuspendedScrollSync(() => captureFullPageScreenshot());
    await openBlobInNewTab(screenshotBlob, getPreviewDeviceLabels(readyEntries.map((entry) => entry.device)));
  } catch (error) {
    logError('Full page screenshot failed.', error);
  } finally {
    refreshControls();
  }
}

function getRecorderMimeType() {
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function captureActiveTab() {
  return extensionApi
    .captureTabStream({
      video: true,
      audio: false
    })
    .then((stream) => {
      if (!stream) {
        throw new Error('The browser did not return a tab stream.');
      }

      return stream;
    });
}

async function getRecordingStream() {
  try {
    return await captureActiveTab();
  } catch (error) {
    return navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser'
      },
      audio: false
    });
  }
}

function resetRecordingState() {
  isRecordingActive = false;
  isRecordingStarting = false;
  recorder = null;
  recordingDonePromise = null;
  refreshControls();
}

async function saveRecording() {
  if (!recordedChunks.length) {
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      recordingStream = null;
    }

    recordedChunks = [];
    resetRecordingState();
    return;
  }

  const mimeType = recorder?.mimeType || 'video/webm';
  const blob = new Blob(recordedChunks, { type: mimeType });

  try {
    await downloadBlob(blob, buildFilename('responsive-tester-recording', 'webm'));
  } finally {
    recordedChunks = [];

    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      recordingStream = null;
    }

    resetRecordingState();
  }
}

async function startRecording() {
  if (isRecordingActive || isRecordingStarting) {
    return;
  }

  isRecordingStarting = true;
  refreshControls();

  try {
    recordingStream = await getRecordingStream();
    recordedChunks = [];

    const mimeType = getRecorderMimeType();
    recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    recordingDonePromise = new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          saveRecording().finally(resolve);
        },
        { once: true }
      );
    });

    recordingStream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (recorder && recorder.state !== 'inactive') {
          stopRecording();
        }
      });
    });

    recorder.start(250);
    isRecordingStarting = false;
    isRecordingActive = true;
    refreshControls();
  } catch (error) {
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      recordingStream = null;
    }

    recordedChunks = [];
    resetRecordingState();
    logError('Recording failed.', error);
  }
}

async function stopRecording() {
  if (!recorder || recorder.state === 'inactive') {
    return;
  }

  stopRecordButton.disabled = true;
  recorder.stop();
  await recordingDonePromise;
}

async function handleSelectDeviceGroup(groupId) {
  selectedGroupId = getDeviceGroup(groupId).id;
  devices = cloneGroupDevices(selectedGroupId);
  currentScale = getDefaultScaleForGroup(selectedGroupId);
  updateZoomDisplay();
  await storageSet({
    [STORAGE_KEYS.deviceGroup]: selectedGroupId,
    [STORAGE_KEYS.scale]: currentScale
  });
  renderScreens();
  renderDeviceBar();
}

async function loadState() {
  const savedState = await storageGet({
    [STORAGE_KEYS.scale]: null,
    [STORAGE_KEYS.scrollSync]: false,
    [STORAGE_KEYS.deviceGroup]: DEFAULT_DEVICE_GROUP_ID,
    [STORAGE_KEYS.customDevices]: {}
  });

  customDeviceOverrides = savedState[STORAGE_KEYS.customDevices] || {};

  selectedGroupId = getDeviceGroup(savedState[STORAGE_KEYS.deviceGroup]).id;
  devices = cloneGroupDevices(selectedGroupId);
  currentScale = Number.isFinite(Number(savedState[STORAGE_KEYS.scale]))
    ? clampScale(savedState[STORAGE_KEYS.scale])
    : getDefaultScaleForGroup(selectedGroupId);
  scrollSyncEnabled = Boolean(savedState[STORAGE_KEYS.scrollSync]);
  updateZoomDisplay();
  updateScrollSyncToggle();
  updateDeviceGroupButtons();

  if (!devices.length) {
    devices = cloneDefaultDevices();
  }

  await storageSet({
    [STORAGE_KEYS.scale]: currentScale,
    [STORAGE_KEYS.scrollSync]: scrollSyncEnabled,
    [STORAGE_KEYS.deviceGroup]: selectedGroupId
  });
}

function handleFrameMessage(event) {
  const data = event.data;

  if (!data || data.source !== APP_CHANNEL || typeof data.type !== 'string') {
    return;
  }

  const sourceEntry = frameEntries.find((entry) => entry.iframe.contentWindow === event.source);
  if (!sourceEntry) {
    return;
  }

  if (data.type === 'frame-ready') {
    sourceEntry.ready = true;
    return;
  }

  if (data.type === 'frame-click') {
    frameEntries.forEach((entry) => {
      if (entry.frameKey !== sourceEntry.frameKey) {
        postToFrame(entry, 'apply-click', data.payload || {});
      }
    });
    return;
  }

  if (!scrollSyncEnabled) {
    return;
  }

  if (data.type === 'frame-scroll') {
    const currentLeaderKey = getActiveScrollLeaderKey();
    if (currentLeaderKey && currentLeaderKey !== sourceEntry.frameKey) {
      return;
    }

    claimScrollLeader(sourceEntry.frameKey);

    frameEntries.forEach((entry) => {
      if (entry.frameKey !== sourceEntry.frameKey) {
        postToFrame(entry, 'apply-scroll', data.payload || {});
      }
    });
  }
}

function registerEventListeners() {
  window.addEventListener('resize', updateScreenLayout);
  window.addEventListener('message', handleFrameMessage);

  screenshotButton.addEventListener('click', handleScreenshot);
  screenshotFullPageButton.addEventListener('click', handleFullPageScreenshot);
  recordButton.addEventListener('click', startRecording);
  stopRecordButton.addEventListener('click', stopRecording);
  scrollSyncToggleButton.addEventListener('click', () => {
    setScrollSyncEnabled(!scrollSyncEnabled).catch((error) => {
      logError('Could not update scroll sync.', error);
    });
  });

  zoomOutButton.addEventListener('click', () => {
    setScale(currentScale - SCALE_STEP).catch((error) => {
      logError('Zoom update failed.', error);
    });
  });

  zoomInButton.addEventListener('click', () => {
    setScale(currentScale + SCALE_STEP).catch((error) => {
      logError('Zoom update failed.', error);
    });
  });

  zoomFitButton.addEventListener('click', () => {
    setScale(getFitScale()).catch((error) => {
      logError('Zoom update failed.', error);
    });
  });

  deviceGroupButtons.forEach((button) => {
    button.addEventListener('click', () => {
      handleSelectDeviceGroup(button.dataset.deviceGroup || DEFAULT_DEVICE_GROUP_ID).catch((error) => {
        logError('Could not apply that device group.', error);
      });
    });
  });
}

async function boot() {
  registerEventListeners();

  if (!testUrl) {
    devices = cloneDefaultDevices();
    currentScale = getDefaultScaleForGroup(DEFAULT_DEVICE_GROUP_ID);
    updateZoomDisplay();
    renderScreens();
    return;
  }

  try {
    await loadState();
    renderScreens();
  } catch (error) {
    devices = cloneDefaultDevices();
    currentScale = getDefaultScaleForGroup(DEFAULT_DEVICE_GROUP_ID);
    scrollSyncEnabled = false;
    selectedGroupId = DEFAULT_DEVICE_GROUP_ID;
    updateZoomDisplay();
    updateScrollSyncToggle();
    updateDeviceGroupButtons();
    renderScreens();
    logError('Loaded with default settings after a storage error.', error);
  }
}

boot();
