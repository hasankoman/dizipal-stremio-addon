import React, { useState, useEffect, useCallback } from "react";
import axios from "./axios";
import requests from "./requests";
import "./ListPage.css";

function ListPage({ type, onSelect, onBack }) {
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [filterOptions, setFilterOptions] = useState({});

    const [kategori, setKategori] = useState([]);
    const [yil, setYil] = useState("");
    const [durum, setDurum] = useState("");
    const [siralama, setSiralama] = useState("newest");
    const [imdbMin, setImdbMin] = useState("");

    const isDizi = type === "diziler";
    const title = isDizi ? "Tum Diziler" : "Tum Filmler";

    const fetchData = useCallback(async (pageNum, append) => {
        if (append) setLoadingMore(true);
        else setLoading(true);

        try {
            const params = { page: pageNum, siralama };
            if (kategori.length > 0) params.kategori = kategori.join(",");
            if (yil) params.yil = yil;
            if (isDizi && durum) params.durum = durum;

            const res = await axios.get(requests.list(type, params));
            const data = res.data;

            if (append) {
                setItems(prev => [...prev, ...data.items]);
            } else {
                setItems(data.items);
            }
            setPage(data.page);
            setTotalPages(data.totalPages);

            if (data.filterOptions && Object.keys(data.filterOptions).length > 0) {
                setFilterOptions(data.filterOptions);
            }
        } catch (err) {
            console.log(err);
        }

        setLoading(false);
        setLoadingMore(false);
    }, [type, kategori, yil, durum, siralama, isDizi]);

    useEffect(() => {
        setItems([]);
        setPage(1);
        fetchData(1, false);
    }, [fetchData]);

    function handleLoadMore() {
        if (page < totalPages && !loadingMore) {
            fetchData(page + 1, true);
        }
    }

    function handleFilterReset() {
        setKategori([]);
        setYil("");
        setDurum("");
        setSiralama("newest");
        setImdbMin("");
    }

    const hasActiveFilter = kategori.length > 0 || yil || durum || siralama !== "newest" || imdbMin;

    const filteredItems = imdbMin
        ? items.filter(item => {
            const r = parseFloat(item.rating);
            return r && r >= parseFloat(imdbMin);
        })
        : items;

    return (
        <div className="listpage">
            <div className="listpage_header">
                <button className="listpage_back" onClick={onBack} aria-label="Geri">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><line x1="16" y1="9" x2="2" y2="9"/><polyline points="8,2 2,9 8,16"/></svg>
                </button>
                <h1 className="listpage_title">{title}</h1>
            </div>

            {filterOptions.kategori && filterOptions.kategori.length > 1 && (
                <div className="listpage_kategori_tags">
                    {filterOptions.kategori.filter(o => o.value).map((o, i) => (
                        <button
                            key={i}
                            className={`listpage_kategori_tag ${kategori.includes(o.value) ? "active" : ""}`}
                            onClick={() => setKategori(prev =>
                                prev.includes(o.value)
                                    ? prev.filter(k => k !== o.value)
                                    : [...prev, o.value]
                            )}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            )}

            <div className="listpage_filters">
                <select value={yil} onChange={e => setYil(e.target.value)}>
                    {filterOptions.yil ? (
                        filterOptions.yil.map((o, i) => (
                            <option key={i} value={o.value}>{o.label}</option>
                        ))
                    ) : (
                        <option value="">Tum Yillar</option>
                    )}
                </select>

                {isDizi && (
                    <select value={durum} onChange={e => setDurum(e.target.value)}>
                        {filterOptions.durum ? (
                            filterOptions.durum.map((o, i) => (
                                <option key={i} value={o.value}>{o.label}</option>
                            ))
                        ) : (
                            <option value="">Tum Durumlar</option>
                        )}
                    </select>
                )}

                <select value={siralama} onChange={e => setSiralama(e.target.value)}>
                    {filterOptions.siralama ? (
                        filterOptions.siralama.map((o, i) => (
                            <option key={i} value={o.value}>{o.label}</option>
                        ))
                    ) : (
                        <>
                            <option value="newest">En Yeni</option>
                            <option value="oldest">En Eski</option>
                            <option value="rating">En Yuksek Puan</option>
                            <option value="views">En Cok Izlenen</option>
                            <option value="name_asc">A-Z</option>
                            <option value="name_desc">Z-A</option>
                        </>
                    )}
                </select>

                <select value={imdbMin} onChange={e => setImdbMin(e.target.value)}>
                    <option value="">IMDb Puan</option>
                    <option value="5">5+</option>
                    <option value="6">6+</option>
                    <option value="7">7+</option>
                    <option value="8">8+</option>
                    <option value="9">9+</option>
                </select>

                {hasActiveFilter && (
                    <button className="listpage_filter_reset" onClick={handleFilterReset}>
                        Sifirla
                    </button>
                )}
            </div>

            {loading ? (
                <div className="listpage_loading">Yukleniyor...</div>
            ) : filteredItems.length === 0 ? (
                <div className="listpage_empty">
                    {imdbMin && items.length > 0
                        ? "Bu sayfada esik ustunde sonuc yok, daha fazla yukleyin."
                        : "Sonuc bulunamadi."}
                </div>
            ) : (
                <>
                    <div className="listpage_grid">
                        {filteredItems.map((item, i) => (
                            <div
                                key={item.id + "-" + i}
                                className="listpage_card"
                                onClick={() => onSelect(item)}
                            >
                                <img
                                    className="listpage_poster"
                                    src={item.poster}
                                    alt={item.title}
                                    onError={(e) => { e.target.src = "https://via.placeholder.com/200x300?text=No+Image"; }}
                                />
                                <div className="listpage_card_info">
                                    <h3 className="listpage_card_title">{item.title}</h3>
                                    <div className="listpage_card_meta">
                                        {item.rating && <span className="listpage_card_rating">{item.rating}</span>}
                                        {item.year && <span className="listpage_card_year">{item.year}</span>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {page < totalPages && (
                        <div className="listpage_loadmore">
                            <button
                                className="listpage_loadmore_btn"
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                            >
                                {loadingMore ? "Yukleniyor..." : "Daha Fazla"}
                            </button>
                            <span className="listpage_page_info">{page} / {totalPages}</span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default ListPage;
