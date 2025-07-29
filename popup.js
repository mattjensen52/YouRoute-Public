// popup.js

document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("toggleEnabled");
    const status = document.getElementById("statusLabel");
    const STORAGE_KEY = "enabled";
  
    // Load saved state from chrome.storage.local (default: true)
    chrome.storage.local.get({ [STORAGE_KEY]: true }, result => {
      const isOn = result[STORAGE_KEY];
      toggle.checked = isOn;
      updateStatus(isOn);
    });
  
    // When user toggles, save the new state
    toggle.addEventListener("change", () => {
      const isOn = toggle.checked;
      chrome.storage.local.set({ [STORAGE_KEY]: isOn }, () => {
        updateStatus(isOn);
      });
    });
  
    function updateStatus(isOn) {
      status.textContent = isOn ? "ON" : "OFF";
      status.style.color   = isOn ? "green" : "red";
    }
  });
  