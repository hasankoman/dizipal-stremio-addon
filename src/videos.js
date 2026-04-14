require("dotenv").config();
const header = require("../header");
const sslfix = require("./sslfix");
const cheerio = require("cheerio");
const Axios = require('axios')
const { setupCache } = require("axios-cache-interceptor");
const CryptoJS = require('crypto-js');

const instance = Axios.create();
const axios = setupCache(instance);

const DECRYPT_KEY = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";

function getPageContext(response, requestedUrl) {
    var responseUrl =
        (((response || {}).request || {}).res || {}).responseUrl ||
        ((response || {}).request || {}).responseURL ||
        requestedUrl;

    try {
        var pageUrl = new URL(responseUrl, requestedUrl).toString();
        return { pageUrl, baseUrl: new URL(pageUrl).origin };
    } catch (e) {
        return { pageUrl: requestedUrl, baseUrl: process.env.PROXY_URL };
    }
}

function makeAbsoluteUrl(url, baseUrl) {
    if (!url) return url;
    try {
        return new URL(url, baseUrl).toString();
    } catch (e) {
        return url;
    }
}

function decryptIframeUrl(jsonStr) {
    try {
        var data = JSON.parse(jsonStr);
        var salt = CryptoJS.enc.Hex.parse(data.salt);
        var iv = CryptoJS.enc.Hex.parse(data.iv);
        var key = CryptoJS.PBKDF2(DECRYPT_KEY, salt, {
            hasher: CryptoJS.algo.SHA512,
            keySize: 0x40 / 0x8,
            iterations: 0x3e7
        });
        var result = CryptoJS.AES.decrypt(data.ciphertext, key, { iv: iv });
        return result.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        console.log("Decrypt error:", e.message);
        return null;
    }
}

async function GetVideos(id) {
    try {
        var requestedUrl = new URL(id, process.env.PROXY_URL).toString();
        var response = await Axios({
            ...sslfix,
            url: requestedUrl,
            headers: {
                ...header,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            method: "GET",
            maxRedirects: 5,
        });

        if (response && response.status == 200) {
            var pageContext = getPageContext(response, requestedUrl);
            var pageBaseUrl = pageContext.baseUrl;
            var pageUrl = pageContext.pageUrl;
            var $ = cheerio.load(response.data);

            // Method 1: Decrypt encrypted iframe URL from data-rm-k
            var encryptedEl = $("[data-rm-k]");
            if (encryptedEl.length > 0) {
                var encryptedJson = encryptedEl.html();
                if (encryptedJson) {
                    var iframeUrl = decryptIframeUrl(encryptedJson);
                    if (iframeUrl) {
                        if (!iframeUrl.startsWith("http")) iframeUrl = "https:" + iframeUrl;
                        iframeUrl = makeAbsoluteUrl(iframeUrl, pageBaseUrl);
                        // Try to scrape the actual video URL from the embed page
                        var scraped = await ScrapeVideoUrl(iframeUrl, pageBaseUrl + "/");
                        if (scraped) return scraped;
                        // Fallback: return the iframe URL for client-side playback
                        return { url: iframeUrl, embedUrl: iframeUrl, subtitles: null, referer: pageBaseUrl + "/" };
                    }
                }
            }

            // Method 2: data-cfg + ajax-player-config
            var cookies = "";
            var setCookies = response.headers["set-cookie"];
            if (setCookies) {
                cookies = setCookies.map(c => c.split(";")[0]).join("; ");
            }
            var cfg = $("#videoContainer").attr("data-cfg");
            if (cfg) {
                var playerResponse = await Axios({
                    ...sslfix,
                    url: pageBaseUrl + "/ajax-player-config",
                    headers: {
                        ...header,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": pageUrl,
                        "Origin": pageBaseUrl,
                        "Cookie": cookies,
                    },
                    method: "POST",
                    data: "cfg=" + encodeURIComponent(cfg)
                });
                if (playerResponse && playerResponse.status == 200 && playerResponse.data) {
                    var data = playerResponse.data;
                    if (data.success && data.config) {
                        var videoUrl = makeAbsoluteUrl(data.config.v || "", pageBaseUrl);
                        var videoType = data.config.t || "embed";
                        if (videoType === "embed" && videoUrl) {
                            var scraped = await ScrapeVideoUrl(videoUrl, pageBaseUrl + "/");
                            if (scraped) return scraped;
                            // Fallback: return embed URL for client-side iframe playback
                            return { url: videoUrl, embedUrl: videoUrl, subtitles: null, referer: pageBaseUrl + "/" };
                        }
                        else if (videoUrl) return { url: videoUrl, subtitles: null, referer: pageBaseUrl + "/" };
                    }
                }
            }

            // Method 3: Fallback old iframe method
            var videoLink = $("#vast_new > iframe").attr("src");
            if (videoLink) return await ScrapeVideoUrl(makeAbsoluteUrl(videoLink, pageBaseUrl), pageBaseUrl + "/");
        }
    } catch (error) {
        console.log(error);
    }
}


async function ScrapeVideoUrl(scrapeUrl, customReferer) {
    try {
        var embedOrigin = scrapeUrl;
        try { embedOrigin = new URL(scrapeUrl).origin; } catch(e) {}

        var refererUrl = customReferer || embedOrigin + "/";
        var refererOrigin = customReferer ? customReferer.replace(/\/$/, '') : embedOrigin;

        var scrapeHeader = {
            "referer": refererUrl,
            "origin": refererOrigin,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "sec-fetch-dest": "iframe",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "cross-site",
        };
        var response = await Axios({ url: scrapeUrl, headers: scrapeHeader, method: "GET" });
        if (response && response.status == 200) {
            var html = response.data;

            // Method 1: FirePlayer API (imagestoo.com style)
            // The FirePlayer call is inside packed JS, so we need to unpack first
            var videoId = null;
            var packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.+)',(\d+),(\d+),'([^']+)'/s);
            if (packedMatch) {
                var pk = packedMatch[4].split('|');
                var pa = parseInt(packedMatch[2]);
                function decodePacked(word) {
                    var n = 0;
                    for (var ch of word) {
                        if (/\d/.test(ch)) n = n * pa + parseInt(ch);
                        else if (/[a-z]/.test(ch)) n = n * pa + ch.charCodeAt(0) - 97 + 10;
                        else if (/[A-Z]/.test(ch)) n = n * pa + ch.charCodeAt(0) - 65 + 36;
                    }
                    return n < pk.length && pk[n] ? pk[n] : word;
                }
                var decoded = packedMatch[1].replace(/\b\w+\b/g, decodePacked);
                var fireMatch = decoded.match(/FirePlayer\("([^"]+)"/);
                if (fireMatch) videoId = fireMatch[1];
            }
            // Also try direct match (in case it's not packed)
            if (!videoId) {
                var directMatch = html.match(/FirePlayer\("([^"]+)"/);
                if (directMatch) videoId = directMatch[1];
            }
            if (videoId) {
                try {
                    var apiRes = await Axios.post(
                        embedOrigin + '/player/index.php?data=' + videoId + '&do=getVideo',
                        'hash=' + videoId + '&r=' + encodeURIComponent(process.env.PROXY_URL + '/'),
                        {
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                                "Referer": scrapeUrl,
                                "User-Agent": scrapeHeader["user-agent"],
                                "X-Requested-With": "XMLHttpRequest"
                            }
                        }
                    );
                    if (apiRes.data && apiRes.data.videoSource) {
                        return {
                            url: apiRes.data.securedLink || apiRes.data.videoSource,
                            subtitles: null,
                            referer: embedOrigin + "/",
                        };
                    }
                } catch(e) {
                    console.log("FirePlayer API error:", e.message);
                }
            }

            // Method 2: Playerjs file pattern
            var playerFileLink = "";
            var subtitles;
            var $ = cheerio.load(html);

            $("script").each((index, script) => {
                const scriptContent = $(script).html().trim();
                if (scriptContent.includes('new Playerjs') || scriptContent.includes('file:')) {
                    const fileMatch = scriptContent.match(/file:"([^"]+)"/);
                    const subtitleMatch = scriptContent.match(/"subtitle":"([^"]+)"/);
                    if (fileMatch && fileMatch[1]) {
                        playerFileLink = fileMatch[1];
                    }
                    if (subtitleMatch && subtitleMatch[1]) {
                        subtitles = subtitleMatch[1].split(",");
                    }
                }
            });

            // Method 3: JWPlayer setup pattern
            var setupMatch = html.match(/jwplayer\(.*?\)\.setup\(([\s\S]*?)\);/);
            if (setupMatch) {
                var setupStr = setupMatch[1];
                if (!playerFileLink) {
                    var fileMatch = setupStr.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
                    if (fileMatch) playerFileLink = fileMatch[1];
                }
                var tracksMatch = setupStr.match(/tracks\s*:\s*\[([\s\S]*?)\]/);
                if (tracksMatch) {
                    var tracksStr = tracksMatch[1];
                    var itemRegex = /\{[\s\S]*?\}/g;
                    var itemMatches = tracksStr.match(itemRegex);
                    if (itemMatches) {
                        var extractedSubs = [];
                        itemMatches.forEach(itemStr => {
                            var tf = itemStr.match(/file\s*:\s*["']([^"']+)["']/);
                            var tl = itemStr.match(/label\s*:\s*["']([^"']+)["']/);
                            var tk = itemStr.match(/kind\s*:\s*["']([^"']+)["']/);
                            var td = /default\s*:\s*true/i.test(itemStr);
                            
                            if (tf && tk && tk[1] === 'captions') {
                                extractedSubs.push({
                                    url: tf[1],
                                    lang: tl ? tl[1].substring(0, 2).toLowerCase() : 'tr',
                                    label: tl ? tl[1] : 'Subtitle',
                                    default: td
                                });
                            }
                        });
                        if (extractedSubs.length > 0) subtitles = extractedSubs;
                    }
                }
            }

            if (playerFileLink) {
                return {
                    url: playerFileLink,
                    subtitles: subtitles,
                    referer: embedOrigin + "/",
                };
            }
        }
    } catch (error) {
        console.log(error);
    }
}


module.exports = { GetVideos }
