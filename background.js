importScripts('extension-api.js');

const PREVIEW_DATA_PREFIX = 'previewData:';
const PREVIEW_TAB_PREFIX = 'previewTab:';
const extensionApi = globalThis.ExtensionApi;
const browserApi = extensionApi.raw;

function getPreviewDataKey(previewKey) {
  return `${PREVIEW_DATA_PREFIX}${previewKey}`;
}

function getPreviewTabKey(tabId) {
  return `${PREVIEW_TAB_PREFIX}${tabId}`;
}

async function openImagePreview(blobUrl, filename = '', deviceLabels = []) {
  const previewKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const previewDataKey = getPreviewDataKey(previewKey);
  const previewUrl =
    extensionApi.getUrl('preview.html') +
    `?previewKey=${encodeURIComponent(previewKey)}`;

  await extensionApi.sessionStorageSet({
    [previewDataKey]: {
      blobUrl,
      filename,
      deviceLabels
    }
  });

  try {
    const tab = await extensionApi.tabsCreate({ url: previewUrl });
    const previewTabKey = getPreviewTabKey(tab.id);

    await extensionApi.sessionStorageSet({
      [previewTabKey]: previewDataKey
    });

    return { tabId: tab.id, previewKey };
  } catch (error) {
    await extensionApi.sessionStorageRemove(previewDataKey);
    throw error;
  }
}

browserApi.action.onClicked.addListener(async (tab) => {
  const appUrl = extensionApi.getUrl('app.html') + '?testUrl=' + encodeURIComponent(tab.url);
  try {
    await extensionApi.tabsSendMessage(tab.id, { type: 'toggle-tester', appUrl });
  } catch {
    await extensionApi.executeScript({
      target: { tabId: tab.id },
      files: ['extension-api.js', 'content.js']
    });
    await extensionApi.tabsSendMessage(tab.id, { type: 'toggle-tester', appUrl });
  }
});

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'capture-visible-tab') {
    const windowId = sender.tab?.windowId;
    const format = message?.format === 'png' ? 'png' : 'jpeg';
    const options = { format };

    if (format === 'jpeg' && Number.isFinite(message?.quality)) {
      options.quality = Math.max(1, Math.min(100, Math.round(message.quality)));
    }

    extensionApi
      .captureVisibleTab(windowId ?? null, options)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((error) => sendResponse({ error: error.message }));

    return true;
  }

  if (message?.type === 'open-image-preview') {
    openImagePreview(message.blobUrl, message.filename, message.deviceLabels)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'get-image-preview') {
    const previewDataKey = getPreviewDataKey(message.previewKey);
    extensionApi
      .sessionStorageGet(previewDataKey)
      .then((result) => sendResponse({ preview: result[previewDataKey] || null }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'clear-image-preview') {
    const previewDataKey = getPreviewDataKey(message.previewKey);
    extensionApi
      .sessionStorageRemove(previewDataKey)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  return false;
});

browserApi.tabs.onRemoved.addListener((tabId) => {
  const previewTabKey = getPreviewTabKey(tabId);

  extensionApi
    .sessionStorageGet(previewTabKey)
    .then((result) => {
      const previewDataKey = result[previewTabKey];
      if (!previewDataKey) {
        return;
      }

      return extensionApi.sessionStorageRemove([previewTabKey, previewDataKey]);
    })
    .catch(() => {});
});
