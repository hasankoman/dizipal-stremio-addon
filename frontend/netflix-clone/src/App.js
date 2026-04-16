import React, { useCallback, useEffect, useRef, useState } from "react";
import Row from "./Row";
import Banner from "./Banner";
import SearchBar from "./SearchBar";
import SearchResults from "./SearchResults";
import DetailModal from "./DetailModal";
import ListPage from "./ListPage";
import ContinueWatchingRow from "./ContinueWatchingRow";
import WatchLaterRow from "./WatchLaterRow";
import WatchLaterPage from "./WatchLaterPage";
import "./App.css";

const APP_BASE = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const HOME_PATH = APP_BASE || "/";
const DETAIL_PATH = `${APP_BASE}/detail`;
const WATCH_LATER_PATH = `${APP_BASE}/watch-later`;

function normalizePathname(pathname) {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized || "/";
}

function buildDetailUrl(content) {
    const params = new URLSearchParams();
    params.set("id", content.id);

    if (content.title) params.set("title", content.title);
    if (content.autoPlay) params.set("autoplay", "1");

    return `${DETAIL_PATH}?${params.toString()}`;
}

function readRouteFromLocation(location = window.location, state = window.history.state) {
    if (normalizePathname(location.pathname) === normalizePathname(WATCH_LATER_PATH)) {
        return { page: "watchLater", content: null };
    }

    if (normalizePathname(location.pathname) !== normalizePathname(DETAIL_PATH)) {
        return { page: "home", content: null };
    }

    const params = new URLSearchParams(location.search);
    const id = params.get("id");

    if (!id) {
        return { page: "home", content: null };
    }

    const stateContent = state?.content?.id === id ? state.content : null;

    return {
        page: "detail",
        content: {
            id,
            title: params.get("title") || stateContent?.title || "",
            poster: stateContent?.poster || "",
            type: stateContent?.type,
            autoPlay: params.get("autoplay") === "1" || Boolean(stateContent?.autoPlay),
        },
    };
}

function App() {
    const [searchResults, setSearchResults] = useState(null);
    const [listPage, setListPage] = useState(null); // "diziler" or "filmler"
    const [menuOpen, setMenuOpen] = useState(false);
    const [cwRefresh, setCwRefresh] = useState(0);
    const [watchLaterRefresh, setWatchLaterRefresh] = useState(0);
    const [route, setRoute] = useState(() => readRouteFromLocation());
    const previousRouteRef = useRef(route.page);

    function handleBack() {
        setListPage(null);
    }

    const navigateHome = useCallback(({ replace = false } = {}) => {
        const isAlreadyHome =
            normalizePathname(window.location.pathname) === normalizePathname(HOME_PATH) &&
            !window.location.search &&
            !window.location.hash;

        if (!isAlreadyHome) {
            window.history[replace ? "replaceState" : "pushState"]({ page: "home" }, "", HOME_PATH);
        }

        setRoute({ page: "home", content: null });
    }, []);

    const navigateWatchLater = useCallback(({ replace = false } = {}) => {
        const isAlreadyWatchLater =
            normalizePathname(window.location.pathname) === normalizePathname(WATCH_LATER_PATH) &&
            !window.location.search &&
            !window.location.hash;

        if (!isAlreadyWatchLater) {
            window.history[replace ? "replaceState" : "pushState"](
                { page: "watchLater" },
                "",
                WATCH_LATER_PATH
            );
        }

        setRoute({ page: "watchLater", content: null });
    }, []);

    const handleSelectContent = useCallback((content) => {
        if (!content?.id) return;

        window.history.pushState(
            { page: "detail", fromApp: true, content },
            "",
            buildDetailUrl(content)
        );

        setRoute({ page: "detail", content });
    }, []);

    const handleCloseDetail = useCallback(() => {
        if (window.history.state?.fromApp) {
            window.history.back();
            return;
        }

        navigateHome({ replace: true });
    }, [navigateHome]);

    useEffect(() => {
        if (!window.history.state?.page) {
            const initialState =
                route.page === "detail"
                    ? { page: "detail", content: route.content }
                    : route.page === "watchLater"
                        ? { page: "watchLater" }
                        : { page: "home" };

            window.history.replaceState(
                initialState,
                "",
                window.location.pathname + window.location.search + window.location.hash
            );
        }

        const handlePopState = (event) => {
            setRoute(readRouteFromLocation(window.location, event.state));
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        setMenuOpen(false);

        if (previousRouteRef.current === "detail" && route.page !== "detail") {
            setCwRefresh((current) => current + 1);
            setWatchLaterRefresh((current) => current + 1);
        }

        previousRouteRef.current = route.page;
    }, [route.page]);

    function handleShowHome() {
        setMenuOpen(false);
        setListPage(null);
        setSearchResults(null);
        navigateHome();
    }

    function handleShowList(type) {
        setMenuOpen(false);
        setListPage(type);
        setSearchResults(null);
        navigateHome();
    }

    function handleShowWatchLater() {
        setMenuOpen(false);
        setListPage(null);
        setSearchResults(null);
        navigateWatchLater();
    }

    function handleShowSearchResults(results) {
        setMenuOpen(false);
        setSearchResults(results);
        setListPage(null);
        navigateHome();
    }

    function handleClearSearch() {
        setMenuOpen(false);
        setSearchResults(null);
        navigateHome();
    }

    if (route.page === "detail") {
        return (
            <DetailModal
                key={`${route.content.id}:${route.content.autoPlay ? "auto" : "manual"}`}
                content={route.content}
                onClose={handleCloseDetail}
                onWatchLaterChange={() => setWatchLaterRefresh((current) => current + 1)}
                pageMode
            />
        );
    }

    return (
        <div className="App">
            <nav className={`nav ${menuOpen ? "nav--open" : ""}`}>
                <span className="nav_logo" lang="en" onClick={handleShowHome}>
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
                    <button className={`nav_link ${listPage === "diziler" ? "nav_link--active" : ""}`} onClick={() => handleShowList("diziler")}>Diziler</button>
                    <button className={`nav_link ${listPage === "filmler" ? "nav_link--active" : ""}`} onClick={() => handleShowList("filmler")}>Filmler</button>
                    <button className={`nav_link ${route.page === "watchLater" ? "nav_link--active" : ""}`} onClick={handleShowWatchLater}>Daha Sonra Izle</button>
                </div>
                <SearchBar onResults={handleShowSearchResults} />
            </nav>

            {route.page === "watchLater" ? (
                <WatchLaterPage
                    onSelect={handleSelectContent}
                    onBack={handleShowHome}
                    refreshKey={watchLaterRefresh}
                />
            ) : listPage ? (
                <ListPage
                    type={listPage}
                    onSelect={handleSelectContent}
                    onBack={handleBack}
                />
            ) : searchResults ? (
                <SearchResults
                    results={searchResults}
                    onSelect={handleSelectContent}
                    onClear={handleClearSearch}
                />
            ) : (
                <>
                    <Banner onSelect={handleSelectContent} />
                    <ContinueWatchingRow onSelect={handleSelectContent} refreshKey={cwRefresh} />
                    <WatchLaterRow
                        onSelect={handleSelectContent}
                        onNavigate={handleShowWatchLater}
                        refreshKey={watchLaterRefresh}
                    />
                    <Row title="Kesfet" isHomepage onSelect={handleSelectContent} onNavigate={handleShowList} />
                </>
            )}
        </div>
    );
}

export default App;
