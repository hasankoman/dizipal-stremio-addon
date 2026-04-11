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
app.use(express.static(path.join(__dirname, "frontend", "netflix-clone", "build"), { index: false }));

var respond = function (res, data) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(data);
};


app.get('/', function (req, res) {
        res.sendFile(path.join(__dirname, "frontend", "netflix-clone", "build", "index.html"));
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
        if (!query || query.length < 2) return respond(res, { diziler: [], filmler: [] });
        var cached = myCache.get("api_search_" + query);
        if (cached) return respond(res, cached);
        var video = await searchVideo.SearchMovieAndSeries(query);
        var all = (video || []).map(item => ({
            id: item.url,
            type: item.type || "movie",
            title: item.title,
            poster: item.poster || "",
            year: item.genres || "",
            url: item.url
        }));
        var result = {
            diziler: all.filter(i => i.type === "series"),
            filmler: all.filter(i => i.type === "movie")
        };
        myCache.set("api_search_" + query, result);
        return respond(res, result);
    } catch (error) {
        console.log(error);
        return respond(res, { diziler: [], filmler: [] });
    }
});

app.get("/api/list/:type", async (req, res) => {
    try {
        var type = req.params.type; // "diziler" or "filmler"
        if (type !== "diziler" && type !== "filmler") return respond(res, { items: [], page: 1, totalPages: 1, filters: {} });

        var page = parseInt(req.query.page) || 1;
        var kategori = req.query.kategori || "";
        // Support comma-separated categories from frontend
        var kategoriList = kategori ? kategori.split(",").filter(Boolean) : [];
        var yil = req.query.yil || "";
        var durum = req.query.durum || "";
        var siralama = req.query.siralama || "newest";

        var cacheKey = `api_list_${type}_${page}_${kategoriList.join(",")}_${yil}_${durum}_${siralama}`;
        var cached = myCache.get(cacheKey);
        if (cached) return respond(res, cached);

        const cheerio = require("cheerio");
        var baseUrl = process.env.PROXY_URL;

        var params = new URLSearchParams();
        if (page > 1) params.set("page", page);
        kategoriList.forEach(k => params.append("kategori", k));
        if (yil) params.set("yil", yil);
        if (durum) params.set("durum", durum);
        if (siralama && siralama !== "newest") params.set("siralama", siralama);

        var url = baseUrl + "/" + type + (params.toString() ? "?" + params.toString() : "");
        var response = await axios({ url, headers: header, method: "GET" });

        if (response && response.status == 200) {
            var $ = cheerio.load(response.data);
            var items = [];

            $("li.content-card").each((j, el) => {
                var $a = $(el).find("a.card-link").first();
                var link = $a.attr("href") || "";
                var name = $(el).find(".card-title").text().trim();
                var poster = $(el).find("img").first().attr("data-src") || $(el).find("img").first().attr("src") || "";
                var rating = $(el).find(".card-rating").text().replace(/[^\d.]/g, "").trim();
                var year = $(el).find(".card-year").text().trim();
                var itemType = link.includes("/dizi/") ? "series" : "movie";
                var id = link;
                try { id = new URL(link).pathname; } catch(e) {}
                if (name && id && id !== "/") items.push({ id, type: itemType, title: name, poster, rating, year });
            });

            var totalPages = parseInt($("#contentGrid").attr("data-total-pages")) || 1;

            // Extract filter options on first page
            var filterOptions = {};
            if (page === 1) {
                $("select[name]").each((i, sel) => {
                    var name = $(sel).attr("name");
                    var options = [];
                    $(sel).find("option").each((j, opt) => {
                        options.push({ value: $(opt).attr("value") || "", label: $(opt).text().trim() });
                    });
                    filterOptions[name] = options;
                });
            }

            var result = { items, page, totalPages, filterOptions };
            myCache.set(cacheKey, result, 1800);
            return respond(res, result);
        }
        return respond(res, { items: [], page: 1, totalPages: 1, filterOptions: {} });
    } catch (error) {
        console.log(error);
        return respond(res, { items: [], page: 1, totalPages: 1, filterOptions: {} });
    }
});

app.get("/api/homepage", async (req, res) => {
    try {
        var cached = myCache.get("api_homepage");
        if (cached) return respond(res, cached);

        const cheerio = require("cheerio");
        var sections = [];
        var baseUrl = process.env.PROXY_URL;

        function titleFromSlug(url) {
            try {
                var pathname = new URL(url).pathname;
                var slug = pathname.split("/").filter(Boolean).pop() || "";
                return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            } catch(e) { return ""; }
        }

        // Extract trending items (a.trending-item inside .trending-slider)
        function extractTrendingItems($, slider) {
            var items = [];
            $(slider).find("a.trending-item").each((j, el) => {
                var link = $(el).attr("href") || "";
                var name = $(el).find(".trending-title").text().trim();
                if (!name) name = titleFromSlug(link);
                var poster = $(el).find("img").first().attr("data-src") || $(el).find("img").first().attr("src") || "";
                var type = link.includes("/dizi/") ? "series" : "movie";
                var id = link;
                try { id = new URL(link).pathname; } catch(e) {}
                if (name && id && id !== "/") items.push({ id, type, title: name, poster });
            });
            return items;
        }

        // Extract content cards (li.content-card inside ul.content-grid)
        function extractContentCards($, container) {
            var items = [];
            $(container).find("li.content-card").each((j, el) => {
                var $a = $(el).find("a.card-link").first();
                var link = $a.attr("href") || "";
                var name = $(el).find(".card-title").text().trim();
                if (!name) name = titleFromSlug(link);
                var poster = $(el).find("img").first().attr("data-src") || $(el).find("img").first().attr("src") || "";
                var type = link.includes("/dizi/") ? "series" : "movie";
                var id = link;
                try { id = new URL(link).pathname; } catch(e) {}
                if (name && id && id !== "/") items.push({ id, type, title: name, poster });
            });
            return items;
        }

        // Extract episode items (a.episode-list-item)
        function extractEpisodeItems($, container) {
            var items = [];
            $(container).find("a.episode-list-item").each((j, el) => {
                var link = $(el).attr("href") || "";
                var name = $(el).find(".ep-title").text().trim();
                var epInfo = $(el).find(".ep-info").text().trim();
                if (epInfo) name = name + " - " + epInfo;
                if (!name) name = titleFromSlug(link);
                var poster = $(el).find("img").first().attr("data-src") || $(el).find("img").first().attr("src") || "";
                var type = "series";
                var id = link;
                try { id = new URL(link).pathname; } catch(e) {}
                if (name && id && id.includes("/bolum/")) items.push({ id, type, title: name, poster });
            });
            return items;
        }

        // 1) Fetch homepage
        var homeRes = await axios({ url: baseUrl, headers: header, method: "GET" });
        if (homeRes && homeRes.status == 200) {
            var $ = cheerio.load(homeRes.data);

            // Trend Diziler (first trending-slider)
            var trendDizi = extractTrendingItems($, "#trendingSlider");
            if (trendDizi.length > 0) sections.push({ title: "Trend Diziler", items: trendDizi });

            // Son Eklenen Diziler (first content-section with content-grid.large)
            var sonDizi = extractContentCards($, "ul.content-grid.large");
            if (sonDizi.length > 0) sections.push({ title: "Son Eklenen Diziler", items: sonDizi });

            // Son Bölümler (latest-episodes-section)
            var sonBolumler = extractEpisodeItems($, ".latest-episodes-section");
            if (sonBolumler.length > 0) sections.push({ title: "Son Bölümler", items: sonBolumler.slice(0, 20) });

            // Trend Filmler (second trending-slider)
            var trendFilm = extractTrendingItems($, "#trendingMoviesSlider");
            if (trendFilm.length > 0) sections.push({ title: "Trend Filmler", items: trendFilm });

            // Son Eklenen Filmler (content-grid without .large class, after trend filmler)
            var allContentGrids = $("ul.content-grid").not(".large");
            var sonFilm = extractContentCards($, allContentGrids);
            if (sonFilm.length > 0) sections.push({ title: "Son Eklenen Filmler", items: sonFilm });
        }

        // 2) Fetch diziler page
        try {
            var diziRes = await axios({ url: baseUrl + "/diziler", headers: header, method: "GET" });
            if (diziRes && diziRes.status == 200) {
                var $d = cheerio.load(diziRes.data);
                var diziItems = extractContentCards($d, "body");
                diziItems.forEach(item => item.type = "series");
                if (diziItems.length > 0) sections.push({ title: "Tüm Diziler", items: diziItems });
            }
        } catch(e) { console.log("Diziler page error:", e.message); }

        // 3) Fetch filmler page
        try {
            var filmRes = await axios({ url: baseUrl + "/filmler", headers: header, method: "GET" });
            if (filmRes && filmRes.status == 200) {
                var $f = cheerio.load(filmRes.data);
                var filmItems = extractContentCards($f, "body");
                filmItems.forEach(item => item.type = "movie");
                if (filmItems.length > 0) sections.push({ title: "Tüm Filmler", items: filmItems });
            }
        } catch(e) { console.log("Filmler page error:", e.message); }

        myCache.set("api_homepage", { sections }, 3600);
        return respond(res, { sections });
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

app.get("/api/trailer", async (req, res) => {
    try {
        const name = req.query.name;
        const contentType = req.query.type === "series" ? "tv" : "movie";
        if (!name) return respond(res, { url: null });

        var cached = myCache.get("trailer_" + contentType + "_" + name);
        if (cached) return respond(res, cached);

        const tmdbHeaders = {
            Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
            "Content-Type": "application/json"
        };

        // 1. Search on TMDB
        const searchRes = await axios.get(
            `https://api.themoviedb.org/3/search/${contentType}?query=${encodeURIComponent(name)}&language=tr-TR`,
            { headers: tmdbHeaders, cache: false }
        );

        if (!searchRes.data.results || searchRes.data.results.length === 0) {
            return respond(res, { url: null });
        }

        const tmdbId = searchRes.data.results[0].id;

        // 2. Get details + credits + videos + external_ids in one call
        const detailRes = await axios.get(
            `https://api.themoviedb.org/3/${contentType}/${tmdbId}?language=tr-TR&append_to_response=credits,videos,external_ids`,
            { headers: tmdbHeaders, cache: false }
        );
        const d = detailRes.data;

        // 3. Find trailer (Turkish first, then English fallback)
        let trailer = d.videos?.results?.find(v => v.site === "YouTube" && v.type === "Trailer");
        if (!trailer) trailer = d.videos?.results?.find(v => v.site === "YouTube");

        if (!trailer) {
            const videosResEn = await axios.get(
                `https://api.themoviedb.org/3/${contentType}/${tmdbId}/videos?language=en-US`,
                { headers: tmdbHeaders, cache: false }
            );
            trailer = videosResEn.data.results?.find(v => v.site === "YouTube" && v.type === "Trailer");
            if (!trailer) trailer = videosResEn.data.results?.find(v => v.site === "YouTube");
        }

        // 4. Build result
        const cast = (d.credits?.cast || []).slice(0, 8).map(c => ({
            name: c.name,
            character: c.character || null,
            photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
        }));
        const directors = (d.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name);
        const creators = (d.created_by || []).map(c => c.name);

        const result = {
            url: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null,
            tmdb: {
                genres: (d.genres || []).map(g => g.name),
                cast: cast,
                director: contentType === "movie" ? directors : creators,
                runtime: d.runtime || null,
                seasonCount: d.number_of_seasons || null,
                episodeCount: d.number_of_episodes || null,
                tmdbRating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
                overview: d.overview || null,
                poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
                backdrop: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null,
                releaseDate: d.release_date || d.first_air_date || null,
                originalTitle: d.original_title || d.original_name || null,
                status: d.status || null,
            }
        };

        myCache.set("trailer_" + contentType + "_" + name, result, 24 * 60 * 60);
        return respond(res, result);
    } catch (error) {
        console.log(error);
        return respond(res, { url: null });
    }
});

app.get("/api/stream/:path(*)", async (req, res) => {
    try {
        var contentPath = "/" + req.params.path;
        var video = await listVideo.GetVideos(contentPath);
        if (video) {
            // If it's an embed URL (Cloudflare protected), return it for client-side iframe playback
            if (video.embedUrl) {
                return respond(res, { url: null, embedUrl: video.embedUrl });
            }
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
        console.log('[proxy] target:', targetUrl);
        console.log('[proxy] referer:', referer);

        var response = await Axios({
            url: targetUrl,
            method: "GET",
            headers: {
                "Referer": referer,
                "Origin": referer.replace(/\/$/, ''),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            maxRedirects: 5,
        });

        var contentType = response.headers['content-type'] || 'application/octet-stream';
        var body = response.data;
        console.log('[proxy] response status:', response.status, 'content-type:', contentType, 'size:', body.length);

        // If it's an m3u8 playlist, rewrite URLs to go through proxy
        // Also detect by content: CDN may disguise m3u8 with .jpg extension or wrong content-type
        var textPreview = body.toString('utf8', 0, Math.min(body.length, 200));
        var isM3u8 = targetUrl.includes('.m3u8')
            || (contentType && contentType.includes('mpegurl'))
            || textPreview.trimStart().startsWith('#EXTM3U');
        if (isM3u8) {
            var text = body.toString('utf8');
            var baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            var encodedReferer = req.params.referer;
            console.log('[proxy] m3u8 baseUrl:', baseUrl);
            console.log('[proxy] m3u8 content (first 500 chars):', text.substring(0, 500));

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

            console.log('[proxy] rewritten m3u8 (first 500 chars):', text.substring(0, 500));
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
        console.log('[proxy] ERROR for url:', req.params.url);
        console.log('[proxy] error:', error.message);
        if (error.response) {
            console.log('[proxy] error status:', error.response.status);
        }
        res.status(500).send('Proxy error');
    }
});

// SPA catch-all: serve index.html for all unmatched routes (React Router)
app.get('*', function (req, res) {
    res.sendFile(path.join(__dirname, "frontend", "netflix-clone", "build", "index.html"));
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