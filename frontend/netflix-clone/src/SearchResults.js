import React from "react";
import "./SearchResults.css";

function SearchResults({ results, onSelect, onClear }) {
    const { diziler = [], filmler = [] } = results;
    const total = diziler.length + filmler.length;

    return (
        <div className="search-results">
            <div className="search-results_header">
                <button className="search-results_back" onClick={onClear} aria-label="Geri">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><line x1="16" y1="9" x2="2" y2="9"/><polyline points="8,2 2,9 8,16"/></svg>
                </button>
                <h1 className="search-results_title">
                    Arama Sonu&ccedil;lar&inodot;
                    <span className="search-results_count">{total}</span>
                </h1>
            </div>

            {total === 0 ? (
                <div className="search-results_empty">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><circle cx="14" cy="14" r="10"/><line x1="22" y1="22" x2="30" y2="30"/></svg>
                    <span>Sonu&ccedil; bulunamad&inodot;.</span>
                </div>
            ) : (
                <>
                    {diziler.length > 0 && (
                        <div className="search-results_section">
                            <h2 className="search-results_section-title">
                                Diziler
                                <span className="search-results_count">{diziler.length}</span>
                            </h2>
                            <div className="search-results_grid">
                                {diziler.map((item) => (
                                    <div
                                        key={item.id}
                                        className="search-results_card"
                                        onClick={() => onSelect(item)}
                                    >
                                        <img
                                            className="search-results_poster"
                                            src={item.poster}
                                            alt={item.title}
                                            onError={(e) => { e.target.src = "https://via.placeholder.com/200x300?text=No+Image"; }}
                                        />
                                        <div className="search-results_info">
                                            <h3>{item.title}</h3>
                                            <span className="search-results_type">Dizi</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {filmler.length > 0 && (
                        <div className="search-results_section">
                            <h2 className="search-results_section-title">
                                Filmler
                                <span className="search-results_count">{filmler.length}</span>
                            </h2>
                            <div className="search-results_grid">
                                {filmler.map((item) => (
                                    <div
                                        key={item.id}
                                        className="search-results_card"
                                        onClick={() => onSelect(item)}
                                    >
                                        <img
                                            className="search-results_poster"
                                            src={item.poster}
                                            alt={item.title}
                                            onError={(e) => { e.target.src = "https://via.placeholder.com/200x300?text=No+Image"; }}
                                        />
                                        <div className="search-results_info">
                                            <h3>{item.title}</h3>
                                            <span className="search-results_type">Film</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default SearchResults;
