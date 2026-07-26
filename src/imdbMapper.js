require("dotenv").config();
const Axios = require("axios");
const fs = require("fs");
const path = require("path");
const searchVideo = require("./search");

// Stremio addresses everything by IMDB id, the site only knows its own slugs and
// mostly Turkish titles ("Esaretin Bedeli" for tt0111161). TMDB bridges the two:
// it maps an IMDB id to both the Turkish and the original title, and we match
// those against the site's search results.
const CACHE_FILE = path.join(__dirname, "..", ".imdb-cache.json");
const TMDB_BASE = "https://api.themoviedb.org/3";
const SEARCH_THROTTLE = 1200;                  // the site answers 429 to bursts
const MISS_TTL = 24 * 60 * 60 * 1000;          // re-try unmatched ids after a day
const MIN_SCORE = 60;                          // below this a match is a guess, not a match

var cache = null;
var lastSearchAt = 0;
var searchChain = Promise.resolve();

function loadCache() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) || {};
    } catch (e) {
        cache = {};
    }
    return cache;
}

function saveCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.log("[imdb] cache yazilamadi:", e.message);
    }
}

function remember(imdbId, entry) {
    loadCache()[imdbId] = entry;
    saveCache();
}

// Serialises every site search through one chain so concurrent Stremio requests
// can never turn into a burst and trip the 429.
function throttledSearch(query) {
    searchChain = searchChain.then(async function () {
        var wait = SEARCH_THROTTLE - (Date.now() - lastSearchAt);
        if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); });
        lastSearchAt = Date.now();
        try {
            return await searchVideo.SearchMovieAndSeries(query);
        } catch (e) {
            return [];
        }
    });
    return searchChain;
}

function normalize(s) {
    return String(s || "")
        .toLocaleLowerCase("tr")
        .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
        .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c")
        .replace(/&/g, "ve")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function scoreCandidate(candidate, info) {
    var candidateTitle = normalize(candidate.title);
    var best = 0;

    for (var i = 0; i < info.titles.length; i++) {
        var t = normalize(info.titles[i]);
        if (!t) continue;
        if (candidateTitle === t) best = Math.max(best, 100);
        else if (candidateTitle.indexOf(t) === 0 || t.indexOf(candidateTitle) === 0) best = Math.max(best, 80);
        else if (candidateTitle.indexOf(t) !== -1 || t.indexOf(candidateTitle) !== -1) best = Math.max(best, 60);
    }
    if (best === 0) return 0;

    if (candidate.type !== info.type) best -= 50;

    // search.js puts the year in `genres`
    var yearMatch = String(candidate.genres || "").match(/\d{4}/);
    var candidateYear = yearMatch ? Number(yearMatch[0]) : 0;
    if (info.year && candidateYear) best += Math.abs(candidateYear - info.year) <= 1 ? 15 : -25;

    return best;
}

function pickBest(candidates, info) {
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
        var s = scoreCandidate(candidates[i], info);
        if (!best || s > best.score) best = { item: candidates[i], score: s };
    }
    return best;
}

async function tmdbLookup(imdbId) {
    if (!process.env.TMDB_TOKEN) {
        console.log("[imdb] TMDB_TOKEN tanimli degil");
        return null;
    }
    try {
        var response = await Axios({
            url: TMDB_BASE + "/find/" + imdbId + "?external_source=imdb_id&language=tr-TR",
            headers: { Authorization: "Bearer " + process.env.TMDB_TOKEN, accept: "application/json" },
            method: "GET",
            timeout: 20000,
            validateStatus: function () { return true; },
        });
        if (response.status !== 200 || !response.data) return null;

        var movie = (response.data.movie_results || [])[0];
        var tv = (response.data.tv_results || [])[0];

        if (movie) {
            return {
                type: "movie",
                titles: [movie.title, movie.original_title].filter(Boolean),
                year: Number(String(movie.release_date || "").slice(0, 4)) || 0,
            };
        }
        if (tv) {
            return {
                type: "series",
                titles: [tv.name, tv.original_name].filter(Boolean),
                year: Number(String(tv.first_air_date || "").slice(0, 4)) || 0,
            };
        }
    } catch (e) {
        console.log("[imdb] TMDB hatasi:", e.message);
    }
    return null;
}

// IMDB id -> the site's own slug (/dizi/... or /film/...), cached on disk.
async function resolveContent(imdbId, type) {
    var cached = loadCache()[imdbId];
    if (cached) {
        if (cached.url) return cached;
        if (Date.now() - (cached.ts || 0) < MISS_TTL) return null;
    }

    var info = await tmdbLookup(imdbId);
    if (!info) {
        remember(imdbId, { url: null, ts: Date.now() });
        return null;
    }
    if (type) info.type = type; // Stremio's own type wins over TMDB's guess

    var seen = new Map();
    for (var i = 0; i < info.titles.length; i++) {
        var results = await throttledSearch(info.titles[i]);
        for (var j = 0; j < results.length; j++) {
            if (!seen.has(results[j].url)) seen.set(results[j].url, results[j]);
        }
        var sofar = pickBest(Array.from(seen.values()), info);
        if (sofar && sofar.score >= 100) break; // exact hit, skip the other title
    }

    var best = pickBest(Array.from(seen.values()), info);
    if (!best || best.score < MIN_SCORE) {
        remember(imdbId, { url: null, ts: Date.now() });
        return null;
    }

    var entry = { url: best.item.url, type: best.item.type, title: best.item.title, score: best.score, ts: Date.now() };
    remember(imdbId, entry);
    console.log("[imdb] " + imdbId + ' -> "' + entry.title + '" ' + entry.url + " (skor " + entry.score + ")");
    return entry;
}

async function resolveEpisodePath(seriesUrl, season, episode) {
    var list = await searchVideo.SearchDetailMovieAndSeries(seriesUrl, "series", season);
    if (!list || !list.length) return null;

    var exact = null;
    var encodesSeason = false;
    for (var i = 0; i < list.length; i++) {
        var m = String(list[i].id).match(/(\d+)-sezon-(\d+)-bolum/);
        if (m) {
            encodesSeason = true;
            if (Number(m[1]) === season && Number(m[2]) === episode) exact = list[i];
        }
    }
    if (exact) return exact.id;

    // SearchDetailMovieAndSeries falls back to season 1 when the requested season
    // does not exist. If the slugs carry the season, a miss means "no such episode"
    // rather than "serve season 1" — do not hand back the wrong episode.
    if (encodesSeason) return null;

    var byIndex = list[episode - 1];
    return byIndex ? byIndex.id : null;
}

// "tt0903747" or "tt0903747:1:1" -> the site path GetVideos() understands.
async function resolveStreamTarget(type, stremioId) {
    var parts = String(stremioId).replace(/\.json$/, "").split(":");
    var imdbId = parts[0];
    if (!/^tt\d+$/i.test(imdbId)) return null;

    var content = await resolveContent(imdbId, type);
    if (!content || !content.url) return null;

    if (type === "series") {
        var season = Number(parts[1]);
        var episode = Number(parts[2]);
        if (!season || !episode) return null;
        var episodePath = await resolveEpisodePath(content.url, season, episode);
        if (!episodePath) return null;
        return { path: episodePath, title: content.title, season: season, episode: episode };
    }

    return { path: content.url, title: content.title };
}

module.exports = { resolveStreamTarget, resolveContent, resolveEpisodePath };
