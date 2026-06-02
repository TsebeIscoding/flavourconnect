/**
 * FlavourConnect — HTTP Client
 *
 * Features:
 * - Automatic Authorization header injection
 * - Automatic token refresh on 401
 * - Request retry after refresh
 * - Standardized error handling
 * - No request forgery (all bodies validated server-side)
 */

const Http = (() => {

    const BASE_URL = window.FC_CONFIG?.apiUrl || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8000/v1' : 'https://api.flavourconnect.com/v1');
    let isRefreshing = false;
    let refreshQueue = []; // Queued requests waiting for refresh

    /**
     * Core request function
     * @param {string} method
     * @param {string} path
     * @param {object|null} body
     * @param {object} options
     * @returns {Promise<any>} - resolved data
     */
    async function request(method, path, body = null, options = {}) {
        const url = BASE_URL + path;

        const headers = {
            'Content-Type': 'application/json',
            'Accept':       'application/json',
        };

        // Inject access token if available
        const token = Store.accessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const fetchOptions = {
            method,
            headers,
            credentials: 'include', // Send cookies if using cookie-based refresh
        };

        if (body !== null && method !== 'GET') {
            fetchOptions.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await fetch(url, fetchOptions);
        } catch (err) {
            throw new ApiError('Network error — check your connection', 0, 'NETWORK_ERROR');
        }

        // Handle 401: attempt token refresh once
        if (response.status === 401 && !options._isRetry) {
            return handleTokenRefresh(method, path, body, options);
        }

        // Parse JSON response
        let json;
        try {
            json = await response.json();
        } catch {
            throw new ApiError('Invalid server response', response.status, 'PARSE_ERROR');
        }

        if (!response.ok || !json.success) {
            const err = json.error || {};
            throw new ApiError(
                err.message || 'Request failed',
                response.status,
                err.code || 'ERROR',
                err.fields || null
            );
        }

        return json.data;
    }

    async function handleTokenRefresh(method, path, body, options) {
        // Queue concurrent requests during refresh
        if (isRefreshing) {
            return new Promise((resolve, reject) => {
                refreshQueue.push({ resolve, reject, method, path, body, options });
            });
        }

        isRefreshing = true;

        try {
            const rawRefresh = Auth.getRefreshToken();
            if (!rawRefresh) {
                throw new ApiError('Session expired. Please log in.', 401, 'AUTH_TOKEN_EXPIRED');
            }

            // Call refresh without auth header (avoid infinite loop)
            const res = await fetch(BASE_URL + '/auth/refresh', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ refresh_token: rawRefresh }),
            });

            const json = await res.json();

            if (!res.ok || !json.success) {
                // Refresh failed — clear session, redirect to login
                Auth.clearSession();
                Store.dispatch('CLEAR_USER');
                Store.dispatch('NAVIGATE', { view: 'login' });
                throw new ApiError('Session expired. Please log in.', 401, 'AUTH_SESSION_EXPIRED');
            }

            // Store new tokens
            Auth.setTokens(json.data.access_token, json.data.refresh_token);
            Store.dispatch('SET_USER', {
                user:        Store.currentUser(),
                accessToken: json.data.access_token,
            });

            // Drain queue
            refreshQueue.forEach(({ resolve, reject, method: m, path: p, body: b, options: o }) => {
                request(m, p, b, { ...o, _isRetry: true }).then(resolve).catch(reject);
            });
            refreshQueue = [];

            // Retry original request
            return request(method, path, body, { ...options, _isRetry: true });

        } catch (err) {
            refreshQueue.forEach(({ reject }) => reject(err));
            refreshQueue = [];
            throw err;
        } finally {
            isRefreshing = false;
        }
    }

    // ─── CONVENIENCE METHODS ────────────────────────────────────

    return {
        get:    (path, options)       => request('GET',    path, null, options),
        post:   (path, body, options) => request('POST',   path, body, options),
        patch:  (path, body, options) => request('PATCH',  path, body, options),
        delete: (path, options)       => request('DELETE', path, null, options),

        // Multipart upload (no JSON body)
        upload: async (path, formData) => {
            const token = Store.accessToken();
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(BASE_URL + path, {
                method:  'POST',
                headers,
                body:    formData, // Browser sets Content-Type with boundary
            });

            const json = await response.json();
            if (!response.ok || !json.success) {
                throw new ApiError(json.error?.message || 'Upload failed', response.status, json.error?.code);
            }
            return json.data;
        },
    };

})();

// ─── API ERROR CLASS ────────────────────────────────────────────

class ApiError extends Error {
    constructor(message, status, code, fields = null) {
        super(message);
        this.name   = 'ApiError';
        this.status = status;
        this.code   = code;
        this.fields = fields; // Validation field errors
    }
}
