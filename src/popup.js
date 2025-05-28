document.getElementById('copyButton').addEventListener('click', (event) => {
    const shiftKey = event.shiftKey;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];

        if (!currentTab || !currentTab.url) {
            alert("Error: Could not retrieve current tab.");
            window.close();
            return;
        }

        // Always allow shift+click to run on any page
        const isCivitai = currentTab.url.includes('civitai.com/models/') || currentTab.url.includes('civitai.com/images/');
        if (!isCivitai && !shiftKey) {
            alert("This doesn't look like a Civitai models or images page.");
            window.close();
            return;
        }

        // Send message to content script
        chrome.tabs.sendMessage(currentTab.id, {
            action: 'scrapeAndCopyCivitai',
            url: currentTab.url,
            shiftKey: shiftKey
        }, function (response) {
            if (chrome.runtime.lastError) {
                console.error("Popup Error:", chrome.runtime.lastError.message);
                alert(`Error: ${chrome.runtime.lastError.message}. Refresh the page and try again?`);
                window.close();
                return;
            }

            if (response && (response.status === "Copied!" || response.status === "Page HTML Copied!")) {
                console.log("Popup: Copy successful.");
                window.close();
            } else if (response) {
                console.error("Popup: Content script reported error:", response.status);
                alert(`Failed to copy: ${response.status}`);
                window.close();
            } else {
                console.error("Popup: No response or unexpected response from content script.");
                alert("Error: Did not receive confirmation from the page. Check console (F12).");
                window.close();
            }
        });
    });
});
