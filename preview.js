const urlParams = new URLSearchParams(window.location.search);
const previewKey = urlParams.get('previewKey') || '';
const previewImage = document.getElementById('previewImage');
const previewStatus = document.getElementById('previewStatus');
const previewName = document.getElementById('previewName');

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

async function loadPreview() {
  if (!previewKey) {
    previewStatus.textContent = 'Missing preview key.';
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: 'get-image-preview',
      previewKey
    });
    const preview = response?.preview;

    if (!preview?.blobUrl) {
      previewStatus.textContent = 'This screenshot preview is no longer available.';
      return;
    }

    previewImage.src = preview.blobUrl;
    previewImage.hidden = false;
    previewStatus.hidden = true;
    previewName.textContent = preview.filename || '';
  } catch (error) {
    previewStatus.textContent = error.message || 'Could not load the screenshot preview.';
  }
}

loadPreview();
