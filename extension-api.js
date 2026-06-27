(function initExtensionApi(global) {
  const rawApi = global.browser ?? global.chrome ?? null;

  function makeMissingApiError(name) {
    return new Error(`Extension API "${name}" is not available in this browser.`);
  }

  function getLastError() {
    return rawApi?.runtime?.lastError ?? null;
  }

  function resolvePromiseOrCallback(name, method, context, args = []) {
    if (typeof method !== 'function') {
      return Promise.reject(makeMissingApiError(name));
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const callback = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        const lastError = getLastError();
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }

        resolve(result);
      };

      try {
        const maybePromise = method.apply(context, [...args, callback]);

        if (maybePromise && typeof maybePromise.then === 'function') {
          settled = true;
          maybePromise.then(resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  global.ExtensionApi = {
    raw: rawApi,
    getUrl(path) {
      if (!rawApi?.runtime?.getURL) {
        throw makeMissingApiError('runtime.getURL');
      }

      return rawApi.runtime.getURL(path);
    },
    sendMessage(message) {
      return resolvePromiseOrCallback('runtime.sendMessage', rawApi?.runtime?.sendMessage, rawApi?.runtime, [message]);
    },
    tabsSendMessage(tabId, message) {
      return resolvePromiseOrCallback('tabs.sendMessage', rawApi?.tabs?.sendMessage, rawApi?.tabs, [tabId, message]);
    },
    executeScript(details) {
      return resolvePromiseOrCallback('scripting.executeScript', rawApi?.scripting?.executeScript, rawApi?.scripting, [details]);
    },
    captureVisibleTab(windowId, options) {
      return resolvePromiseOrCallback('tabs.captureVisibleTab', rawApi?.tabs?.captureVisibleTab, rawApi?.tabs, [windowId, options]);
    },
    storageGet(defaults) {
      return resolvePromiseOrCallback('storage.local.get', rawApi?.storage?.local?.get, rawApi?.storage?.local, [defaults]);
    },
    storageSet(values) {
      return resolvePromiseOrCallback('storage.local.set', rawApi?.storage?.local?.set, rawApi?.storage?.local, [values]);
    },
    download(options) {
      return resolvePromiseOrCallback('downloads.download', rawApi?.downloads?.download, rawApi?.downloads, [options]);
    },
    captureTabStream(options) {
      return resolvePromiseOrCallback('tabCapture.capture', rawApi?.tabCapture?.capture, rawApi?.tabCapture, [options]);
    }
  };
})(globalThis);
