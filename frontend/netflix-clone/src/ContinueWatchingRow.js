import React, { useState, useEffect } from "react";
import { getContinueWatchingItems, removeWatchProgress, formatTime } from "./watchHistory";
import "./ContinueWatchingRow.css";

function ContinueWatchingRow({ onSelect, refreshKey }) {
    const [items, setItems] = useState([]);

    useEffect(() => {
        setItems(getContinueWatchingItems());
    }, [refreshKey]);

    if (items.length === 0) return null;

    function handleClick(item) {
        if (item.season && item.episode && item.parentId?.includes("/dizi/")) {
            const slug = item.parentId.replace("/dizi/", "");
            const bolumId = `/bolum/${slug}-${item.season}-sezon-${item.episode}-bolum`;
            onSelect({ id: bolumId, title: item.title, poster: item.poster });
        } else {
            onSelect({ id: item.parentId, title: item.title, poster: item.poster, autoPlay: true });
        }
    }

    function handleRemove(e, streamPath) {
        e.stopPropagation();
        removeWatchProgress(streamPath);
        setItems(getContinueWatchingItems());
    }

    return (
        <div className="row cw_row">
            <div className="row_header">
                <h2>Kaldığın Yerden Devam Et</h2>
            </div>
            <div className="row_thumbnails">
                {items.map((item) => {
                    const progress = item.duration > 0 ? (item.currentTime / item.duration) * 100 : 0;
                    const remaining = Math.max(0, item.duration - item.currentTime);
                    return (
                        <div
                            key={item.streamPath}
                            className="row_card cw_card"
                            onClick={() => handleClick(item)}
                        >
                            <div className="row_card_img">
                                <img
                                    className="row_thumbnail"
                                    src={item.poster}
                                    alt={item.title}
                                    onError={(e) => { e.target.src = "https://via.placeholder.com/200x300?text=No+Image"; }}
                                />
                                {item.season && item.episode && (
                                    <span className="row_card_badge">S{item.season}B{item.episode}</span>
                                )}
                                <button
                                    className="cw_remove"
                                    onClick={(e) => handleRemove(e, item.streamPath)}
                                    aria-label="Kaldir"
                                >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                                        <line x1="2" y1="2" x2="10" y2="10" />
                                        <line x1="10" y1="2" x2="2" y2="10" />
                                    </svg>
                                </button>
                                <div className="cw_overlay">
                                    <span className="cw_remaining">{formatTime(remaining)} kaldi</span>
                                </div>
                                <div className="cw_progress_bar">
                                    <div className="cw_progress_fill" style={{ width: `${progress}%` }} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default ContinueWatchingRow;
