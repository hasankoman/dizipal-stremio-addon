const STORAGE_KEY = "komanmovie_watchLater";

function readWatchLaterMap() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function writeWatchLaterMap(items) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
        // ignore write errors
    }
}

function inferType(item) {
    if (item?.type) return item.type;

    const id = item?.id || "";
    if (id.includes("/dizi/") || id.includes(":series:")) {
        return "series";
    }

    return "movie";
}

export function getWatchLaterMap() {
    return readWatchLaterMap();
}

export function getWatchLaterItems(limit = 50) {
    return Object.values(readWatchLaterMap())
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .slice(0, limit);
}

export function isInWatchLater(contentId) {
    if (!contentId) return false;
    return Boolean(readWatchLaterMap()[contentId]);
}

export function saveWatchLaterItem(item) {
    if (!item?.id) return false;

    const watchLaterMap = readWatchLaterMap();
    watchLaterMap[item.id] = {
        ...watchLaterMap[item.id],
        ...item,
        type: inferType(item),
        addedAt: Date.now(),
    };

    const entries = Object.entries(watchLaterMap);
    if (entries.length > 100) {
        entries
            .sort(([, a], [, b]) => (a.addedAt || 0) - (b.addedAt || 0))
            .slice(0, entries.length - 100)
            .forEach(([key]) => delete watchLaterMap[key]);
    }

    writeWatchLaterMap(watchLaterMap);
    return true;
}

export function removeWatchLaterItem(contentId) {
    if (!contentId) return;

    const watchLaterMap = readWatchLaterMap();
    delete watchLaterMap[contentId];
    writeWatchLaterMap(watchLaterMap);
}

export function toggleWatchLaterItem(item) {
    if (!item?.id) return false;

    if (isInWatchLater(item.id)) {
        removeWatchLaterItem(item.id);
        return false;
    }

    saveWatchLaterItem(item);
    return true;
}
