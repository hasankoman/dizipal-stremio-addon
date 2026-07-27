// Reads a HLS master playlist so each quality can be offered to Stremio as its
// own stream, instead of dumping one master and letting ABR decide.
//
// Languages are deliberately NOT split into separate streams: every audio
// rendition stays inside the emitted playlist, so the player's own audio menu
// can switch dubs during playback. Splitting them would remove that.
//
// The catch that makes a generated playlist necessary at all: when the source
// declares audio as a separate rendition (EXT-X-MEDIA + AUDIO="group"), a bare
// variant playlist carries no sound.

function attr(line, name) {
    var quoted = line.match(new RegExp(name + '="([^"]*)"'));
    if (quoted) return quoted[1];
    var bare = line.match(new RegExp(name + "=([^,\\s]+)"));
    return bare ? bare[1] : null;
}

function absolute(url, baseUrl) {
    try {
        return new URL(url, baseUrl).toString();
    } catch (e) {
        return url;
    }
}

// Label by pixel count, not height alone: these sources ship cinematic crops
// (1728x720, 1920x960) where height alone would misreport the tier.
function qualityLabel(width, height) {
    var pixels = (width || 0) * (height || 0);
    if (!pixels) return "";
    if (pixels >= 3500000) return "4K";
    if (pixels >= 1600000) return "1080p";
    if (pixels >= 800000) return "720p";
    if (pixels >= 350000) return "480p";
    return "360p";
}

// Sources sometimes label a track "Undefined"; that is noise, not a name.
function cleanName(name) {
    var n = String(name || "").trim();
    if (!n || /^undefined$/i.test(n)) return "";
    return n;
}

function parseMaster(text, baseUrl) {
    var lines = String(text || "").split("\n");
    var variants = [];
    var audios = [];
    var subtitles = [];

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();

        if (line.indexOf("#EXT-X-MEDIA:") === 0 && /TYPE=AUDIO/.test(line)) {
            var uri = attr(line, "URI");
            if (!uri) continue;
            audios.push({
                url: absolute(uri, baseUrl),
                name: cleanName(attr(line, "NAME")),
                lang: attr(line, "LANGUAGE") || "",
                group: attr(line, "GROUP-ID") || "",
                isDefault: /DEFAULT=YES/.test(line),
                channels: attr(line, "CHANNELS") || "",
            });
            continue;
        }

        // Subtitle renditions live only in the master playlist — GetVideos does
        // not see them, so without this the tracks are silently dropped.
        if (line.indexOf("#EXT-X-MEDIA:") === 0 && /TYPE=SUBTITLES/.test(line)) {
            var suri = attr(line, "URI");
            if (!suri) continue;
            subtitles.push({
                url: absolute(suri, baseUrl),
                name: cleanName(attr(line, "NAME")),
                lang: attr(line, "LANGUAGE") || "",
                group: attr(line, "GROUP-ID") || "",
            });
            continue;
        }

        if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
            // the URL sits on the next non-empty, non-comment line
            var url = null;
            for (var j = i + 1; j < lines.length; j++) {
                var candidate = lines[j].trim();
                if (!candidate) continue;
                if (candidate.indexOf("#") === 0) break;
                url = candidate;
                break;
            }
            if (!url) continue;

            var res = attr(line, "RESOLUTION") || "";
            var dims = res.split("x");
            var width = Number(dims[0]) || 0;
            var height = Number(dims[1]) || 0;

            // Some sources already label the tier (NAME="720p"); trust that over
            // our own guess when present.
            var declared = cleanName(attr(line, "NAME"));

            variants.push({
                url: absolute(url, baseUrl),
                bandwidth: Number(attr(line, "BANDWIDTH")) || 0,
                width: width,
                height: height,
                resolution: res,
                quality: declared || qualityLabel(width, height),
                audioGroup: attr(line, "AUDIO"),
                subtitleGroup: attr(line, "SUBTITLES"),
                codecs: attr(line, "CODECS") || "",
            });
        }
    }

    // Highest quality first, mirroring how Stremio lists sources.
    variants.sort(function (a, b) { return b.bandwidth - a.bandwidth; });
    return { variants: variants, audios: audios, subtitles: subtitles };
}

// Total runtime from a variant playlist, used to estimate file size.
function durationOf(playlistText) {
    var matches = String(playlistText || "").match(/#EXTINF:([\d.]+)/g) || [];
    var total = 0;
    for (var i = 0; i < matches.length; i++) {
        total += parseFloat(matches[i].split(":")[1]) || 0;
    }
    return total;
}

function humanSize(bandwidth, seconds) {
    if (!bandwidth || !seconds) return "";
    var bytes = (bandwidth * seconds) / 8;
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
    return Math.round(bytes / 1e6) + " MB";
}

// The audio renditions a given variant can use. Empty means the audio is muxed
// into the video segments, so no separate track is needed.
function audiosFor(master, variant) {
    if (!variant.audioGroup) return [];
    return master.audios.filter(function (a) { return a.group === variant.audioGroup; });
}

// Minimal master carrying one video variant plus ALL of its audio renditions.
// Keeping every language in a single playlist is what lets the player's own
// audio menu switch dubs mid-playback — splitting them into separate streams
// would take that away. Dropping them entirely would play the video silent,
// since a variant playlist holds no audio when the source declares it apart.
// `proxify` maps a source URL to the URL the player should actually request.
function buildMiniMaster(variant, audios, proxify) {
    var tracks = Array.isArray(audios) ? audios : (audios ? [audios] : []);
    var out = ["#EXTM3U", "#EXT-X-VERSION:3"];
    var streamInf = "#EXT-X-STREAM-INF:BANDWIDTH=" + (variant.bandwidth || 1000000);

    if (variant.resolution) streamInf += ",RESOLUTION=" + variant.resolution;
    if (variant.codecs) streamInf += ',CODECS="' + variant.codecs + '"';

    if (tracks.length) {
        // Prefer Turkish as the default track, else whatever the source marked.
        var defaultIndex = tracks.findIndex(function (a) { return /^tr/i.test(a.lang || "") || /türk|turkish/i.test(a.name || ""); });
        if (defaultIndex === -1) defaultIndex = tracks.findIndex(function (a) { return a.isDefault; });
        if (defaultIndex === -1) defaultIndex = 0;

        tracks.forEach(function (a, i) {
            out.push(
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="' + (a.name || a.lang || ("Audio " + (i + 1))) + '"'
                + (a.lang ? ',LANGUAGE="' + a.lang + '"' : "")
                + ",AUTOSELECT=YES,DEFAULT=" + (i === defaultIndex ? "YES" : "NO")
                + ',URI="' + proxify(a.url) + '"'
            );
        });
        streamInf += ',AUDIO="aud"';
    }

    out.push(streamInf);
    out.push(proxify(variant.url));
    return out.join("\n") + "\n";
}

module.exports = { parseMaster, audiosFor, buildMiniMaster, qualityLabel, durationOf, humanSize };
