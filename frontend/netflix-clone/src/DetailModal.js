import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "./axios";
import requests from "./requests";
import "./DetailModal.css";

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
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

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
        async function fetchDetail() {
            setLoading(true);
            try {
                const res = await axios.get(requests.detail(resolvedId));
                setDetail(res.data);

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

                if (parsedBolum) {
                    setActiveSeason(parsedBolum.season);
                    const eps = res.data?.episodes || [];
                    const target = eps.find(ep => ep.season === parsedBolum.season && ep.episode === parsedBolum.episode);
                    if (target && target.id) {
                        handlePlay(target.id);
                    }
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
        if (!video || !streamUrl) return;
        videoRef.current = video;

        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const url = streamUrl.proxy;
        console.log("[initPlayer] proxy URL:", url);

        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

        if (isSafari && video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = url;
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
                setStreamUrl({ embed: res.data.embedUrl });
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
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        setPlaying(false);
        setStreamUrl(null);
        setPlayerError(null);
    }

    const type = parsedBolum ? "series" : (content.type || (content.id?.includes("/dizi/") ? "series" : "movie"));

    return (
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
                                    allow="autoplay; encrypted-media"
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
                            <button className="modal_back_btn" onClick={handleStopPlaying} aria-label="Geri">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><line x1="14" y1="8" x2="2" y2="8"/><polyline points="7,2 2,8 7,14"/></svg>
                            </button>
                        </div>
                        {!streamUrl.embed && (
                            <div className="modal_alt_players">
                                {streamUrl.vlc && (
                                    <a href={streamUrl.vlc} className="modal_alt_btn">VLC</a>
                                )}
                                {streamUrl.infuse && (
                                    <a href={streamUrl.infuse} className="modal_alt_btn">Infuse</a>
                                )}
                                {streamUrl.direct && (
                                    <a href={streamUrl.direct} target="_blank" rel="noreferrer" className="modal_alt_btn">Safari</a>
                                )}
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
                                        {detail?.meta?.imdbRating > 0 && (
                                            <span className="modal_rating">IMDB {detail.meta.imdbRating}</span>
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
                                    <span className="modal_status">{tmdb.status}</span>
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
                                    {streamLoading ? "Yukleniyor..." : "Izle"}
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
                                                    {(seasons[activeSeason] || []).map((ep, i) => (
                                                        <button
                                                            key={ep.id || i}
                                                            className="modal_episode_btn"
                                                            onClick={() => handlePlay(ep.id)}
                                                            disabled={streamLoading}
                                                        >
                                                            <span className="ep_number">{ep.episode || i + 1}</span>
                                                            <span className="ep_title">{ep.title}</span>
                                                        </button>
                                                    ))}
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
    );
}

export default DetailModal;
