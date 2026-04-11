require("dotenv").config();
const Axios = require('axios');
const { setupCache } = require("axios-cache-interceptor");

const instance = Axios.create();
const axios = setupCache(instance);

let customData = { movies: [], series: [] };
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 dakika

async function fetchCustomContent() {
    var now = Date.now();
    if (now - lastFetch < CACHE_TTL && (customData.movies.length > 0 || customData.series.length > 0)) {
        return customData;
    }

    var url = process.env.CUSTOM_CONTENT_URL;
    if (!url) return customData;

    try {
        var response = await axios.get(url, { cache: false });
        if (response.status === 200 && response.data) {
            customData = {
                movies: response.data.movies || [],
                series: response.data.series || []
            };
            lastFetch = now;
            console.log("[custom] Loaded", customData.movies.length, "movies,", customData.series.length, "series from GitHub");
        }
    } catch (error) {
        console.log("[custom] Fetch error:", error.message);
    }
    return customData;
}

async function searchCustomContent(query) {
    var data = await fetchCustomContent();
    if (data.movies.length === 0 && data.series.length === 0) return [];

    var q = query.toLowerCase().trim();
    var tmdbToken = process.env.TMDB_TOKEN;
    if (!tmdbToken) return [];

    // Tüm custom TMDB ID'leri topla
    var allItems = [
        ...data.movies.map(m => ({ tmdbId: m.tmdbId, type: "movie", embedUrl: m.embedUrl })),
        ...data.series.map(s => ({ tmdbId: s.tmdbId, type: "series", episodes: s.episodes }))
    ];

    if (allItems.length === 0) return [];

    // TMDB'de arama yap, sonra custom listede olanları filtrele
    try {
        var searchRes = await axios.get(
            `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&language=tr-TR`,
            { headers: { Authorization: `Bearer ${tmdbToken}` }, cache: false }
        );

        var tmdbResults = searchRes.data.results || [];
        var results = [];

        for (var tmdbItem of tmdbResults) {
            var mediaType = tmdbItem.media_type === "tv" ? "series" : tmdbItem.media_type;
            if (mediaType !== "movie" && mediaType !== "series") continue;

            var customItem = allItems.find(c => c.tmdbId === tmdbItem.id && c.type === mediaType);
            if (customItem) {
                results.push({
                    id: "custom:" + mediaType + ":" + tmdbItem.id,
                    type: mediaType,
                    title: tmdbItem.title || tmdbItem.name,
                    poster: tmdbItem.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}` : "",
                    year: (tmdbItem.release_date || tmdbItem.first_air_date || "").substring(0, 4),
                    source: "Manuel",
                    tmdbId: tmdbItem.id
                });
            }
        }

        return results;
    } catch (error) {
        console.log("[custom] Search error:", error.message);
    }
    return [];
}

async function getAllCustomContent() {
    var data = await fetchCustomContent();
    var tmdbToken = process.env.TMDB_TOKEN;
    if (!tmdbToken) return [];

    var results = [];

    // Film metadata'ları çek
    for (var movie of data.movies) {
        try {
            var res = await axios.get(
                `https://api.themoviedb.org/3/movie/${movie.tmdbId}?language=tr-TR`,
                { headers: { Authorization: `Bearer ${tmdbToken}` } }
            );
            var d = res.data;
            results.push({
                id: "custom:movie:" + movie.tmdbId,
                type: "movie",
                title: d.title,
                poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : "",
                year: (d.release_date || "").substring(0, 4),
                source: "Manuel",
                tmdbId: movie.tmdbId
            });
        } catch (e) { console.log("[custom] Movie meta error:", e.message); }
    }

    // Dizi metadata'ları çek
    for (var series of data.series) {
        try {
            var res = await axios.get(
                `https://api.themoviedb.org/3/tv/${series.tmdbId}?language=tr-TR`,
                { headers: { Authorization: `Bearer ${tmdbToken}` } }
            );
            var d = res.data;
            results.push({
                id: "custom:series:" + series.tmdbId,
                type: "series",
                title: d.name,
                poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : "",
                year: (d.first_air_date || "").substring(0, 4),
                source: "Manuel",
                tmdbId: series.tmdbId
            });
        } catch (e) { console.log("[custom] Series meta error:", e.message); }
    }

    return results;
}

async function getCustomDetail(tmdbId, type) {
    var data = await fetchCustomContent();
    var tmdbToken = process.env.TMDB_TOKEN;
    if (!tmdbToken) return null;

    var tmdbType = type === "series" ? "tv" : "movie";

    try {
        var detailRes = await axios.get(
            `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?language=tr-TR&append_to_response=credits,videos,external_ids`,
            { headers: { Authorization: `Bearer ${tmdbToken}` }, cache: false }
        );
        var d = detailRes.data;

        // Fragman bul
        var trailer = d.videos?.results?.find(v => v.site === "YouTube" && v.type === "Trailer");
        if (!trailer) trailer = d.videos?.results?.find(v => v.site === "YouTube");

        var meta = {
            name: d.title || d.name,
            background: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : "",
            description: d.overview || "",
            releaseInfo: (d.release_date || d.first_air_date || "").substring(0, 4),
            imdbRating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : 0,
            season: d.number_of_seasons || 1,
            genres: (d.genres || []).map(g => g.name),
            source: "Manuel"
        };

        var episodes = [];
        if (type === "series") {
            var customSeries = data.series.find(s => s.tmdbId === parseInt(tmdbId));
            var episodeMap = customSeries ? customSeries.episodes || {} : {};

            for (var i = 1; i <= (d.number_of_seasons || 1); i++) {
                try {
                    var seasonRes = await axios.get(
                        `https://api.themoviedb.org/3/tv/${tmdbId}/season/${i}?language=tr-TR`,
                        { headers: { Authorization: `Bearer ${tmdbToken}` } }
                    );
                    var seasonEps = seasonRes.data.episodes || [];
                    for (var ep of seasonEps) {
                        var key = i + "x" + ep.episode_number;
                        var hasEmbed = !!episodeMap[key];
                        episodes.push({
                            id: "custom:series:" + tmdbId + ":" + i + ":" + ep.episode_number,
                            title: ep.name || `Bölüm ${ep.episode_number}`,
                            season: i,
                            episode: ep.episode_number,
                            hasEmbed: hasEmbed
                        });
                    }
                } catch (e) { /* season fetch error */ }
            }
        }

        var trailerData = null;
        if (trailer) {
            var cast = (d.credits?.cast || []).slice(0, 8).map(c => ({
                name: c.name,
                character: c.character || null,
                photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
            }));
            var directors = (d.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name);
            var creators = (d.created_by || []).map(c => c.name);

            trailerData = {
                url: `https://www.youtube.com/embed/${trailer.key}`,
                tmdb: {
                    genres: meta.genres,
                    cast: cast,
                    director: type === "movie" ? directors : creators,
                    runtime: d.runtime || null,
                    seasonCount: d.number_of_seasons || null,
                    episodeCount: d.number_of_episodes || null,
                    tmdbRating: meta.imdbRating,
                    overview: meta.description,
                    poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
                    backdrop: meta.background,
                    releaseDate: d.release_date || d.first_air_date || null,
                    originalTitle: d.original_title || d.original_name || null,
                    status: d.status || null,
                }
            };
        }

        return { meta, episodes, trailer: trailerData };
    } catch (error) {
        console.log("[custom] Detail error:", error.message);
        return null;
    }
}

async function getCustomStreamUrl(tmdbId, type, season, episode) {
    var data = await fetchCustomContent();

    if (type === "movie") {
        var movie = data.movies.find(m => m.tmdbId === parseInt(tmdbId));
        return movie ? { embedUrl: movie.embedUrl } : null;
    }

    if (type === "series") {
        var series = data.series.find(s => s.tmdbId === parseInt(tmdbId));
        if (!series || !series.episodes) return null;
        var key = season + "x" + episode;
        var url = series.episodes[key];
        return url ? { embedUrl: url } : null;
    }

    return null;
}

module.exports = { fetchCustomContent, searchCustomContent, getAllCustomContent, getCustomDetail, getCustomStreamUrl };
