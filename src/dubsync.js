// Yerel bir video dosyasindaki (ör. REMUX) ses ile dizipal'dan cozulen Turkce
// dublaj arasindaki senkron farkini olcer ve istenirse senkronlu mux uretir.
//
// Iki kaynak genelde farkli kare hizinda calisir (WEB kaynaklari 25 fps PAL,
// REMUX'lar 23.976 fps), bu yuzden fark tek bir sabit gecikme DEGILDIR:
//   t_ref = offset + hiz * t_dub
// Once dublaj sesi kaba hiz faktoruyle referans zaman eksenine "warp" edilir
// (bu yapilmazsa 20-25 sn'lik pencere icinde bile korelasyon tepesi dagilir),
// sonra bolume yayilmis pencerelerde capraz korelasyon + dogrusal fit ile
// hiz ve offset birlikte cozulur. Dublajda konusma farkli dilde olsa da
// muzik/efekt bandi orijinalle ayni oldugundan korelasyon calisir.
//
// Tum DSP saf JS'tir (FFT dahil); tek dis bagimlilik ffmpeg/ffprobe.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const listVideo = require("./videos");
const hlsParser = require("./hls");
const Axios = require("axios");

const SR = 8000; // analiz ornekleme hizi; 1 ornek = 0.125 ms cozunurluk
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ---------------------------------------------------------------- ffmpeg ----

function run(cmd, args, opts) {
    return new Promise(function (resolve, reject) {
        var p = spawn(cmd, args, opts || {});
        var err = "";
        var chunks = [];
        if (p.stdout) p.stdout.on("data", function (d) { chunks.push(d); });
        if (p.stderr) p.stderr.on("data", function (d) { err += d; });
        p.on("error", reject);
        p.on("close", function (code) {
            if (code === 0) resolve(Buffer.concat(chunks));
            else reject(new Error(cmd + " cikis kodu " + code + ": " + err.slice(-800)));
        });
    });
}

// -extension_picky ffmpeg 7.1 ile geldi; daha eski surumler (ör. Ubuntu'nun
// 6.1'i) bunu taniyip hata veriyor ve komut hic calismiyor. Bir kez sorup
// sonucu sakliyoruz — surum farki dagitim ortamlari arasinda gercek bir fark.
var extensionPickySupport = null;
function supportsExtensionPicky() {
    if (extensionPickySupport !== null) return extensionPickySupport;
    try {
        var out = require("child_process").execFileSync(
            "ffmpeg", ["-hide_banner", "-h", "demuxer=hls"],
            { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }
        );
        extensionPickySupport = out.indexOf("extension_picky") !== -1;
    } catch (e) {
        extensionPickySupport = false;
    }
    return extensionPickySupport;
}

function httpHeaderArgs(source) {
    if (!source || !source.referer) return [];
    var lines = ["Referer: " + source.referer, "User-Agent: " + UA];
    if (source.cookies) lines.push("Cookie: " + source.cookies);
    // CDN, HLS segmentlerini .jpg gibi sahte uzantilarla servis ediyor;
    // ffmpeg'in hls demuxer'i bunlari varsayilan olarak reddeder.
    var args = ["-allowed_extensions", "ALL"];
    if (supportsExtensionPicky()) args.push("-extension_picky", "0");
    return args.concat(["-headers", lines.join("\r\n") + "\r\n"]);
}

// Herhangi bir girdiyi (yerel dosya ya da URL) mono 8 kHz PCM'e cozer.
async function decodePcm(input, source) {
    var args = ["-v", "error"]
        .concat(source ? httpHeaderArgs(source) : [])
        .concat(["-i", input, "-vn", "-sn", "-map", "0:a:0", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"]);
    var buf = await run("ffmpeg", args);
    var out = new Float32Array(buf.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
    return out;
}

async function probeDuration(file) {
    var buf = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return parseFloat(String(buf).trim()) || 0;
}

// ------------------------------------------------------------------- DSP ----

// Yerinde iteratif radix-2 FFT (re/im ayri diziler).
function fft(re, im, inverse) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
        var bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            var t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (var len = 2; len <= n; len <<= 1) {
        var ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
        var wr = Math.cos(ang), wi = Math.sin(ang);
        for (var s = 0; s < n; s += len) {
            var cr = 1, ci = 0;
            for (var k = 0; k < len / 2; k++) {
                var ur = re[s + k], ui = im[s + k];
                var vr = re[s + k + len / 2] * cr - im[s + k + len / 2] * ci;
                var vi = re[s + k + len / 2] * ci + im[s + k + len / 2] * cr;
                re[s + k] = ur + vr; im[s + k] = ui + vi;
                re[s + k + len / 2] = ur - vr; im[s + k + len / 2] = ui - vi;
                var ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr; cr = ncr;
            }
        }
    }
    if (inverse) {
        for (var q = 0; q < n; q++) { re[q] /= n; im[q] /= n; }
    }
}

// Tam capraz korelasyon: c[i] karsiligi lag = i - (b.length - 1); b, a icinde kaydirilir.
function xcorr(a, b) {
    var outLen = a.length + b.length - 1;
    var n = 1; while (n < outLen) n <<= 1;
    var are = new Float64Array(n), aim = new Float64Array(n);
    var bre = new Float64Array(n), bim = new Float64Array(n);
    are.set(a);
    for (var i = 0; i < b.length; i++) bre[i] = b[b.length - 1 - i]; // ters cevrilmis b ile konvolusyon
    fft(are, aim, false);
    fft(bre, bim, false);
    for (var k = 0; k < n; k++) {
        var r = are[k] * bre[k] - aim[k] * bim[k];
        var im2 = are[k] * bim[k] + aim[k] * bre[k];
        are[k] = r; aim[k] = im2;
    }
    fft(are, aim, true);
    return are.subarray(0, outLen);
}

// Tepe konumu + kalite (tepe - medyan)/std. Medyan/std hiz icin seyrek orneklenir.
function peakOf(c) {
    var best = 0, bi = 0;
    for (var i = 0; i < c.length; i++) if (c[i] > best) { best = c[i]; bi = i; }
    var step = Math.max(1, c.length >> 13);
    var sample = [];
    for (var j = 0; j < c.length; j += step) sample.push(c[j]);
    sample.sort(function (x, y) { return x - y; });
    var med = sample[sample.length >> 1];
    var mean = 0, m2 = 0;
    for (var k = 0; k < sample.length; k++) mean += sample[k];
    mean /= sample.length;
    for (var q = 0; q < sample.length; q++) { var d = sample[q] - mean; m2 += d * d; }
    var std = Math.sqrt(m2 / sample.length) || 1e-12;
    // parabolik alt-ornek incelik
    var frac = 0;
    if (bi > 0 && bi < c.length - 1) {
        var den = c[bi - 1] - 2 * c[bi] + c[bi + 1];
        if (Math.abs(den) > 1e-12) frac = 0.5 * (c[bi - 1] - c[bi + 1]) / den;
    }
    return { index: bi + frac, quality: (best - med) / std };
}

// RBJ 2. derece Butterworth highpass (60 Hz): DC/ugultuyu atar.
function highpass(x, fc) {
    var w0 = 2 * Math.PI * fc / SR, cw = Math.cos(w0), sw = Math.sin(w0);
    var alpha = sw / Math.SQRT2;
    var b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = (1 + cw) / 2;
    var a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    var y = new Float32Array(x.length);
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
        var v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
}

// 50 Hz log-RMS zarfi (kaba arama icin kucuk ve gurbuz temsil).
function envelope(x) {
    var hop = SR / 50;
    var n = Math.floor(x.length / hop);
    var e = new Float64Array(n);
    var mean = 0;
    for (var i = 0; i < n; i++) {
        var s = 0;
        for (var j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j];
        e[i] = Math.log1p(100 * Math.sqrt(s / hop));
        mean += e[i];
    }
    mean /= n || 1;
    for (var k = 0; k < n; k++) e[k] -= mean;
    return e;
}

function timeStretch(x, factor) {
    var out = new Float32Array(Math.floor(x.length * factor));
    for (var i = 0; i < out.length; i++) {
        var t = i / factor;
        var i0 = Math.floor(t);
        var fr = t - i0;
        out[i] = i0 + 1 < x.length ? x[i0] * (1 - fr) + x[i0 + 1] * fr : x[i0] || 0;
    }
    return out;
}

function demean(x) {
    var m = 0;
    for (var i = 0; i < x.length; i++) m += x[i];
    m /= x.length || 1;
    var y = new Float64Array(x.length);
    for (var j = 0; j < x.length; j++) y[j] = x[j] - m;
    return y;
}

// ------------------------------------------------------------- olcum ----

// refPcm: referans (yerel dosya) sesi, dubPcm: dublaj sesi (her ikisi 8 kHz mono).
// Donus: { speed, offsetSec, residualMs, windowsUsed, windowsTotal, atempo, delayMs }
function measureSync(refPcm, dubPcm, log) {
    log = log || function () {};
    var ref = highpass(refPcm, 60);
    var dub = highpass(dubPcm, 60);

    // 1) Kaba asama: zarf uzerinde hiz faktoru adaylari + izgara arama
    var er = envelope(ref), edub = envelope(dub);
    var durRatio = ref.length / dub.length;
    var seeds = [1.0, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25, durRatio];
    var grid = {};
    seeds.forEach(function (s) {
        if (s > 0.9 && s < 1.12) {
            for (var d = -0.002; d <= 0.002; d += 0.001) grid[(s + d).toFixed(5)] = true;
        }
    });
    var best = null;
    Object.keys(grid).forEach(function (key) {
        var f = parseFloat(key);
        var stretched = timeStretch(Float32Array.from(edub), f);
        var c = xcorr(er, demean(stretched));
        var p = peakOf(c);
        if (!best || p.quality > best.quality) {
            best = { factor: f, lagEnv: p.index - (stretched.length - 1), quality: p.quality };
        }
    });
    var r0 = best.factor;
    var off0 = best.lagEnv / 50; // saniye
    log("kaba model: hiz=" + r0.toFixed(5) + " offset=" + off0.toFixed(2) + "s kalite=" + best.quality.toFixed(1));

    // 2) Ince asama: dublaji r0 ile warp edip 8 kHz ham seste pencere olcumleri
    var dubW = timeStretch(dub, r0);
    var WIN = 25 * SR, SEARCH = 6 * SR, STEP = 60 * SR;
    var meas = [];
    for (var d0 = 30 * SR; d0 + WIN + 30 * SR < dubW.length; d0 += STEP) {
        var exp = Math.round(d0 + off0 * SR);
        var a0 = Math.max(0, exp - SEARCH);
        var a1 = Math.min(ref.length, exp + WIN + SEARCH);
        if (a1 - a0 < WIN + SR) continue;
        var segD = demean(dubW.subarray(d0, d0 + WIN));
        var segR = demean(ref.subarray(a0, a1));
        var c = xcorr(segR, segD);
        var p = peakOf(c);
        var tRef = (a0 + p.index - (segD.length - 1)) / SR;
        meas.push({ tDub: d0 / SR, tRef: tRef, q: p.quality });
    }
    if (meas.length < 4) throw new Error("yeterli olcum penceresi yok (" + meas.length + ")");

    // 3) Saglam dogrusal fit: tRef = a + rw * tDub, kalite esigi + artik ayiklama
    var qs = meas.map(function (m) { return m.q; }).sort(function (a, b) { return a - b; });
    var qThresh = Math.max(12, qs[Math.floor(qs.length * 0.4)]);
    var m = meas.filter(function (x) { return x.q >= qThresh; });
    if (m.length < 4) m = meas.slice().sort(function (a, b) { return b.q - a.q; }).slice(0, Math.max(4, meas.length >> 1));

    var a = 0, rw = 1;
    for (var iter = 0; iter < 5; iter++) {
        var n = m.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
        m.forEach(function (p2) { sx += p2.tDub; sy += p2.tRef; sxx += p2.tDub * p2.tDub; sxy += p2.tDub * p2.tRef; });
        var den = n * sxx - sx * sx;
        rw = (n * sxy - sx * sy) / den;
        a = (sy - rw * sx) / n;
        var res = m.map(function (p2) { return p2.tRef - (a + rw * p2.tDub); });
        var std = Math.sqrt(res.reduce(function (s2, r) { return s2 + r * r; }, 0) / n);
        var tol = Math.max(0.008, 2.5 * std);
        var kept = m.filter(function (p2, i2) { return Math.abs(res[i2]) < tol; });
        if (kept.length === m.length || kept.length < 4) break;
        m = kept;
    }
    var resFin = m.map(function (p2) { return p2.tRef - (a + rw * p2.tDub); });
    var residualMs = Math.sqrt(resFin.reduce(function (s2, r) { return s2 + r * r; }, 0) / m.length) * 1000;

    var speed = r0 * rw;             // t_ref = offset + speed * t_dub(ham)
    return {
        speed: speed,
        offsetSec: a,
        atempo: 1 / speed,           // dublaji referansa oturtmak icin yavaslatma
        delayMs: a * 1000,           // atempo SONRASI uygulanacak gecikme
        residualMs: residualMs,
        windowsUsed: m.length,
        windowsTotal: meas.length,
        coarseQuality: best.quality,
        measurements: meas,
    };
}

// ------------------------------------------------- kaynak cozumleme ----

// Dizipal icerik yolundan Turkce ses kaynagini cozer.
// Ayri TR ses rendition'i varsa onu, yoksa en dusuk bantli varyanti dondurur
// (muxlanmis tek sesli kaynaklarda ses zaten dublajdir).
// Donen nesne, kaynak fps'i olcmek icin video varyantinin adresini de tasir.
async function resolveTrAudioSource(contentPath) {
    var video = await listVideo.GetVideos(contentPath);
    if (!video || !video.url) throw new Error("video cozulemedi: " + contentPath);
    var source = { referer: video.referer, cookies: video.cookies };

    var masterRes = await Axios({
        url: video.url,
        headers: Object.assign(
            { Referer: video.referer, "User-Agent": UA, Accept: "*/*" },
            video.cookies ? { Cookie: video.cookies } : {}
        ),
        timeout: 20000,
        validateStatus: function () { return true; },
    });
    if (masterRes.status !== 200) throw new Error("master playlist alinamadi: " + masterRes.status);

    var master = hlsParser.parseMaster(masterRes.data, video.url);
    var tr = (master.audios || []).find(function (a2) {
        return /^tur?$/i.test(a2.lang || "") || /t[uü]rk/i.test(a2.name || "");
    });
    // Kaynak fps'i icin video varyanti gerekiyor; ses rendition'inda kare yok.
    var videoVariant = master.variants.length ? master.variants[master.variants.length - 1].url : null;
    if (tr) return Object.assign({ url: tr.url, kind: "tr-rendition", name: tr.name || "Türkçe", videoVariant: videoVariant }, source);
    if (master.variants.length) {
        var lowest = master.variants[master.variants.length - 1];
        return Object.assign({ url: lowest.url, kind: "muxed-variant", name: "Türkçe", videoVariant: lowest.url }, source);
    }
    return Object.assign({ url: video.url, kind: "direct", name: "Türkçe", videoVariant: video.url }, source);
}

// Kaynagin kare hizi. PAL hizlandirmasi burada yakalanir: dizipal WEB kaynaklari
// 25 fps, REMUX'lar 23.976 fps olunca hiz orani = kaynak/hedef seklinde OLCUMSUZ
// hesaplanabiliyor (olcumle dogrulandi: sapma ~1 ppm). Bir segment indirmek
// gerektigi icin sonuc cagiran tarafta onbellege alinmali.
async function probeSourceFps(videoUrl, source) {
    var args = ["-v", "error"]
        .concat(source ? httpHeaderArgs(source) : [])
        .concat([
            "-select_streams", "v:0",
            "-show_entries", "stream=avg_frame_rate,r_frame_rate",
            "-of", "csv=p=0", videoUrl,
        ]);
    var out = String(await run("ffprobe", args)).trim().split("\n")[0] || "";
    var fps = 0;
    out.split(",").forEach(function (frac) {
        var parts = String(frac).split("/");
        var v = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(parts[0]);
        if (!fps && isFinite(v) && v > 1) fps = v;
    });
    if (!fps) throw new Error("kaynak fps okunamadi");
    return fps;
}

// Yaygin kare hizlarina yapisma: ffprobe 25000/1000 yerine 24999/1000 gibi
// degerler dondurebiliyor, bu da hiz oraninda gereksiz ppm hatasi yaratir.
function snapFps(fps) {
    var common = [23.976023976, 24, 25, 29.97002997, 30, 50, 59.94005994, 60];
    for (var i = 0; i < common.length; i++) {
        if (Math.abs(fps - common[i]) / common[i] < 0.002) return common[i];
    }
    return fps;
}

// TR sesi kayipsiz kopyayla yerel dosyaya indirir (mux'ta yeniden kullanilir).
async function downloadAudio(source, outFile) {
    var args = ["-v", "error", "-y"]
        .concat(httpHeaderArgs(source))
        .concat(["-i", source.url]);
    if (source.kind === "muxed-variant") args = args.concat(["-vn"]);
    args = args.concat(["-map", "0:a:0", "-c", "copy", outFile]);
    await run("ffmpeg", args);
    return outFile;
}

// ------------------------------------- hedefe uyarlanmis ses uretimi ----

// Hiz duzeltilmis sesi diske hazirlar; ayni is iki kez istenirse tek is calisir.
// mpv harici ses izinde ARAMA (seek) yapabilmeli, bu yuzden canli boru yerine
// tamamlanmis bir dosya servis ediyoruz — yarim indirilmis dosya "hazir"
// sanilmasin diye once .part'a yazilip bitince yeniden adlandiriliyor.
const jobs = new Map();

function correctedName(contentPath, atempo, pitch) {
    var slug = String(contentPath).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
    return slug + "__" + (pitch === "keep" ? "t" : "r") + atempo.toFixed(6).replace(".", "") + ".m4a";
}

// asetrate icin ara ornekleme hizi. asetrate tamsayi bir hiz ister; yuksek bir
// tabandan gidince yuvarlama hatasi ~1 ppm'e (bolum boyunca ~2 ms) iner.
const RESAMPLE_BASE = 192000;

// atempo: sesi hedefin zaman eksenine oturtan carpan (1/hiz orani).
//
// PAL hizlandirmasi bir YENIDEN ORNEKLEME'dir: ses hem hizlanir hem tizlesir.
// Dolayisiyla dogru tersi de yeniden ornekleme (asetrate) — zamanlamayla
// birlikte perdeyi de orijinaline dondurur. Bunun olculebilir kaniti var:
// dizipal sesi 0.959 ile yeniden orneklenince REMUX'un muzik yatagiyla HAM
// ORNEK duzeyinde (yalnizca zarfta degil) 0.04 ms artikla ortusuyor; bu ancak
// spektrum da ortusurse olur. atempo yalnizca zamanlamayi duzeltir, perdeyi
// %4.3 tiz birakir — perde korunsun istenirse pitch: "keep".
async function prepareCorrectedAudio(source, contentPath, atempo, opts) {
    opts = opts || {};
    var dir = opts.cacheDir || path.join(os.tmpdir(), "komanmovie-dub");
    fs.mkdirSync(dir, { recursive: true });
    var outFile = path.join(dir, correctedName(contentPath, atempo, opts.pitch));

    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        return { status: "ready", file: outFile };
    }
    if (jobs.has(outFile)) return { status: "preparing", file: outFile };

    var partFile = outFile + ".part";
    // Kaynagin kendi ornekleme hizi bilinmedigi icin once sabit bir tabana
    // getiriliyor: asetrate mutlak bir hiz alir, goreli bir carpan degil.
    var filters = opts.pitch === "keep"
        ? ["atempo=" + atempo.toFixed(7)]
        : [
            "aresample=" + RESAMPLE_BASE,
            "asetrate=" + Math.round(RESAMPLE_BASE * atempo),
            "aresample=48000",
        ];

    var args = ["-v", "error", "-y"]
        .concat(httpHeaderArgs(source))
        .concat(["-i", source.url]);
    if (source.kind === "muxed-variant") args = args.concat(["-vn"]);
    args = args.concat([
        "-map", "0:a:0",
        "-af", filters.join(","),
        "-c:a", "aac", "-b:a", opts.bitrate || "192k",
        "-movflags", "+faststart",
        "-metadata:s:a:0", "language=tur",
        // Uzanti .part oldugu icin ffmpeg konteyneri ad'dan secemiyor.
        "-f", "mp4", partFile,
    ]);

    var job = run("ffmpeg", args).then(function () {
        fs.renameSync(partFile, outFile);
        jobs.delete(outFile);
        return outFile;
    }, function (e) {
        jobs.delete(outFile);
        try { fs.unlinkSync(partFile); } catch (e2) {}
        throw e;
    });
    jobs.set(outFile, job);
    // Isi baslatan istek genelde onu beklemez (once "preparing" doner); sahipsiz
    // bir red tum sunucuyu dusurur, bu yuzden burada ayrica yutuluyor. Bekleyen
    // cagiranlar yine `job` uzerinden hatayi gorur.
    job.catch(function () {});
    return { status: "preparing", file: outFile, job: job };
}

// Hazirlanan sesler bolum basina ~60 MB tutuyor ve bir daha istenmeyebilir;
// budanmazsa disk sessizce dolar. Son erisimi eskiyenler siliniyor — dosya
// yeniden istenirse zaten yeniden uretiliyor.
function pruneCache(dir, maxAgeMs) {
    var cacheDir = dir || path.join(os.tmpdir(), "komanmovie-dub");
    var cutoff = Date.now() - (maxAgeMs || 7 * 24 * 60 * 60 * 1000);
    var removed = 0;
    try {
        fs.readdirSync(cacheDir).forEach(function (name) {
            var file = path.join(cacheDir, name);
            try {
                var stat = fs.statSync(file);
                if (!stat.isFile()) return;
                // Hazirlanmakta olan bir dosyayi silmemek icin .part atlanir;
                // yarim kalmis olanlar da yaslaninca zaten temizlenir.
                if (/\.part$/.test(name) && Date.now() - stat.mtimeMs < 60 * 60 * 1000) return;
                var last = Math.max(stat.atimeMs || 0, stat.mtimeMs || 0);
                if (last < cutoff) { fs.unlinkSync(file); removed++; }
            } catch (e) { /* yarista silinmis olabilir */ }
        });
    } catch (e) { /* dizin henuz yok */ }
    return removed;
}

// ------------------------------------------------------------- mux ----

// Referans videonun tum izlerini koruyup senkronlanmis TR sesini ekler.
async function muxDub(refFile, dubAudioFile, outFile, sync, opts) {
    opts = opts || {};
    var filters = ["atempo=" + sync.atempo.toFixed(7)];
    if (sync.offsetSec >= 0) {
        filters.push("adelay=" + Math.round(sync.delayMs) + ":all=1");
    } else {
        filters.push("atrim=start=" + (-sync.offsetSec).toFixed(4), "asetpts=PTS-STARTPTS");
    }
    var args = [
        "-v", "error", "-y",
        "-i", refFile, "-i", dubAudioFile,
        "-filter_complex", "[1:a:0]" + filters.join(",") + "[tr]",
        "-map", "0", "-map", "[tr]",
        "-c", "copy", "-c:a:1", "aac", "-b:a:1", opts.bitrate || "192k",
        "-metadata:s:a:1", "language=tur",
        "-metadata:s:a:1", "title=" + (opts.title || "Türkçe (KomanMovie)"),
        outFile,
    ];
    // -c copy tum izlere uygulanir; yeni ses izi icin -c:a:1 aac onu ezer.
    await run("ffmpeg", args);
    return outFile;
}

module.exports = {
    resolveTrAudioSource, downloadAudio, decodePcm, probeDuration, measureSync, muxDub,
    probeSourceFps, snapFps, prepareCorrectedAudio, pruneCache, SR,
};
