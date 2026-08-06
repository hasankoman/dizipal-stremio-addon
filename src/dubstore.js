// tools/dubsync.js ile olculen senkron sonuclarinin kalici deposu.
//
// Anahtar, dizipal icerik yoludur (ör. /bolum/lioness-2-sezon-1-bolum): istemci
// IMDB id ile gelse de endpoint onu zaten bu yola cozuyor, boylece CLI'in ayrica
// IMDB id bilmesi gerekmiyor.
//
// Hiz orani kaynak/hedef fps'ten deterministik olarak hesaplanabiliyor; burada
// saklanan asil deger OFFSET: dizipal surumunun basindan ne kadar kirpildigi
// olcum yapilmadan bilinemez. Kayit, olcumun yapildigi dosyanin suresini de
// tutar — istemci baska bir surum oynatiyorsa (farkli kirpma) gecikme
// uygulanmaz, yanlis degeri uygulamaktansa hic uygulamamak yeglenir.

const fs = require("fs");
const path = require("path");

// Konteynerde uygulama dizini her yeniden derlemede sifirlanir; olculen
// gecikmeler tek yeniden uretilemeyen veri oldugu icin kalici bir birime
// tasinabilmeli. DUBSYNC_STORE verilmezse repo koku kullanilir (yerel calisma).
const STORE_FILE = process.env.DUBSYNC_STORE || path.join(__dirname, "..", ".dubsync-store.json");
const DURATION_TOLERANCE = 2.0; // saniye

function readAll() {
    try {
        return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    } catch (e) {
        return {};
    }
}

function writeAll(data) {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.log("[dubstore] yazilamadi:", e.message);
        return false;
    }
}

function put(contentPath, entry) {
    var all = readAll();
    all[contentPath] = Object.assign({}, all[contentPath], entry);
    return writeAll(all);
}

function get(contentPath) {
    return readAll()[contentPath] || null;
}

// Istemcinin oynattigi dosya, olcumun yapildigi dosyayla ayni surum mu?
// refDuration yoksa dogrulanamaz; bu durumda kayit "dogrulanmamis" sayilir.
function matches(entry, targetDuration) {
    if (!entry || entry.delayMs == null) return false;
    if (!targetDuration || !entry.refDuration) return false;
    return Math.abs(targetDuration - entry.refDuration) <= DURATION_TOLERANCE;
}

module.exports = { get, put, matches, STORE_FILE, DURATION_TOLERANCE };
