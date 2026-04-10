import React, { useState } from "react";
import Row from "./Row";
import Banner from "./Banner";
import SearchBar from "./SearchBar";
import SearchResults from "./SearchResults";
import DetailModal from "./DetailModal";
import ListPage from "./ListPage";
import "./App.css";

function App() {
    const [searchResults, setSearchResults] = useState(null);
    const [selectedContent, setSelectedContent] = useState(null);
    const [listPage, setListPage] = useState(null); // "diziler" or "filmler"
    const [menuOpen, setMenuOpen] = useState(false);

    function handleBack() {
        setListPage(null);
    }

    return (
        <div className="App">
            <nav className={`nav ${menuOpen ? "nav--open" : ""}`}>
                <span className="nav_logo" lang="en" onClick={() => { setListPage(null); setSearchResults(null); setMenuOpen(false); }}>
                    <img className="nav_logo_img" src="/logo192.png" alt="KomanMovie" />
                    <span className="nav_logo_text">KomanMovie</span>
                </span>
                <button className="nav_hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
                    {menuOpen ? (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="2" y1="2" x2="16" y2="16"/><line x1="16" y1="2" x2="2" y2="16"/></svg>
                    ) : (
                        <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"><line x1="0" y1="2" x2="20" y2="2"/><line x1="0" y1="8" x2="20" y2="8"/><line x1="0" y1="14" x2="20" y2="14"/></svg>
                    )}
                </button>
                <div className="nav_links">
                    <button className={`nav_link ${listPage === "diziler" ? "nav_link--active" : ""}`} onClick={() => { setListPage("diziler"); setSearchResults(null); setMenuOpen(false); }}>Diziler</button>
                    <button className={`nav_link ${listPage === "filmler" ? "nav_link--active" : ""}`} onClick={() => { setListPage("filmler"); setSearchResults(null); setMenuOpen(false); }}>Filmler</button>
                </div>
                <SearchBar onResults={(r) => { setSearchResults(r); setListPage(null); setMenuOpen(false); }} />
            </nav>

            {selectedContent && (
                <DetailModal
                    content={selectedContent}
                    onClose={() => setSelectedContent(null)}
                />
            )}

            {listPage ? (
                <ListPage
                    type={listPage}
                    onSelect={setSelectedContent}
                    onBack={handleBack}
                />
            ) : searchResults ? (
                <SearchResults
                    results={searchResults}
                    onSelect={setSelectedContent}
                    onClear={() => setSearchResults(null)}
                />
            ) : (
                <>
                    <Banner onSelect={setSelectedContent} />
                    <Row title="Kesfet" isHomepage onSelect={setSelectedContent} onNavigate={setListPage} />
                </>
            )}
        </div>
    );
}

export default App;
