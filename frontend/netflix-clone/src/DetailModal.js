import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "./axios";
import requests from "./requests";
import "./DetailModal.css";
import { getWatchProgress, saveWatchProgress, formatTime } from "./watchHistory";
import DownloadPage from "./DownloadPage";

function DetailModal({ content, onClose }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [streamLoading, setStreamLoading] = useState(false);
    const [streamUrl, setStreamUrl] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [activeSeason, setActiveSeason] = useState(1);
    const [playerError, setPlayerError] = useState(null);
    const [trailerUrl, setTrailerUrl] = useState(null);
    const [trailerLoading, setTrailerLoading] = useState(true);
    const [tmdb, setTmdb] = useState(null);
    const [playingEpisodeId, setPlayingEpisodeId] = useState(null);
    const [showNextPrompt, setShowNextPrompt] = useState(false);
    const [nextCountdown, setNextCountdown] = useState(0);
    const [downloadInfo, setDownloadInfo] = useState(null);
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const playingPathRef = useRef(null);
    const contentInfoRef = useRef({});
    const cleanupListenersRef = useRef(null);
    const nextEpisodeIdRef = useRef(null);

    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    // Parse bolum path: /bolum/for-all-mankind-5-sezon-3-bolum → /dizi/for-all-mankind, season 5
    const parsedBolum = useMemo(() => {
        if (!content.id?.includes("/bolum/")) return null;
        const slug = content.id.replace("/bolum/", "");
        const match = slug.match(/^(.+?)-(\d+)-sezon-(\d+)-bolum$/);
        if (match) return { diziId: "/dizi/" + match[1], season: parseInt(match[2]), episode: parseInt(match[3]) };
        return null;
    }, [content.id]);

    const resolvedId = parsedBolum ? parsedBolum.diziId : content.id;

    useEffect(() => {
        contentInfoRef.current = {
            ...contentInfoRef.current,
            title: detail?.meta?.name || content.title,
            poster: content.poster,
            parentId: resolvedId,
        };
    }, [detail, content, resolvedId]);

    useEffect(() => {
        async function fetchDetail() {
            setLoading(true);
            try {
                const res = await axios.get(requests.detail(resolvedId));
                setDetail(res.data);

                // TMDB/Custom content ise trailer detail'den gelir
                const isTmdbContent = resolvedId.includes("tmdb:") || resolvedId.includes("custom:");
                if (isTmdbContent && res.data?.trailer) {
                    if (res.data.trailer.url) setTrailerUrl(res.data.trailer.url);
                    if (res.data.trailer.tmdb) setTmdb(res.data.trailer.tmdb);
                    setTrailerLoading(false);
                } else {
                    // Fetch trailer from TMDB
                    const name = res.data?.meta?.name;
                    const contentType = resolvedId.includes("/dizi/") ? "series" : "movie";
                    if (name) {
                        axios.get(requests.trailer(name, contentType))
                            .then(r => {
                                if (r.data.url) setTrailerUrl(r.data.url);
                                if (r.data.tmdb) setTmdb(r.data.tmdb);
                            })
                            .catch(() => {})
                            .finally(() => setTrailerLoading(false));
                    } else {
                        setTrailerLoading(false);
                    }
                }

                if (parsedBolum) {
                    setActiveSeason(parsedBolum.season);
                    const eps = res.data?.episodes || [];
                    const target = eps.find(ep => ep.season === parsedBolum.season && ep.episode === parsedBolum.episode);
                    if (target && target.id) {
                        handlePlay(target.id);
                    }
                } else if (content.autoPlay) {
                    handlePlay(content.id);
                }
            } catch (err) {
                console.log(err);
            }
            setLoading(false);
        }
        fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedId, parsedBolum]);

    const initPlayer = useCallback((video) => {
        console.log("[initPlayer] called, video:", !!video, "streamUrl:", !!streamUrl);
        if (!video) {
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
            return;
        }
        if (!streamUrl) return;
        videoRef.current = video;

        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const url = streamUrl.proxy;
        console.log("[initPlayer] proxy URL:", url);

        // Cleanup previous listeners to prevent accumulation on episode switch
        if (cleanupListenersRef.current) {
            cleanupListenersRef.current();
            cleanupListenersRef.current = null;
        }

        const currentPath = playingPathRef.current;
        const saved = currentPath ? getWatchProgress(currentPath) : null;

        // Watch progress tracking
        if (currentPath) {
            let cancelled = false;
            let lastSaveTime = 0;
            const saveProgress = () => {
                if (cancelled) return;
                if (video.currentTime > 0 && isFinite(video.duration) && video.duration > 0) {
                    saveWatchProgress(currentPath, {
                        currentTime: video.currentTime,
                        duration: video.duration,
                        ...contentInfoRef.current,
                    });
                }
            };
            const onTimeUpdate = () => {
                const now = Date.now();
                if (now - lastSaveTime < 5000) return;
                lastSaveTime = now;
                saveProgress();
            };
            const onPause = saveProgress;
            const onEnded = () => {
                if (cancelled) return;
                if (isFinite(video.duration) && video.duration > 0) {
                    saveWatchProgress(currentPath, {
                        currentTime: video.duration,
                        duration: video.duration,
                        ...contentInfoRef.current,
                    });
                }
                const nextId = nextEpisodeIdRef.current;
                if (nextId) setShowNextPrompt(true);
            };
            video.addEventListener('timeupdate', onTimeUpdate);
            video.addEventListener('pause', onPause);
            video.addEventListener('ended', onEnded);
            cleanupListenersRef.current = () => {
                cancelled = true;
                video.removeEventListener('timeupdate', onTimeUpdate);
                video.removeEventListener('pause', onPause);
                video.removeEventListener('ended', onEnded);
            };
        }

        // Resume from saved position
        const resumePosition = () => {
            if (saved && saved.currentTime > 5 && saved.duration > 0) {
                const progress = saved.currentTime / saved.duration;
                if (progress < 0.95) {
                    video.currentTime = saved.currentTime;
                }
            }
        };

        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

        if (isSafari && video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = url;
            video.addEventListener('loadedmetadata', resumePosition, { once: true });
            video.play().catch((e) => console.error("[initPlayer] native play error:", e));
            return;
        }

        if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                fragLoadingMaxRetry: 5,
                fragLoadingRetryDelay: 1000,
                manifestLoadingMaxRetry: 3,
                levelLoadingMaxRetry: 3,
            });
            hlsRef.current = hls;
            let recoverAttempts = 0;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                resumePosition();
                video.play().catch((e) => console.error("[initPlayer] play() error:", e));
            });
            hls.on(window.Hls.Events.ERROR, (event, data) => {
                console.error("[initPlayer] HLS ERROR:", data);
                if (data.fatal) {
                    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && recoverAttempts < 3) {
                        recoverAttempts++;
                        console.log("[initPlayer] Network error, retrying... attempt", recoverAttempts);
                        hls.startLoad();
                    } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && recoverAttempts < 3) {
                        recoverAttempts++;
                        console.log("[initPlayer] Media error, recovering... attempt", recoverAttempts);
                        hls.recoverMediaError();
                    } else {
                        setPlayerError("Video yuklenemedi: " + data.details + (data.response?.code ? ` (HTTP ${data.response.code})` : ""));
                    }
                }
            });
        } else {
            setPlayerError("Tarayiciniz HLS desteklemiyor. Infuse veya VLC ile deneyin.");
        }
    }, [streamUrl]);

    useEffect(() => {
        return () => {
            if (cleanupListenersRef.current) cleanupListenersRef.current();
            if (videoRef.current && playingPathRef.current) {
                const video = videoRef.current;
                if (video.currentTime > 0 && isFinite(video.duration) && video.duration > 0) {
                    saveWatchProgress(playingPathRef.current, {
                        currentTime: video.currentTime,
                        duration: video.duration,
                        ...contentInfoRef.current,
                    });
                }
            }
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, []);

    function loadHlsScript() {
        return new Promise((resolve) => {
            if (window.Hls) { resolve(); return; }
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17";
            script.onload = () => resolve();
            script.onerror = () => {
                setPlayerError("HLS.js yuklenemedi.");
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    async function handlePlay(path) {
        setShowNextPrompt(false);
        playingPathRef.current = path;
        setPlayingEpisodeId(path);
        videoRef.current = null;
        if (cleanupListenersRef.current) {
            cleanupListenersRef.current();
            cleanupListenersRef.current = null;
        }
        if (detail?.episodes) {
            const ep = detail.episodes.find(e => e.id === path);
            if (ep) {
                contentInfoRef.current = { ...contentInfoRef.current, season: ep.season, episode: ep.episode };
                setActiveSeason(ep.season);
            } else {
                const { season, episode, ...rest } = contentInfoRef.current;
                contentInfoRef.current = rest;
            }
        }
        setStreamLoading(true);
        setPlayerError(null);
        setStreamUrl(null);
        setPlaying(false);
        try {
            const res = await axios.get(requests.stream(path));
            if (res.data && res.data.url) {
                const proxyUrl = res.data.url;
                const infuseUrl = `infuse://x-callback-url/play?url=${encodeURIComponent(proxyUrl)}`;
                const vlcUrl = `vlc://${proxyUrl}`;
                const urls = { proxy: proxyUrl, infuse: infuseUrl, vlc: vlcUrl, direct: proxyUrl };
                await loadHlsScript();
                setStreamUrl(urls);
                setPlaying(true);
            } else if (res.data && res.data.embedUrl) {
                setStreamUrl({ embed: res.data.embedUrl, sources: res.data.sources || null });
                setPlaying(true);
            } else {
                setPlayerError("Stream URL bulunamadi.");
            }
        } catch (err) {
            setPlayerError("Stream yuklenemedi: " + (err.response?.status || err.message));
        }
        setStreamLoading(false);
    }

    function handleStopPlaying() {
        setShowNextPrompt(false);
        if (cleanupListenersRef.current) {
            cleanupListenersRef.current();
            cleanupListenersRef.current = null;
        }
        if (videoRef.current && playingPathRef.current) {
            const video = videoRef.current;
            if (video.currentTime > 0 && isFinite(video.duration) && video.duration > 0) {
                saveWatchProgress(playingPathRef.current, {
                    currentTime: video.currentTime,
                    duration: video.duration,
                    ...contentInfoRef.current,
                });
            }
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        playingPathRef.current = null;
        setPlayingEpisodeId(null);
        setPlaying(false);
        setStreamUrl(null);
        setPlayerError(null);
    }

    const type = parsedBolum ? "series" : (content.type || (content.id?.includes("/dizi/") || content.id?.includes(":series:") ? "series" : "movie"));

    const currentEpisodeNav = useMemo(() => {
        if (!playingEpisodeId || !detail?.episodes?.length) return { prev: null, next: null, current: null };
        const allEpisodes = [...detail.episodes].sort((a, b) => {
            if ((a.season || 1) !== (b.season || 1)) return (a.season || 1) - (b.season || 1);
            return (a.episode || 0) - (b.episode || 0);
        });
        const idx = allEpisodes.findIndex(ep => ep.id === playingEpisodeId);
        if (idx === -1) return { prev: null, next: null, current: null };
        return {
            prev: idx > 0 ? allEpisodes[idx - 1] : null,
            next: idx < allEpisodes.length - 1 ? allEpisodes[idx + 1] : null,
            current: allEpisodes[idx],
        };
    }, [playingEpisodeId, detail]);

    useEffect(() => {
        nextEpisodeIdRef.current = currentEpisodeNav.next?.id || null;
    }, [currentEpisodeNav]);

    // Countdown timer for next episode prompt
    useEffect(() => {
        if (!showNextPrompt) return;
        setNextCountdown(10);
        const interval = setInterval(() => {
            setNextCountdown(c => {
                if (c <= 1) { clearInterval(interval); return 0; }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [showNextPrompt]);

    // Auto-play when countdown expires
    useEffect(() => {
        if (nextCountdown === 0 && showNextPrompt && currentEpisodeNav.next) {
            setShowNextPrompt(false);
            handlePlay(currentEpisodeNav.next.id);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nextCountdown]);

    function handleDownload(path, title) {
        setDownloadInfo({ path, title: title || contentInfoRef.current.title });
    }

    const movieProgress = type === "movie" ? getWatchProgress(content.id) : null;
    const movieHasProgress = movieProgress && movieProgress.duration > 0 &&
        (movieProgress.currentTime / movieProgress.duration) > 0.02 &&
        (movieProgress.currentTime / movieProgress.duration) < 0.95;

    return (
        <>
        {downloadInfo && (
            <DownloadPage
                path={downloadInfo.path}
                contentTitle={downloadInfo.title}
                onClose={() => setDownloadInfo(null)}
            />
        )}
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                {playing && streamUrl ? (
                    <div className="modal_player_page">
                        <div className="modal_player">
                            {streamUrl.embed ? (
                                <iframe
                                    src={streamUrl.embed}
                                    title="Player"
                                    className="modal_embed"
                                    allowFullScreen
                                    allow="autoplay; encrypted-media; fullscreen"
                                    referrerPolicy="origin"
                                />
                            ) : (
                                <video
                                    ref={initPlayer}
                                    controls
                                    autoPlay
                                    playsInline
                                    className="modal_video"
                                />
                            )}
                            {playerError && (
                                <div className="modal_player_error">{playerError}</div>
                            )}
                            <button className={`modal_back_btn${streamUrl.embed?.includes("multiembed") ? " modal_back_btn_multi" : ""}`} onClick={handleStopPlaying} aria-label="Geri">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><line x1="14" y1="8" x2="2" y2="8"/><polyline points="7,2 2,8 7,14"/></svg>
                            </button>
                            {showNextPrompt && currentEpisodeNav.next && (
                                <div className="modal_next_overlay">
                                    <div className="modal_next_box">
                                        <span className="modal_next_label">Sonraki Bolum</span>
                                        <span className="modal_next_ep">
                                            {currentEpisodeNav.next.season}. Sezon {currentEpisodeNav.next.episode}. Bolum
                                        </span>
                                        {currentEpisodeNav.next.title && (
                                            <span className="modal_next_title">{currentEpisodeNav.next.title}</span>
                                        )}
                                        <div className="modal_next_countdown_bar">
                                            <div className="modal_next_countdown_fill" key={showNextPrompt} />
                                        </div>
                                        <div className="modal_next_actions">
                                            <button
                                                className="modal_next_play"
                                                onClick={() => { setShowNextPrompt(false); handlePlay(currentEpisodeNav.next.id); }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><polygon points="2,0 14,7 2,14"/></svg>
                                                Sonraki ({nextCountdown})
                                            </button>
                                            <button
                                                className="modal_next_exit"
                                                onClick={() => {
                                                    const next = currentEpisodeNav.next;
                                                    if (next) {
                                                        saveWatchProgress(next.id, {
                                                            currentTime: 0,
                                                            duration: 0,
                                                            nextUp: true,
                                                            title: contentInfoRef.current.title,
                                                            poster: contentInfoRef.current.poster,
                                                            parentId: contentInfoRef.current.parentId,
                                                            season: next.season,
                                                            episode: next.episode,
                                                        });
                                                    }
                                                    setShowNextPrompt(false);
                                                    handleStopPlaying();
                                                }}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                                                Cik
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        {type === "series" && currentEpisodeNav.current && (
                            <div className="modal_ep_nav">
                                <button
                                    className="modal_ep_nav_btn"
                                    onClick={() => handlePlay(currentEpisodeNav.prev.id)}
                                    disabled={!currentEpisodeNav.prev || streamLoading}
                                >
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="12" y1="7" x2="2" y2="7"/><polyline points="6,2 2,7 6,12"/></svg>
                                    Onceki
                                </button>
                                <span className="modal_ep_nav_info">
                                    {currentEpisodeNav.current.season}. Sezon {currentEpisodeNav.current.episode}. Bolum
                                </span>
                                <button
                                    className="modal_ep_nav_btn"
                                    onClick={() => handlePlay(currentEpisodeNav.next.id)}
                                    disabled={!currentEpisodeNav.next || streamLoading}
                                >
                                    Sonraki
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="8,2 12,7 8,12"/></svg>
                                </button>
                            </div>
                        )}
                        {streamUrl.sources && streamUrl.sources.length > 1 && (
                            <div className="modal_source_selector">
                                <label className="modal_source_label">Kaynak:</label>
                                <select
                                    className="modal_source_dropdown"
                                    value={streamUrl.embed}
                                    onChange={(e) => setStreamUrl({ ...streamUrl, embed: e.target.value })}
                                >
                                    {streamUrl.sources.map((s) => (
                                        <option key={s.name} value={s.url}>
                                            {s.name}{s.hasTurkishSub ? " (TR Altyazı)" : ""}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {streamUrl.sources && (
                            <div className="modal_ublock_bar">
                                <p className="modal_ublock_sub">Türkçe altyazı player içindeki ayarlardan seçilebilir.</p>
                                <p className="modal_ublock_text">Reklamlar video kaynaklarından gelmektedir ve tarafımızca engellenememektedir. Reklamsız bir deneyim için uBlock Origin eklentisini yükleyin.</p>
                                <a
                                    href="https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="modal_ublock_btn"
                                >
                                    uBlock Origin Y&#252;kle
                                </a>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="modal_banner">
                            {trailerUrl ? (
                                <iframe
                                    src={trailerUrl}
                                    title="Fragman"
                                    className="modal_banner_trailer"
                                    allowFullScreen
                                    allow="encrypted-media"
                                    referrerPolicy="origin"
                                />
                            ) : (
                                <div
                                    className="modal_banner_bg"
                                    style={{
                                        backgroundImage: detail?.meta?.background
                                            ? `url(${detail.meta.background})`
                                            : `url(${content.poster})`,
                                    }}
                                />
                            )}
                            <button className="modal_close" onClick={onClose} aria-label="Kapat">
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><line x1="2" y1="2" x2="16" y2="16"/><line x1="16" y1="2" x2="2" y2="16"/></svg>
                            </button>
                            {!trailerUrl && (
                                <div className="modal_banner_overlay">
                                    <div className="modal_banner_meta">
                                        {tmdb?.tmdbRating && (
                                            <span className="modal_rating">TMDB {tmdb.tmdbRating}</span>
                                        )}
                                        {(tmdb?.releaseDate || detail?.meta?.releaseInfo) && (
                                            <span className="modal_year">{tmdb?.releaseDate ? tmdb.releaseDate.substring(0, 4) : detail.meta.releaseInfo}</span>
                                        )}
                                        {trailerLoading ? (
                                            <span className="modal_trailer_loading"><span className="spinner" /></span>
                                        ) : (
                                            <a
                                                className="modal_yt_btn"
                                                href={`https://www.youtube.com/results?search_query=${encodeURIComponent((detail?.meta?.name || content.title) + " resmi fragman trailer")}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                YouTube'da Fragman Bul
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal_info">
                            <h1 className="modal_title">
                                {detail?.meta?.name || content.title}
                            </h1>
                            <div className="modal_meta_row">
                                {tmdb?.tmdbRating && (
                                    <span className="modal_rating">TMDB {tmdb.tmdbRating}</span>
                                )}
                                {detail?.meta?.imdbRating > 0 && (
                                    <span className="modal_rating">IMDB {detail.meta.imdbRating}</span>
                                )}
                                {tmdb?.releaseDate && (
                                    <span className="modal_year">{tmdb.releaseDate.substring(0, 4)}</span>
                                )}
                                {!tmdb?.releaseDate && detail?.meta?.releaseInfo && (
                                    <span className="modal_year">{detail.meta.releaseInfo}</span>
                                )}
                                {tmdb?.runtime && (
                                    <span className="modal_runtime">{Math.floor(tmdb.runtime / 60)}s {tmdb.runtime % 60}dk</span>
                                )}
                                {tmdb?.seasonCount && (
                                    <span className="modal_runtime">{tmdb.seasonCount} Sezon</span>
                                )}
                                {tmdb?.status && (
                                    <span className="modal_status">{{
                                        "Returning Series": "Devam Ediyor",
                                        "Ended": "Final",
                                        "Canceled": "İptal",
                                        "In Production": "Yapımda",
                                        "Planned": "Planlanıyor",
                                        "Released": "Yayında",
                                        "Post Production": "Post Prodüksiyon",
                                        "Rumored": "Söylenti",
                                    }[tmdb.status] || tmdb.status}</span>
                                )}
                            </div>
                            {tmdb?.genres?.length > 0 && (
                                <div className="modal_genres">
                                    {tmdb.genres.map((g, i) => (
                                        <span key={i} className="modal_genre_tag">{g}</span>
                                    ))}
                                </div>
                            )}
                            {(tmdb?.overview || detail?.meta?.description) && (
                                <p className="modal_description">
                                    {tmdb?.overview || detail.meta.description}
                                </p>
                            )}
                            {tmdb?.cast?.length > 0 && (
                                <div className="modal_cast_section">
                                    <span className="modal_cast_label">Oyuncular</span>
                                    <div className="modal_cast_list">
                                        {tmdb.cast.map((c, i) => (
                                            <div key={i} className="modal_cast_card">
                                                {c.photo ? (
                                                    <img className="modal_cast_photo" src={c.photo} alt={c.name} />
                                                ) : (
                                                    <div className="modal_cast_photo modal_cast_no_photo" />
                                                )}
                                                <span className="modal_cast_name">{c.name}</span>
                                                {c.character && <span className="modal_cast_char">{c.character}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {tmdb?.director?.length > 0 && (
                                <div className="modal_director">
                                    <span className="modal_cast_label">{type === "movie" ? "Y\u00f6netmen:" : "Yarat\u0131c\u0131:"}</span>
                                    <span className="modal_cast_names">{tmdb.director.join(", ")}</span>
                                </div>
                            )}
                        </div>

                        {loading ? (
                            <div className="modal_loading">Yukleniyor...</div>
                        ) : type === "movie" ? (
                            <div className="modal_actions">
                                <button
                                    className="modal_play_main"
                                    onClick={() => handlePlay(content.id)}
                                    disabled={streamLoading}
                                >
                                    {streamLoading ? "Yukleniyor..." : movieHasProgress ? `Devam Et — ${formatTime(movieProgress.currentTime)}` : "Izle"}
                                </button>
                                <button
                                    className="modal_download_btn"
                                    onClick={() => handleDownload(content.id, detail?.meta?.name || content.title)}
                                    disabled={streamLoading}
                                >
                                    {"Indir"}
                                </button>
                            </div>
                        ) : (
                            <div className="modal_episodes">
                                {detail?.episodes?.length > 0 ? (
                                    (() => {
                                        const seasons = {};
                                        detail.episodes.forEach((ep) => {
                                            const s = ep.season || 1;
                                            if (!seasons[s]) seasons[s] = [];
                                            seasons[s].push(ep);
                                        });
                                        const seasonKeys = Object.keys(seasons);
                                        return (
                                            <>
                                                <div className="season_tabs">
                                                    {seasonKeys.map((s) => (
                                                        <button
                                                            key={s}
                                                            className={`season_tab ${Number(s) === activeSeason ? "active" : ""}`}
                                                            onClick={() => setActiveSeason(Number(s))}
                                                        >
                                                            {s}. Sezon
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="modal_episode_list">
                                                    {(seasons[activeSeason] || []).map((ep, i) => {
                                                        const epProg = getWatchProgress(ep.id);
                                                        const epPct = epProg && epProg.duration > 0 ? (epProg.currentTime / epProg.duration) * 100 : 0;
                                                        return (
                                                            <div key={ep.id || i} className="modal_episode_row">
                                                                <button
                                                                    className="modal_episode_btn"
                                                                    onClick={() => handlePlay(ep.id)}
                                                                    disabled={streamLoading}
                                                                >
                                                                    <span className="ep_number">{ep.episode || i + 1}</span>
                                                                    <span className="ep_title">{ep.title}</span>
                                                                    {epPct > 2 && epPct < 95 && (
                                                                        <div className="ep_progress"><div className="ep_progress_fill" style={{ width: `${epPct}%` }} /></div>
                                                                    )}
                                                                </button>
                                                                <button
                                                                    className="modal_ep_download"
                                                                    onClick={() => handleDownload(ep.id, `${detail?.meta?.name || content.title} S${ep.season}E${ep.episode}`)}
                                                                    disabled={false}
                                                                    aria-label="Indir"
                                                                >
                                                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square"><line x1="7" y1="1" x2="7" y2="10"/><polyline points="3,7 7,11 11,7"/><line x1="2" y1="13" x2="12" y2="13"/></svg>
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        );
                                    })()
                                ) : (
                                    <p className="modal_no_episodes">Bolum bulunamadi.</p>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
        </>
    );
}

export default DetailModal;
