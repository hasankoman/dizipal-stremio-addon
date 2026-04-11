const STORAGE_KEY = 'komanmovie_watchHistory';

export function getWatchHistory() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

export function getWatchProgress(contentId) {
    return getWatchHistory()[contentId] || null;
}

export function saveWatchProgress(contentId, data) {
    const history = getWatchHistory();
    history[contentId] = {
        ...history[contentId],
        ...data,
        updatedAt: Date.now(),
    };
    const entries = Object.entries(history);
    if (entries.length > 100) {
        entries.sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
        entries.slice(0, entries.length - 100).forEach(([key]) => delete history[key]);
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
        // localStorage full — ignore
    }
}

export function removeWatchProgress(contentId) {
    const history = getWatchHistory();
    delete history[contentId];
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
        // ignore
    }
}

export function getContinueWatchingItems(limit = 20) {
    const history = getWatchHistory();
    const filtered = Object.entries(history)
        .filter(([, data]) => {
            if (!data.title) return false;
            if (data.nextUp && (!data.duration || data.currentTime === 0)) return true;
            if (!data.duration || !isFinite(data.duration) || !isFinite(data.currentTime)) return false;
            const progress = data.currentTime / data.duration;
            return progress > 0.02 && progress < 0.95;
        })
        .map(([id, data]) => ({ streamPath: id, ...data }));

    // Deduplicate by parentId: keep the furthest-ahead episode per series
    const deduped = {};
    for (const item of filtered) {
        const key = item.parentId || item.streamPath;
        if (!deduped[key]) {
            deduped[key] = item;
        } else {
            const existingPos = (deduped[key].season || 0) * 10000 + (deduped[key].episode || 0);
            const newPos = (item.season || 0) * 10000 + (item.episode || 0);
            if (newPos > existingPos) {
                deduped[key] = item;
            }
        }
    }

    return Object.values(deduped)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
}

export function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
