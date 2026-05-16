const APP_CHANNEL = 'responsive-tester';
const SCROLL_SUPPRESS_MS = 220;

let testerEnabled = false;
let frameKey = window.name || location.href;
let scrollSyncEnabled = false;
let scrollRafId = 0;
let suppressScrollUntil = 0;
let applyScrollRafId = 0;
let queuedScrollTarget = null;

function postToParent(type, payload = {}) {
  if (!testerEnabled || window.parent === window) {
    return;
  }

  window.parent.postMessage(
    {
      source: APP_CHANNEL,
      type,
      frameKey,
      payload
    },
    '*'
  );
}

function getScrollRoot() {
  return document.scrollingElement || document.documentElement || document.body;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getScrollMetrics() {
  const root = getScrollRoot();
  const maxX = Math.max(0, root.scrollWidth - window.innerWidth);
  const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
  const x = window.scrollX || root.scrollLeft || 0;
  const y = window.scrollY || root.scrollTop || 0;

  return {
    x,
    y,
    maxX,
    maxY,
    progressX: maxX > 0 ? x / maxX : 0,
    progressY: maxY > 0 ? y / maxY : 0
  };
}

function resetQueuedScrollWork() {
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = 0;
  }

  if (applyScrollRafId) {
    cancelAnimationFrame(applyScrollRafId);
    applyScrollRafId = 0;
  }

  queuedScrollTarget = null;
}

function setScrollSyncEnabled(enabled) {
  scrollSyncEnabled = Boolean(enabled);

  if (!scrollSyncEnabled) {
    suppressScrollUntil = 0;
    resetQueuedScrollWork();
  }
}

function queueSyncedScroll(targetX, targetY) {
  queuedScrollTarget = { x: targetX, y: targetY };

  if (applyScrollRafId) {
    return;
  }

  applyScrollRafId = requestAnimationFrame(() => {
    applyScrollRafId = 0;

    if (!queuedScrollTarget) {
      return;
    }

    suppressScrollUntil = Date.now() + SCROLL_SUPPRESS_MS;
    window.scrollTo({
      left: queuedScrollTarget.x,
      top: queuedScrollTarget.y,
      behavior: 'auto'
    });
    queuedScrollTarget = null;
  });
}

function scheduleScrollSync() {
  if (scrollRafId || !scrollSyncEnabled || Date.now() < suppressScrollUntil) {
    return;
  }

  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = 0;

    if (!scrollSyncEnabled || Date.now() < suppressScrollUntil) {
      return;
    }

    postToParent('frame-scroll', getScrollMetrics());
  });
}

function escapeAttributeValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildSelector(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const path = [];
  let current = element;

  while (current && current instanceof Element && current !== document.documentElement) {
    let segment = current.localName;

    if (!segment) {
      break;
    }

    const testId = current.getAttribute('data-testid');
    if (testId) {
      segment += `[data-testid="${escapeAttributeValue(testId)}"]`;
    }

    const name = current.getAttribute('name');
    if (name && !segment.includes('[name=')) {
      segment += `[name="${escapeAttributeValue(name)}"]`;
    }

    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.localName === current.localName);
      if (sameTagSiblings.length > 1) {
        segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
    }

    path.unshift(segment);

    const selector = path.join(' > ');
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (error) {
      break;
    }

    current = parent;
  }

  return path.join(' > ') || null;
}

function dispatchSyntheticClick(element) {
  if (!(element instanceof Element)) {
    return;
  }

  if (element instanceof HTMLElement) {
    element.focus({ preventScroll: true });
  }

  if (element instanceof HTMLLabelElement && element.control) {
    element.control.focus({ preventScroll: true });
    element.control.click();
    return;
  }

  if (typeof element.click === 'function') {
    element.click();
  }
}

function applySyncedClick(payload) {
  let target = null;

  if (payload.selector) {
    try {
      target = document.querySelector(payload.selector);
    } catch (error) {
      target = null;
    }
  }

  if (!target && typeof payload.x === 'number' && typeof payload.y === 'number') {
    target = document.elementFromPoint(payload.x, payload.y);
  }

  if (target) {
    dispatchSyntheticClick(target);
  }
}

window.addEventListener(
  'click',
  (event) => {
    if (!testerEnabled || !event.isTrusted) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const formTarget = target?.closest?.('input, textarea, select, option, label');
    if (!target || formTarget) {
      return;
    }

    postToParent('frame-click', {
      selector: buildSelector(target),
      x: event.clientX,
      y: event.clientY
    });
  },
  true
);

window.addEventListener(
  'scroll',
  () => {
    if (!testerEnabled || !scrollSyncEnabled || Date.now() < suppressScrollUntil) {
      return;
    }

    scheduleScrollSync();
  },
  { capture: true, passive: true }
);

window.addEventListener('message', (event) => {
  const data = event.data;

  if (!data || data.source !== APP_CHANNEL || typeof data.type !== 'string') {
    return;
  }

  if (data.type === 'tester-init') {
    testerEnabled = true;
    frameKey = data.payload?.frameKey || data.frameKey || window.name || frameKey;
    setScrollSyncEnabled(Boolean(data.payload?.scrollSyncEnabled));
    postToParent('frame-ready', {
      url: location.href,
      title: document.title
    });
    return;
  }

  if (!testerEnabled) {
    return;
  }

  if (data.type === 'set-scroll-sync') {
    setScrollSyncEnabled(Boolean(data.payload?.enabled));
    return;
  }

  if (data.type === 'apply-click') {
    applySyncedClick(data.payload || {});
    return;
  }

  if (data.type === 'apply-scroll' && scrollSyncEnabled) {
    const payload = data.payload || {};
    const root = getScrollRoot();
    const maxX = Math.max(0, root.scrollWidth - window.innerWidth);
    const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
    const progressX = typeof payload.progressX === 'number' ? clamp(payload.progressX, 0, 1) : null;
    const progressY = typeof payload.progressY === 'number' ? clamp(payload.progressY, 0, 1) : null;
    const targetX = progressX === null ? clamp(Number(payload.x) || 0, 0, maxX) : maxX * progressX;
    const targetY = progressY === null ? clamp(Number(payload.y) || 0, 0, maxY) : maxY * progressY;

    queueSyncedScroll(targetX, targetY);
  }
});

/* ── Tester overlay (top frame only) ── */
const OVERLAY_ID = 'responsive-tester-overlay';

function toggleTesterOverlay(appUrl) {
  if (window !== window.top) return;

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
    document.documentElement.style.overflow = '';
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;background:#eef2f6;';

  const iframe = document.createElement('iframe');
  iframe.src = appUrl;
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  iframe.setAttribute('allow', 'display-capture');

  overlay.appendChild(iframe);
  document.documentElement.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'toggle-tester' && message.appUrl) {
    toggleTesterOverlay(message.appUrl);
    sendResponse({ ok: true });
  }
  return false;
});
