require("dotenv").config()
const MANIFEST = require('./manifest');
const landing = require("./src/landingTemplate");
const header = require('./header');
const fs = require('fs')
const Path = require("path");
const express = require("express");
const app = express();
const searchVideo = require("./src/search");
const listVideo = require("./src/videos");
const path = require("path");
const NodeCache = require("node-cache");
const { v4: uuidv4 } = require('uuid');
const subsrt = require('subtitle-converter');
const Axios = require('axios')
const { setupCache } = require("axios-cache-interceptor");


const instance = Axios.create();
const axios = setupCache(instance);





const CACHE_MAX_AGE = 4 * 60 * 60; // 4 hours in seconds
const STALE_REVALIDATE_AGE = 4 * 60 * 60; // 4 hours
const STALE_ERROR_AGE = 7 * 24 * 60 * 60; // 7 days

const myCache = new NodeCache({ stdTTL: 30*60, checkperiod: 300 });

app.use(express.static(path.join(__dirname, "static")));
app.use(express.static(path.join(__dirname, "frontend"), { index: false }));

var respond = function (res, data) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(data);
};


app.get('/', function (req, res) {
        res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

app.get("/:userConf?/configure", function (req, res) {
        if (req.params.userConf !== "addon") {
            res.redirect("/addon/configure")
        } else {
            res.set('Content-Type', 'text/html');
            const newManifest = { ...MANIFEST };
            res.send(landing(newManifest));
        }
});

app.get('/manifest.json', function (req, res) {
        const newManifest = { ...MANIFEST };
        // newManifest.behaviorHints.configurationRequired = false;
        newManifest.behaviorHints.configurationRequired = true;
        return respond(res, newManifest);
});

app.get('/:userConf/manifest.json', function (req, res) {
        const newManifest = { ...MANIFEST };
        if (!((req || {}).params || {}).userConf) {
            newManifest.behaviorHints.configurationRequired = true;
           return respond(res, newManifest);
        } else {
            newManifest.behaviorHints.configurationRequired = false;
           return respond(res, newManifest);
        }
});

// API for frontend
app.get("/api/search", async (req, res) => {
    try {
        var query = req.query.q;
        if (!query || query.length < 2) return respond(res, { results: [] });
        var cached = myCache.get("api_search_" + query);
        if (cached) return respond(res, { results: cached });
        var video = await searchVideo.SearchMovieAndSeries(query);
        var results = (video || []).map(item => ({
            id: item.url,
            type: item.type === "Dizi" ? "series" : (item.type || "movie"),
            title: item.title,
            poster: item.poster || "",
            year: item.rating || "",
            url: item.url
        }));
        myCache.set("api_search_" + query, results);
        return respond(res, { results });
    } catch (error) {
        console.log(error);
        return respond(res, { results: [] });
    }
});

app.get("/api/homepage", async (req, res) => {
    try {
        var cached = myCache.get("api_homepage");
        if (cached) return respond(res, cached);

        const cheerio = require("cheerio");
        var response = await axios({ url: process.env.PROXY_URL, headers: header, method: "GET" });
        if (response && response.status == 200) {
            var $ = cheerio.load(response.data);
            var sections = [];

            $(".content-section, .swiper-container, .section-container, [class*='section']").each((i, el) => {
                var title = $(el).find("h2, h3, .section-title, .block-title").first().text().trim();
                if (!title) return;
                var items = [];
                $(el).find(".content-card, article, .poster-item, .movie-item").each((j, card) => {
                    var link = $(card).find("a").first().attr("href") || "";
                    var name = $(card).find(".card-title, h3, h4, img").first().attr("alt") || $(card).find(".card-title, h3").first().text().trim();
                    var poster = $(card).find("img").first().attr("data-src") || $(card).find("img").first().attr("src") || "";
                    var type = link.includes("/dizi/") ? "series" : "movie";
                    var id = link;
                    try { id = new URL(link).pathname; } catch(e) {}
                    if (name && id) items.push({ id, type, title: name, poster });
                });
                if (items.length > 0) sections.push({ title, items });
            });

            myCache.set("api_homepage", { sections }, 3600);
            return respond(res, { sections });
        }
        return respond(res, { sections: [] });
    } catch (error) {
        console.log(error);
        return respond(res, { sections: [] });
    }
});

app.get("/api/detail/:path(*)", async (req, res) => {
    try {
        var contentPath = "/" + req.params.path;
        var cached = myCache.get("api_detail_" + contentPath);
        if (cached) return respond(res, cached);

        var meta = await searchVideo.SearchMetaMovieAndSeries(contentPath, contentPath.includes("/dizi/") ? "series" : "movie");
        var episodes = [];
        if (contentPath.includes("/dizi/") && meta && meta.season) {
            for (let i = 1; i <= meta.season; i++) {
                var eps = await searchVideo.SearchDetailMovieAndSeries(contentPath, "series", i);
                if (eps) {
                    eps.forEach(ep => {
                        if (ep.id) episodes.push({ ...ep, season: i });
                    });
                }
            }
        }
        var result = { meta, episodes };
        myCache.set("api_detail_" + contentPath, result);
        return respond(res, result);
    } catch (error) {
        console.log(error);
        return respond(res, { meta: null, episodes: [] });
    }
});

app.get("/api/stream/:path(*)", async (req, res) => {
    try {
        var contentPath = "/" + req.params.path;
        var video = await listVideo.GetVideos(contentPath);
        if (video) {
            var encodedUrl = Buffer.from(video.url).toString('base64url');
            var encodedReferer = Buffer.from(video.referer || process.env.PROXY_URL + "/").toString('base64url');
            var proxyUrl = `${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encodedUrl}`;
            return respond(res, { url: proxyUrl, directUrl: video.url, referer: video.referer });
        }
        return respond(res, { url: null });
    } catch (error) {
        console.log(error);
        return respond(res, { url: null });
    }
});

//CODE
app.get("/addon/catalog/:type/:id/search=:search", async (req, res, next) => {
    try {
        var { type, id, search } = req.params;
        search = search.replace(".json", "");
        if (id == "komanmovie") {
            var cached = myCache.get(search + type)
            if (cached) {
                return respond(res, { metas: cached,cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE });
            }
            var metaData = [];
            var video = await searchVideo.SearchMovieAndSeries(search);

            for (const element in video) {
                if (video.hasOwnProperty(element)) {
                    const item = video[element];
                    if (typeof (item.type) === "undefined") {
                        item.type = "movie";
                    }
                    if (type === item.type) {
                        var value = {
                            id: item.url,
                            type: item.type || "movie",
                            name: item.title,
                            poster: item.poster,
                            description: "",
                            genres: []
                        }
                        item.genres.split(",").forEach((data) => {
                            value.genres.push(data.trim().toString());
                        })
                        metaData.push(value);
                    }
                }
            }
            myCache.set(search + type, metaData);
            return respond(res, { metas: metaData,cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE });
        }
    } catch (error) {
        console.log(error);
    }

})

app.get('/addon/meta/:type/:id/', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        var metaObj = {};
        var cached = myCache.get(id);
        if (cached) {
            return respond(res, { meta: cached,cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE })
        }

        var data = await searchVideo.SearchMetaMovieAndSeries(id, type);

        if (data) {

            metaObj = {
                id: id,
                type: type,
                name: data.name,
                background: data.background,
                country: data.country || "JP",
                genres: [],
                season: Number(data.season) || undefined,
                videos: [] || undefined,
                imdbRating: Number(data.imdbRating),
                description: data.description,
                releaseInfo: String(data.releaseInfo),
                poster: data.background,
                posterShape: 'poster',
            }
            //series or movie check
            if (type === "series") {
                for (let i = 1; i <= data.season; i++) {
                    var dizipalVideo = await searchVideo.SearchDetailMovieAndSeries(id, type, i);
                    if (dizipalVideo && typeof (dizipalVideo) !== "undefined") {
                        dizipalVideo.forEach(element => {
                            if (typeof (element.title) !== "undefined") {
                                metaObj.videos.push({
                                    id: element.id,
                                    title: element.title || `Bölüm ${element.episode}`,
                                    released: "2024-01-09T00:00:00.000Z",
                                    season: i,
                                    episode: element.episode,
                                    overview: element.title || "",
                                    thumbnail: element.thumbnail
                                });
                            }

                        });
                    }
                }
                myCache.set(id, metaObj);
                return respond(res, { meta: metaObj,cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE })
            } else {
                myCache.set(id, metaObj);
                return respond(res, { meta: metaObj,cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE })
            }

        }
    } catch (error) {
        console.log(error);
    }


})


app.get('/addon/stream/:type/:id/', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        if (id) {
            var video = await listVideo.GetVideos(id);
            if (video) {
                // Encode the video URL and referer for proxying
                var encodedUrl = Buffer.from(video.url).toString('base64url');
                var encodedReferer = Buffer.from(video.referer || process.env.PROXY_URL + "/").toString('base64url');
                var proxyUrl = `${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encodedUrl}`;

                const stream = { url: proxyUrl };
                if (video.subtitles) {
                    myCache.set(id, video.subtitles);
                }
                return respond(res, { streams: [stream],cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE })
            }
        }
    } catch (error) {
        console.log(error);
    }
})

app.get('/addon/subtitles/:type/:id/:query?.json', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        var subtitles = [];
        var data = myCache.get(id)
        if (data) {
            for (const value of data) {

                if (String(value).includes("Türkçe")) {
                    var url = String(value).replace("[Türkçe]", "");
                    var newUrl = await WriteSubtitles(url, uuidv4());
                    if (newUrl) {
                        subtitles.push({ url: newUrl, lang: "tur",id:"dizipal-tur" });
                    }
                }
                if (String(value).includes("İngilizce")) {
                    var url = String(value).replace("[İngilizce]", "");
                    var newUrl = await WriteSubtitles(url, uuidv4());
                    if (newUrl) {
                        subtitles.push({ url: newUrl, lang: "eng",id:"dizipal-eng" });
                    }
                }
            }

            if (subtitles.length > 0) {
                return respond(res, { subtitles: subtitles,cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE })
            }

        }
    } catch (error) {
        console.log(error);
    }
})

async function WriteSubtitles(url, name) {
    try {
        var response = await axios({ url: url, method: "GET", headers: header });
        if (response && response.status === 200) {
            CheckSubtitleFoldersAndFiles();
            const outputExtension = '.srt';
            const options = {
                removeTextFormatting: true,
            };

            var subtitle = subsrt.convert(response.data, outputExtension, options).subtitle;

            fs.writeFileSync(path.join(__dirname, "static", "subs", name + ".srt"), subtitle);
            var url = `${process.env.HOSTING_URL}/subs/${name}.srt`;
            return url;
        }
    } catch (error) {
        console.log(error);
    }
}


function CheckSubtitleFoldersAndFiles() {
    try {
        const folderPath = path.join(__dirname, "static", "subs");

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
        }

        const files = fs.readdirSync(folderPath);

        if (files.length > 500) {
            files.forEach((file) => {
                const filePath = Path.join(folderPath, file);
                const fileStats = fs.statSync(filePath);

                if (fileStats.isFile()) {
                    fs.unlinkSync(filePath);
                } else if (fileStats.isDirectory()) {
                    // Dizin içinde dosya varsa onları da silmek için
                    fs.rmdirSync(filePath, { recursive: true });
                }
            });
        }
    } catch (error) {
        console.log(error);
    }

}


// Proxy endpoint for HLS streams
app.get('/proxy/:referer/:url', async (req, res) => {
    try {
        var targetUrl = Buffer.from(req.params.url, 'base64url').toString();
        var referer = Buffer.from(req.params.referer, 'base64url').toString();

        var response = await axios({
            url: targetUrl,
            method: "GET",
            headers: {
                "Referer": referer,
                "Origin": referer.replace(/\/$/, ''),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            },
            responseType: 'arraybuffer',
            timeout: 30000,
        });

        var contentType = response.headers['content-type'] || 'application/octet-stream';
        var body = response.data;

        // If it's an m3u8 playlist, rewrite URLs to go through proxy
        if (targetUrl.includes('.m3u8') || (contentType && contentType.includes('mpegurl'))) {
            var text = body.toString('utf8');
            var baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            var encodedReferer = req.params.referer;

            // Rewrite all non-comment lines (segment URLs) to go through proxy
            text = text.replace(/^((?!#)\S+.*)$/gm, (match) => {
                var line = match.trim();
                if (!line) return match;
                var fullUrl = line.startsWith('http') ? line : baseUrl + line;
                var encoded = Buffer.from(fullUrl).toString('base64url');
                return `${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encoded}`;
            });
            // Also handle URI= in EXT-X-I-FRAME-STREAM-INF
            text = text.replace(/URI="([^"]+)"/g, (match, uri) => {
                var fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
                var encoded = Buffer.from(fullUrl).toString('base64url');
                return `URI="${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encoded}"`;
            });

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(text);
        }

        // For .ts segments and other binary data
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        return res.send(Buffer.from(body));
    } catch (error) {
        console.log('Proxy error:', error.message);
        res.status(500).send('Proxy error');
    }
});

if (module.parent) {
    module.exports = app;
} else {
    app.listen(process.env.PORT || 7000, function (err) {
        if (err) {
           return Error("Error in server setup",err.message);
        }
        console.log(`extension running port : ${process.env.PORT}`)
    });
}

//publishToCentral(process.env.HOSTING_URL+"/manifest.json")