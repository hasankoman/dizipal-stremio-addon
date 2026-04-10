import axios from 'axios'

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://movie.hasankoman.dev';

const instance = axios.create({
    baseURL: BACKEND_URL,
});

export default instance
