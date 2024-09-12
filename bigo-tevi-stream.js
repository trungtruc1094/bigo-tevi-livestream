const puppeteer = require('puppeteer');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// List to store downloaded TS files
let tsFileList = [];

// Function to download a .ts file
async function downloadTsFile(url, filename) {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
    });

    const filePath = path.join(__dirname, filename);
    const writer = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        let error = null;
        writer.on('error', (err) => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => {
            if (!error) {
                resolve(filePath);
            }
        });
    });
}

// Function to concatenate TS files into a single MP4 file
function concatenateTsFiles(outputFile) {
    return new Promise((resolve, reject) => {
        const fileListPath = path.join(__dirname, 'filelist.txt');
        
        // Create a file list for FFmpeg concatenation
        fs.writeFileSync(fileListPath, tsFileList.map(f => `file '${f}'`).join('\n'));

        const ffmpegCommand = `ffmpeg -f concat -safe 0 -i ${fileListPath} -c copy ${outputFile}`;
        console.log(`Concatenating TS files into ${outputFile}...`);

        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`FFmpeg concatenation error: ${stderr}`);
                reject(stderr);
            } else {
                console.log(`FFmpeg concatenation output: ${stdout}`);
                resolve();
            }

            // Clean up: remove the text file and .ts files
            fs.unlinkSync(fileListPath);
            tsFileList.forEach(f => fs.unlinkSync(f));
        });
    });
}

// Function to stream the M3U8 file to the RTMP server
function streamM3U8ToRtmp(m3u8Url, FULL_RTMP_URL) {
    return new Promise((resolve, reject) => {
        const ffmpegCommand = `ffmpeg -re -i ${m3u8Url} -c:v copy -c:a aac -ar 44100 -ab 128k -ac 2 -strict -2 -flags +global_header -bsf:a aac_adtstoasc -bufsize 2500k -f flv ${FULL_RTMP_URL}`;
        console.log(`Executing: ${ffmpegCommand}`);

        const process = exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`FFmpeg Error: ${stderr}`);
                reject(stderr);
            } else {
                console.log(`FFmpeg Output: ${stdout}`);
                resolve();
            }
        });

        // Output FFmpeg progress in real-time
        process.stdout.on('data', (data) => {
            console.log(`FFmpeg STDOUT: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`FFmpeg STDERR: ${data}`);
        });
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
    const rtmpUrl = await askQuestion("Input RTMP URL: ");
    const streamKey = await askQuestion("Input Stream Key: ");
    const bigoUrl = await askQuestion("Input Bigo URL: ");
    
    const FULL_RTMP_URL = `${rtmpUrl}${streamKey}`;
    // Launch Puppeteer and open the browser page
    const browser = await puppeteer.launch({
        headless: true,  // run in headless mode
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
        // Stream the M3U8 file to the RTMP server
        await streamM3U8ToRtmp(m3u8Url, FULL_RTMP_URL);
    } catch (error) {
        console.error('Error streaming to RTMP:', error);
    }

    await browser.close();
    console.log('Browser closed.');
    process.stdin.pause();  // Stop listening for input
})();
