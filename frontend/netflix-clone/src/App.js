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

    function handleBack() {
        setListPage(null);
    }

    return (
        <div className="App">
            <nav className="nav">
                <span className="nav_logo_text" onClick={() => { setListPage(null); setSearchResults(null); }}>
                    KomanMovie
                </span>
                <div className="nav_links">
                    <button className={`nav_link ${listPage === "diziler" ? "nav_link--active" : ""}`} onClick={() => { setListPage("diziler"); setSearchResults(null); }}>Diziler</button>
                    <button className={`nav_link ${listPage === "filmler" ? "nav_link--active" : ""}`} onClick={() => { setListPage("filmler"); setSearchResults(null); }}>Filmler</button>
                </div>
                <SearchBar onResults={(r) => { setSearchResults(r); setListPage(null); }} />
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
