require("dotenv").config();

// One of the CDNs answers 403 to the server's own IP but 200 from a Turkish one,
// so requests to it have to leave through a TR exit. SOURCE_PROXY points at that
// exit (e.g. socks5://127.0.0.1:1080 fed by `ssh -R 1080 <server>` from a TR box).
//
// Rather than maintaining a host list by hand, a host is learned: the first time
// it answers 403 directly, it is remembered and every later request for it goes
// through the proxy. With SOURCE_PROXY unset everything behaves as before.
var SocksProxyAgent = null;
try {
    SocksProxyAgent = require("socks-proxy-agent").SocksProxyAgent;
} catch (e) {
    // optional dependency; without it the proxy simply stays disabled
}

const PROXY_URL_SETTING = String(process.env.SOURCE_PROXY || "").trim();
const FORCED_HOSTS = String(process.env.SOURCE_PROXY_HOSTS || "")
    .split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

var agent = null;
var blockedHosts = new Set(FORCED_HOSTS);

function enabled() {
    return !!(PROXY_URL_SETTING && SocksProxyAgent);
}

function getAgent() {
    if (!enabled()) return null;
    if (!agent) {
        try {
            agent = new SocksProxyAgent(PROXY_URL_SETTING);
        } catch (e) {
            console.log("[proxy-exit] agent kurulamadi:", e.message);
            return null;
        }
    }
    return agent;
}

function hostOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch (e) {
        return "";
    }
}

// Hosts are matched by suffix so every shard (s2., s4., ...) is covered at once.
function isBlocked(url) {
    var host = hostOf(url);
    if (!host) return false;
    for (var h of blockedHosts) {
        if (host === h || host.endsWith("." + h)) return true;
    }
    return false;
}

function remember(url) {
    var host = hostOf(url);
    if (!host) return;
    // store the registrable-ish suffix so sibling shards inherit the decision
    var parts = host.split(".");
    var suffix = parts.length > 2 ? parts.slice(-3).join(".") : host;
    if (!blockedHosts.has(suffix)) {
        blockedHosts.add(suffix);
        console.log("[proxy-exit] " + suffix + " engelli, bundan sonra TR cikisi kullanilacak");
    }
}

// Axios config additions for a URL: proxy agent when the host is known-blocked.
function agentFor(url) {
    if (!enabled() || !isBlocked(url)) return {};
    var a = getAgent();
    if (!a) return {};
    return { httpAgent: a, httpsAgent: a, proxy: false };
}

// Runs `attempt(extraConfig)`; if the direct call is rejected the way this CDN
// rejects foreign IPs, retries once through the proxy and remembers the host.
async function withFallback(url, attempt) {
    var response = await attempt(agentFor(url));
    var status = response && response.status;
    if (status !== 403 && status !== 451) return response;
    if (!enabled() || isBlocked(url)) return response;

    remember(url);
    try {
        return await attempt(agentFor(url));
    } catch (e) {
        return response;
    }
}

module.exports = { agentFor, withFallback, enabled, isBlocked };
