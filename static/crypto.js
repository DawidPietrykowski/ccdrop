function arrayBufferToBase64(buffer) {
  return (new Uint8Array(buffer)).toBase64({ alphabet: "base64url" });
}

function base64ToArrayBuffer(base64) {
  return Uint8Array.fromBase64(base64, { alphabet: "base64url" }).buffer;
}

async function generateCipherKeyFromBase64(keyBase64) {
  const keyBytes = base64ToArrayBuffer(keyBase64);
  return window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function generateRandomCipherKey() {
  const cryptoKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const rawKey = await window.crypto.subtle.exportKey("raw", cryptoKey);
  const base64Key = arrayBufferToBase64(rawKey);
  return { cryptoKey, base64Key };
}

async function encrypt(plaintext, key) {
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext
  );

  const result = new Uint8Array(nonce.length + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), nonce.length);

  return result;
}

async function decrypt(data, key) {
  const dataBytes = new Uint8Array(data);

  const nonce = dataBytes.slice(0, 12);
  const ciphertext = dataBytes.slice(12);

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      ciphertext
    );
    return decrypted;
  } catch (e) {
    throw new Error("Decryption failed, the key is incorrect.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const encryptButton = document.getElementById("encrypt-btn");
  const decryptButton = document.getElementById("decrypt-btn");

  const serverUrl = new URL(window.location).origin;

  encryptButton.addEventListener("click", async () => {
    const fileInput = document.getElementById("file-input");
    const resultsDiv = document.getElementById("encrypt-results");

    // Verify input
    if (!fileInput.files || fileInput.files.length === 0) {
      resultsDiv.textContent = "Select a file";
      return;
    }

    try {
      // Prepare data
      resultsDiv.textContent = "Encrypting data...";
      const fileBuffer = await fileInput.files[0].arrayBuffer();
      const { cryptoKey, base64Key } = await generateRandomCipherKey();
      const encryptedData = await encrypt(fileBuffer, cryptoKey);

      // Send data
      const response = await fetch(`${serverUrl}/share`, {
        method: "POST",
        body: encryptedData,
      });
      if (!response.ok) {
        throw new Error(`Failed to upload file to server: ${response.status}`);
      }
      const shareId = await response.text();

      // Print share info
      const shareUrl = `${serverUrl}/${shareId}#${base64Key}`;

      resultsDiv.className = 'results success';
      const resultsContent = `
          <div class="results-content">
              <p class="status-message success">File Encrypted Successfully!</p>
              <p style="text-align:center; color: var(--color-text-secondary); margin-top: -1rem;">The Share URL has been copied to your clipboard.</p>
            
              <div class="result-item">
                  <label for="share-url-field">Share URL</label>
                  <div class="result-field">
                      <input id="share-url-field" type="text" readonly value="${shareUrl}">
                      <button class="copy-btn" data-copy-target="#share-url-field">Copy</button>
                  </div>
              </div>

              <div class="result-item">
                  <label for="cli-command-field">CLI Command</label>
                  <div class="result-field">
                      <input id="cli-command-field" type="text" readonly value="ccdrop -i ${shareId} -k ${base64Key} -u ${serverUrl} get">
                      <button class="copy-btn" data-copy-target="#cli-command-field">Copy</button>
                  </div>
              </div>
              <button class="btn" id="qr-code-btn">Show QR code</button>
              <div class="result-item">
                  <div class="qr-code" id="qrcode">
                  </div>
              </div>
          </div>
      `;

      resultsDiv.innerHTML = resultsContent;

      const qrCode = new QRCodeStyling({
          width: 360,
          height: 360,
          type: "svg",
          data: shareUrl,
          margin: 8,
          qrOptions: {
              typeNumber: 0,
              mode: "Byte",
              errorCorrectionLevel: "M"
          },
          dotsOptions: {
              color: "#ffffff",
              type: "square"
          },
          backgroundOptions: {
              color: "transparent",
          },
          cornersSquareOptions: {
              color: "#c792f9",
              type: "square"
          },
          cornersDotOptions: {
              color: "#c792f9",
              type: "square"
          }
      });

      resultsDiv.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          const targetInput = document.querySelector(e.target.dataset.copyTarget);
          navigator.clipboard.writeText(targetInput.value).then(() => {
            e.target.textContent = 'Copied!';
            setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
          });
        });
      });

      let qrCodeBtn = resultsDiv.querySelector('#qr-code-btn');
      qrCodeBtn.addEventListener('click', (e) => {
        const qrContainer = document.querySelector('#qrcode');
        qrCode.append(qrContainer);
        qrCodeBtn.classList.add("hidden");
      });

    } catch (error) {
      console.error(error);
      resultsDiv.className = 'results error';
      if (error.message && error.message.includes("404")) {
        resultsDiv.innerHTML = `<div class="results-content"><p class="status-message error">Share not found</p></div>`;
      } else {
        resultsDiv.innerHTML = `<div class="results-content"><p class="status-message error">Error: ${error.message}</p></div>`;
      }
    }
  });

  decryptButton.addEventListener("click", async () => {
    const resultsDiv = document.getElementById("decrypt-results");
    const shareId = window.location.pathname.substring(1);
    const decryptionKeyBase64 = window.location.hash.substring(1);

    // Verify input
    if (!shareId || !decryptionKeyBase64 || !serverUrl) {
      resultsDiv.textContent = "Invalid URL";
      return;
    }

    try {
      // Fetch data
      console.log("Fetching share");
      resultsDiv.textContent = `Downloading share ID: ${shareId}...`;
      const response = await fetch(`${serverUrl}/get/${shareId}`);
      if (!response.ok) {
        if (response.status == 404) {
          resultsDiv.className = 'results error';
          resultsDiv.innerHTML = `<div class="results-content"><p class="status-message error">Share not found</p></div>`;
          return;
        }
        throw new Error(`Server returned status ${response.status}`);
      }
      const encryptedData = await response.arrayBuffer();
      resultsDiv.textContent = "File downloaded. Decrypting...";

      // Decrypt data
      console.log("Received data");
      const cryptoKey = await generateCipherKeyFromBase64(decryptionKeyBase64);
      console.log("Generated key");
      const decryptedData = await decrypt(encryptedData, cryptoKey);
      console.log("Decrypted data");

      // Serve data
      const blob = new Blob([decryptedData]);
      const url = URL.createObjectURL(blob);

      resultsDiv.innerHTML = ''; // Clear previous results
      resultsDiv.className = 'results success';

      const resultsContent = document.createElement('div');
      resultsContent.className = 'results-content';
      resultsContent.style.textAlign = 'center';
      resultsContent.style.gap = '1rem';

      const successMessage = document.createElement('p');
      successMessage.className = 'status-message success';
      successMessage.textContent = 'Decryption Successful!';

      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = "decrypted-output"; // TODO: get filename
      downloadLink.textContent = "Save Decrypted File";
      downloadLink.className = 'btn';
      downloadLink.style.display = 'block';

      resultsContent.appendChild(successMessage);
      resultsContent.appendChild(downloadLink);
      resultsDiv.appendChild(resultsContent);
    } catch (error) {
      resultsDiv.className = 'results error';
      resultsDiv.innerHTML = `<div class="results-content"><p class="status-message error">Error: ${error.message}</p></div>`;
      console.error(error);
    }
  });
});
