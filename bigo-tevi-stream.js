const puppeteer = require('puppeteer');
const axios = require('axios');
const { exec } = require('child_process');
const stopRecipientStream = require('./stop-stream'); // Adjust the path based on the file structure


// Function to check if the original stream is still active
async function isStreamActive(m3u8Url) {
    try {
        const response = await axios.get(m3u8Url);
        
        // If the response is successful, check for .ts segments
        const tsSegments = response.data.match(/\.ts/g);
        return tsSegments && tsSegments.length > 0;
        
    } catch (error) {
        // If the server returns a 404 error, assume the stream has ended
        if (error.response && error.response.status === 404) {
            console.log(`Livestream ended: Received 404 for ${m3u8Url}`);
            return false;  // Stream has ended
        }
        
        // Log other errors for debugging
        console.error('Error fetching m3u8:', error.message);
        return false;
    }
}

// Function to stop the recipient's stream (execute a new script or send a command)
// function stopRecipientStream() {
//     console.log('Stopping recipient stream...');
//     const stopCommand = 'node stop-stream.js'; // Run the stop-stream.js script
//     exec(stopCommand, (error, stdout, stderr) => {
//         if (error) {
//             console.error(`Error stopping recipient stream: ${stderr}`);
//         } else {
//             console.log(`Recipient stream stopped successfully: ${stdout}`);
//         }
//     });
// }

// Function to monitor and stream
async function monitorStream(m3u8Url, FULL_RTMP_URL) {
    console.log('Starting stream monitoring...');
    let isActive = true;

    // Start streaming the original source to RTMP
    const streamProcess = streamM3U8ToRtmp(m3u8Url, FULL_RTMP_URL);

    // Keep checking if the original stream is still active
    while (isActive) {
        isActive = await isStreamActive(m3u8Url);
        if (!isActive) {
            console.log('Original stream stopped. Moving to Step 2...');
            
            // Kill the FFmpeg process when the stream stops
            //streamProcess.kill(); // Kill the FFmpeg process to stop streaming

            // Stop the recipient stream, and catch any potential errors
            try {
                await stopRecipientStream(); // Handle stopping the recipient stream
            } catch (error) {
                console.error('Error stopping recipient stream:', error); // Log the error
            }

            break;
        }
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before checking again
    }

    console.log('Stream monitoring stopped.');
    process.stdin.pause(); // Stop listening for input
}

// Function to stream the M3U8 file to the RTMP server
function streamM3U8ToRtmp(m3u8Url, FULL_RTMP_URL) {
    return new Promise((resolve, reject) => {
        const ffmpegCommand = `ffmpeg -re -i ${m3u8Url} -c:v copy -c:a aac -ar 44100 -ab 128k -ac 2 -strict -2 -flags +global_header -bsf:a aac_adtstoasc -bufsize 2500k -f flv ${FULL_RTMP_URL}`;
        console.log(`Executing: ${ffmpegCommand}`);

        // Spawn the FFmpeg process
        const ffmpegProcess = exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`FFmpeg Error: ${stderr}`);
                reject(error); // Reject the promise on error
            } else {
                console.log(`FFmpeg Output: ${stdout}`);
                resolve(ffmpegProcess); // Resolve with the FFmpeg process object
            }
        });

        // Output FFmpeg progress in real-time
        ffmpegProcess.stdout.on('data', (data) => {
            console.log(`FFmpeg STDOUT: ${data}`);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`FFmpeg STDERR: ${data}`);
        });

        // Handle 'error' event on the FFmpeg process to avoid unhandled rejections
        ffmpegProcess.on('error', (err) => {
            if (err.code === 'ENOTCONN') {
                console.log('Network connection issue (ENOTCONN), but the stream is still running.');
            } else {
                console.error('FFmpeg encountered an error:', err);
                reject(err); // Reject if it's another kind of error
            }
        });

        // Return the ffmpegProcess object so we can kill it later
        return ffmpegProcess;
    });
}

// Function to read input from the command line
const askQuestion = (query) => {
    return new Promise((resolve) => {
        process.stdout.write(query);
        process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
        });
    });
};

// Main function to monitor and download .ts segments
(async () => {
    // Prompt the user for the RTMP URL, stream key, and Bigo URL
    //const rtmpUrl = await askQuestion("Input RTMP URL: ");
    const streamKey = await askQuestion("Input Stream Key: ");
    const bigoUrl = await askQuestion("Input Bigo URL: ");
    
    const FULL_RTMP_URL = `rtmps://live.tevi.com:443/live/${streamKey}`;
    // Launch Puppeteer and open the browser page
    const browser = await puppeteer.launch({
        headless: true,  // run in headless mode
        args: ['--remote-debugging-port=9224'], // Add debugging port for later connection
    });
    const page = await browser.newPage();
    let m3u8Url = null;

    // Intercept network requests
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
        const url = request.url();
        if (url.endsWith('.m3u8')) {
            console.log(`Detected M3U8 file: ${url}`);
            m3u8Url = url;
            request.abort();
        } else {
            request.continue();
        }
    });

    // Go to the Bigo live stream page
    await page.goto(bigoUrl, {
        waitUntil: 'networkidle2',  // wait for the network to be idle
    });

    // Wait until an M3U8 file is detected
    while (!m3u8Url) {
        await new Promise(resolve => setTimeout(resolve, 1000));  // Polling delay
    }

    console.log('Starting stream to RTMP...');

    try {
        // Start monitoring the stream and streaming to RTMP
        await monitorStream(m3u8Url, FULL_RTMP_URL);
    } catch (error) {
        console.error('Error streaming to RTMP:', error);
    }

    await browser.close();
    console.log('Browser closed.');
})();
