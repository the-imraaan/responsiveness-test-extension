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
  if (message?.type !== 'capture-visible-tab') {
    return false;
  }

  const windowId = sender.tab?.windowId;

  chrome.tabs.captureVisibleTab(windowId ?? null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }

    sendResponse({ dataUrl });
  });

  return true;
});
