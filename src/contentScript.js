chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    console.log("Civitai Scraper: Message received", request);

    if (request.action !== 'scrapeAndCopyCivitai') return;

    // Handle Shift+Click (copy HTML) on any site
    if (request.shiftKey) {
        console.log("Shift-click: Copying entire page HTML (universal)");
        copyEntirePageToClipboard()
            .then(status => {
                sendResponse({ success: true, status: "Page HTML Copied!" });
            })
            .catch(error => {
                console.error("Error copying page HTML:", error);
                sendResponse({ success: false, status: `Error: ${error.message}` });
            });
        return true; // async
    }

    // Only allow scraping logic on civitai.com
    const url = request.url;
    const isCivitai = url.includes('civitai.com/models/') || url.includes('civitai.com/images/');
    if (!isCivitai) {
        console.warn("Non-CivitAI page: CivitAI scraping not supported.");
        sendResponse({ success: false, status: "Cannot process this site. Only works on civitai.com/models/ or /images/." });
        return true;
    }

    // Dispatch to appropriate scrape function
    if (url.includes('/images/') || new URL(url).pathname.startsWith('/images/')) {
        console.log("Detected CivitAI image page");
        scrapeImagePageAndCopy(url)
            .then(() => sendResponse({ success: true, status: "Copied!" }))
            .catch(error => {
                console.error("Image page scrape error:", error);
                sendResponse({ success: false, status: `Error: ${error.message}` });
            });
    } else {
        console.log("Detected CivitAI model page");
        scrapeCivitaiDataAndCopy(url)
            .then(() => sendResponse({ success: true, status: "Copied!" }))
            .catch(error => {
                console.error("Model page scrape error:", error);
                sendResponse({ success: false, status: `Error: ${error.message}` });
            });
    }

    return true; // keep sendResponse async
});


/**
 * Helper function to format prompt text:
 * 1. Replaces newlines with " * " 
 * 2. Replaces HTML entities with their actual characters
 * @param {string} promptText - The original prompt text
 * @return {string} - The formatted prompt text
 */
function formatPromptText(promptText) {
    if (!promptText || promptText === 'N/A') return promptText;
    
    let formatted = promptText;
    
    // Replace newlines with " * "
    formatted = formatted.replace(/\n/g, ' * ');
    
    // Replace common HTML entities with their actual characters
    formatted = formatted.replace(/&lt;/g, '<')
                         .replace(/&gt;/g, '>')
                         .replace(/&amp;/g, '&')
                         .replace(/&quot;/g, '"')
                         .replace(/&#39;/g, "'");
    
    return formatted;
}

/**
 * Helper function to escape pipe characters in markdown table cells
 * Replaces | with ¦ (broken bar) to prevent breaking markdown tables
 * @param {string} cellText - The table cell content
 * @return {string} - The formatted cell content
 */
function escapePipeInTableCell(cellText) {
    if (!cellText || cellText === 'N/A') return cellText;
    
    // Replace pipe characters with broken bar character
    return cellText.replace(/\|/g, '¦');
}

/**
 * TEMPORARY FUNCTION: Copies the entire page HTML to the clipboard
 * for analysis purposes.
 */
async function copyEntirePageToClipboard() {
    console.log("Civitai Scraper: Copying entire page HTML");
    try {
        // Get the complete HTML content
        const htmlContent = document.documentElement.outerHTML;
        
        // Copy the raw HTML to clipboard
        try {
            await navigator.clipboard.writeText(htmlContent);
            console.log('Civitai Scraper: Entire page HTML copied successfully');
        } catch (err) {
            console.error('Civitai Scraper: Failed to copy using navigator.clipboard:', err);
            // Fallback attempt using execCommand (more reliable in extension context)
            try {
                const textArea = document.createElement('textarea');
                textArea.style.position = 'fixed'; // Prevent scrolling to bottom
                textArea.style.top = '0';
                textArea.style.left = '0';
                textArea.style.opacity = '0'; // Hide it
                textArea.value = htmlContent;
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (!successful) {
                    throw new Error('execCommand failed');
                }
                console.log('Civitai Scraper: Data copied successfully using fallback execCommand.');
            } catch (fallbackErr) {
                console.error('Civitai Scraper: Fallback execCommand also failed:', fallbackErr);
                return `Error: Failed to copy. Check browser permissions. (${err.name})`;
            }
        }
        
        // Visual feedback
        const notification = document.createElement('div');
        notification.textContent = 'Entire page HTML copied!';
        Object.assign(notification.style, {
            position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
            backgroundColor: '#4CAF50', color: 'white', borderRadius: '5px',
            zIndex: '9999', opacity: '0.9', transition: 'opacity 0.5s ease-out'
        });
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 2000);

        return "HTML Copied!";
    } catch (error) {
        console.error('Civitai Scraper: An unexpected error occurred while copying page:', error);
        return `Error: Unexpected error (${error.message}). Check console.`;
    }
}

/**
 * Scrapes content from a Civitai image page and copies it to the clipboard.
 * Returns a promise that resolves with a status message ("Copied!" or error).
 */
async function scrapeImagePageAndCopy(pageUrl) {
    console.log("Civitai Scraper: Starting scrape for image page URL:", pageUrl);
    try {
        // Extract canonical URL (page URL)
        const canonicalLink = document.querySelector('link[rel="canonical"]');
        const canonicalUrl = canonicalLink ? canonicalLink.getAttribute('href') : pageUrl;
        
        // Extract actual image URL
        let imageUrl = '';
        let validImageUrlFound = false;
        try {
            // Try to find the image URL through various methods
            
            // Method 1: Check Open Graph meta tag (most reliable)
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.getAttribute('content')) {
                const potentialUrl = ogImage.getAttribute('content');
                if (potentialUrl.includes('image.civitai.com')) {
                    imageUrl = potentialUrl;
                    validImageUrlFound = true;
                    console.log("Civitai Scraper: Found valid image URL from Open Graph:", imageUrl);
                } else {
                    console.log("Civitai Scraper: Found invalid image URL from Open Graph:", potentialUrl);
                }
            }
            
            // Method 2: Look for the main image in the page
            if (!validImageUrlFound) {
                // Look for large images that are in the main content area
                const mainImage = document.querySelector('.mantine-Image-image, img[alt*="image"], .image-block img');
                if (mainImage && mainImage.src && mainImage.src.includes('image.civitai.com')) {
                    imageUrl = mainImage.src;
                    validImageUrlFound = true;
                    console.log("Civitai Scraper: Found valid image URL from main content:", imageUrl);
                } else if (mainImage && mainImage.src) {
                    console.log("Civitai Scraper: Found invalid image URL from main content:", mainImage.src);
                }
            }
            
            // Method 3: Look for the largest image on the page
            if (!validImageUrlFound) {
                let largestImage = null;
                let largestSize = 0;
                
                document.querySelectorAll('img').forEach(img => {
                    // Skip tiny icons and invalid URLs
                    if (img.width > 200 && img.height > 200 && img.src && img.src.includes('image.civitai.com')) {
                        const size = img.width * img.height;
                        if (size > largestSize) {
                            largestSize = size;
                            largestImage = img;
                        }
                    }
                });
                
                if (largestImage && largestImage.src) {
                    imageUrl = largestImage.src;
                    validImageUrlFound = true;
                    console.log("Civitai Scraper: Found valid image URL (largest image):", imageUrl);
                }
            }
            
            // Method 4: Check if there's a full-sized image URL in the JSON data
            if (!validImageUrlFound) {
                const jsonDataScript = document.getElementById('__NEXT_DATA__');
                if (jsonDataScript && jsonDataScript.textContent) {
                    try {
                        const pageData = JSON.parse(jsonDataScript.textContent);
                        // Look for image data in the queries
                        const imageQuery = pageData?.props?.pageProps?.trpcState?.json?.queries?.find(
                            q => q.queryKey?.[0]?.[0] === 'image' && q.queryKey?.[0]?.[1] === 'get'
                        );
                        
                        if (imageQuery?.state?.data?.url) {
                            // This should be the original, full-size image URL
                            let potentialUrl = imageQuery.state.data.url;
                            
                            // Check if it's a relative URL, if so add domain
                            if (potentialUrl.startsWith('/')) {
                                potentialUrl = 'https://civitai.com' + potentialUrl;
                            }
                            
                            // Make sure it's a valid image URL from image.civitai.com
                            if (potentialUrl.includes('image.civitai.com')) {
                                imageUrl = potentialUrl;
                                validImageUrlFound = true;
                                console.log("Civitai Scraper: Found valid image URL from JSON data:", imageUrl);
                            } else if (imageQuery.state.data.id) {
                                // Try to construct a full URL using the image ID
                                potentialUrl = `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/${imageQuery.state.data.id}/width=1024`;
                                imageUrl = potentialUrl;
                                validImageUrlFound = true;
                                console.log("Civitai Scraper: Constructed valid image URL from ID:", imageUrl);
                            } else {
                                console.log("Civitai Scraper: Invalid image URL from JSON data:", potentialUrl);
                            }
                        }
                    } catch (jsonError) {
                        console.warn('Civitai Scraper: Error parsing JSON data for image URL:', jsonError);
                    }
                }
            }
            
            // Note: We don't throw an error here anymore, we'll continue processing
            if (!validImageUrlFound) {
                console.warn('Civitai Scraper: Could not find valid image URL (must start with image.civitai.com)');
                // Will show error popup after copying data
            }
            
        } catch (imageUrlError) {
            console.warn('Civitai Scraper: Error extracting image URL:', imageUrlError);
            // Continue processing without image URL
        }
        
        // Extract generation data - IMPROVED SELECTOR
        let generationData = 'N/A';
        try {
            // Look for the section with "Resources used" heading
            const resourcesSection = Array.from(document.querySelectorAll('.mantine-Text-root.text-lg.font-semibold'))
                .find(el => el.textContent.includes('Resources used'));
            
            if (resourcesSection) {
                // Find ALL list items containing model info
                const modelListItems = resourcesSection.closest('.flex.flex-col')?.querySelectorAll('li.flex.flex-col');
                
                if (modelListItems && modelListItems.length > 0) {
                    // Array to store formatted model data entries
                    const modelEntries = [];
                    
                    // Process each model list item
                    modelListItems.forEach(modelListItem => {
                        // Extract model name and its link - find the anchor tag that wraps the element with text
                        const modelNameWrapper = modelListItem.querySelector('a');
                        const modelNameElement = modelListItem.querySelector('.cursor-pointer.underline');
                        const modelName = modelNameElement?.textContent?.trim() || '';
                        const modelUrl = modelNameWrapper?.getAttribute('href') || '';
                        
                        // Extract model type from the badge
                        const modelType = modelListItem.querySelector('.mantine-Badge-inner')?.textContent?.trim() || '';
                        
                        // Extract version - specifically look for the element with 'text-xs' class
                        const versionElement = modelListItem.querySelector('.text-xs.cursor-pointer');
                        const versionText = versionElement ? versionElement.textContent.trim() : '';
                        
                        // Format this model entry as a single line with spaces
                        let modelEntry = '';
                        
                        // Add model name with link if available
                        if (modelUrl) {
                            // Make sure we have the full URL (may need to prepend domain if it's a relative URL)
                            const fullModelUrl = modelUrl.startsWith('/') ? `https://civitai.com${modelUrl}` : modelUrl;
                            modelEntry += `[${modelName}](${fullModelUrl}) `;
                        } else {
                            modelEntry += modelName;
                        }
                        
                        // Add model type and version with spaces (removing the leading space since we added it after the link)
                        modelEntry += `${modelType} ${versionText}`.trim();
                        
                        modelEntries.push(modelEntry);
                    });
                    
                    // Join all model entries with a comma and space
                    generationData = modelEntries.join(', ');
                    console.log("Civitai Scraper: Found generation data for multiple models:", generationData);
                }
            }
        } catch (genDataError) {
            console.warn('Civitai Scraper: Error extracting generation data:', genDataError);
        }
        
        // Extract prompt - IMPROVED SELECTOR
        let prompt = 'N/A';
        try {
            const promptHeading = Array.from(document.querySelectorAll('.flex.items-center.justify-between'))
                .find(el => el.querySelector('.font-semibold')?.textContent.includes('Prompt'));
            
            if (promptHeading) {
                const promptElement = promptHeading.parentElement.querySelector('.text-sm');
                if (promptElement) {
                    const originalPrompt = promptElement.textContent.trim();
                    
                    // Log the original prompt for debugging
                    console.log("Civitai Scraper: Original prompt:", originalPrompt);
                    
                    // Use our helper function to format the prompt
                    prompt = formatPromptText(originalPrompt);
                    
                    console.log("Civitai Scraper: Formatted prompt:", prompt);
                }
            }
        } catch (promptError) {
            console.warn('Civitai Scraper: Error extracting prompt:', promptError);
        }
        
        // Extract negative prompt - IMPROVED SELECTOR
        let negativePrompt = 'N/A';
        try {
            const negPromptHeading = Array.from(document.querySelectorAll('.flex.items-center.justify-between'))
                .find(el => el.querySelector('.font-semibold')?.textContent.includes('Negative prompt'));
            
            if (negPromptHeading) {
                const negPromptElement = negPromptHeading.parentElement.querySelector('.text-sm');
                if (negPromptElement) {
                    const originalNegPrompt = negPromptElement.textContent.trim();
                    
                    // Log the original negative prompt for debugging
                    console.log("Civitai Scraper: Original negative prompt:", originalNegPrompt);
                    
                    // Use our helper function to format the negative prompt
                    negativePrompt = formatPromptText(originalNegPrompt);
                    
                    console.log("Civitai Scraper: Formatted negative prompt:", negativePrompt);
                }
            }
        } catch (negPromptError) {
            console.warn('Civitai Scraper: Error extracting negative prompt:', negPromptError);
        }
        
        // Extract metadata
        let metadata = 'N/A';
        try {
            const metadataElements = document.querySelectorAll('.flex.flex-wrap.gap-2 .mantine-Badge-inner');
            if (metadataElements.length > 0) {
                const metadataItems = Array.from(metadataElements).map(el => el.textContent.trim());
                metadata = metadataItems.join(' ');
                console.log("Civitai Scraper: Found metadata:", metadata);
            }
        } catch (metadataError) {
            console.warn('Civitai Scraper: Error extracting metadata:', metadataError);
        }
        
        // Format output
        let output = `## <name>\n\n`;
        
        // Only include the image link if a valid image URL was found
        if (validImageUrlFound) {
            // Use the canonical URL as alt text, which the downloader will use as the click-through link
            // And use the image URL as the regular URL to display the image
            output += `![${canonicalUrl}](${imageUrl})\n\n`;
        }
        
        output += `| Content | Value | \n`;
        output += `| ------- | ----- |\n`;
        output += `| Page URL | ${escapePipeInTableCell(canonicalUrl)} |\n`;
        output += `| Generation Data | ${escapePipeInTableCell(generationData)} |\n`;
        output += `| Prompt | ${escapePipeInTableCell(prompt)} |\n`;
        output += `| Negative Prompt | ${escapePipeInTableCell(negativePrompt)} |\n`;
        output += `| Guidance | ${escapePipeInTableCell(metadata)} |\n\n`;
        
        // Copy to clipboard
        try {
            await navigator.clipboard.writeText(output);
            console.log('Civitai Scraper: Formatted data copied successfully');
            
            // Show error popup if no valid image URL was found
            if (!validImageUrlFound) {
                const errorModal = document.createElement('div');
                errorModal.innerHTML = `
                    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 10000;">
                        <div style="background: white; padding: 20px; border-radius: 8px; max-width: 400px; text-align: center;">
                            <h3 style="margin-top: 0; color: #d32f2f;">Warning</h3>
                            <p>Data copied, but no valid image URL was found. The image URL must come from image.civitai.com.</p>
                            <button style="background: #4CAF50; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 10px;">Close</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(errorModal);
                
                // Add event listener to close button
                errorModal.querySelector('button').addEventListener('click', () => {
                    errorModal.remove();
                });
                
                console.warn('Civitai Scraper: Data copied without image URL');
            } else {
                // Quick flash notification for success
                const notification = document.createElement('div');
                notification.textContent = 'Copied!';
                Object.assign(notification.style, {
                    position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
                    backgroundColor: '#4CAF50', color: 'white', borderRadius: '5px',
                    zIndex: '9999', opacity: '0.9', transition: 'opacity 0.3s ease-out'
                });
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 100);
                }, 500);
            }

            return true; // Return true to indicate success
        } catch (err) {
            console.error('Civitai Scraper: Failed to copy image page data:', err);
            
            // Fallback attempt using execCommand
            try {
                const textArea = document.createElement('textarea');
                textArea.style.position = 'fixed';
                textArea.style.top = '0';
                textArea.style.left = '0';
                textArea.style.opacity = '0';
                textArea.value = output;
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (!successful) {
                    throw new Error('execCommand failed');
                }
                console.log('Civitai Scraper: Data copied successfully using fallback execCommand.');
                
                // Quick flash notification for fallback method too
                const notification = document.createElement('div');
                notification.textContent = 'Copied!';
                Object.assign(notification.style, {
                    position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
                    backgroundColor: '#4CAF50', color: 'white', borderRadius: '5px',
                    zIndex: '9999', opacity: '0.9', transition: 'opacity 0.3s ease-out'
                });
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 100);
                }, 500);
                
                return true; // Still return true if fallback worked
            } catch (fallbackErr) {
                console.error('Civitai Scraper: Fallback execCommand also failed:', fallbackErr);
                return `Error: ${err.name}`; // Shortened error message
            }
        }
    } catch (error) {
        console.error('Civitai Scraper: An unexpected error occurred while scraping image page:', error);
        throw error; // Re-throw the error to be handled by caller
    }
}

/**
 * Scrapes data from a Civitai model page, formats it, and copies it to the clipboard.
 * Returns a promise that resolves with a status message ("Copied!" or error).
 */
async function scrapeCivitaiDataAndCopy(pageUrl) {
    console.log("Civitai Scraper: Starting scrape for URL:", pageUrl);
    try {
        // --- Extract data primarily from __NEXT_DATA__ ---
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (!nextDataScript || !nextDataScript.textContent) {
            console.error('Civitai Scraper: __NEXT_DATA__ script tag not found or empty.');
            throw new Error('Could not find page data (__NEXT_DATA__).');
        }

        let modelData;
        let latestVersionData;

        try {
            const pageData = JSON.parse(nextDataScript.textContent);
            // Find the specific query containing model data (more robust than relying on index)
             const modelQuery = pageData?.props?.pageProps?.trpcState?.json?.queries?.find(
                 q => q.queryKey?.[0]?.[0] === 'model' && q.queryKey?.[0]?.[1] === 'getById'
             );

             if (!modelQuery || !modelQuery.state?.data) {
                  console.error('Civitai Scraper: Model data not found in __NEXT_DATA__ query.');
                  throw new Error('Could not find model data in page JSON.');
             }
             modelData = modelQuery.state.data;

            // Find the currently displayed version. This is trickier as the order isn't guaranteed.
            // Let's try to match based on the URL slug if possible, otherwise default to first.
            const currentVersionSlug = pageUrl.match(/modelVersionId=(\d+)/)?.[1]; // Extract version ID if present in URL
            let versionIndex = 0;
            if (currentVersionSlug && modelData?.modelVersions?.length > 0) {
                const foundIndex = modelData.modelVersions.findIndex(v => v.id.toString() === currentVersionSlug);
                if (foundIndex !== -1) {
                    versionIndex = foundIndex;
                    console.log(`Civitai Scraper: Found matching version index ${versionIndex} for ID ${currentVersionSlug}`);
                } else {
                     console.log(`Civitai Scraper: Version ID ${currentVersionSlug} from URL not found in data, defaulting to first version.`);
                }
            }

            latestVersionData = modelData?.modelVersions?.[versionIndex];
            if (!latestVersionData) {
                 console.error('Civitai Scraper: Model version data not found in page JSON (index ' + versionIndex + ').');
                 throw new Error('Could not find model version data in page JSON.');
             }
            console.log("Civitai Scraper: Using data for version:", latestVersionData.name, `(ID: ${latestVersionData.id})`);

        } catch (jsonError) {
             console.error('Civitai Scraper: Error parsing __NEXT_DATA__ JSON:', jsonError);
             throw new Error('Parsing page data failed. Structure might have changed.');
        }


        const name = modelData?.name || 'N/A';
        const fileInfo = latestVersionData?.files?.[0]; // Assuming the first file is the primary one for the version
        const fileUrl = fileInfo?.url || 'N/A';
        // Extract filename robustly, handling potential query parameters
        const filename = fileUrl !== 'N/A' ? decodeURIComponent(fileUrl.substring(fileUrl.lastIndexOf('/') + 1).split('?')[0]) : 'N/A';
        const baseModel = latestVersionData?.baseModel || 'N/A';
        const triggerWordsRaw = latestVersionData?.trainedWords || [];

        // Format triggers: Join with newline and indent for readability in clipboard.
        const triggerWordsFormatted = triggerWordsRaw.length > 0
            ? triggerWordsRaw.map(word => word.trim()).filter(word => word.length > 0).join(',\n    ') // Trim, filter empty, Join with newline and indent
            : 'N/A';

        // --- Extract Usage Tips from DOM Table (as it's not clearly in JSON) ---
        let usageTips = '';
        try {
            const detailsAccordionButton = document.querySelector('button[aria-controls*="panel-version-details"][data-active="true"]');
            let tableContainer = null;

            if (detailsAccordionButton) {
                // Find the corresponding panel content
                const panelId = detailsAccordionButton.getAttribute('aria-controls');
                 const panel = document.getElementById(panelId);
                 tableContainer = panel?.querySelector('table.mantine-Table-root > tbody');
                 console.log("Civitai Scraper: Searching for Usage Tips within active details accordion panel:", panelId);
            } else {
                // Fallback: search the whole document if accordion state isn't clear (less reliable)
                console.log("Civitai Scraper: Active details accordion not identified, searching whole document for table.");
                 tableContainer = document.querySelector('table.mantine-Table-root > tbody');
            }

             if (tableContainer) {
                 const tableRows = tableContainer.querySelectorAll('tr');
                 for (const row of tableRows) {
                     const cells = row.querySelectorAll('td');
                     // Look for exact match first, then try contains
                     if (cells.length >= 2) {
                        const headerCellText = cells[0].innerText.trim();
                        if (headerCellText === 'Usage Tips') {
                             usageTips = cells[1].innerText.trim().replace(/\s+/g, ' '); // Normalize whitespace
                             console.log("Civitai Scraper: Found 'Usage Tips':", usageTips);
                            break; // Found it
                        }
                         // Fallback check (might be less precise)
                         else if (headerCellText.includes('Usage')) {
                             usageTips = cells[1].innerText.trim().replace(/\s+/g, ' '); // Normalize whitespace
                             console.log("Civitai Scraper: Found row containing 'Usage':", usageTips);
                             // Don't break here, maybe a more specific row exists
                         }
                     }
                }
                 if (!usageTips) {
                     console.log("Civitai Scraper: 'Usage Tips' row not found in the details table.");
                 }
             } else {
                 console.log("Civitai Scraper: Details table body not found.");
             }
        } catch (domError) {
            console.warn('Civitai Scraper: Error scraping table for Usage Tips:', domError);
            // Continue without Usage Tips if DOM scraping fails
        }

        // --- Scrape Sample Image URLs ---
        const sampleImageUrls = []; // Use an array to limit the count
        const maxImages = 4;
        try {
            console.log("Civitai Scraper: Searching for sample images (max 4, width=450)...");
            const images = document.querySelectorAll('img');
            // Regex to match base URL and extension, but we will check width separately
            const imageRegex = /^(https?:\/\/image\.civitai\.com\/.*?\.(?:jpg|jpeg|png|webp|svg))/i;

            for (const img of images) { // Use for...of to allow breaking early
                if (sampleImageUrls.length >= maxImages) {
                    console.log("Civitai Scraper: Reached max images (4).");
                    break; // Stop searching once we have enough
                }

                if (img.src && img.src.includes('width=450')) { // Check for width=450 first
                    const match = img.src.match(imageRegex);
                    if (match && match[1]) {
                        const baseUrl = match[1];
                        // Check if this base URL is already added to avoid near-duplicates
                        if (!sampleImageUrls.some(item => item.url === img.src)) { // Check full URL to be safe
                             sampleImageUrls.push({ url: img.src, base: baseUrl });
                             console.log(`Civitai Scraper: Added image ${sampleImageUrls.length}: ${img.src}`);
                        }
                    }
                }
                // Optional: Check srcset if needed, applying the same width=450 and limit logic
            }
             console.log(`Civitai Scraper: Found ${sampleImageUrls.length} unique sample image URLs matching criteria.`);
        } catch (imageError) {
             console.warn('Civitai Scraper: Error scraping sample images:', imageError);
        }


        // --- Format the final output string (Markdown) ---
        let output = `## ${escapePipeInTableCell(name)}\n`;
        output += `* Filename: ${escapePipeInTableCell(filename)}\n`;
        output += `* URL: ${escapePipeInTableCell(pageUrl.split('?')[0])}\n`;
        output += `* Base Model: ${escapePipeInTableCell(baseModel)}\n`;
        if (usageTips) {
            output += `* Usage Tips: ${escapePipeInTableCell(usageTips)}\n`;
        }

        // Format Triggers
        output += `* Triggers:\n`;
        if (triggerWordsFormatted !== 'N/A' && triggerWordsFormatted.trim().length > 0) {
             const triggers = triggerWordsFormatted.split(',\n    ');
             triggers.forEach(trigger => {
                 output += `  * ${escapePipeInTableCell(trigger.trim())}\n`; // Escape pipes in triggers too
             });
        } else {
            output += `  * N/A\n`;
        }

        // Add Sample Images section if found
        if (sampleImageUrls.length > 0) {
             output += `### Sample Images:\n\n`; // H3 heading and extra newline
             sampleImageUrls.forEach(item => {
                 const imgFilename = decodeURIComponent(item.base.substring(item.base.lastIndexOf('/') + 1));
                 output += `![${imgFilename}](${item.url})\n`; // Just the markdown link, no list formatting
             });
        }

        // --- Copy to clipboard using modern API ---
        try {
            await navigator.clipboard.writeText(output);
            console.log('Civitai Scraper: Data copied successfully:\n', output);

             // Quick flash notification
             const notification = document.createElement('div');
             notification.textContent = 'Copied!';
             Object.assign(notification.style, {
                 position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
                 backgroundColor: '#4CAF50', color: 'white', borderRadius: '5px',
                 zIndex: '9999', opacity: '0.9', transition: 'opacity 0.3s ease-out'
             });
             document.body.appendChild(notification);
             setTimeout(() => {
                 notification.style.opacity = '0';
                 setTimeout(() => notification.remove(), 100);
             }, 500);

            return true; // Return true to indicate success
        } catch (err) {
            console.error('Civitai Scraper: Failed to copy using navigator.clipboard:', err);
             // Fallback attempt using execCommand (might not work in all contexts)
             try {
                const textArea = document.createElement('textarea');
                 textArea.style.position = 'fixed'; // Prevent scrolling to bottom
                 textArea.style.top = '0';
                 textArea.style.left = '0';
                 textArea.style.opacity = '0'; // Hide it
                 textArea.value = output;
                 document.body.appendChild(textArea);
                 textArea.focus();
                 textArea.select();
                 const successful = document.execCommand('copy');
                 document.body.removeChild(textArea);
                 if (successful) {
                     console.log('Civitai Scraper: Data copied successfully using fallback execCommand.');
                     
                     // Quick flash notification
                     const notification = document.createElement('div');
                     notification.textContent = 'Copied!';
                     Object.assign(notification.style, {
                         position: 'fixed', top: '20px', right: '20px', padding: '10px 20px',
                         backgroundColor: '#4CAF50', color: 'white', borderRadius: '5px',
                         zIndex: '9999', opacity: '0.9', transition: 'opacity 0.3s ease-out'
                     });
                     document.body.appendChild(notification);
                     setTimeout(() => {
                         notification.style.opacity = '0';
                         setTimeout(() => notification.remove(), 100);
                     }, 500);
                     
                     return true; // Still return true if fallback worked
                 } else {
                     throw new Error('execCommand failed');
                 }
             } catch (fallbackErr) {
                 console.error('Civitai Scraper: Fallback execCommand also failed:', fallbackErr);
                 return `Error: ${err.name}`; // Shortened error message
             }
        }

    } catch (error) {
        console.error('Civitai Scraper: An unexpected error occurred:', error);
        throw error; // Re-throw the error to be handled by caller
    }
}
