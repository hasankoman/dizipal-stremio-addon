import React, { useEffect, useState } from "react";
import { getWatchLaterItems, removeWatchLaterItem } from "./watchLater";
import "./WatchLaterRow.css";

function WatchLaterRow({ onSelect, onNavigate, refreshKey }) {
    const [items, setItems] = useState([]);

    useEffect(() => {
        setItems(getWatchLaterItems(20));
    }, [refreshKey]);

    if (items.length === 0) return null;

    function handleRemove(event, contentId) {
        event.stopPropagation();
        removeWatchLaterItem(contentId);
        setItems(getWatchLaterItems(20));
    }

    function handleOpen(item) {
        onSelect({
            id: item.id,
            title: item.title,
            poster: item.poster,
            type: item.type,
        });
    }

    return (
        <div className="row wl_row">
            <div className="row_header">
                <h2>Daha Sonra Izle</h2>
                {onNavigate && (
                    <button className="row_see_all" onClick={onNavigate}>
                        <span>Tumunu Gor</span>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
                            <line x1="2" y1="7" x2="12" y2="7" />
                            <polyline points="8,3 12,7 8,11" />
                        </svg>
                    </button>
                )}
            </div>
            <div className="row_thumbnails">
                {items.map((item) => {
                    const typeLabel = item.type === "series" ? "Dizi" : "Film";

                    return (
                        <div
                            key={item.id}
                            className="row_card wl_card"
                            onClick={() => handleOpen(item)}
                        >
                            <div className="row_card_img">
                                <img
                                    className="row_thumbnail"
                                    src={item.poster}
                                    alt={item.title}
                                    onError={(event) => {
                                        event.target.src = "https://via.placeholder.com/200x300?text=No+Image";
                                    }}
                                />
                                <button
                                    className="wl_remove"
                                    onClick={(event) => handleRemove(event, item.id)}
                                    aria-label="Listeden kaldir"
                                >
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                                        <line x1="2" y1="2" x2="10" y2="10" />
                                        <line x1="10" y1="2" x2="2" y2="10" />
                                    </svg>
                                </button>
                                <div className="wl_overlay">
                                    <span className="wl_meta">
                                        {typeLabel}
                                        {item.year ? ` / ${item.year}` : ""}
                                    </span>
                                    <span className="wl_title">{item.title}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default WatchLaterRow;
