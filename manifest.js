require("dotenv").config()

// Torrentio-style stream provider: no catalog of its own, no meta. Stremio shows
// the content (meta comes from Cinemeta) and this addon only contributes sources,
// addressed by IMDB id. Subtitles ride along inside each stream object, so the
// separate `subtitles` resource is not needed.
const manifest = {
    id: 'org.komanmovie',
    version: '2.0.0',
    name: 'KomanMovie',
    description: "Türkçe film ve dizi kaynakları.",
    contactEmail: "hasan@hasankoman.dev",
    logo: `${process.env.HOSTING_URL}/images/logo.png`,
    background: `${process.env.HOSTING_URL}/images/background.jpg`,
    behaviorHints: {
        configurable: false,
        configurationRequired: false,
    },
    catalogs: [],
    resources: ['stream'],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
}

module.exports = manifest;
