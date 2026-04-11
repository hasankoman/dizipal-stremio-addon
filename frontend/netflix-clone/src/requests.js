const requests = {
    fetchHomepage: `/api/homepage`,
    search: (query) => `/api/search?q=${encodeURIComponent(query)}`,
    detail: (path) => `/api/detail${path.startsWith('/') ? '' : '/'}${path}`,
    stream: (path) => `/api/stream${path.startsWith('/') ? '' : '/'}${path}`,
    download: (path) => `/api/download${path}`,
    trailer: (name, type) => `/api/trailer?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    list: (type, params) => {
        const qs = new URLSearchParams(params).toString();
        return `/api/list/${type}${qs ? '?' + qs : ''}`;
    },
};

export default requests;
