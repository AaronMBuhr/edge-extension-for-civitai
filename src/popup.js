document.getElementById('copyButton').addEventListener('click', (event) => {
    // Detect if shift key is pressed during click
    const shiftKey = event.shiftKey;
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        // Check if it's a Civitai page (models or images) before sending the message
        if (currentTab.url && (currentTab.url.includes('civitai.com/models/') || currentTab.url.includes('civitai.com/images/'))) {
            // Include shiftKey in the message
            chrome.tabs.sendMessage(currentTab.id, { 
                action: 'scrapeAndCopyCivitai', 
                url: currentTab.url,
                shiftKey: shiftKey 
            }, function (response) {
                if (chrome.runtime.lastError) {
                    // Handle potential errors like the content script not being injected
                    console.error("Popup Error:", chrome.runtime.lastError.message);
                    alert(`Error: ${chrome.runtime.lastError.message}. Refresh the page and try again?`);
                    window.close(); // Close even on error
                    return;
                }

                if (response && response.status === "Copied!" || response && response.status === "Page HTML Copied!") {
                    // Success! Just close the popup. Feedback is now shown on the page itself.
                    console.log("Popup: Copy successful.");
                    window.close();
                } else if (response) {
                    // Show error message received from content script
                    console.error("Popup: Content script reported error:", response.status);
                    alert(`Failed to copy: ${response.status}`);
                    window.close(); // Close even on error
                } else {
                     // Handle unexpected lack of response
                    console.error("Popup: No response or unexpected response from content script.");
                     alert("Error: Did not receive confirmation from the page. Check console (F12).");
                     window.close();
                }
            });
        } else {
            alert("This doesn't look like a Civitai models or images page.");
            window.close();
        }
    });
});
