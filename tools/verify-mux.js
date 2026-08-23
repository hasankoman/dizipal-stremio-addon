#!/usr/bin/env node
// Mux edilmis dosyanin ICINDEKI iki sesi karsilastirir: referans iz (orijinal
// dil) ve eklenen Turkce iz. Dogru hizalanmissa aradaki gecikme ~0 olmalidir.
//
// Olcumun ne dedigi degil, DOSYANIN kendisi kontrol edilir. Hizalama dogru
// olculup mux'a yanlis yansirsa (ornegin negatif gecikmenin sessizce yok
// sayilmasi) yalnizca bu kontrol yakalar.
//
// Kullanim:
//   node tools/verify-mux.js "<dosya.mkv>" [referansDil] [hedefDil]
//   varsayilan diller: eng, tur

const { execFile } = require("child_process");

const SR = 8000, ENV_HZ = 50;
const FILE = process.argv[2];
const REF_LANG = (process.argv[3] || "eng").toLowerCase();
const DUB_LANG = (process.argv[4] || "tur").toLowerCase();

if (!FILE) {
    console.log('kullanim: node tools/verify-mux.js "<dosya.mkv>" [referansDil] [hedefDil]');
    process.exit(1);
}

function run(cmd, args, binary) {
    return new Promise((res, rej) => {
        execFile(cmd, args, { maxBuffer: 1 << 30, encoding: binary ? "buffer" : "utf8" },
            (e, so) => (e ? rej(e) : res(so)));
    });
}

// Dil etiketine gore ses izlerinin mutlak stream indeksini bulur.
async function findAudio(file) {
    const out = await run("ffprobe", ["-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index:stream_tags=language", "-of", "csv=p=0", file]);
    const map = {};
    out.trim().split("\n").filter(Boolean).forEach((line) => {
        const [idx, lang] = line.split(",");
        const k = (lang || "und").toLowerCase();
        if (map[k] === undefined) map[k] = parseInt(idx, 10);
    });
    return map;
}

async function decode(file, streamIdx) {
    const buf = await run("ffmpeg", ["-v", "error", "-i", file, "-vn", "-sn",
        "-map", "0:" + streamIdx, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], true);
    const out = new Float32Array(buf.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
    return out;
}

function envelope(pcm) {
    const step = Math.round(SR / ENV_HZ), n = Math.floor(pcm.length / step);
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = i * step; j < (i + 1) * step; j++) s += pcm[j] * pcm[j];
        e[i] = Math.sqrt(s / step);
    }
    return e;
}

// ed[d0..d0+win] penceresini er icinde arar; donen deger saniye cinsinden kayma.
function bestOffset(er, ed, d0, win, search) {
    const seg = ed.slice(d0, d0 + win);
    let m = 0; for (const v of seg) m += v; m /= seg.length;
    let ss = 0; for (let i = 0; i < seg.length; i++) { seg[i] -= m; ss += seg[i] * seg[i]; }
    ss = Math.sqrt(ss) || 1e-9;
    let best = { off: 0, score: -1 };
    for (let lag = -search; lag <= search; lag++) {
        const st = d0 + lag;
        if (st < 0 || st + win >= er.length) continue;
        let mr = 0; for (let i = 0; i < win; i++) mr += er[st + i]; mr /= win;
        let dot = 0, rr = 0;
        for (let i = 0; i < win; i++) { const rv = er[st + i] - mr; dot += seg[i] * rv; rr += rv * rv; }
        const sc = dot / (ss * (Math.sqrt(rr) || 1e-9));
        if (sc > best.score) best = { off: lag / ENV_HZ, score: sc };
    }
    return best;
}

(async () => {
    const map = await findAudio(FILE);
    const refIdx = map[REF_LANG], dubIdx = map[DUB_LANG];
    if (refIdx === undefined || dubIdx === undefined) {
        console.log(`ses izi bulunamadi (${REF_LANG}/${DUB_LANG}). Mevcut: ` + JSON.stringify(map));
        process.exit(1);
    }
    console.log(`${REF_LANG}=stream ${refIdx}   ${DUB_LANG}=stream ${dubIdx}   cozuluyor...`);
    const ref = await decode(FILE, refIdx);
    const dub = await decode(FILE, dubIdx);
    console.log(`  ${REF_LANG}: ${(ref.length / SR / 60).toFixed(2)} dk   ${DUB_LANG}: ${(dub.length / SR / 60).toFixed(2)} dk\n`);

    const er = envelope(ref), ed = envelope(dub);
    const win = 40 * ENV_HZ, search = 30 * ENV_HZ;
    console.log("zaman  |  kayma   | skor");
    console.log("-------+----------+------");
    const offs = [];
    for (let t = 60; t + 40 < dub.length / SR - 60; t += 300) {
        const r = bestOffset(er, ed, t * ENV_HZ, win, search);
        const mm = String(Math.floor(t / 60)).padStart(2, "0");
        console.log(`  ${mm}:00 | ${r.off >= 0 ? "+" : "-"}${Math.abs(r.off).toFixed(2).padStart(6)} s | ${r.score.toFixed(3)}`
            + (r.score <= 0.45 ? "  (zayif)" : ""));
        if (r.score > 0.45) offs.push(r.off);
    }
    if (!offs.length) { console.log("\nguvenilir olcum yok."); process.exit(1); }

    offs.sort((a, b) => a - b);
    const med = offs[offs.length >> 1];
    const spread = offs[offs.length - 1] - offs[0];
    console.log(`\nmedyan kayma: ${med >= 0 ? "+" : "-"}${Math.abs(med).toFixed(3)} s   yayilim: ${spread.toFixed(3)} s   (${offs.length} nokta)`);
    if (Math.abs(med) < 0.15) console.log(">>> MUX DOGRU: izler hizali.");
    else console.log(`>>> MUX HATALI: ${DUB_LANG} izi ${med > 0 ? "GEC" : "ERKEN"} ${Math.abs(med).toFixed(2)} s.`);
    process.exit(Math.abs(med) < 0.15 ? 0 : 1);
})();
