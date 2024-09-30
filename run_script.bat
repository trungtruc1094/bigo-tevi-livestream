@echo off
REM Step 1: Kill any existing Chrome processes
echo Killing all Chrome processes...
taskkill /F /IM chrome.exe /T

REM Step 2: Launch Chrome with remote debugging port
:: start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\Users\trung\AppData\Local\Google\Chrome\User Data\Profile 32"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\Users\Administrator\AppData\Local\Google\Chrome\User Data\Default"

REM Step 3: Wait for manual setup of the livestream session
echo "Please set up your livestream session on the recipient platform, then provide the necessary information."

REM Step 4: Run the bigo-tevi-stream.js script to handle the restream and monitoring
node bigo-tevi-stream.js

pause
