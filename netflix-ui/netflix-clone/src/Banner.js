import React from "react";
import "./Banner.css";

function Banner({ onSelect }) {
    return (
        <header className="banner">
            <div className="banner_bg" style={{
                backgroundImage: `url("https://movie.hasankoman.dev/images/background.jpg")`,
            }} />
            <div className="banner_content">
                <div className="banner_label">Film &amp; Dizi</div>
                <h1 className="banner_title">
                    <span className="banner_title_line">Koman</span>
                    <span className="banner_title_line banner_title_outline">Movie</span>
                </h1>
                <p className="banner_description">
                    Film ve dizi arayarak izlemeye baslayin. Yukaridaki arama cubugunu kullanin.
                </p>
                <div className="banner_stats">
                    <div className="banner_stat">
                        <span className="banner_stat_value">HD</span>
                        <span className="banner_stat_label">Kalite</span>
                    </div>
                    <div className="banner_stat_divider" />
                    <div className="banner_stat">
                        <span className="banner_stat_value">7/24</span>
                        <span className="banner_stat_label">Erisim</span>
                    </div>
                    <div className="banner_stat_divider" />
                    <div className="banner_stat">
                        <span className="banner_stat_value">HLS</span>
                        <span className="banner_stat_label">Stream</span>
                    </div>
                </div>
            </div>
            <div className="banner_grid_overlay" />
        </header>
    );
}

export default Banner;
