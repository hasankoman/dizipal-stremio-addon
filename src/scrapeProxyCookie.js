const Axios = require('axios');
const { setupCache } = require("axios-cache-interceptor");

const instance = Axios.create();
const axios = setupCache(instance);

async function fetchWithCookies(url) {
  // Without a cookie server configured there is nothing to call; the site's
  // DDoS-Guard cookies already come back on the page response itself.
  if (!process.env.COOKIESERVER) return undefined;

  var cookieData = {
    url: url,
    token: "free"
  }
  try {
    var response = await axios.post(`${process.env.COOKIESERVER}/api/v1/getcookie`, cookieData);
    if (response.data.status == true) {
      return response.data;
    }
  } catch (error) {
    console.error('Error fetching cookies:', error.message);
  }
}

module.exports = { fetchWithCookies };