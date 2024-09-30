const dns = require('dns');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Force DNS to prioritize IPv4 over IPv6
dns.setDefaultResultOrder('ipv4first');

const API_BASE_URL = 'https://wapi.tevi.app';
const REFRESH_TOKEN_ENDPOINT = '/auth/v1/token/refresh/';

// Device information for token refresh
const device_info = {
  device_id: 'aa4ffb69-2f3a-4113-b513-21e748450633',     // Replace with actual device ID
  device_type: 'browser', // Replace with actual device type
  os_type: 'Windows',         // Replace with actual OS type
  device_name: 'Chrome', // Replace with actual device name
};

// Load tokens from the JSON file
function load_tokens() {
  try {
    const tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf-8'));
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('tokens.json file not found. Please provide initial tokens.');
    } else if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON format in tokens.json.');
    } else {
      throw error;
    }
  }
}

// Save tokens to the JSON file
function save_tokens(access_token, refresh_token) {
  const tokens = {
    access_token: access_token,
    refresh_token: refresh_token
  };
  fs.writeFileSync('tokens.json', JSON.stringify(tokens, null, 2));
  console.log('Tokens saved to tokens.json.');
}

// Function to refresh the access token
async function refresh_access_token() {
  const { access_token, refresh_token } = load_tokens();

  const refreshPayload = {
    refresh_token: refresh_token,
    device_id: device_info.device_id,
    device_type: device_info.device_type,
    os: device_info.os_type,
    device_name: device_info.device_name,
  };

  const headers = {
    'Authorization': `Bearer ${access_token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${API_BASE_URL}${REFRESH_TOKEN_ENDPOINT}`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(refreshPayload),
  });

  if (response.status === 200) {
    const data = await response.json();
    const new_access_token = data.data.access_token;
    const new_refresh_token = data.data.refresh_token;

    // Save the new tokens back to the JSON file
    save_tokens(new_access_token, new_refresh_token);
    console.log('Access token refreshed successfully.');
    return { access_token: new_access_token, refresh_token: new_refresh_token };
  } else {
    const errorText = await response.text();
    throw new Error(`Token refresh failed with status ${response.status}: ${errorText}`);
  }
}

// Function to handle API requests with token refresh logic
async function apiRequestWithToken(url, method = 'GET', payload = null, tokens) {
  let { access_token, refresh_token } = tokens;

  const headers = {
    'Authorization': `Bearer ${access_token}`,
    'Content-Type': 'application/json',
  };

  let options = {
    method: method,
    headers: headers,
    body: payload ? JSON.stringify(payload) : null,
  };

  // Timeout setup (30 seconds)
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000); // 30 seconds

  try {
    let response = await fetch(url, { ...options, signal: controller.signal }).finally(() => {
      clearTimeout(timeout);
    });

    // If token is expired or invalid, refresh token and retry the request
    if (response.status === 401) {
      console.log('Token expired. Refreshing token...');
      const newTokens = await refresh_access_token(refresh_token, access_token);
      access_token = newTokens.access_token;
      refresh_token = newTokens.refresh_token;

      // Retry the request with the new token
      headers.Authorization = `Bearer ${access_token}`;
      options.headers = headers;

      response = await fetch(url, { ...options, signal: controller.signal });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Request timed out.');
    } else {
      console.error('Fetch failed during API request:', error);
    }
    throw error;
  }
}

// Function to create a livestream and return the "rtmps_stream_key"
async function createLivestream() {
  try {
    let tokens = load_tokens();

    // Step 1: Retrieve details of the last livestream event
    const lastEventResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/events/last-event/`, 'GET', null, tokens);
    console.log('Last Event:', lastEventResponse);
    const required_packages_last = lastEventResponse.data.required_packages;

    // Step 2: Get livestream cover
    const liveCoverPayload = {
      live_title: 'Test Live',
      space_name: 'Donnie Farmer',
      profile_url: 'https://img.tevi.app/Channel/Images/website/24/08/05/a3679bf9f109447eb36c82b4228b50bb.jpg',
    };
    const liveCoverResponse = await apiRequestWithToken(`${API_BASE_URL}/media/v1/image/live-cover/`, 'POST', liveCoverPayload, tokens);
    console.log('Live Cover:', liveCoverResponse);

    // Step 3: Create livestream event
    const createEventPayload = {
      title: 'Test Live',
      description: 'Test Live',
      start_at: Date.now(),
      price_currency: 'TVS',
      price: 0,
      images: {
        banner: liveCoverResponse.data.image_url,
      },
      visibility: 'public',
      notification: true,
      invitation_emails: [],
      chat_filter: [],
      allow_chat: true,
      allowed_capture: false,
      required_packages: []
      //required_packages: required_packages_last,
    };
    const createEventResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/events/`, 'POST', createEventPayload, tokens);
    console.log('Create Event:', createEventResponse);

    const eventCode = createEventResponse.data.code;
    const shareable_url = createEventResponse.data.shareable_url; 

    // Step 4: Retrieve livestream event's details
    const eventDetailsResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/public/events/${eventCode}/`, 'GET', null, tokens);
    console.log('Event Details:', eventDetailsResponse);

    // Step 5: Request additional information
    const additionalInfoResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/live/event/${eventCode}/input/`, 'GET', null, tokens);
    console.log('Additional Info:', additionalInfoResponse);

    // Step 6: Retrieve backstage information
    const backstageInfoResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/live/event/${eventCode}/backstage-input/?source=encoder`, 'GET', null, tokens);
    console.log('Backstage Info:', backstageInfoResponse);

    return { rtmps_stream_key: backstageInfoResponse.data.rtmps_stream_key, eventCode, shareable_url};
  } catch (error) {
    console.error('Error in createLivestream:', error.message);
    throw error;
  }
}

// Function to start a livestream
async function startLivestream(eventCode) {
  try {
    let tokens = load_tokens();
    const startLiveResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/events/${eventCode}/live/`, 'POST', {}, tokens);
    console.log('Start Live:', startLiveResponse);
    return startLiveResponse.success;
  } catch (error) {
    console.error('Error in startLivestream:', error.message);
    throw error;
  }
}

// Export the functions as a module
module.exports = {
  createLivestream,
  startLivestream
};

// (async () => {
//   try {
//     // Load tokens once at the beginning of the main flow
//     let tokens = load_tokens();

//     // Launch Puppeteer browser
//     // const browser = await puppeteer.launch({ headless: false });
//     // const page = await browser.newPage();

//     // Step 1: Retrieve details of the last livestream event
//     const lastEventResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/events/last-event/`, 'GET', null, tokens);
//     console.log('Last Event:', lastEventResponse);
//     const required_packages_last = lastEventResponse.data.required_packages;

//     // Step 2: Retrieve package information of current membership tier
//     const packageInfoResponse = await apiRequestWithToken(`${API_BASE_URL}/billy/v3/subscription/channel/donniefarmer/packages/?page=1&page_size=20`, 'GET', null, tokens);
//     console.log('Package Info:', packageInfoResponse);

//     // Step 3: Get livestream cover
//     const liveCoverPayload = {
//       live_title: 'Test Live',
//       space_name: 'Donnie Farmer',
//       profile_url: 'https://img.tevi.app/Channel/Images/website/24/08/05/a3679bf9f109447eb36c82b4228b50bb.jpg',
//     };
//     const liveCoverResponse = await apiRequestWithToken(`${API_BASE_URL}/media/v1/image/live-cover/`, 'POST', liveCoverPayload, tokens);
//     console.log('Live Cover:', liveCoverResponse);

//     // Step 4: Create livestream event
//     const createEventPayload = {
//       title: 'Test Live',
//       description: 'Test Live',
//       start_at: Date.now(),
//       price_currency: 'TVS',
//       price: 2,
//       images: {
//         banner: liveCoverResponse.data.image_url,
//       },
//       visibility: 'public',
//       notification: true,
//       invitation_emails: [],
//       chat_filter: [],
//       allow_chat: true,
//       allowed_capture: false,
//       required_packages: required_packages_last,
//     };
//     const createEventResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/events/`, 'POST', createEventPayload, tokens);
//     console.log('Create Event:', createEventResponse);

//     // Extract event code for later use
//     const eventCode = createEventResponse.data.code;

//     // Step 5: Retrieve livestream event's details
//     const eventDetailsResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/public/events/${eventCode}/`, 'GET', null, tokens);
//     console.log('Event Details:', eventDetailsResponse);

//     // Step 6: Request additional information
//     const additionalInfoResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/live/event/${eventCode}/input/`, 'GET', null, tokens);
//     console.log('Additional Info:', additionalInfoResponse);

//     // Step 7: Retrieve backstage information of livestream session
//     const backstageInfoResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/live/event/${eventCode}/backstage-input/?source=encoder`, 'GET', null, tokens);
//     console.log('Backstage Info:', backstageInfoResponse);
//     console.log('RTMP Stream Key:', backstageInfoResponse.data.rtmps_stream_key);

//     // Step 8: Start livestream session with correct endpoint
//     const startLiveResponse = await apiRequestWithToken(`${API_BASE_URL}/core/v4/events/${eventCode}/live/`, 'POST', {}, tokens);
//     console.log('Start Live:', startLiveResponse);

//     // Close the browser
//     // await browser.close();
//   } catch (error) {
//     console.error('An error occurred:', error.message);
//   }
// })();
