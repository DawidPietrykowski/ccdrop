function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64) {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0)).buffer;
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
      await navigator.clipboard.writeText(shareUrl);
      resultsDiv.innerHTML = `File encrypted successfully<br>` +
        `Share URL: ${shareUrl} <br>` +
        `CLI command: ccdrop -i ${shareId} -k ${base64Key} -u ${serverUrl} get`;
    } catch (error) {
      console.error(error);
      resultsDiv.textContent = `Error: ${error.message}`;
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
      const a = document.createElement("a");
      a.href = url;
      a.download = "decrypted-output";
      a.textContent = "Save decrypted file";
      a.style.display = "block";
      a.style.marginTop = "10px";

      resultsDiv.textContent = "Decryption successful";
      resultsDiv.appendChild(a);

    } catch (error) {
      resultsDiv.textContent = `Error: ${error.message}`;
      console.error(error);
    }
  });
});
