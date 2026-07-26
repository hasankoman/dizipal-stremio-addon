const Axios = require('axios');
const { setupCache } = require("axios-cache-interceptor");

const instance = Axios.create();
const axios = setupCache(instance);

async function fetchWithUrl() {
    try {
        if (process.env.URLGETSTATUS === "true") {
            var response = await axios.get("https://raw.githubusercontent.com/dizipaltv/api/refs/heads/main/dizipal.json");
            if (response.status == 200) {
                var siteUrl = String((response.data || {}).currentSiteURL || "").trim();
                if (!siteUrl) return undefined;
                if (!/^https?:\/\//i.test(siteUrl)) siteUrl = "https://" + siteUrl;
                process.env.PROXY_URL = new URL(siteUrl).origin + (process.env.PROXYTEMPLATEURL || "");
                return process.env.PROXY_URL;
            }
        }
        else{
            return undefined;
        }
    } catch (error) {
        console.error('Error fetching the URL:', error);
    }
}

module.exports = { fetchWithUrl };