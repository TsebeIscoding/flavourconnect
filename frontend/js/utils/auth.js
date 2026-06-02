/**
 * FlavourConnect — Auth Token Manager
 *
 * Access token:  stored in memory only (never localStorage — XSS safe)
 * Refresh token: stored in sessionStorage (clears on tab close)
 *
 * For production with httpOnly cookies, remove refresh token storage
 * here and rely on the server to set/clear the cookie.
 */

const Auth = (() => {

    // Access token lives ONLY in memory — never persisted to storage
    // It is re-issued on page load via the refresh token
    let _accessToken = null;

    const REFRESH_KEY = 'fc_rt'; // sessionStorage key

    // ─── TOKEN MANAGEMENT ───────────────────────────────────────

    function setTokens(accessToken, refreshToken) {
        _accessToken = accessToken;
        if (refreshToken) {
            try {
                sessionStorage.setItem(REFRESH_KEY, refreshToken);
            } catch {
                // sessionStorage unavailable (private mode edge cases)
                console.warn('[Auth] Could not store refresh token');
            }
        }
    }

    function getAccessToken() {
        return _accessToken;
    }

    function getRefreshToken() {
        try {
            return sessionStorage.getItem(REFRESH_KEY);
        } catch {
            return null;
        }
    }

    function clearSession() {
        _accessToken = null;
        try {
            sessionStorage.removeItem(REFRESH_KEY);
        } catch { /* ignore */ }
    }

    // ─── SESSION RESTORE ON PAGE LOAD ───────────────────────────

    /**
     * On page load, if a refresh token exists, silently obtain a new
     * access token and restore the user session.
     */
    async function restoreSession() {
        const rawRefresh = getRefreshToken();
        if (!rawRefresh) return false;

        try {
            const apiUrl = window.FC_CONFIG?.apiUrl || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8000/v1' : 'https://api.flavourconnect.com/v1');

            const res = await fetch(apiUrl + '/auth/refresh', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ refresh_token: rawRefresh }),
            });

            const json = await res.json();

            if (!res.ok || !json.success) {
                clearSession();
                return false;
            }

            const { access_token, refresh_token } = json.data;
            setTokens(access_token, refresh_token);

            // Decode user from access token payload (no verification needed client-side)
            const user = decodeTokenPayload(access_token);
            if (!user) {
                clearSession();
                return false;
            }

            Store.dispatch('SET_USER', {
                user: {
                    id:        user.sub,
                    role:      user.role,
                    // Full name fetched separately if needed
                },
                accessToken: access_token,
            });

            return true;
        } catch {
            clearSession();
            return false;
        }
    }

    // ─── HELPERS ────────────────────────────────────────────────

    /**
     * Decode JWT payload without verification.
     * Verification is ALWAYS done server-side.
     * Client uses payload only for role-based UI rendering.
     */
    function decodeTokenPayload(token) {
        try {
            const parts   = token.split('.');
            if (parts.length !== 3) return null;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            // Reject if expired
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
            return payload;
        } catch {
            return null;
        }
    }

    function isTokenExpired(token) {
        const payload = decodeTokenPayload(token);
        if (!payload) return true;
        return payload.exp < Math.floor(Date.now() / 1000);
    }

    return Object.freeze({
        setTokens,
        getAccessToken,
        getRefreshToken,
        clearSession,
        restoreSession,
        decodeTokenPayload,
        isTokenExpired,
    });

})();
