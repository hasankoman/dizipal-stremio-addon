#!/usr/bin/env node
// Yerel bolum dosyalarini (SxxExx adli) dizipal'daki Turkce dublajla esleyip
// senkron farkini olcer; istenirse senkronlu mux uretir.
//
// Kullanim:
//   node tools/dubsync.js --show lioness --dir /Volumes/SANDISK
//   node tools/dubsync.js --show lioness --file "/path/Lioness.S02E03....mkv"
//   node tools/dubsync.js --show lioness --dir /Volumes/SANDISK --season 2 --mux --outdir ~/Movies
//
// Secenekler:
//   --show <slug|arama>   dizipal dizi slug'i (/dizi/<slug>) ya da arama sorgusu
//   --dir <klasor>        SxxExx desenli video dosyalarini tara (alt klasorler dahil)
//   --file <dosya>        tek dosya isle
//   --season <n>          sadece bu sezonu isle
//   --episode <n>         sadece bu bolumu isle
//   --mux                 senkronlu TR sesli .mkv uret (varsayilan: sadece olc)
//   --outdir <klasor>     mux ciktilari ve indirilen sesler icin klasor
//   --audio-dir <klasor>  indirilen TR seslerini burada sakla/yeniden kullan

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const os = require("os");
const path = require("path");
const dubsync = require("../src/dubsync");
const searchVideo = require("../src/search");

const VIDEO_EXT = /\.(mkv|mp4|avi|m2ts|ts|mov)$/i;
const EP_RE = /S(\d{1,2})[\s._-]*E(\d{1,3})/i;

function parseArgs(argv) {
    var a = {};
    for (var i = 2; i < argv.length; i++) {
        var k = argv[i];
        if (k.slice(0, 2) !== "--") continue;
        var name = k.slice(2);
        var next = argv[i + 1];
        if (!next || next.slice(0, 2) === "--") a[name] = true;
        else { a[name] = next; i++; }
    }
    return a;
}

function findVideos(dir) {
    var out = [];
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
        if (e.name.slice(0, 1) === ".") return;
        var p = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(findVideos(p));
        else if (VIDEO_EXT.test(e.name) && !/\.part$/i.test(e.name)) out.push(p);
    });
    return out;
}

async function resolveSeries(show) {
    if (show.indexOf("/dizi/") === 0) return show;
    var results = await searchVideo.SearchMovieAndSeries(show);
    var dizi = (results || []).filter(function (r) { return r.type === "series"; })[0];
    if (!dizi) throw new Error("dizi bulunamadi: " + show);
    console.log("dizi: " + dizi.title + " (" + dizi.url + ")");
    return dizi.url;
}

// Dizipal bolum listesi: [{season, episode, id}]
async function episodeMap(seriesPath) {
    var meta = await searchVideo.SearchMetaMovieAndSeries(seriesPath, "series");
    if (!meta) throw new Error("dizi sayfasi okunamadi: " + seriesPath);
    var map = {};
    for (var s = 1; s <= (meta.season || 1); s++) {
        var eps = await searchVideo.SearchDetailMovieAndSeries(seriesPath, "series", s);
        (eps || []).forEach(function (ep) {
            if (ep.id) map[s + "x" + ep.episode] = ep.id;
        });
    }
    return map;
}

function fmtMs(x) { return (x >= 0 ? "+" : "") + x.toFixed(1) + " ms"; }

async function processOne(file, contentPath, opts) {
    var tag = path.basename(file).replace(/\.[^.]+$/, "");
    console.log("\n=== " + tag);
    console.log("dizipal: " + contentPath);

    var audioDir = opts.audioDir || fs.mkdtempSync(path.join(os.tmpdir(), "dubsync-"));
    fs.mkdirSync(audioDir, { recursive: true });
    var audioFile = path.join(audioDir, tag + ".tur.m4a");

    if (!fs.existsSync(audioFile) || !fs.statSync(audioFile).size) {
        var source = await dubsync.resolveTrAudioSource(contentPath);
        console.log("ses kaynagi: " + source.kind);
        await dubsync.downloadAudio(source, audioFile);
    }
    console.log("TR ses: " + audioFile + " (" + Math.round(fs.statSync(audioFile).size / 1e6) + " MB)");

    var t0 = Date.now();
    var refPcm = await dubsync.decodePcm(file);
    var dubPcm = await dubsync.decodePcm(audioFile);
    var sync = dubsync.measureSync(refPcm, dubPcm, function (m) { console.log("  " + m); });
    console.log("  olcum " + ((Date.now() - t0) / 1000).toFixed(0) + " sn surdu");

    console.log("  hiz orani : " + sync.speed.toFixed(7) + (Math.abs(sync.speed - 25 / 23.976) < 0.0005 ? "  (PAL 25/23.976)" : ""));
    console.log("  atempo    : " + sync.atempo.toFixed(7));
    console.log("  delay     : " + fmtMs(sync.delayMs) + " (atempo sonrasi)");
    console.log("  guven     : " + sync.windowsUsed + "/" + sync.windowsTotal + " pencere, artik " + sync.residualMs.toFixed(2) + " ms");
    if (sync.residualMs > 50) console.log("  UYARI: artik yuksek — sonucu kontrol edin (farkli kurgu olabilir)");

    if (opts.mux) {
        var outDir = opts.outdir || path.dirname(file);
        fs.mkdirSync(outDir, { recursive: true });
        var outFile = path.join(outDir, tag + ".TR-Dublaj.mkv");
        console.log("  mux: " + outFile);
        await dubsync.muxDub(file, audioFile, outFile, sync);
        console.log("  mux tamam (" + Math.round(fs.statSync(outFile).size / 1e9 * 10) / 10 + " GB)");
    }
    return { file: tag, sync: sync };
}

(async function main() {
    var args = parseArgs(process.argv);
    if (!args.show || (!args.dir && !args.file)) {
        console.log("kullanim: node tools/dubsync.js --show <slug|arama> (--dir <klasor> | --file <dosya>) [--season N] [--episode N] [--mux] [--outdir D] [--audio-dir D]");
        process.exit(1);
    }

    // .env'deki PROXY_URL bayatlamis olabilir; site domain atlattiginda gecerli
    // olani cache/tarama ile bul (sunucu tarafinda ayni isi startAutoRefresh yapiyor).
    await require("../src/domainResolver").resolveDomain({ force: true });

    var seriesPath = await resolveSeries(String(args.show));
    var eps = await episodeMap(seriesPath);
    console.log("dizipal bolum sayisi: " + Object.keys(eps).length);

    var files = args.file ? [String(args.file)] : findVideos(String(args.dir));
    var jobs = [];
    files.forEach(function (f) {
        var m = path.basename(f).match(EP_RE);
        if (!m) return;
        var s = parseInt(m[1], 10), e = parseInt(m[2], 10);
        if (args.season && s !== parseInt(args.season, 10)) return;
        if (args.episode && e !== parseInt(args.episode, 10)) return;
        var id = eps[s + "x" + e];
        if (!id) { console.log("dizipal'da yok, atlandi: " + path.basename(f) + " (S" + s + "E" + e + ")"); return; }
        jobs.push({ file: f, contentPath: id, s: s, e: e });
    });
    jobs.sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    if (!jobs.length) { console.log("islenecek dosya bulunamadi"); process.exit(1); }
    console.log("islenecek: " + jobs.length + " bolum");

    var results = [];
    for (var i = 0; i < jobs.length; i++) {
        try {
            results.push(await processOne(jobs[i].file, jobs[i].contentPath, {
                mux: !!args.mux,
                outdir: args.outdir && String(args.outdir),
                audioDir: args["audio-dir"] && String(args["audio-dir"]),
            }));
        } catch (e2) {
            console.log("HATA (" + path.basename(jobs[i].file) + "): " + e2.message);
            results.push({ file: path.basename(jobs[i].file), error: e2.message });
        }
    }

    console.log("\n================ OZET ================");
    results.forEach(function (r) {
        if (r.error) { console.log(r.file + "  HATA: " + r.error); return; }
        console.log(
            r.file.slice(0, 44).padEnd(46)
            + " hiz=" + r.sync.speed.toFixed(6)
            + " atempo=" + r.sync.atempo.toFixed(6)
            + " delay=" + fmtMs(r.sync.delayMs).padStart(12)
            + " artik=" + r.sync.residualMs.toFixed(2) + "ms"
        );
    });
    process.exit(0);
})().catch(function (e) { console.error("HATA:", e.message); process.exit(1); });
