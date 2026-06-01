/**
 * FlavourConnect — Reactive State Store
 *
 * Architecture: STATE → RENDER → UI
 *
 * Rules:
 * - UI is FULLY derived from state. Zero exceptions.
 * - State mutations ALWAYS go through dispatch()
 * - Every mutation triggers a re-render of affected views
 * - No direct DOM manipulation outside render functions
 */

const Store = (() => {

    // ─── INITIAL STATE ──────────────────────────────────────────
    const initialState = {
        // Auth
        auth: {
            user:         null,    // { id, email, role, full_name }
            accessToken:  null,
            isLoading:    false,
            error:        null,
        },

        // Navigation
        nav: {
            currentView:  'home',  // home|login|register|restaurants|cart|orders|vendor|driver|admin
            params:       {},      // { restaurantId, orderId, ... }
        },

        // Restaurants
        restaurants: {
            list:         [],
            current:      null,
            pagination:   null,
            isLoading:    false,
            error:        null,
            filters: {
                open:     false,
                cuisine:  '',
                search:   '',
            },
        },

        // Menu
        menu: {
            items:        [],
            isLoading:    false,
            error:        null,
        },

        // Cart
        cart: {
            id:              null,
            restaurant_id:   null,
            restaurant_name: null,
            items:           [],
            subtotal:        0,
            item_count:      0,
            isLoading:       false,
            error:           null,
        },

        // Orders
        orders: {
            list:         [],
            current:      null,
            pagination:   null,
            isLoading:    false,
            error:        null,
        },

        // Notifications
        notifications: {
            list:         [],
        },

        // Global UI
        ui: {
            cartOpen:     false,
            modalOpen:    false,
            modalContent: null,
            toast:        null,  // { message, type: 'success'|'error'|'info' }
        },
    };

    // Deep clone initial state
    let state = JSON.parse(JSON.stringify(initialState));

    // ─── SUBSCRIBERS ────────────────────────────────────────────
    const subscribers = new Map();
    let renderQueued  = false;

    function subscribe(key, fn) {
        if (!subscribers.has(key)) {
            subscribers.set(key, new Set());
        }
        subscribers.get(key).add(fn);
        return () => subscribers.get(key).delete(fn); // unsubscribe
    }

    function notify(changedKeys) {
        // Batch renders in the same microtask tick
        if (renderQueued) return;
        renderQueued = true;

        queueMicrotask(() => {
            renderQueued = false;
            changedKeys.forEach(key => {
                if (subscribers.has(key)) {
                    subscribers.get(key).forEach(fn => fn(state));
                }
            });
            // Always notify wildcard subscribers
            if (subscribers.has('*')) {
                subscribers.get('*').forEach(fn => fn(state));
            }
        });
    }

    // ─── MUTATIONS ──────────────────────────────────────────────
    const mutations = {

        // Auth mutations
        SET_AUTH_LOADING: (state, payload) => {
            state.auth.isLoading = payload;
        },
        SET_AUTH_ERROR: (state, payload) => {
            state.auth.error = payload;
            state.auth.isLoading = false;
        },
        SET_USER: (state, { user, accessToken }) => {
            state.auth.user        = user;
            state.auth.accessToken = accessToken;
            state.auth.isLoading   = false;
            state.auth.error       = null;
        },
        CLEAR_USER: (state) => {
            state.auth.user        = null;
            state.auth.accessToken = null;
        },

        // Navigation
        NAVIGATE: (state, { view, params = {} }) => {
            state.nav.currentView = view;
            state.nav.params      = params;
            state.ui.cartOpen     = false;
            state.ui.modalOpen    = false;
        },

        // Restaurants
        SET_RESTAURANTS_LOADING: (state, payload) => {
            state.restaurants.isLoading = payload;
        },
        SET_RESTAURANTS: (state, { restaurants, pagination }) => {
            state.restaurants.list       = restaurants;
            state.restaurants.pagination = pagination;
            state.restaurants.isLoading  = false;
            state.restaurants.error      = null;
        },
        SET_RESTAURANT: (state, restaurant) => {
            state.restaurants.current   = restaurant;
            state.restaurants.isLoading = false;
        },
        SET_RESTAURANT_FILTER: (state, filters) => {
            state.restaurants.filters = { ...state.restaurants.filters, ...filters };
        },

        // Menu
        SET_MENU: (state, items) => {
            state.menu.items     = items;
            state.menu.isLoading = false;
        },
        SET_MENU_LOADING: (state, payload) => {
            state.menu.isLoading = payload;
        },

        // Cart
        SET_CART: (state, cart) => {
            state.cart = { ...state.cart, ...cart, isLoading: false, error: null };
        },
        SET_CART_LOADING: (state, payload) => {
            state.cart.isLoading = payload;
        },
        SET_CART_ERROR: (state, error) => {
            state.cart.error     = error;
            state.cart.isLoading = false;
        },
        TOGGLE_CART: (state) => {
            state.ui.cartOpen = !state.ui.cartOpen;
        },

        // Orders
        SET_ORDERS: (state, { orders, pagination }) => {
            state.orders.list       = orders;
            state.orders.pagination = pagination;
            state.orders.isLoading  = false;
        },
        SET_ORDERS_LOADING: (state, payload) => {
            state.orders.isLoading = payload;
        },
        SET_CURRENT_ORDER: (state, order) => {
            state.orders.current   = order;
            state.orders.isLoading = false;
        },
        UPDATE_ORDER_IN_LIST: (state, updatedOrder) => {
            const idx = state.orders.list.findIndex(o => o.id === updatedOrder.id);
            if (idx !== -1) {
                state.orders.list[idx] = updatedOrder;
            }
        },

        // Notifications
        ADD_NOTIFICATION: (state, notification) => {
            state.notifications.list.unshift({
                ...notification,
                id:   crypto.randomUUID(),
                read: false,
            });
        },

        // Toast
        SHOW_TOAST: (state, { message, type = 'info' }) => {
            state.ui.toast = { message, type, id: Date.now() };
        },
        HIDE_TOAST: (state) => {
            state.ui.toast = null;
        },

        // Modal
        OPEN_MODAL: (state, content) => {
            state.ui.modalOpen    = true;
            state.ui.modalContent = content;
        },
        CLOSE_MODAL: (state) => {
            state.ui.modalOpen    = false;
            state.ui.modalContent = null;
        },
    };

    // ─── DISPATCH ───────────────────────────────────────────────

    /**
     * dispatch(type, payload) — the ONLY way to mutate state
     *
     * Returns the affected top-level keys for targeted re-renders
     */
    function dispatch(type, payload) {
        if (!mutations[type]) {
            console.error(`[Store] Unknown mutation: ${type}`);
            return;
        }

        const before = JSON.stringify(state);
        mutations[type](state, payload);
        const after = JSON.stringify(state);

        if (before === after) return; // No change, no render

        // Determine which top-level keys changed
        const changedKeys = Object.keys(state).filter(key => {
            return JSON.stringify(state[key]) !== JSON.stringify(JSON.parse(before)[key]);
        });

        notify(changedKeys);
    }

    // ─── GETTERS ────────────────────────────────────────────────

    const getters = {
        isLoggedIn:    () => !!state.auth.user,
        currentUser:   () => state.auth.user,
        userRole:      () => state.auth.user?.role,
        accessToken:   () => state.auth.accessToken,
        currentView:   () => state.nav.currentView,
        cartItemCount: () => state.cart.items.reduce((sum, i) => sum + i.quantity, 0),
    };

    // ─── PUBLIC API ─────────────────────────────────────────────

    return Object.freeze({
        getState:  () => ({ ...state }), // shallow clone for safety
        dispatch,
        subscribe,
        get:       (key) => state[key],
        ...getters,
    });

})();
