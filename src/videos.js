require("dotenv").config();
const header = require("../header");
const sslfix = require("./sslfix");
const cheerio = require("cheerio");
const Axios = require('axios')
const { setupCache } = require("axios-cache-interceptor");

const instance = Axios.create();
const axios = setupCache(instance);


async function GetVideos(id) {
    try {
        // Step 1: Load the episode/movie page to get data-cfg and session cookies
        var response = await Axios({
            ...sslfix,
            url: process.env.PROXY_URL + id,
            headers: {
                ...header,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            method: "GET",
            maxRedirects: 5,
        });

        if (response && response.status == 200) {
            // Extract cookies from response
            var cookies = "";
            var setCookies = response.headers["set-cookie"];
            if (setCookies) {
                cookies = setCookies.map(c => c.split(";")[0]).join("; ");
            }

            var $ = cheerio.load(response.data);
            var cfg = $("#videoContainer").attr("data-cfg");

            if (cfg) {
                // Step 2: POST to ajax-player-config with the same session cookies
                var playerResponse = await Axios({
                    ...sslfix,
                    url: process.env.PROXY_URL + "/ajax-player-config",
                    headers: {
                        ...header,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": process.env.PROXY_URL + id,
                        "Origin": process.env.PROXY_URL,
                        "Cookie": cookies,
                    },
                    method: "POST",
                    data: "cfg=" + encodeURIComponent(cfg)
                });

                if (playerResponse && playerResponse.status == 200 && playerResponse.data) {
                    var data = playerResponse.data;
                    if (data.success && data.config) {
                        var config = data.config;
                        var videoUrl = config.v || "";
                        var videoType = config.t || "embed";

                        if (videoType === "embed" && videoUrl) {
                            return await ScrapeVideoUrl(videoUrl);
                        } else if (videoUrl) {
                            return { url: videoUrl, subtitles: null };
                        }
                    }
                }
            }

            // Fallback: try old iframe method
            var videoLink = $("#vast_new > iframe").attr("src");
            if (videoLink) {
                return await ScrapeVideoUrl(videoLink);
            }
        }
    } catch (error) {
        console.log(error);
    }
}


async function ScrapeVideoUrl(scrapeUrl) {
    try {
        var embedOrigin = scrapeUrl;
        try { embedOrigin = new URL(scrapeUrl).origin; } catch(e) {}

        var scrapeHeader = {
            "referer": process.env.PROXY_URL,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
        };
        var response = await axios({ url: scrapeUrl, headers: scrapeHeader, method: "GET" });
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
