require("dotenv").config();
const header = require("../header");
const sslfix = require("./sslfix");
const cheerio = require("cheerio");
const Axios = require('axios')
const { setupCache } = require("axios-cache-interceptor");

const instance = Axios.create();
const axios = setupCache(instance);


async function SearchMovieAndSeries(name) {
    try {
        var response = await axios({
            ...sslfix,
            url: `${process.env.PROXY_URL}/ajax-search?q=${encodeURIComponent(name)}`,
            headers: header,
            method: "GET"
        });

        if (response && response.status == 200 && response.data && response.data.success) {
            return response.data.results.map(item => {
                var type = "movie";
                if (item.type === "Dizi") type = "series";

                // Extract the path from the full URL
                var url = item.url;
                try {
                    url = new URL(item.url).pathname;
                } catch(e) {}

                return {
                    title: item.title,
                    type: type,
                    url: url,
                    poster: item.poster || "",
                    genres: item.year ? String(item.year) : "",
                    rating: item.rating || ""
                };
            });
        }
    } catch (error) {
        if (error) console.log(error);
    }
    return [];
}

async function SearchMetaMovieAndSeries(id, type) {
    try {
        var response = await axios({ ...sslfix, url: process.env.PROXY_URL + id, headers: header, method: "GET" });
        if (response && response.status == 200) {
            var $ = cheerio.load(response.data);

            if (type == "series") {
                var name = $(".series-title").text().trim();
                var background = "";
                var heroStyle = $(".series-hero").attr("style") || "";
                var bgMatch = heroStyle.match(/url\(['"]?([^'"\)]+)['"]?\)/);
                if (bgMatch) background = bgMatch[1];

                var description = $(".series-description").text().trim();
                var seasonButtons = $(".season-btn");
                var season = seasonButtons.length || 1;

                // Try to get rating from JSON-LD
                var imdb = "";
                $('script[type="application/ld+json"]').each((i, el) => {
                    try {
                        var json = JSON.parse($(el).html());
                        if (json.aggregateRating) {
                            imdb = json.aggregateRating.ratingValue;
                        }
                        if (json.numberOfSeasons) {
                            season = json.numberOfSeasons;
                        }
                    } catch(e) {}
                });

                var releaseInfo = "";
                $(".detail-meta-item").each((i, el) => {
                    var text = $(el).text();
                    if (text.match(/\d{4}/)) {
                        releaseInfo = text.match(/\d{4}/)[0];
                    }
                });

            } else {
                var name = $(".movie-title, .detail-title, h1").first().text().trim();
                var background = "";
                var heroStyle = $(".movie-hero, .detail-hero, .series-hero").attr("style") || "";
                var bgMatch = heroStyle.match(/url\(['"]?([^'"\)]+)['"]?\)/);
                if (bgMatch) background = bgMatch[1];

                var description = $(".movie-description, .detail-description, .series-description").text().trim();
                var season = 1;
                var imdb = "";
                var releaseInfo = "";

                $('script[type="application/ld+json"]').each((i, el) => {
                    try {
                        var json = JSON.parse($(el).html());
                        if (json.aggregateRating) {
                            imdb = json.aggregateRating.ratingValue;
                        }
                        if (json.datePublished) {
                            releaseInfo = json.datePublished.substring(0, 4);
                        }
                    } catch(e) {}
                });
            }

            return {
                name: name,
                background: background || "",
                country: "US",
                genres: [],
                season: season,
                imdbRating: Number(imdb),
                description: description,
                releaseInfo: String(releaseInfo),
            };
        }
    } catch (error) {
        console.log(error);
    }
}

async function SearchDetailMovieAndSeries(id, type, seasonNum) {
    try {
        if (type == "series") {
            var response = await axios({ ...sslfix, url: process.env.PROXY_URL + id, headers: header, method: "GET" });
            if (response && response.status == 200) {
                var values = [];
                var $ = cheerio.load(response.data);

                // Each season's episodes are in detail-episode-list
                var episodeLists = $(".detail-episode-list");
                var seasonList = episodeLists.eq(seasonNum - 1);

                if (seasonList.length === 0) {
                    // Fallback: try finding all episodes
                    seasonList = episodeLists.first();
                }

                seasonList.find(".detail-episode-item-wrap").each((i, element) => {
                    var link = $(element).find("a.detail-episode-item");
                    var href = link.attr("href") || "";
                    var title = $(element).find(".detail-episode-title").text().trim();
                    var subtitle = $(element).find(".detail-episode-subtitle").text().trim();

                    // Extract path from URL
                    try {
                        href = new URL(href).pathname;
                    } catch(e) {}

                    values.push({
                        id: href,
                        title: title || subtitle || `Bölüm ${i + 1}`,
                        thumbnail: "",
                        episode: i + 1
                    });
                });

                return values;
            }
        } else {
            return [{ id: id }];
        }
    } catch (error) {
        console.log(error);
    }
}

module.exports = { SearchMovieAndSeries, SearchMetaMovieAndSeries, SearchDetailMovieAndSeries };
