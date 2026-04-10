require("dotenv").config()
const manifest = {
    id: 'org.komanmovie',
    version: '1.0.2',
    name: 'KomanMovie',
    description: "Film ve dizileri izleyin.",
    contactEmail: "hasan@hasankoman.dev",
    logo: `${process.env.HOSTING_URL}/images/logo.png`,
    background: `${process.env.HOSTING_URL}/images/background.jpg`,
    behaviorHints: {
        configurable: false,
        configurationRequired: true,
    },
    config: [{
        key: "komanmovie",
        required: false
    }],
    catalogs: [{
        type: "series",
        id: "komanmovie",
        extra: [{
            name: "search",
            isRequired: true
        }]
    },
    {
        type: "movie",
        id: "komanmovie",
        extra: [{
            name: "search",
            isRequired: true
        }]
    }],
    resources: ['stream', 'meta', 'subtitles'],
    types: ["movie", 'series'],
    idPrefixes: ["/"]
}

module.exports = manifest;
