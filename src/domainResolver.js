require("dotenv").config();
const Axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const sslfix = require("./sslfix");

// The site hops to a new numbered domain every few days (dizipal2043 -> dizipal2089 -> ...).
// Each old domain 301s to the next one, so following the chain from any still-alive
// domain lands on the current one. The homepage often answers 403 behind the bot
// protection, but a real content path keeps redirecting properly, so we probe /arama.
const CACHE_FILE = path.join(__dirname, "..", ".domain-cache.json");
const PROBE_PATH = "/arama?q=" + encodeURIComponent("breaking bad");
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // re-check every 6 hours
const MIN_RECHECK = 60 * 1000;               // never re-probe more than once a minute
const MAX_REDIRECTS = 60;                    // the chain can be 40+ hops after a long gap
const SCAN_SPAN = 40;                        // how far to scan when the chain is broken
const SCAN_BATCH = 8;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

var resolving = null;    // collapses concurrent callers onto one resolution
var lastOk = 0;
var lastAttempt = 0;

function readCache() {
    try {
        var raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        if (raw && raw.origin) return raw.origin;
    } catch (e) { }
    return null;
}

function writeCache(origin) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ origin: origin, updatedAt: new Date().toISOString() }, null, 2));
    } catch (e) {
        console.log("[domain] cache yazilamadi:", e.message);
    }
}

// Fetches a real content page and confirms it actually renders results.
// A 200 alone is not enough: parked pages and clones answer 200 with no cards.
// Returns the final origin after redirects, or null.
async function probe(origin) {
    try {
        var response = await Axios({
            ...sslfix,
            url: origin + PROBE_PATH + "&_=" + Date.now(),
            headers: {
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "tr,en;q=0.9",
            },
            method: "GET",
            maxRedirects: MAX_REDIRECTS,
            timeout: 25000,
            validateStatus: function () { return true; },
        });
        if (response.status !== 200) return null;

        var $ = cheerio.load(response.data);
        if ($("article.content-card").length === 0) return null;

        var finalUrl = (((response.request || {}).res || {}).responseUrl) || origin;
        return new URL(finalUrl).origin;
    } catch (e) {
        return null;
    }
}

// If the chain is broken (an intermediate domain went dead / NXDOMAIN), walk the
// number forward from the last known one until a live domain answers.
async function scanForward(origin) {
    var parts = String(origin).match(/^(https?:\/\/[a-z-]*?)(\d+)(\.[a-z.]+)$/i);
    if (!parts) return null;

    var prefix = parts[1], start = parseInt(parts[2], 10), tld = parts[3];
    console.log("[domain] zincir kopuk, " + start + " sonrasi taraniyor...");

    for (var i = 1; i <= SCAN_SPAN; i += SCAN_BATCH) {
        var batch = [];
        for (var j = i; j < i + SCAN_BATCH && j <= SCAN_SPAN; j++) {
            batch.push(prefix + (start + j) + tld);
        }
        var found = (await Promise.all(batch.map(probe))).filter(Boolean);
        if (found.length) return found[0];
    }
    return null;
}

function adopt(origin) {
    if (origin !== process.env.PROXY_URL) {
        console.log("[domain] guncellendi: " + process.env.PROXY_URL + " -> " + origin);
    }
    process.env.PROXY_URL = origin;

    // header is a shared object captured at require time, so its Origin/Referer
    // would otherwise keep pointing at the stale domain.
    try {
        var header = require("../header");
        header.Origin = origin;
        header.Referer = origin;
    } catch (e) { }

    lastOk = Date.now();
    writeCache(origin);
    return origin;
}

async function resolveDomain(options) {
    var opts = options || {};

    if (resolving) return resolving;
    if (!opts.force && lastOk && Date.now() - lastOk < REFRESH_INTERVAL) return process.env.PROXY_URL;
    if (lastAttempt && Date.now() - lastAttempt < MIN_RECHECK) return process.env.PROXY_URL;
    lastAttempt = Date.now();

    resolving = (async function () {
        var candidates = [];
        var cached = readCache();
        if (cached) candidates.push(cached);
        if (process.env.PROXY_URL) candidates.push(process.env.PROXY_URL);

        // fetchWithUrl assigns PROXY_URL itself, so snapshot and restore it —
        // whether we adopt that domain is decided by the probe, not by the API.
        if (process.env.URLGETSTATUS === "true") {
            var before = process.env.PROXY_URL;
            try {
                var fromApi = await require("./getUrlApi").fetchWithUrl();
                if (fromApi) candidates.push(fromApi);
            } catch (e) { }
            process.env.PROXY_URL = before;
        }

        var unique = candidates.filter(function (c, i) { return c && candidates.indexOf(c) === i; });

        for (var i = 0; i < unique.length; i++) {
            var found = await probe(unique[i]);
            if (found) return adopt(found);
        }

        for (var k = 0; k < unique.length; k++) {
            var scanned = await scanForward(unique[k]);
            if (scanned) return adopt(scanned);
        }

        console.log("[domain] cozulemedi, mevcut korunuyor: " + process.env.PROXY_URL);
        return process.env.PROXY_URL;
    })();

    try {
        return await resolving;
    } finally {
        resolving = null;
    }
}

// Resolve once at boot, then keep it fresh in the background.
function startAutoRefresh() {
    resolveDomain({ force: true }).catch(function (e) { console.log("[domain] hata:", e.message); });
    var timer = setInterval(function () {
        resolveDomain({ force: true }).catch(function (e) { console.log("[domain] hata:", e.message); });
    }, REFRESH_INTERVAL);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = { resolveDomain, startAutoRefresh };
