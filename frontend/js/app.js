/**
 * FlavourConnect — Application Bootstrap
 *
 * This is the reactive rendering orchestrator.
 *
 * Pattern:
 *   STATE CHANGE → dispatch() → notify subscribers → render functions
 *
 * No component ever renders itself — the App wires state keys
 * to render functions. A change in `cart` triggers renderCart().
 * A change in `nav` triggers the router to call the right view renderer.
 */

(async () => {

    // ── CONFIG ────────────────────────────────────────────────────
    // ── Environment detection ─────────────────────────────────────
    const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    window.FC_CONFIG = {
        apiUrl: isDev ? 'http://localhost:8000/v1'     : 'https://api.flavourconnect.com/v1',
        wsUrl:  isDev ? 'ws://localhost:8080'           : 'wss://ws.flavourconnect.com',
    };

    // ── BOOT SEQUENCE ─────────────────────────────────────────────

    // 1. Show loading screen
    const loadingScreen = Dom.qs('#loading-screen');

    // 2. Restore session from refresh token (silent, no flicker)
    const sessionRestored = await Auth.restoreSession();

    // 3. If session restored, load initial data for the user's role
    if (sessionRestored) {
        const role = Store.userRole();
        await loadInitialDataForRole(role);
    }

    // 4. Hide loading screen
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        setTimeout(() => loadingScreen.remove(), 300);
    }

    // ── REACTIVE WIRING ───────────────────────────────────────────
    // Subscribe render functions to state keys
    // When state.nav changes → re-render the view
    // When state.cart changes → re-render the cart panel
    // etc.

    Store.subscribe('nav', renderCurrentView);
    Store.subscribe('auth', (state) => {
        NavComponents.renderNav(state);
        renderCurrentView(state);
    });
    Store.subscribe('restaurants', renderCurrentView);
    Store.subscribe('menu', renderCurrentView);
    Store.subscribe('orders', renderCurrentView);
    Store.subscribe('cart', (state) => {
        CartComponents.renderCart(state);
        // Also re-render current view if it's checkout or restaurant detail
        const view = state.nav.currentView;
        if (view === 'checkout') CartComponents.renderCheckout(state);
    });
    Store.subscribe('ui', (state) => {
        NavComponents.renderToast(state);
        CartComponents.renderCart(state);
    });
    Store.subscribe('notifications', renderNotifications);

    // Seed history with home so back button works from the first navigation
    Store.dispatch('NAV_SEED_HOME');

    // Initial render
    const initialState = Store.getState();
    NavComponents.renderNav(initialState);
    CartComponents.renderCart(initialState);

    // Ensure view-content container exists
    ensureViewContent();

    // Trigger initial view render
    renderCurrentView(initialState);

    // ── WEBSOCKET ─────────────────────────────────────────────────
    if (sessionRestored) {
        WsClient.connect();
    }

    // Reconnect WebSocket after login
    Store.subscribe('auth', (state) => {
        if (state.auth.user && !WsClient.isConnected()) {
            WsClient.connect();
        } else if (!state.auth.user && WsClient.isConnected()) {
            WsClient.disconnect();
        }
    });

    // ── VIEW ROUTER ───────────────────────────────────────────────

    function renderCurrentView(state) {
        ensureViewContent();
        const view = state.nav.currentView;
        const role = state.auth.user?.role;

        // Guard: redirect unauthenticated users from protected views
        const publicViews   = new Set(['home', 'login', 'register', 'restaurant']);
        const protectedViews = new Set(['checkout', 'orders', 'order-detail', 'vendor-dashboard', 'vendor-menu', 'vendor-profile', 'driver-dashboard', 'admin-dashboard']);

        if (protectedViews.has(view) && !state.auth.user) {
            Store.dispatch('NAVIGATE', { view: 'login' });
            return;
        }

        // Guard: role-specific views
        if (view === 'vendor-dashboard' && role !== 'vendor' && role !== 'admin') {
            Store.dispatch('NAVIGATE', { view: 'home' });
            return;
        }
        if (view === 'driver-dashboard' && role !== 'driver' && role !== 'admin') {
            Store.dispatch('NAVIGATE', { view: 'home' });
            return;
        }

        // Load data when navigating to a view
        handleViewDataLoading(view, state);

        // Dispatch to render function
        switch (view) {
            case 'home':
                RestaurantComponents.renderRestaurants(state);
                break;

            case 'restaurant':
                RestaurantComponents.renderRestaurantDetail(state);
                break;

            case 'login':
                AuthComponents.renderLogin(state);
                break;

            case 'register':
                AuthComponents.renderRegister(state);
                break;

            case 'checkout':
                CartComponents.renderCheckout(state);
                break;

            case 'orders':
                OrderComponents.renderOrders(state);
                break;

            case 'order-detail':
                OrderComponents.renderOrderDetail(state);
                break;

            case 'vendor-dashboard':
                if (typeof VendorComponents !== 'undefined') {
                    VendorComponents.renderDashboard(state);
                }
                break;

            case 'vendor-menu':
                if (typeof VendorComponents !== 'undefined') {
                    VendorComponents.renderMenuManager(state);
                }
                break;

            case 'vendor-profile':
                if (typeof VendorComponents !== 'undefined') {
                    VendorComponents.renderProfile(state);
                }
                break;

            case 'driver-dashboard':
                if (typeof DriverComponents !== 'undefined') {
                    DriverComponents.renderDashboard(state);
                }
                break;

            case 'admin-dashboard':
                if (typeof AdminComponents !== 'undefined') {
                    AdminComponents.renderDashboard(state);
                }
                break;

            default:
                render404();
        }

        // Scroll to top on view change
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Update page title
        document.title = viewTitle(view) + ' — FlavourConnect';
    }

    function handleViewDataLoading(view, state) {
        const role = state.auth.user?.role;

        // Only trigger loads on navigation — not on every state update
        const prevView = window._prevView;
        if (prevView === view) return;
        window._prevView = view;

        switch (view) {
            case 'home':
                if (state.restaurants.list.length === 0) {
                    Actions.loadRestaurants(state.restaurants.filters);
                }
                break;

            case 'orders':
                if (role) Actions.loadOrders(role);
                break;

            case 'checkout':
                if (!state.cart.id) Actions.loadCart();
                break;

            case 'vendor-dashboard':
                if (role === 'vendor') {
                    Actions.loadOrders('vendor');
                    // Load vendor's own restaurant so open/close toggle reflects real state
                    Api.restaurants.mine().then(data => {
                        if (data?.restaurant) {
                            Store.dispatch('SET_RESTAURANT', data.restaurant);
                        }
                    }).catch(() => {});
                }
                break;

            case 'vendor-menu':
                if (role === 'vendor') {
                    // Load vendor's own restaurant and its menu
                    Api.restaurants.mine().then(data => {
                        const restId = data?.restaurant?.id;
                        if (restId) {
                            Store.dispatch('SET_MENU_LOADING', true);
                            Api.menu.list(restId).then(menuData => {
                                Store.dispatch('SET_MENU', menuData.menu_items);
                            });
                        }
                    }).catch(() => {});
                }
                break;

            case 'vendor-profile':
                if (role === 'vendor') {
                    Api.restaurants.mine().then(data => {
                        if (data?.restaurant) {
                            Store.dispatch('SET_RESTAURANT', data.restaurant);
                        }
                    }).catch(() => {});
                }
                break;

            case 'driver-dashboard':
                if (role === 'driver') {
                    Actions.loadOrders('driver');
                }
                break;
        }
    }

    async function loadInitialDataForRole(role) {
        switch (role) {
            case 'customer':
                await Actions.loadCart();
                break;
            case 'vendor':
                // Vendor dashboard is primary view
                Store.dispatch('NAVIGATE', { view: 'vendor-dashboard' });
                break;
            case 'driver':
                Store.dispatch('NAVIGATE', { view: 'driver-dashboard' });
                break;
            case 'admin':
                Store.dispatch('NAVIGATE', { view: 'admin-dashboard' });
                break;
        }
    }

    function ensureViewContent() {
        if (!Dom.qs('#view-content')) {
            const app = Dom.qs('#app');
            if (app) {
                const content = Dom.el('main', { id: 'view-content', class: 'view-content' });
                app.appendChild(content);
            }
        }
    }

    function renderNotifications(state) {
        const { list } = state.notifications;
        const unread   = list.filter(n => !n.read).length;
        const badge    = Dom.qs('.nav__notif-badge');
        if (badge) {
            badge.textContent = unread;
            badge.hidden      = unread === 0;
        }
    }

    function render404() {
        const container = Dom.qs('#view-content');
        if (!container) return;
        Dom.render(container,
            Dom.el('div', { class: 'state-404' }, [
                Dom.el('h1', {}, ['404']),
                Dom.el('p',  {}, ['Page not found.']),
            ])
        );
    }

    function viewTitle(view) {
        const titles = {
            'home':             'Browse Restaurants',
            'restaurant':       'Restaurant',
            'login':            'Sign In',
            'register':         'Create Account',
            'checkout':         'Checkout',
            'orders':           'Orders',
            'order-detail':     'Order Detail',
            'vendor-dashboard': 'Vendor Dashboard',
            'vendor-menu':      'Menu Manager',
            'vendor-profile':   'Restaurant Profile',
            'driver-dashboard': 'Driver Dashboard',
            'admin-dashboard':  'Admin Dashboard',
        };
        return titles[view] || 'FlavourConnect';
    }

    // ── BROWSER BACK/FORWARD SUPPORT ──────────────────────────────
    // Minimal history API integration

    Store.subscribe('nav', (state) => {
        const view = state.nav.currentView;
        const url  = `/${view === 'home' ? '' : view}`;
        if (window.location.pathname !== url) {
            history.pushState({ view, params: state.nav.params }, '', url);
        }
    });

    window.addEventListener('popstate', (e) => {
        // Use NAV_BACK so the in-app history stack stays in sync
        Store.dispatch('NAV_BACK');
    });

})();
