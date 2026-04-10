import React, { useState } from "react";
import axios from "./axios";
import requests from "./requests";
import "./SearchBar.css";

function SearchBar({ onResults }) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSearch(e) {
        e.preventDefault();
        if (query.length < 2) return;
        setLoading(true);
        try {
            const res = await axios.get(requests.search(query));
            onResults(res.data.results || []);
        } catch (err) {
            console.log(err);
            onResults([]);
        }
        setLoading(false);
    }

    return (
        <form className="searchbar" onSubmit={handleSearch}>
            <input
                className="searchbar_input"
                type="text"
                placeholder="Film veya dizi ara..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            <button className="searchbar_button" type="submit" disabled={loading} aria-label="Ara">
                {loading ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="4" y1="8" x2="12" y2="8"/></svg>
                ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="15" y2="15"/></svg>
                )}
            </button>
        </form>
    );
}

export default SearchBar;
