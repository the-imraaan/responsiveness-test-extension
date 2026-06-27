const APP_CHANNEL = 'responsive-tester';
const SCROLL_SUPPRESS_MS = 220;

let testerEnabled = false;
let frameKey = window.name || location.href;
let scrollSyncEnabled = false;
let scrollRafId = 0;
let suppressScrollUntil = 0;
let applyScrollRafId = 0;
let captureScrollRafId = 0;
let queuedScrollTarget = null;
let captureScrollbarStyle = null;
let hiddenCaptureElements = [];
let resolvedScrollRoot = null;
let markedCaptureScrollRoot = null;
let activeCaptureScrollbarRoot = null;

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

function isDocumentScrollRoot(root) {
  return root === document.scrollingElement || root === document.documentElement || root === document.body;
}

function getViewportHeightForRoot(root) {
  return isDocumentScrollRoot(root) ? window.innerHeight : root.clientHeight;
}

function getViewportWidthForRoot(root) {
  return isDocumentScrollRoot(root) ? window.innerWidth : root.clientWidth;
}

function getRootScrollTop(root) {
  return isDocumentScrollRoot(root) ? window.scrollY || root.scrollTop || 0 : root.scrollTop;
}

function getRootScrollLeft(root) {
  return isDocumentScrollRoot(root) ? window.scrollX || root.scrollLeft || 0 : root.scrollLeft;
}

function isScrollableElementCandidate(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false;
  }

  if (element === document.body || element === document.documentElement) {
    return false;
  }

  if (element.scrollHeight <= element.clientHeight + 8) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const overflowY = `${style.overflowY} ${style.overflow}`;
  if (!/(auto|scroll|overlay)/.test(overflowY) || /(hidden|clip)/.test(overflowY)) {
    return false;
  }

  const minHeight = Math.min(240, Math.round(window.innerHeight * 0.45));
  const minWidth = Math.min(320, Math.round(window.innerWidth * 0.45));
  if (element.clientHeight < minHeight || element.clientWidth < minWidth) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  const visibleWidth = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);

  return visibleHeight >= minHeight && visibleWidth >= minWidth;
}

function scoreScrollRootCandidate(element) {
  const rect = element.getBoundingClientRect();
  const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const viewportHeight = Math.max(1, window.innerHeight);
  const viewportWidth = Math.max(1, window.innerWidth);
  const heightCoverage = visibleHeight / viewportHeight;
  const widthCoverage = visibleWidth / viewportWidth;
  let score = visibleHeight * 4 + visibleWidth * 2;
  score += Math.min(element.scrollHeight, element.clientHeight * 4);
  score += Math.min(element.scrollWidth, element.clientWidth * 2);
  score += heightCoverage * 5_000 + widthCoverage * 3_000;

  if (element.scrollTop > 0 || element.scrollLeft > 0) {
    score += 100_000;
  }

  if (rect.top <= 2) {
    score += 2_500;
  }

  return score;
}

function detectScrollRoot() {
  const documentRoot = document.scrollingElement || document.documentElement || document.body;
  let bestRoot = documentRoot;
  let bestScore = Math.max(
    documentRoot.scrollHeight > window.innerHeight + 8 ? documentRoot.scrollHeight : 0,
    getRootScrollTop(documentRoot) > 0 ? 10_000 : 0
  );

  for (const element of document.querySelectorAll('body *')) {
    if (!isScrollableElementCandidate(element)) {
      continue;
    }

    const score = scoreScrollRootCandidate(element);
    if (score > bestScore) {
      bestRoot = element;
      bestScore = score;
    }
  }

  return bestRoot;
}

function getScrollRoot(forceRefresh = false) {
  if (!forceRefresh && resolvedScrollRoot?.isConnected) {
    return resolvedScrollRoot;
  }

  resolvedScrollRoot = detectScrollRoot();
  return resolvedScrollRoot;
}

function markCaptureScrollRoot(root) {
  if (markedCaptureScrollRoot && markedCaptureScrollRoot !== root) {
    markedCaptureScrollRoot.style.scrollbarWidth = '';
    markedCaptureScrollRoot.style.msOverflowStyle = '';
    markedCaptureScrollRoot.removeAttribute('data-responsive-tester-scroll-root');
    markedCaptureScrollRoot = null;
  }

  if (root instanceof HTMLElement && !isDocumentScrollRoot(root)) {
    root.setAttribute('data-responsive-tester-scroll-root', 'true');
    markedCaptureScrollRoot = root;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getScrollMetrics() {
  const root = getScrollRoot();
  const maxX = Math.max(0, root.scrollWidth - getViewportWidthForRoot(root));
  const maxY = Math.max(0, root.scrollHeight - getViewportHeightForRoot(root));
  const x = getRootScrollLeft(root);
  const y = getRootScrollTop(root);

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

  if (captureScrollRafId) {
    cancelAnimationFrame(captureScrollRafId);
    captureScrollRafId = 0;
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

function setCaptureScrollbarsHidden(hidden) {
  const root = getScrollRoot(true);

  if (hidden) {
    if (!captureScrollbarStyle) {
      captureScrollbarStyle = document.createElement('style');
      captureScrollbarStyle.id = 'responsive-tester-scrollbar-style';
      captureScrollbarStyle.textContent = `
        html, body {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        [data-responsive-tester-scroll-root="true"] {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar,
        [data-responsive-tester-scroll-root="true"]::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
        }
      `;
      document.documentElement.appendChild(captureScrollbarStyle);
    }

    markCaptureScrollRoot(root);
    activeCaptureScrollbarRoot = root;
    root.style.scrollbarWidth = 'none';
    root.style.msOverflowStyle = 'none';
    return;
  }

  if (activeCaptureScrollbarRoot) {
    activeCaptureScrollbarRoot.style.scrollbarWidth = '';
    activeCaptureScrollbarRoot.style.msOverflowStyle = '';
    activeCaptureScrollbarRoot = null;
  }
  if (markedCaptureScrollRoot) {
    markedCaptureScrollRoot.removeAttribute('data-responsive-tester-scroll-root');
    markedCaptureScrollRoot = null;
  }
  if (captureScrollbarStyle) {
    captureScrollbarStyle.remove();
    captureScrollbarStyle = null;
  }
}

function setCaptureFixedElementsHidden(hidden) {
  if (hidden) {
    if (hiddenCaptureElements.length) {
      return;
    }

    hiddenCaptureElements = Array.from(document.body.querySelectorAll('*'))
      .filter((element) => element instanceof HTMLElement)
      .map((element) => {
        const computedStyle = window.getComputedStyle(element);
        if (computedStyle.position !== 'fixed' && computedStyle.position !== 'sticky') {
          return null;
        }

        return {
          element,
          visibility: element.style.visibility,
          opacity: element.style.opacity,
          pointerEvents: element.style.pointerEvents
        };
      })
      .filter(Boolean);

    hiddenCaptureElements.forEach(({ element }) => {
      element.style.visibility = 'hidden';
      element.style.opacity = '0';
      element.style.pointerEvents = 'none';
    });

    return;
  }

  hiddenCaptureElements.forEach(({ element, visibility, opacity, pointerEvents }) => {
    element.style.visibility = visibility;
    element.style.opacity = opacity;
    element.style.pointerEvents = pointerEvents;
  });
  hiddenCaptureElements = [];
}

function areVisibleImagesReady() {
  const viewportMargin = Math.max(120, Math.round(window.innerHeight * 0.25));

  return Array.from(document.images || []).every((image) => {
    const rect = image.getBoundingClientRect();
    const isNearViewport =
      rect.bottom >= -viewportMargin &&
      rect.top <= window.innerHeight + viewportMargin &&
      rect.right >= 0 &&
      rect.left <= window.innerWidth;

    if (!isNearViewport) {
      return true;
    }

    return image.complete;
  });
}

function countBlockingAnimations() {
  if (typeof document.getAnimations !== 'function') {
    return 0;
  }

  const viewportMargin = Math.max(120, Math.round(window.innerHeight * 0.25));

  return document
    .getAnimations({ subtree: true })
    .filter((animation) => {
      if (animation.playState === 'finished' || animation.playState === 'idle') {
        return false;
      }

      const timing = animation.effect?.getTiming?.() || {};
      if (timing.iterations === Infinity) {
        return false;
      }

      const target = animation.effect?.target;
      if (!(target instanceof Element)) {
        return true;
      }

      const rect = target.getBoundingClientRect();
      return (
        rect.bottom >= -viewportMargin &&
        rect.top <= window.innerHeight + viewportMargin &&
        rect.right >= 0 &&
        rect.left <= window.innerWidth
      );
    })
    .length;
}

function waitForCaptureReady(options = {}) {
  return new Promise((resolve) => {
    const root = getScrollRoot(true);
    const minQuietMs = Math.max(70, Number(options.minQuietMs) || 100);
    const maxWaitMs = Math.max(minQuietMs, Number(options.maxWaitMs) || 1800);
    const neededStableFrames = Math.max(2, Number(options.stableFrames) || 2);
    const observerTarget = document.body || document.documentElement;
    const start = performance.now();

    let lastMutationAt = start;
    let lastTop = root.scrollTop;
    let lastHeight = root.scrollHeight;
    let lastWidth = root.scrollWidth;
    let stableFrames = 0;

    const observer = observerTarget
      ? new MutationObserver(() => {
          lastMutationAt = performance.now();
          stableFrames = 0;
        })
      : null;

    observer?.observe(observerTarget, {
      subtree: true,
      childList: true,
      attributes: true
    });

    function finish(reason) {
      observer?.disconnect();
      resolve({
        reason,
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight
      });
    }

    function tick(now) {
      const currentTop = root.scrollTop;
      const currentHeight = root.scrollHeight;
      const currentWidth = root.scrollWidth;
      const quietFor = now - lastMutationAt;
      const geometryStable =
        Math.abs(currentTop - lastTop) <= 1 &&
        currentHeight === lastHeight &&
        currentWidth === lastWidth;
      const imagesReady = areVisibleImagesReady();
      const blockingAnimations = countBlockingAnimations();

      if (geometryStable && quietFor >= minQuietMs && imagesReady && blockingAnimations === 0) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      lastTop = currentTop;
      lastHeight = currentHeight;
      lastWidth = currentWidth;

      if (stableFrames >= neededStableFrames) {
        finish('stable');
        return;
      }

      if (now - start >= maxWaitMs) {
        finish('timeout');
        return;
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
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
    const root = getScrollRoot();
    if (isDocumentScrollRoot(root)) {
      window.scrollTo({
        left: queuedScrollTarget.x,
        top: queuedScrollTarget.y,
        behavior: 'auto'
      });
    } else {
      root.scrollTo({
        left: queuedScrollTarget.x,
        top: queuedScrollTarget.y,
        behavior: 'auto'
      });
    }
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
    getScrollRoot(true);
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
    const maxX = Math.max(0, root.scrollWidth - getViewportWidthForRoot(root));
    const maxY = Math.max(0, root.scrollHeight - getViewportHeightForRoot(root));
    const progressX = typeof payload.progressX === 'number' ? clamp(payload.progressX, 0, 1) : null;
    const progressY = typeof payload.progressY === 'number' ? clamp(payload.progressY, 0, 1) : null;
    const targetX = progressX === null ? clamp(Number(payload.x) || 0, 0, maxX) : maxX * progressX;
    const targetY = progressY === null ? clamp(Number(payload.y) || 0, 0, maxY) : maxY * progressY;

    queueSyncedScroll(targetX, targetY);
  }

  if (data.type === 'get-scroll-info') {
    const root = getScrollRoot(true);
    postToParent('scroll-info', {
      scrollHeight: root.scrollHeight,
      scrollWidth: root.scrollWidth,
      viewportHeight: getViewportHeightForRoot(root),
      viewportWidth: getViewportWidthForRoot(root),
      scrollTop: getRootScrollTop(root),
      scrollLeft: getRootScrollLeft(root)
    });
    return;
  }

  if (data.type === 'set-scroll-top') {
    const root = getScrollRoot(true);
    const targetTop = Number(data.payload?.scrollTop) || 0;
    const smooth = Boolean(data.payload?.smooth);

    if (!smooth) {
      if (captureScrollRafId) {
        cancelAnimationFrame(captureScrollRafId);
        captureScrollRafId = 0;
      }
      root.scrollTop = targetTop;
      postToParent('scroll-top-applied', { scrollTop: getRootScrollTop(root) });
      return;
    }

    const maxY = Math.max(0, root.scrollHeight - getViewportHeightForRoot(root));
    const clampedTop = clamp(targetTop, 0, maxY);

    if (captureScrollRafId) {
      cancelAnimationFrame(captureScrollRafId);
      captureScrollRafId = 0;
    }

    const startTop = getRootScrollTop(root);
    if (Math.abs(startTop - clampedTop) <= 2) {
      root.scrollTop = clampedTop;
      postToParent('scroll-top-applied', { scrollTop: getRootScrollTop(root) });
      return;
    }

    const requestedBaseMs = Math.max(112, Number(data.payload?.durationMs) || 224);
    const distancePx = Math.abs(clampedTop - startTop);
    const viewportDistance = Math.max(1, getViewportHeightForRoot(root));
    const distanceRatio = clamp(distancePx / viewportDistance, 0.45, 1.8);
    const durationMs = Math.round(clamp(requestedBaseMs * distanceRatio, 112, 378));

    suppressScrollUntil = Date.now() + SCROLL_SUPPRESS_MS + durationMs;

    function easeInOutQuad(progress) {
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    }

    const start = performance.now();
    const delta = clampedTop - startTop;

    function animateCaptureScroll(now) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const nextTop = Math.round(startTop + delta * easeInOutQuad(progress));
      root.scrollTop = nextTop;

      if (progress >= 1) {
        captureScrollRafId = 0;
        root.scrollTop = clampedTop;
        postToParent('scroll-top-applied', { scrollTop: getRootScrollTop(root) });
        return;
      }

      captureScrollRafId = requestAnimationFrame(animateCaptureScroll);
    }

    captureScrollRafId = requestAnimationFrame(animateCaptureScroll);
    return;
  }

  if (data.type === 'await-capture-ready') {
    waitForCaptureReady(data.payload || {}).then((payload) => {
      postToParent('capture-ready', payload);
    });
    return;
  }

  if (data.type === 'set-overflow') {
    setCaptureScrollbarsHidden(Boolean(data.payload?.hidden));
    return;
  }

  if (data.type === 'set-fixed-elements-hidden') {
    setCaptureFixedElementsHidden(Boolean(data.payload?.hidden));
    return;
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
