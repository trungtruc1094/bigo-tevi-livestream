const puppeteer = require('puppeteer');
const axios = require('axios');

async function stopRecipientStream() {
    try {
        console.log('Connecting to Chrome to stop the stream...');

        // Fetch the WebSocket debugger URL from Chrome
        const response = await axios.get('http://127.0.0.1:9223/json/version');
        const { webSocketDebuggerUrl } = response.data;

        // Connect to the running instance of Chrome
        const browser = await puppeteer.connect({
            browserWSEndpoint: webSocketDebuggerUrl,  // Use the retrieved WebSocket URL
        });

        console.log('Connected to Chrome.');

        // Get all open tabs/pages in Chrome
        const pages = await browser.pages();

        // Search for the tab with the recipient livestream by URL
        let recipientPage = null;
        for (const page of pages) {
            const url = await page.url();
            if (url.includes('tevi.com')) {  // Adjust the URL to match the recipient's livestream platform
                recipientPage = page;
                break;
            }
        }

        if (recipientPage) {
            console.log("Found recipient livestream page. Attempting to stop the stream...");

            try {
                // Use evaluate to click the "Stop stream" button
                const stopStreamSuccess = await recipientPage.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const stopButton = buttons.find(button => button.innerText.includes('Stop stream'));
                    if (stopButton) {
                        stopButton.click();
                        return true;
                    }
                    return false;
                });
                
                if (stopStreamSuccess) {
                    console.log("Stop stream button clicked successfully.");

                    // Wait for the confirmation modal to appear
                    await recipientPage.waitForSelector('button');  // Wait for buttons to be available
                    // Click the "Yes, I want" button in the confirmation modal
                    const confirmSuccess = await recipientPage.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const yesButton = buttons.find(button => button.innerText.includes('Yes, I want'));
                        if (yesButton) {
                            yesButton.click();
                            return true;
                        }
                        return false;
                    });

                    if (confirmSuccess) {
                        console.log("Yes, I want button clicked successfully.");
                    } else {
                        console.error("Yes, I want button not found.");
                    }

                } else {
                    console.error("Stop stream button not found.");
                }

                // Optionally, close the tab or browser after stopping the stream
                await browser.close();
                console.log('Browser closed.');
            } catch (error) {
                console.error("Error interacting with the stream controls:", error);
            }
        } else {
            console.error("Recipient livestream page not found. Unable to stop the stream.");
        }

    } catch (err) {
        console.error('Failed to connect to Chrome instance or stop the recipient stream:', err);
        throw err; // Re-throw the error to be caught in the main function
    }
}

module.exports = stopRecipientStream;
