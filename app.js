const APP_CHANNEL = 'responsive-tester';
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
  desktop: DEFAULT_SCALE
};
const MIN_SCALE = 0.2;
const MAX_SCALE = 1;
const SCALE_STEP = 0.1;
const INITIAL_STRIP_LOCK_MS = 2000;
const SCROLL_LEADER_TTL_MS = 320;

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
  }
];
const DEVICE_GROUPS_BY_ID = Object.fromEntries(DEVICE_GROUPS.map((group) => [group.id, group]));

const screens = document.getElementById('screens');
const toolbar = document.querySelector('.toolbar');
const screenshotButton = document.getElementById('screenshot');
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

  devices.forEach((device) => {
    const chip = document.createElement('span');
    chip.className = 'device-chip';
    chip.textContent = formatDeviceBadge(device);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'device-chip-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = `Remove ${device.name}`;
    removeBtn.addEventListener('click', () => removeDevice(device.id));

    chip.appendChild(removeBtn);
    deviceBar.appendChild(chip);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'device-add-btn';
  addBtn.textContent = '+ Add device';
  addBtn.addEventListener('click', () => showAddDeviceForm(addBtn));
  deviceBar.appendChild(addBtn);
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

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not prepare the screenshot file.'));
        return;
      }

      resolve(blob);
    }, type);
  });
}

function storageGet(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(result);
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response?.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(downloadId);
    });
  });
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

async function setScrollSyncEnabled(nextValue, persist = true) {
  scrollSyncEnabled = Boolean(nextValue);

  if (!scrollSyncEnabled) {
    clearScrollLeader();
  }

  updateScrollSyncToggle();
  broadcastScrollSyncState();
  refreshControls();

  if (persist) {
    await persistScrollSync();
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

async function captureVisibleTab() {
  const response = await sendRuntimeMessage({ type: 'capture-visible-tab' });
  return response.dataUrl;
}

function getCaptureOffsets(totalWidth, viewportWidth) {
  const offsets = [0];
  const maxOffset = Math.max(0, totalWidth - viewportWidth);
  let nextOffset = 0;

  while (nextOffset < maxOffset) {
    nextOffset = Math.min(maxOffset, nextOffset + viewportWidth);
    if (nextOffset === offsets[offsets.length - 1]) {
      break;
    }

    offsets.push(nextOffset);
  }

  return offsets;
}

async function settleBeforeCapture() {
  await waitForNextFrame();
  await waitForNextFrame();
  await waitForTimeout(120);
}

async function captureAllDeviceViews() {
  const totalWidth = Math.round(screens.scrollWidth);
  const viewportWidth = Math.round(screens.clientWidth);
  const viewportHeight = Math.round(screens.clientHeight);

  if (!totalWidth || !viewportWidth || !viewportHeight) {
    throw new Error('There is no device strip available to capture.');
  }

  const captureRect = screens.getBoundingClientRect();
  const offsets = getCaptureOffsets(totalWidth, viewportWidth);
  const originalScrollLeft = screens.scrollLeft;
  const captures = [];

  try {
    for (const offset of offsets) {
      screens.scrollLeft = offset;
      await settleBeforeCapture();

      const dataUrl = await captureVisibleTab();
      const image = await loadImage(dataUrl);
      captures.push({ offset, image });
    }
  } finally {
    screens.scrollLeft = originalScrollLeft;
  }

  await settleBeforeCapture();

  const firstCapture = captures[0];
  const scaleX = firstCapture.image.naturalWidth / window.innerWidth;
  const scaleY = firstCapture.image.naturalHeight / window.innerHeight;
  const sourceX = Math.max(0, Math.round(captureRect.left * scaleX));
  const sourceY = Math.max(0, Math.round(captureRect.top * scaleY));
  const sourceHeight = Math.max(1, Math.round(viewportHeight * scaleY));
  const stitchedWidth = Math.max(1, Math.round(totalWidth * scaleX));

  const canvas = document.createElement('canvas');
  canvas.width = stitchedWidth;
  canvas.height = sourceHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not prepare the screenshot canvas.');
  }

  context.fillStyle = '#eef2f6';
  context.fillRect(0, 0, canvas.width, canvas.height);

  captures.forEach(({ offset, image }) => {
    const sourceWidth = Math.max(1, Math.min(Math.round(viewportWidth * scaleX), image.naturalWidth - sourceX));
    const sourceCropHeight = Math.max(1, Math.min(sourceHeight, image.naturalHeight - sourceY));
    const destinationX = Math.round(offset * scaleX);
    const drawWidth = Math.max(1, Math.min(sourceWidth, canvas.width - destinationX));
    const drawHeight = Math.max(1, Math.min(sourceCropHeight, canvas.height));

    context.drawImage(
      image,
      sourceX,
      sourceY,
      drawWidth,
      drawHeight,
      destinationX,
      0,
      drawWidth,
      drawHeight
    );
  });

  return canvasToBlob(canvas);
}

async function handleScreenshot() {
  screenshotButton.disabled = true;

  try {
    const screenshotBlob = await captureAllDeviceViews();
    await downloadBlob(screenshotBlob, buildFilename('responsive-tester-screenshot', 'png'));
  } catch (error) {
    logError('Screenshot failed.', error);
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
  return new Promise((resolve, reject) => {
    chrome.tabCapture.capture(
      {
        video: true,
        audio: false
      },
      (stream) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!stream) {
          reject(new Error('Chrome did not return a tab stream.'));
          return;
        }

        resolve(stream);
      }
    );
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
