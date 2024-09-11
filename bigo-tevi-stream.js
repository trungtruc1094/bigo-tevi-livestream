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

// Function to stream the TS file to the RTMP server (currently unused)
function streamToRtmp(tsFile) {
    return new Promise((resolve, reject) => {
        const ffmpegCommand = `ffmpeg -re -i ${tsFile} -vf "scale=720:1280:flags=bicubic" -c:v libx264 -preset veryfast -crf 20 -g 50 -c:a aac -b:a 128k -f flv ${FULL_RTMP_URL}`;
        // const ffmpegCommand = `ffmpeg -i ${tsFile} -vf "scale=720:1280" -preset veryfast -b:v 2500k -maxrate 2500k -bufsize 5000k -g 60 -keyint_min 60 -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 44100 -ac 2 -f flv ${FULL_RTMP_URL}`;
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

    // Intercept network requests
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
        const url = request.url();
        if (url.endsWith('.ts')) {
            console.log(`Detected TS segment: ${url}`);

            // Download the .ts file and add it to the list
            const tsFile = `segment_${Date.now()}.ts`;
            try {
                const tsFilePath = await downloadTsFile(url, tsFile);

                tsFileList.push(tsFilePath); // Add the downloaded file to the list
                
                // await streamToRtmp(tsFilePath, FULL_RTMP_URL);
                // Clean up: remove the .ts file after streaming
                //fs.unlinkSync(tsFilePath);
            } catch (error) {
                console.error('Error handling TS segment:', error);
            }
        }
        request.continue();
    });

    // Go to the Bigo live stream page
    await page.goto(bigoUrl, {
        waitUntil: 'networkidle2',  // wait for the network to be idle
    });

    // Listen for TS segments for a set duration (e.g., 5 minutes)
    console.log('Listening for TS segments...');
    
    setTimeout(async () => {
        // After 5 minutes, concatenate the TS files into an MP4 file
        const outputFile = 'output_video.mp4';
        try {
            await concatenateTsFiles(outputFile);
            console.log(`Video saved as ${outputFile}. You can play this file with VLC.`);
        } catch (error) {
            console.error('Error concatenating TS files:', error);
        }

        await browser.close();
        console.log('Browser closed.');
        process.stdin.pause(); // Stop listening for input
    }, 120000);  // 30 minutes
})();
