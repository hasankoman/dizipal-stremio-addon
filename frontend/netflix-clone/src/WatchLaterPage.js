import React, { useEffect, useState } from "react";
import { getWatchLaterItems, removeWatchLaterItem } from "./watchLater";
import "./WatchLaterPage.css";

function WatchLaterPage({ onSelect, onBack, refreshKey }) {
    const [items, setItems] = useState([]);

    useEffect(() => {
        setItems(getWatchLaterItems());
    }, [refreshKey]);

    function handleRemove(event, contentId) {
        event.stopPropagation();
        removeWatchLaterItem(contentId);
        setItems(getWatchLaterItems());
    }

    return (
        <div className="watchlater">
            <div className="watchlater_header">
                <button className="watchlater_back" onClick={onBack} aria-label="Ana sayfaya don">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                        <line x1="16" y1="9" x2="2" y2="9" />
                        <polyline points="8,2 2,9 8,16" />
                    </svg>
                </button>
                <div className="watchlater_heading">
                    <h1 className="watchlater_title">Daha Sonra Izle</h1>
                    <p className="watchlater_subtitle">
                        {items.length > 0
                            ? `${items.length} kayitli icerik seni bekliyor.`
                            : "Kaydettigin film ve dizileri burada bulursun."}
                    </p>
                </div>
            </div>

            {items.length === 0 ? (
                <div className="watchlater_empty">
                    <div className="watchlater_empty_badge">Liste Bos</div>
                    <h2>Henuz Kayitli Icerik Yok</h2>
                    <p>
                        Bir filmin ya da dizinin detay sayfasindan
                        "Daha Sonra Izle" butonuna basarak listeni olusturabilirsin.
                    </p>
                    <button className="watchlater_empty_action" onClick={onBack}>
                        Ana Sayfaya Don
                    </button>
                </div>
            ) : (
                <div className="watchlater_grid">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="watchlater_card"
                            onClick={() => onSelect({
                                id: item.id,
                                title: item.title,
                                poster: item.poster,
                                type: item.type,
                            })}
                        >
                            <div className="watchlater_poster_wrap">
                                <img
                                    className="watchlater_poster"
                                    src={item.poster}
                                    alt={item.title}
                                    onError={(event) => {
                                        event.target.src = "https://via.placeholder.com/200x300?text=No+Image";
                                    }}
                                />
                                <button
                                    className="watchlater_remove"
                                    onClick={(event) => handleRemove(event, item.id)}
                                    aria-label="Listeden kaldir"
                                >
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
                                        <line x1="2" y1="2" x2="12" y2="12" />
                                        <line x1="12" y1="2" x2="2" y2="12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="watchlater_card_body">
                                <div className="watchlater_card_meta">
                                    <span className="watchlater_badge">
                                        {item.type === "series" ? "Dizi" : "Film"}
                                    </span>
                                    {item.year && <span className="watchlater_year">{item.year}</span>}
                                </div>
                                <h2 className="watchlater_card_title">{item.title}</h2>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default WatchLaterPage;
