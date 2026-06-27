const PREVIEW_DATA_PREFIX = 'previewData:';
const PREVIEW_TAB_PREFIX = 'previewTab:';

function getPreviewDataKey(previewKey) {
  return `${PREVIEW_DATA_PREFIX}${previewKey}`;
}

function getPreviewTabKey(tabId) {
  return `${PREVIEW_TAB_PREFIX}${tabId}`;
}

async function openImagePreview(blobUrl, filename = '') {
  const previewKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const previewDataKey = getPreviewDataKey(previewKey);
  const previewUrl =
    chrome.runtime.getURL('preview.html') +
    `?previewKey=${encodeURIComponent(previewKey)}`;

  await chrome.storage.session.set({
    [previewDataKey]: {
      blobUrl,
      filename
    }
  });

  try {
    const tab = await chrome.tabs.create({ url: previewUrl });
    const previewTabKey = getPreviewTabKey(tab.id);

    await chrome.storage.session.set({
      [previewTabKey]: previewDataKey
    });

    return { tabId: tab.id, previewKey };
  } catch (error) {
    await chrome.storage.session.remove(previewDataKey);
    throw error;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const appUrl = chrome.runtime.getURL('app.html') + '?testUrl=' + encodeURIComponent(tab.url);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-tester', appUrl });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-tester', appUrl });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'capture-visible-tab') {
    const windowId = sender.tab?.windowId;
    const format = message?.format === 'png' ? 'png' : 'jpeg';
    const options = { format };

    if (format === 'jpeg' && Number.isFinite(message?.quality)) {
      options.quality = Math.max(1, Math.min(100, Math.round(message.quality)));
    }

    chrome.tabs.captureVisibleTab(windowId ?? null, options, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ dataUrl });
    });

    return true;
  }

  if (message?.type === 'open-image-preview') {
    openImagePreview(message.blobUrl, message.filename)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'get-image-preview') {
    const previewDataKey = getPreviewDataKey(message.previewKey);
    chrome.storage.session.get(previewDataKey, (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ preview: result[previewDataKey] || null });
    });
    return true;
  }

  if (message?.type === 'clear-image-preview') {
    const previewDataKey = getPreviewDataKey(message.previewKey);
    chrome.storage.session.remove(previewDataKey, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const previewTabKey = getPreviewTabKey(tabId);

  chrome.storage.session.get(previewTabKey, (result) => {
    if (chrome.runtime.lastError) {
      return;
    }

    const previewDataKey = result[previewTabKey];
    if (!previewDataKey) {
      return;
    }

    chrome.storage.session.remove([previewTabKey, previewDataKey]);
  });
});
