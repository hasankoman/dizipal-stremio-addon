import React, { useState, useEffect } from "react";
import axios from "./axios";
import requests from "./requests";
import "./Row.css";

function Row({ title, isHomepage, onSelect, onNavigate }) {
    const [sections, setSections] = useState([]);

    useEffect(() => {
        async function fetchData() {
            try {
                const res = await axios.get(requests.fetchHomepage);
                setSections(res.data.sections || []);
            } catch (err) {
                console.log(err);
            }
        }
        if (isHomepage) fetchData();
    }, [isHomepage]);

    if (!isHomepage || sections.length === 0) return null;

    return (
        <>
            {sections.map((section, i) => (
                <div className="row" key={i}>
                    <div className="row_header">
                        <h2>{section.title}</h2>
                        {section.title === "Tüm Diziler" && onNavigate && (
                            <button className="row_see_all" onClick={() => onNavigate("diziler")}>
                                <span>T&uuml;m&uuml;n&uuml; G&ouml;r</span>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="8,3 12,7 8,11"/></svg>
                            </button>
                        )}
                        {section.title === "Tüm Filmler" && onNavigate && (
                            <button className="row_see_all" onClick={() => onNavigate("filmler")}>
                                <span>T&uuml;m&uuml;n&uuml; G&ouml;r</span>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="8,3 12,7 8,11"/></svg>
                            </button>
                        )}
                    </div>
                    <div className="row_thumbnails">
                        {section.items.map((item, j) => (
                            <div
                                key={item.id || j}
                                className="row_card"
                                onClick={() => onSelect(item)}
                            >
                                <img
                                    className="row_thumbnail"
                                    src={item.poster}
                                    alt={item.title}
                                    onError={(e) => { e.target.src = "https://via.placeholder.com/200x300?text=No+Image"; }}
                                />
                                <span className="row_card_title">{item.title}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </>
    );
}

export default Row;
