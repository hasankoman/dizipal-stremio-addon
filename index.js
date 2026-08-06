require("dotenv").config()
const MANIFEST = require('./manifest');
const landing = require("./src/landingTemplate");
const header = require('./header');
const fs = require('fs')
const os = require('os');
const Path = require("path");
const express = require("express");
const app = express();
const searchVideo = require("./src/search");
const listVideo = require("./src/videos");
const customContent = require("./src/customContent");
const path = require("path");
const NodeCache = require("node-cache");
const { v4: uuidv4 } = require('uuid');
const subsrt = require('subtitle-converter');
const Axios = require('axios')
const { setupCache } = require("axios-cache-interceptor");


const instance = Axios.create();
const axios = setupCache(instance);

// The site keeps hopping to a new numbered domain; resolve it at boot and
// re-check periodically so PROXY_URL never has to be edited by hand.
const domainResolver = require("./src/domainResolver");
domainResolver.startAutoRefresh();





const CACHE_MAX_AGE = 4 * 60 * 60; // 4 hours in seconds
const STALE_REVALIDATE_AGE = 4 * 60 * 60; // 4 hours
const STALE_ERROR_AGE = 7 * 24 * 60 * 60; // 7 days

const myCache = new NodeCache({ stdTTL: 30*60, checkperiod: 300 });

// --- Stremio addon routes -------------------------------------------------
// These must come BEFORE express.static: the React build ships its own
// manifest.json, which would otherwise shadow the addon manifest.
const imdbMapper = require("./src/imdbMapper");
const hls = require("./src/hls");

const STREAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// direct = client fetches the CDN itself (mpv-based players, viewer in-region)
// proxy  = everything flows through us (works anywhere, costs bandwidth)
// both   = offer each variant twice, direct first
const STREAM_MODE = (process.env.STREAM_MODE || "both").toLowerCase();

const LANG_MAP = {
    tr: "tur", tu: "tur", tur: "tur", turkce: "tur", turkish: "tur",
    en: "eng", eng: "eng", english: "eng", ingilizce: "eng",
};

// videos.js clips JWPlayer labels to two chars ("Türkçe" -> "tü"), so fold the
// Turkish letters to ASCII before matching and allow prefix hits.
function toIso3(label) {
    var key = String(label || "").trim().toLocaleLowerCase("tr")
        .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
        .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");
    if (!key) return "tur";
    if (LANG_MAP[key]) return LANG_MAP[key];
    for (var k in LANG_MAP) {
        if (k.indexOf(key) === 0 || key.indexOf(k) === 0) return LANG_MAP[k];
    }
    return key.slice(0, 3);
}

// GetVideos returns subtitles in two shapes depending on which player it hit:
// JWPlayer tracks give {url,lang,label}, Playerjs gives raw "[Türkçe]https://..." strings.
function normalizeSubtitles(subs) {
    if (!Array.isArray(subs)) return [];
    var out = [];
    for (var i = 0; i < subs.length; i++) {
        var s = subs[i];
        if (typeof s === "string") {
            var tagged = s.match(/^\s*\[([^\]]+)\]\s*(\S+)/);
            if (tagged) out.push({ id: "koman-" + i, url: tagged[2], lang: toIso3(tagged[1]) });
            else if (/^https?:\/\//i.test(s.trim())) out.push({ id: "koman-" + i, url: s.trim(), lang: "tur" });
        } else if (s && s.url) {
            out.push({ id: "koman-" + i, url: s.url, lang: toIso3(s.lang || s.label) });
        }
    }
    return out;
}

// --- Access keys ----------------------------------------------------------
// Stremio carries whatever path segment precedes /manifest.json into every
// later request, so putting a key there gates the whole addon (Torrentio uses
// the same trick). Leave ADDON_KEYS empty to keep the addon public.
const ADDON_KEYS = String(process.env.ADDON_KEYS || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
const KEYS_REQUIRED = ADDON_KEYS.length > 0;
// Real route prefixes must never be mistaken for a key.
const RESERVED_SEGMENTS = ["addon", "api", "proxy", "stream", "hls", "images", "static", "configure", "dub"];

function readKey(req) {
    var key = (req.params || {}).key;
    if (!key || RESERVED_SEGMENTS.indexOf(key) !== -1) return null;
    return key;
}

function keyAllowed(key) {
    if (!KEYS_REQUIRED) return true;
    return !!key && ADDON_KEYS.indexOf(key) !== -1;
}

function denyKey(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(403).json({ err: "Gecersiz veya eksik erisim anahtari" });
}

function keyPrefix(key) {
    return key ? "/" + encodeURIComponent(key) : "";
}

function proxify(url, referer, key) {
    return process.env.HOSTING_URL + keyPrefix(key) + "/proxy/"
        + Buffer.from(referer).toString("base64url") + "/"
        + Buffer.from(url).toString("base64url");
}

// Points the player at our own mini master playlist for one quality tier.
// `direct` leaves the media URLs pointing at the CDN (client fetches them
// itself); otherwise they are rewritten through /proxy.
function hlsUrl(variant, audios, referer, key, direct) {
    var spec = {
        v: variant.url,
        a: (audios || []).map(function (x) { return { u: x.url, n: x.name, l: x.lang, d: x.isDefault }; }),
        r: referer,
        b: variant.bandwidth,
        res: variant.resolution,
        c: variant.codecs,
        d: direct ? 1 : 0,
    };
    return process.env.HOSTING_URL + keyPrefix(key) + "/hls/"
        + Buffer.from(JSON.stringify(spec)).toString("base64url") + ".m3u8";
}

// One Stremio entry per quality (and per dub). Stremio reads the quality tier
// from `name`, which is why a bare "KomanMovie" showed up as Unknown.
async function buildStreams(video, referer, key, contentName) {
    // videos.js sets embedUrl when it could not extract a media URL from the embed
    // page — typically because that host refuses this server's IP. Hand the page
    // itself to the client: a viewer in the CDN's region can resolve it locally.
    if (video.embedUrl) {
        console.log("[stream] embed cozulemedi, istemciye birakiliyor:", String(video.url).slice(0, 70));
        return [{
            name: "KomanMovie 🔗\nKaynak sayfası",
            title: contentName + "\n🔗 Bağlantı cihazda çözülecek",
            url: video.url,
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: { request: { Referer: referer, "User-Agent": STREAM_UA } },
            },
        }];
    }

    var fallback = [{
        name: "KomanMovie",
        title: contentName,
        url: proxify(video.url, referer, key),
    }];

    try {
        var srcHeaders = { Referer: referer, "User-Agent": STREAM_UA, Accept: "*/*" };
        if (video.cookies) srcHeaders.Cookie = video.cookies;
        var response = await Axios({
            url: video.url,
            headers: srcHeaders,
            method: "GET",
            timeout: 20000,
            validateStatus: function () { return true; },
        });
        if (response.status !== 200) {
            console.log("[stream] master playlist alinamadi:", response.status);
            return fallback;
        }

        var master = hls.parseMaster(response.data, video.url);
        if (!master.variants.length) return fallback; // not a master playlist, serve as-is

        // Runtime is identical across variants, so one variant playlist is enough
        // to turn each variant's bitrate into a size estimate.
        var seconds = 0;
        try {
            var probe = await Axios({
                url: master.variants[0].url,
                headers: srcHeaders,
                method: "GET", timeout: 15000, validateStatus: function () { return true; },
            });
            if (probe.status === 200) seconds = hls.durationOf(probe.data);
        } catch (e) { /* size is a nicety, never fail the request over it */ }

        // Subtitle renditions are only visible here, not in GetVideos' output.
        var masterSubs = master.subtitles.map(function (s, i) {
            return {
                id: "hls-" + i,
                lang: toIso3(s.lang || s.name),
                url: proxify(s.url, referer, key),
            };
        });

        var streams = [];
        master.variants.forEach(function (variant) {
            // All languages for this tier travel inside one playlist, so the
            // player's audio menu can switch between them mid-playback.
            var audios = hls.audiosFor(master, variant);

            var details = [];
            if (variant.resolution) details.push("🎬 " + variant.resolution);
            if (audios.length) {
                var names = audios.map(function (a) { return a.name || a.lang; }).filter(Boolean);
                if (names.length) details.push("🎧 " + names.join(", "));
            }
            var size = hls.humanSize(variant.bandwidth, seconds);
            if (size) details.push("💾 " + size);
            if (variant.bandwidth) details.push("📶 " + (variant.bandwidth / 1000000).toFixed(1) + " Mbps");
            if (seconds) details.push("⏱ " + Math.round(seconds / 60) + " dk");

            var label = variant.quality || "";
            var detailLine = details.length ? "\n" + details.join(" • ") : "";

            // Direct: only the small generated playlist comes from us, the media
            // itself is fetched from the CDN by the player, with the Referer
            // carried via proxyHeaders. Needs a client that honours proxyHeaders
            // (mpv-based, e.g. Harbor) and a viewer the CDN serves.
            if (STREAM_MODE !== "proxy") {
                var direct = {
                    name: "KomanMovie ⚡" + (label ? "\n" + label : ""),
                    title: contentName + detailLine + "\n⚡ Doğrudan bağlantı",
                    url: hlsUrl(variant, audios, referer, key, true),
                    behaviorHints: {
                        notWebReady: true,
                        bingeGroup: "koman-direct-" + (variant.quality || "x"),
                        proxyHeaders: { request: { Referer: referer, "User-Agent": STREAM_UA } },
                    },
                };
                // Subtitles stay proxied even here: proxyHeaders only covers the
                // video request, and these are a few KB — not worth the risk of a
                // 403 on a track the player fetches on its own.
                if (masterSubs.length) direct.subtitles = masterSubs;
                streams.push(direct);
            }

            // Proxied: works everywhere (fixes the mislabelled content type and
            // carries the Referer server-side), at the cost of our bandwidth.
            if (STREAM_MODE !== "direct") {
                var proxied = {
                    name: "KomanMovie 🛡" + (label ? "\n" + label : ""),
                    title: contentName + detailLine + "\n🛡 Sunucu üzerinden",
                    url: hlsUrl(variant, audios, referer, key, false),
                    behaviorHints: { bingeGroup: "koman-proxy-" + (variant.quality || "x") },
                };
                if (masterSubs.length) proxied.subtitles = masterSubs;
                streams.push(proxied);
            }
        });

        return streams;
    } catch (e) {
        console.log("[stream] master playlist okunamadi:", e.message);
        return fallback;
    }
}

function hlsHandler(req, res) {
    var key = readKey(req);
    if (!keyAllowed(key)) return denyKey(res);
    try {
        var raw = String(req.params.spec || "").replace(/\.m3u8$/, "");
        var spec = JSON.parse(Buffer.from(raw, "base64url").toString());
        var variant = { url: spec.v, bandwidth: spec.b, resolution: spec.res, codecs: spec.c };
        var audios = (spec.a || []).map(function (x) {
            return { url: x.u, name: x.n, lang: x.l, isDefault: x.d };
        });

        // In direct mode the media URLs stay on the CDN — only this playlist
        // comes from us, so we carry no video traffic.
        var mapUrl = spec.d
            ? function (u) { return u; }
            : function (u) { return proxify(u, spec.r, key); };

        var text = hls.buildMiniMaster(variant, audios, mapUrl);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.send(text);
    } catch (e) {
        console.log("[hls] hata:", e.message);
        return res.status(400).send("Gecersiz playlist");
    }
}

async function streamHandler(req, res) {
    try {
        var key = readKey(req);
        if (!keyAllowed(key)) return denyKey(res);

        var type = req.params.type;
        var id = String(req.params.id || "").replace(/\.json$/, "");
        if (type !== "movie" && type !== "series") return respond(res, { streams: [] });

        var target = await imdbMapper.resolveStreamTarget(type, id);
        if (!target) return respond(res, { streams: [] });

        // Istemci kaynak listesini alirken dublaj hazirligini baslat; oynatma
        // basladiginda ses cogunlukla hazir olur.
        prewarmDub(target.path);

        var video = await listVideo.GetVideos(target.path);
        if (!video || !video.url) return respond(res, { streams: [] });

        // Everything goes through our own /proxy: the source 403s without a
        // Referer, and it also mislabels segments as image/jpeg, which players
        // refuse to decode. proxyHeaders could carry the Referer but cannot fix
        // the content type, so proxying is the only path that plays.
        var referer = video.referer || process.env.PROXY_URL + "/";
        var contentName = target.title || "Türkçe kaynak";

        var subtitles = normalizeSubtitles(video.subtitles).map(function (s) {
            return { id: s.id, lang: s.lang, url: proxify(s.url, referer, key) };
        });

        var streams = await buildStreams(video, referer, key, contentName);
        if (subtitles.length) {
            // Merge, do not replace: buildStreams may already have attached the
            // subtitle renditions found in the master playlist.
            streams.forEach(function (s) {
                s.subtitles = (s.subtitles || []).concat(subtitles);
            });
        }

        return respond(res, {
            streams: streams,
            cacheMaxAge: CACHE_MAX_AGE,
            staleRevalidate: STALE_REVALIDATE_AGE,
            staleError: STALE_ERROR_AGE,
        });
    } catch (error) {
        console.log("[stream] hata:", error.message);
        return respond(res, { streams: [] });
    }
}

function manifestHandler(req, res) {
    var key = readKey(req);
    if (!keyAllowed(key)) return denyKey(res);
    return respond(res, { ...MANIFEST });
}

// /:key/... rotalari /api/... gibi gercek yollari da yakalar (ör. /api/stream/...
// istegi key="api" olarak buraya duser ve key hatasi doner). Rezerve segmentlerde
// next() ile asagida tanimli gercek rotaya birakiyoruz.
function keyedRoute(handler) {
    return function (req, res, next) {
        if (RESERVED_SEGMENTS.indexOf(req.params.key) !== -1) return next();
        return handler(req, res, next);
    };
}

app.get(["/manifest.json", "/addon/manifest.json"], manifestHandler);
app.get("/:key/manifest.json", keyedRoute(manifestHandler));

app.get(["/stream/:type/:id", "/addon/stream/:type/:id"], streamHandler);
app.get("/:key/stream/:type/:id", keyedRoute(streamHandler));

app.get("/hls/:spec", hlsHandler);
app.get("/:key/hls/:spec", keyedRoute(hlsHandler));

// --- Dublaj senkron ucu ---------------------------------------------------
// Kaynak (dizipal) 25 fps PAL hizlandirmali, hedef (REMUX/WEB-DL) genelde
// 23.976 fps. Bu ses baska bir videonun uzerine eklenince fark SABIT DEGILDIR:
// saniyede ~43 ms kayar. Oynaticinin "audio delay" ayari sabit kaydirma
// oldugundan bunu duzeltemez — dogru yer kaynagin kendisidir, bu yuzden ses
// burada hedefin kare hizina gore yeniden zamanlanip servis edilir.
const dubsync = require("./src/dubsync");
const dubstore = require("./src/dubstore");

const dubFpsCache = new NodeCache({ stdTTL: 24 * 60 * 60 });
const DUB_CACHE_DIR = process.env.DUB_CACHE_DIR || Path.join(os.tmpdir(), "komanmovie-dub");
const DUB_CACHE_TTL_MS = Number(process.env.DUB_CACHE_TTL_HOURS || 168) * 60 * 60 * 1000;

// Hazirlanan sesler bolum basina ~60 MB; budanmazsa disk sessizce dolar.
(function scheduleDubPrune() {
    function sweep() {
        var n = dubsync.pruneCache(DUB_CACHE_DIR, DUB_CACHE_TTL_MS);
        if (n) console.log("[dub] onbellekten " + n + " dosya silindi");
    }
    sweep();
    setInterval(sweep, 6 * 60 * 60 * 1000).unref();
})();

// Olculmus bir plani olan bolumun sesini, istemci daha istemeden hazirlamaya
// baslar. Ilk acilista beklenen sure indirme + yeniden kodlamadan geliyor;
// kullanici kaynak secerken bunu arka planda ilerletmek beklemeyi kisaltiyor.
// Yalnizca plani olan bolumler icin calisir, yani gozat trafigi is uretmez.
function prewarmDub(contentPath) {
    var plan = dubstore.get(contentPath);
    if (!plan || !plan.atempo) return;
    (async function () {
        try {
            var source = await dubsync.resolveTrAudioSource(contentPath);
            await dubsync.prepareCorrectedAudio(source, contentPath, plan.atempo, {
                cacheDir: DUB_CACHE_DIR,
                segments: (plan.segments && plan.segments.length > 1) ? plan.segments : null,
            });
        } catch (e) {
            console.log("[dub] onhazirlik atlandi:", e.message);
        }
    })();
}

// Kaynak fps'i bir segment indirmeyi gerektiriyor; icerik basina onbellege alinir.
async function sourceFpsOf(source, contentPath) {
    var hit = dubFpsCache.get(contentPath);
    if (hit) return hit;
    var fps = dubsync.snapFps(await dubsync.probeSourceFps(source.videoVariant || source.url, source));
    dubFpsCache.set(contentPath, fps);
    return fps;
}

// GET /dub/:type/:id.json?fps=23.976&duration=2635.049
// Istemci, oynattigi videonun kare hizini ve suresini bildirir; cevap, o hedefe
// uyarlanmis ses izinin adresini ve (olculmusse) uygulanacak gecikmeyi tasir.
async function dubInfoHandler(req, res) {
    var key = readKey(req);
    if (!keyAllowed(key)) return denyKey(res);
    try {
        var type = req.params.type;
        var id = String(req.params.id || "").replace(/\.json$/, "");
        var targetFps = Number(req.query.fps) || 0;
        var targetDuration = Number(req.query.duration) || 0;

        var target = await imdbMapper.resolveStreamTarget(type, id);
        if (!target) return respond(res, { ok: false, err: "icerik bulunamadi" });

        var source = await dubsync.resolveTrAudioSource(target.path);
        var sourceFps = await sourceFpsOf(source, target.path);
        // fps bilinmiyorsa hiz duzeltmesi yapilamaz; ham izi vermek, sessizce
        // kayan bir iz vermekten iyidir — istemci uyariyi gosterebilir.
        var speed = targetFps ? sourceFps / dubsync.snapFps(targetFps) : 1;
        var atempo = 1 / speed;

        var measured = dubstore.get(target.path);
        var trusted = dubstore.matches(measured, targetDuration);
        // Bu bolum hic olculmediyse ayni dizinin olculen bolumlerinden turet.
        // Kayit VAR ama surum tutmuyorsa tahmin uretilmez: tahmin de ayni
        // surumlerden geliyor, dolayisiyla o da yanlis olurdu.
        var estimate = measured ? null : dubstore.seriesEstimate(target.path);

        // Iki surumun kurgusu ayni degilse offset sabit kalmaz; boyle bir plan
        // varsa hizalama sesin icine isleniyor (istemcinin uygulayabilecegi tek
        // bir gecikme bu durumu temsil edemez).
        var segments = (trusted && measured.segments && measured.segments.length > 1)
            ? measured.segments : null;
        var corrected = Math.abs(atempo - 1) > 0.0005 || !!segments;

        // duration da tasinmali: ses ucu ayni plani secebilmek icin hangi surumun
        // oynatildigini bilmek zorunda.
        var url = process.env.HOSTING_URL + keyPrefix(key) + "/dub/" + type + "/"
            + encodeURIComponent(id) + ".m4a?fps=" + (targetFps || "")
            + "&duration=" + (targetDuration || "");

        var payload = {
            ok: true,
            name: "Türkçe (KomanMovie)",
            lang: "tur",
            url: corrected ? url : source.url,
            direct: !corrected,          // hiz farki yoksa kaynak dogrudan verilir
            referer: corrected ? null : source.referer,
            sourceFps: sourceFps,
            targetFps: targetFps || null,
            speed: speed,
            atempo: atempo,
            // Parcali planda gecikme sesin icinde: istemci ayrica kaydirmamali.
            delayMs: segments ? 0
                : trusted ? measured.delayMs
                : (estimate ? estimate.delayMs : null),
            delaySource: segments ? "baked-segments"
                : trusted ? "measured"
                : estimate ? "series-estimate"     // ayni dizinin olculen bolumlerinden
                : !measured ? "unknown"
                : !targetDuration ? "unverified"   // sure bildirilmedi, dogrulanamadi
                : "release-mismatch",              // baska bir surum oynatiliyor
            delaySamples: estimate ? estimate.samples : undefined,
            cuts: segments ? segments.length - 1 : undefined,
            muxed: source.kind === "muxed-variant",
        };
        if (!corrected) return respond(res, payload);

        // Hazirlik uzun surebilir; istemci hazir olana kadar tekrar sorabilsin.
        var job = await dubsync.prepareCorrectedAudio(source, target.path, atempo, {
            cacheDir: DUB_CACHE_DIR,
            segments: segments,
        });
        payload.status = job.status;
        return respond(res, payload);
    } catch (error) {
        console.log("[dub] info hatasi:", error.message);
        return respond(res, { ok: false, err: error.message });
    }
}

// GET /dub/:type/:id.m4a?fps=23.976
// Hiz duzeltilmis ses dosyasi. mpv harici izde arama yapabilmeli, bu yuzden
// canli boru yerine tamamlanmis dosya Range destegiyle servis edilir.
async function dubAudioHandler(req, res) {
    var key = readKey(req);
    if (!keyAllowed(key)) return denyKey(res);
    try {
        var type = req.params.type;
        var id = String(req.params.id || "").replace(/\.m4a$/, "");
        var targetFps = Number(req.query.fps) || 0;
        var targetDuration = Number(req.query.duration) || 0;

        var target = await imdbMapper.resolveStreamTarget(type, id);
        if (!target) return res.status(404).json({ err: "icerik bulunamadi" });

        var source = await dubsync.resolveTrAudioSource(target.path);
        var sourceFps = await sourceFpsOf(source, target.path);
        var atempo = targetFps ? dubsync.snapFps(targetFps) / sourceFps : 1;

        // Bilgi ucuyla ayni plani secmek zorunda: aksi halde farkli bir dosya
        // uretilir ve istemci yanlis sesi alir.
        var measured = dubstore.get(target.path);
        var segments = (dubstore.matches(measured, targetDuration)
            && measured.segments && measured.segments.length > 1) ? measured.segments : null;

        var job = await dubsync.prepareCorrectedAudio(source, target.path, atempo, {
            cacheDir: DUB_CACHE_DIR,
            segments: segments,
        });
        if (job.status !== "ready") {
            if (!job.job) return res.status(503).json({ err: "hazirlaniyor" });
            await job.job; // ayni dosya icin ikinci istek de ayni isi bekler
        }

        var file = job.file;
        var stat = fs.statSync(file);
        var range = req.headers.range;
        res.setHeader("Content-Type", "audio/mp4");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (range) {
            var m = /bytes=(\d*)-(\d*)/.exec(range) || [];
            var start = m[1] ? parseInt(m[1], 10) : 0;
            var end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
            if (start >= stat.size) {
                res.setHeader("Content-Range", "bytes */" + stat.size);
                return res.status(416).end();
            }
            end = Math.min(end, stat.size - 1);
            res.status(206);
            res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + stat.size);
            res.setHeader("Content-Length", end - start + 1);
            return fs.createReadStream(file, { start: start, end: end }).pipe(res);
        }

        res.setHeader("Content-Length", stat.size);
        return fs.createReadStream(file).pipe(res);
    } catch (error) {
        console.log("[dub] ses hatasi:", error.message);
        if (!res.headersSent) return res.status(500).json({ err: error.message });
        return res.end();
    }
}

app.get("/dub/:type/:id.json", dubInfoHandler);
app.get("/:key/dub/:type/:id.json", keyedRoute(dubInfoHandler));
app.get("/dub/:type/:id.m4a", dubAudioHandler);
app.get("/:key/dub/:type/:id.m4a", keyedRoute(dubAudioHandler));

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

// Manifest routes (with and without an access key) are registered above, before
// the static middleware. A catch-all variant must NOT live here: it would answer
// any path segment and hand out the manifest without checking the key.

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
            url: item.url,
            source: "Repertuar"
        }));

        // TMDB'de ara - repertuarda olmayanları "eksik" olarak göster
        var eksik = [];
        try {
            var tmdbHeaders = { Authorization: `Bearer ${process.env.TMDB_TOKEN}` };
            var tmdbRes = await axios.get(
                `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&language=tr-TR`,
                { headers: tmdbHeaders, cache: false }
            );
            var tmdbResults = tmdbRes.data.results || [];
            for (var tmdbItem of tmdbResults) {
                if (tmdbItem.media_type !== "movie" && tmdbItem.media_type !== "tv") continue;
                var tmdbTitle = tmdbItem.title || tmdbItem.name || "";
                if (!tmdbTitle) continue;
                // Repertuarda zaten var mı kontrol et (benzerlik %80+ ise duplicate say)
                var tmdbTitleLower = tmdbTitle.toLowerCase();
                var alreadyExists = all.some(a => {
                    var aLower = a.title.toLowerCase();
                    if (aLower === tmdbTitleLower) return true;
                    // Kısa başlıklar (5 karakter altı) tam eşleşme gerektirir
                    if (aLower.length < 5 || tmdbTitleLower.length < 5) return false;
                    // Uzun başlıklarda: biri diğerini içeriyorsa VE uzunluk farkı az ise
                    if (aLower.includes(tmdbTitleLower) || tmdbTitleLower.includes(aLower)) {
                        var ratio = Math.min(aLower.length, tmdbTitleLower.length) / Math.max(aLower.length, tmdbTitleLower.length);
                        return ratio > 0.7;
                    }
                    return false;
                });
                if (!alreadyExists) {
                    var eType = tmdbItem.media_type === "tv" ? "series" : "movie";
                    eksik.push({
                        id: "tmdb:" + eType + ":" + tmdbItem.id,
                        type: eType,
                        title: tmdbTitle,
                        poster: tmdbItem.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}` : "",
                        year: (tmdbItem.release_date || tmdbItem.first_air_date || "").substring(0, 4),
                        url: "tmdb:" + eType + ":" + tmdbItem.id,
                        source: "TMDB"
                    });
                }
            }
        } catch(e) { console.log("TMDB search error:", e.message); }

        var result = {
            diziler: all.filter(i => i.type === "series"),
            filmler: all.filter(i => i.type === "movie"),
            eksik: eksik
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
        var yil = req.query.yil || "";
        var durum = req.query.durum || "";
        var siralama = req.query.siralama || "newest";

        var cacheKey = `api_list_${type}_${page}_${kategori}_${yil}_${durum}_${siralama}`;
        var cached = myCache.get(cacheKey);
        if (cached) return respond(res, cached);

        const cheerio = require("cheerio");
        var baseUrl = process.env.PROXY_URL;

        var params = new URLSearchParams();
        if (page > 1) params.set("page", page);
        if (kategori) params.set("kategori", kategori);
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

        // Manuel eklenen içerikler
        try {
            var customItems = await customContent.getAllCustomContent();
            if (customItems.length > 0) {
                sections.unshift({ title: "Manuel Eklenen", items: customItems });
            }
        } catch(e) { console.log("Custom content homepage error:", e.message); }

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

        // TMDB content kontrolü (tmdb:movie:12345 veya tmdb:series:12345)
        var tmdbMatch = contentPath.match(/\/?(tmdb|custom):(movie|series):(\d+)/);
        if (tmdbMatch) {
            var cType = tmdbMatch[2];
            var cTmdbId = tmdbMatch[3];
            var cacheKey = "api_detail_tmdb_" + cType + "_" + cTmdbId;
            var cached = myCache.get(cacheKey);
            if (cached) return respond(res, cached);

            var tmdbDetail = await customContent.getCustomDetail(cTmdbId, cType);
            if (tmdbDetail) {
                myCache.set(cacheKey, tmdbDetail);
                return respond(res, tmdbDetail);
            }
            return respond(res, { meta: null, episodes: [] });
        }

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

const { spawn } = require('child_process');

// Track active downloads
const activeDownloads = new Map();

// SSE endpoint for download progress
app.get("/api/download-progress/:path(*)", async (req, res) => {
    var contentPath = "/" + req.params.path;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    function sendEvent(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    sendEvent({ status: "preparing" });

    try {
        var video = await listVideo.GetVideos(contentPath);

        if (!video || !video.url) {
            sendEvent({ status: "error", message: "Video bulunamadi" });
            res.end();
            return;
        }

        var filename = contentPath.replace(/\//g, "_").replace(/^_/, "") + ".mp4";
        var referer = video.referer || process.env.PROXY_URL + "/";
        var tmpFile = path.join(os.tmpdir(), "dl_" + Date.now() + ".mp4");

        activeDownloads.set(contentPath, { tmpFile, filename, status: "downloading" });

        // Bazi kaynaklar (FirePlayer/imagestoo) securedLink'i sadece embed
        // oturum cerezi ile verir; cerez olmadan CDN 403 doner.
        var ytdlpArgs = [
            "--referer", referer,
            "--user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "-o", tmpFile,
            "--no-part",
            "--newline",
            "--concurrent-fragments", "16",
            "--progress-template", "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s",
        ];
        if (video.cookies) ytdlpArgs.push("--add-headers", "Cookie: " + video.cookies);
        ytdlpArgs.push(video.url);
        var ytdlp = spawn("yt-dlp", ytdlpArgs);

        var aborted = false;
        var maxProgress = 0;

        req.on("close", () => {
            // Eğer indirme tamamlandıysa silme, dosyayı aktarmak için lazım
            var download = activeDownloads.get(contentPath);
            if (download && download.status === "completed") {
                return;
            }
            aborted = true;
            ytdlp.kill("SIGTERM");
            fs.unlink(tmpFile, () => {});
            activeDownloads.delete(contentPath);
        });

        ytdlp.stdout.on("data", (data) => {
            if (aborted) return;
            var lines = data.toString().split("\n");
            for (var line of lines) {
                line = line.trim();
                if (!line) continue;

                var parts = line.split("|");
                if (parts.length >= 1) {
                    var percentStr = parts[0].replace("%", "").trim();
                    var progress = parseFloat(percentStr) || 0;
                    var speed = parts[1] || null;
                    var eta = parts[2] || null;
                    var totalSize = parts[3] || null;

                    // Progress sadece artabilir, birleştirme aşamasında sıfırlanmasın
                    if (progress > maxProgress) {
                        maxProgress = progress;
                    }

                    sendEvent({
                        status: "downloading",
                        progress: Math.min(maxProgress, 99),
                        speed: speed,
                        eta: eta,
                        fileSize: totalSize
                    });
                }
            }
        });

        ytdlp.stderr.on("data", (data) => {
            console.log("yt-dlp stderr:", data.toString());
        });

        ytdlp.on("close", (code) => {
            if (aborted) return;
            if (code === 0 && fs.existsSync(tmpFile)) {
                var stat = fs.statSync(tmpFile);
                activeDownloads.set(contentPath, { tmpFile, filename, status: "completed", size: stat.size });
                sendEvent({ status: "completed", fileSize: stat.size });
            } else {
                activeDownloads.delete(contentPath);
                sendEvent({ status: "error", message: "Indirme basarisiz (kod: " + code + ")" });
                fs.unlink(tmpFile, () => {});
            }
            res.end();
        });

        ytdlp.on("error", (err) => {
            console.log("yt-dlp error:", err);
            activeDownloads.delete(contentPath);
            sendEvent({ status: "error", message: "yt-dlp hatasi" });
            res.end();
        });

    } catch (error) {
        console.log(error);
        sendEvent({ status: "error", message: "Bir hata olustu" });
        res.end();
    }
});

// Download completed file
app.get("/api/download-file/:path(*)", async (req, res) => {
    var contentPath = "/" + req.params.path;
    var download = activeDownloads.get(contentPath);

    if (!download || download.status !== "completed") {
        return res.status(404).json({ error: "Dosya hazir degil" });
    }

    var { tmpFile, filename, size } = download;

    if (!fs.existsSync(tmpFile)) {
        activeDownloads.delete(contentPath);
        return res.status(404).json({ error: "Dosya bulunamadi" });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", size);

    var stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("end", () => {
        fs.unlink(tmpFile, () => {});
        activeDownloads.delete(contentPath);
    });
    stream.on("error", () => {
        fs.unlink(tmpFile, () => {});
        activeDownloads.delete(contentPath);
        res.end();
    });
});

app.get("/api/download/:path(*)", async (req, res) => {
    try {
        var contentPath = "/" + req.params.path;
        var video = await listVideo.GetVideos(contentPath);

        if (!video || !video.url) {
            return res.status(404).json({ error: "Video bulunamadi" });
        }

        var filename = contentPath.replace(/\//g, "_").replace(/^_/, "") + ".mp4";
        var referer = video.referer || process.env.PROXY_URL + "/";
        var tmpFile = path.join(os.tmpdir(), "dl_" + Date.now() + ".mp4");

        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "video/mp4");

        var ytdlpArgs = [
            "--referer", referer,
            "--user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "-o", tmpFile,
            "--no-part",
            "--quiet",
            "--concurrent-fragments", "16",
        ];
        if (video.cookies) ytdlpArgs.push("--add-headers", "Cookie: " + video.cookies);
        ytdlpArgs.push(video.url);
        var ytdlp = spawn("yt-dlp", ytdlpArgs);

        var aborted = false;

        req.on("close", () => {
            aborted = true;
            ytdlp.kill("SIGTERM");
            fs.unlink(tmpFile, () => {});
        });

        ytdlp.on("close", (code) => {
            if (aborted) return;
            if (code === 0 && fs.existsSync(tmpFile)) {
                var stat = fs.statSync(tmpFile);
                res.setHeader("Content-Length", stat.size);
                var stream = fs.createReadStream(tmpFile);
                stream.pipe(res);
                stream.on("end", () => fs.unlink(tmpFile, () => {}));
                stream.on("error", () => { fs.unlink(tmpFile, () => {}); res.end(); });
            } else {
                if (!res.headersSent) res.status(500).json({ error: "Indirme hatasi" });
                fs.unlink(tmpFile, () => {});
            }
        });

        ytdlp.on("error", (err) => {
            console.log("yt-dlp error:", err);
            if (!res.headersSent) res.status(500).json({ error: "yt-dlp hatasi" });
        });

    } catch (error) {
        console.log(error);
        if (!res.headersSent) res.status(500).json({ error: "Indirme hatasi" });
    }
});

app.get("/api/stream/:path(*)", async (req, res) => {
    try {
        var contentPath = "/" + req.params.path;

        // TMDB content stream (tmdb:movie:12345 veya tmdb:series:12345:1:3)
        var tmdbMatch = contentPath.match(/\/?(tmdb|custom):(movie|series):(\d+)(?::(\d+):(\d+))?/);
        if (tmdbMatch) {
            var cType = tmdbMatch[2];
            var cTmdbId = tmdbMatch[3];
            var cSeason = tmdbMatch[4] || "1";
            var cEpisode = tmdbMatch[5] || "1";

            var sources = [];
            if (cType === "movie") {
                sources = [
                    { name: "Videasy", url: "https://player.videasy.net/movie/" + cTmdbId, hasTurkishSub: true },
                    { name: "VidSrc.me", url: "https://vidsrc-embed.ru/embed/movie/" + cTmdbId + "?ds_lang=tr", hasTurkishSub: true },
                    { name: "VidSrc", url: "https://vidsrc.cc/v2/embed/movie/" + cTmdbId, hasTurkishSub: false },
                    { name: "MultiEmbed", url: "https://multiembed.mov/?video_id=" + cTmdbId + "&tmdb=1", hasTurkishSub: false },
                ];
            } else {
                sources = [
                    { name: "Videasy", url: "https://player.videasy.net/tv/" + cTmdbId + "/" + cSeason + "/" + cEpisode, hasTurkishSub: true },
                    { name: "VidSrc.me", url: "https://vidsrc-embed.ru/embed/tv/" + cTmdbId + "/" + cSeason + "/" + cEpisode + "?ds_lang=tr", hasTurkishSub: true },
                    { name: "VidSrc", url: "https://vidsrc.cc/v2/embed/tv/" + cTmdbId + "/" + cSeason + "/" + cEpisode, hasTurkishSub: false },
                    { name: "MultiEmbed", url: "https://multiembed.mov/?video_id=" + cTmdbId + "&tmdb=1&s=" + cSeason + "&e=" + cEpisode, hasTurkishSub: false },
                ];
            }
            // Türkçe altyazılı olanlar önce
            sources.sort((a, b) => (b.hasTurkishSub ? 1 : 0) - (a.hasTurkishSub ? 1 : 0));
            return respond(res, { url: null, embedUrl: sources[0].url, sources: sources });
        }

        var video = await listVideo.GetVideos(contentPath);
        if (video) {
            // If it's an embed URL (Cloudflare protected), return it for client-side iframe playback
            if (video.embedUrl) {
                return respond(res, { url: null, embedUrl: video.embedUrl });
            }
            var encodedUrl = Buffer.from(video.url).toString('base64url');
            var encodedReferer = Buffer.from(video.referer || process.env.PROXY_URL + "/").toString('base64url');
            var proxyUrl = `${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encodedUrl}`;
            
            var proxySubs = [];
            if (video.subtitles && Array.isArray(video.subtitles)) {
                proxySubs = video.subtitles.map(sub => {
                    if (typeof sub === 'string') {
                        var match = sub.match(/\[(.+?)\](.+)/);
                        var label = match ? match[1] : 'Subtitle';
                        var url = match ? match[2] : sub;
                        var encodedSubUrl = Buffer.from(url).toString('base64url');
                        var proxySubUrl = `${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encodedSubUrl}`;
                        return { label: label, url: proxySubUrl, lang: label.substring(0, 2).toLowerCase() };
                    } else if (typeof sub === 'object') {
                        var encodedSubUrl = Buffer.from(sub.url).toString('base64url');
                        var proxySubUrl = `${process.env.HOSTING_URL}/proxy/${encodedReferer}/${encodedSubUrl}`;
                        return { label: sub.label, url: proxySubUrl, lang: sub.lang, default: sub.default };
                    }
                    return null;
                }).filter(Boolean);
            }
            
            return respond(res, { url: proxyUrl, directUrl: video.url, referer: video.referer, subtitles: proxySubs });
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
                    var sourceVideo = await searchVideo.SearchDetailMovieAndSeries(id, type, i);
                    if (sourceVideo && typeof (sourceVideo) !== "undefined") {
                        sourceVideo.forEach(element => {
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


// The Stremio stream route now lives above the static middleware (streamHandler),
// resolving IMDB ids instead of the site's own slugs.

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
                        subtitles.push({ url: newUrl, lang: "tur",id:"sub-tur" });
                    }
                }
                if (String(value).includes("İngilizce")) {
                    var url = String(value).replace("[İngilizce]", "");
                    var newUrl = await WriteSubtitles(url, uuidv4());
                    if (newUrl) {
                        subtitles.push({ url: newUrl, lang: "eng",id:"sub-eng" });
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
async function proxyHandler(req, res) {
    try {
        var accessKey = readKey(req);
        if (!keyAllowed(accessKey)) return denyKey(res);

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
            validateStatus: function () { return true; },
        });

        if (response.status >= 400) {
            console.log('[proxy] kaynak hatasi:', response.status, targetUrl.slice(0, 80));
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.status(response.status).send('Kaynak erisilemedi');
        }

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

            // Keep the access key on every rewritten URL, otherwise the player's
            // follow-up requests for playlists and segments would be rejected.
            var proxyBase = process.env.HOSTING_URL + keyPrefix(accessKey) + '/proxy/';

            // Rewrite all non-comment lines (segment URLs) to go through proxy
            text = text.replace(/^((?!#)\S+.*)$/gm, (match) => {
                var line = match.trim();
                if (!line) return match;
                var fullUrl = line.startsWith('http') ? line : baseUrl + line;
                var encoded = Buffer.from(fullUrl).toString('base64url');
                return `${proxyBase}${encodedReferer}/${encoded}`;
            });
            // Also handle URI= in EXT-X-I-FRAME-STREAM-INF
            text = text.replace(/URI="([^"]+)"/g, (match, uri) => {
                var fullUrl = uri.startsWith('http') ? uri : baseUrl + uri;
                var encoded = Buffer.from(fullUrl).toString('base64url');
                return `URI="${proxyBase}${encodedReferer}/${encoded}"`;
            });

            console.log('[proxy] rewritten m3u8 (first 500 chars):', text.substring(0, 500));
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(text);
        }

        // For .ts segments and other binary data.
        // The CDN mislabels video segments as image/jpeg to dodge filtering, and
        // players refuse to decode them ("no audio or video data played").
        // Trust the bytes instead: 0x47 is the MPEG-TS sync byte, "ftyp" marks fMP4.
        var outType = contentType;
        var buf = Buffer.from(body);
        if (buf.length > 8) {
            if (buf[0] === 0x47) outType = 'video/mp2t';
            else if (buf.slice(4, 8).toString('ascii') === 'ftyp') outType = 'video/mp4';
            // Subtitle renditions are served as application/octet-stream; players
            // need a real WebVTT type to render them.
            else if (buf.slice(0, 6).toString('utf8').replace(/^﻿/, '').indexOf('WEBVTT') === 0) outType = 'text/vtt';
        }
        if (outType !== contentType) {
            console.log('[proxy] content-type duzeltildi:', contentType, '->', outType);
        }
        res.setHeader('Content-Type', outType);
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
}

app.get('/proxy/:referer/:url', proxyHandler);
app.get('/:key/proxy/:referer/:url', keyedRoute(proxyHandler));

// SPA catch-all: serve index.html for all unmatched routes (React Router)
app.get('*', function (req, res) {
    // Asset-looking paths must 404 instead of falling through to the SPA shell.
    // A missing /images/logo.png was answering 200 with HTML, so Stremio drew a
    // broken image where the addon logo belongs.
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|map|m3u8|ts|vtt|woff2?)$/i.test(req.path)) {
        return res.status(404).send('Not found');
    }
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