document.addEventListener("DOMContentLoaded", () => {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const status = document.getElementById("status");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
            status.innerText = "No active tab";
            return;
        }

        const tabId = tabs[0].id;

        startBtn.onclick = () => {
            chrome.tabs.sendMessage(tabId, { action: "START_TRANSLATION" }, (response) => {
                if (chrome.runtime.lastError) {
                    status.innerText = "Error: Reload page";
                    console.error(chrome.runtime.lastError);
                } else {
                    status.innerText = "🎤 Listening...";
                    startBtn.disabled = true;
                    stopBtn.disabled = false;
                }
            });
        };

        stopBtn.onclick = () => {
            chrome.tabs.sendMessage(tabId, { action: "STOP_TRANSLATION" }, (response) => {
                status.innerText = "⏹️ Stopped";
                startBtn.disabled = false;
                stopBtn.disabled = true;
            });
        };

        // Initial state
        stopBtn.disabled = true;
    });
});