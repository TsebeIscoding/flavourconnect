/**
 * FlavourConnect — API Service
 *
 * All backend communication goes through here.
 * Components never call Http directly.
 * Each method maps 1:1 to a backend endpoint.
 */

const Api = (() => {

    // ── AUTH ─────────────────────────────────────────────────────

    const auth = {
        register: (data) => Http.post('/auth/register', data),
        login:    (data) => Http.post('/auth/login', data),
        refresh:  (refreshToken) => Http.post('/auth/refresh', { refresh_token: refreshToken }),
        logout:   (refreshToken) => Http.post('/auth/logout', { refresh_token: refreshToken }),
    };

    // ── RESTAURANTS ──────────────────────────────────────────────

    const restaurants = {
        mine:       ()            => Http.get('/restaurants/mine'),
        list:       (params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/restaurants${qs ? '?' + qs : ''}`);
        },
        get:        (id)          => Http.get(`/restaurants/${id}`),
        update:     (id, data)    => Http.patch(`/restaurants/${id}`, data),
        uploadLogo: (id, file)    => {
            const fd = new FormData();
            fd.append('logo', file);
            return Http.upload(`/restaurants/${id}/logo`, fd);
        },
        uploadPhoto: (id, file)   => {
            const fd = new FormData();
            fd.append('photo', file);
            return Http.upload(`/restaurants/${id}/photos`, fd);
        },
        deletePhoto: (id, photoId) => Http.delete(`/restaurants/${id}/photos/${photoId}`),
    };

    // ── MENU ─────────────────────────────────────────────────────

    const menu = {
        list:    (restaurantId, params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/restaurants/${restaurantId}/menu${qs ? '?' + qs : ''}`);
        },
        create:  (data)          => Http.post('/menu', data),
        update:  (id, data)      => Http.patch(`/menu/${id}`, data),
        destroy: (id)            => Http.delete(`/menu/${id}`),
        uploadImage: (id, file)  => {
            const fd = new FormData();
            fd.append('image', file);
            return Http.upload(`/menu/${id}/image`, fd);
        },
    };

    // ── CART ─────────────────────────────────────────────────────

    const cart = {
        get:    ()     => Http.get('/cart'),
        add:    (data) => Http.post('/cart/add', data),
        remove: (data) => Http.post('/cart/remove', data),
        clear:  ()     => Http.delete('/cart'),
    };

    // ── ORDERS ───────────────────────────────────────────────────

    const orders = {
        create:         (data)           => Http.post('/orders', data),
        customerOrders: (params = {})    => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/orders/customer${qs ? '?' + qs : ''}`);
        },
        vendorOrders:   (params = {})    => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/orders/vendor${qs ? '?' + qs : ''}`);
        },
        driverOrders:   (params = {})    => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/orders/driver${qs ? '?' + qs : ''}`);
        },
        get:            (id)             => Http.get(`/orders/${id}`),
        updateStatus:   (id, status)     => Http.patch(`/orders/${id}/status`, { status }),
    };

    // ── DRIVERS ──────────────────────────────────────────────────

    const drivers = {
        setOnlineStatus: (isOnline) => Http.patch('/drivers/status', { is_online: isOnline }),
    };

    // ── ADMIN ────────────────────────────────────────────────────

    const admin = {
        listUsers:  (params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/admin/users${qs ? '?' + qs : ''}`);
        },
        updateUser: (id, data)    => Http.patch(`/admin/users/${id}`, data),
        listOrders: (params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return Http.get(`/admin/orders${qs ? '?' + qs : ''}`);
        },
        getStats:   ()            => Http.get('/admin/stats'),
    };

    // ── USERS (profile, all roles) ──────────────────────────────

    const users = {
        getProfile:    ()         => Http.get('/users/me'),
        updateProfile: (data)     => Http.patch('/users/me', data),
        uploadAvatar:  (file)     => {
            const fd = new FormData();
            fd.append('avatar', file);
            return Http.upload('/users/me/avatar', fd);
        },
    };

    return Object.freeze({ auth, restaurants, menu, cart, orders, drivers, admin, users });

})();

// ─── ACTION CREATORS ────────────────────────────────────────────
// These coordinate API calls + state updates + error handling

const Actions = (() => {

    // ── AUTH ACTIONS ─────────────────────────────────────────────

    async function login(email, password) {
        Store.dispatch('SET_AUTH_LOADING', true);
        try {
            const data = await Api.auth.login({ email, password });
            Auth.setTokens(data.access_token, data.refresh_token);
            Store.dispatch('SET_USER', {
                user:        data.user,
                accessToken: data.access_token,
            });
            // Navigate based on role
            navigateByRole(data.user.role);
            return true;
        } catch (err) {
            Store.dispatch('SET_AUTH_ERROR', {
                message: err.message,
                fields:  err.fields || null,
                code:    err.code   || null,
            });
            return false;
        }
    }

    async function register(formData) {
        Store.dispatch('SET_AUTH_LOADING', true);
        try {
            const data = await Api.auth.register(formData);
            Auth.setTokens(data.access_token, data.refresh_token);
            Store.dispatch('SET_USER', {
                user:        data.user,
                accessToken: data.access_token,
            });
            navigateByRole(data.user.role);
            return true;
        } catch (err) {
            Store.dispatch('SET_AUTH_ERROR', {
                message: err.message,
                fields:  err.fields || null,
                code:    err.code   || null,
            });
            return false;
        }
    }

    async function logout() {
        try {
            const rt = Auth.getRefreshToken();
            if (rt) await Api.auth.logout(rt);
        } catch { /* ignore errors on logout */ }
        Auth.clearSession();
        Store.dispatch('CLEAR_USER');
        Store.dispatch('NAVIGATE', { view: 'home' });
    }

    // ── RESTAURANT ACTIONS ───────────────────────────────────────

    async function loadRestaurants(filters = {}) {
        Store.dispatch('SET_RESTAURANTS_LOADING', true);
        try {
            const data = await Api.restaurants.list(filters);
            Store.dispatch('SET_RESTAURANTS', data);
        } catch (err) {
            showToast(err.message, 'error');
            Store.dispatch('SET_RESTAURANTS_LOADING', false);
        }
    }

    async function loadRestaurant(id) {
        Store.dispatch('SET_RESTAURANTS_LOADING', true);
        Store.dispatch('SET_MENU_LOADING', true);
        try {
            const [restData, menuData] = await Promise.all([
                Api.restaurants.get(id),
                Api.menu.list(id),
            ]);
            Store.dispatch('SET_RESTAURANT', restData.restaurant ?? restData);
            Store.dispatch('SET_MENU', menuData.menu_items);
            Store.dispatch('NAVIGATE', { view: 'restaurant', params: { restaurantId: id } });
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    // ── CART ACTIONS ─────────────────────────────────────────────

    async function loadCart() {
        Store.dispatch('SET_CART_LOADING', true);
        try {
            const data = await Api.cart.get();
            Store.dispatch('SET_CART', data.cart);
        } catch (err) {
            Store.dispatch('SET_CART_ERROR', err.message);
        }
    }

    async function addToCart(menuItemId, quantity = 1) {
        Store.dispatch('SET_CART_LOADING', true);
        try {
            const data = await Api.cart.add({ menu_item_id: menuItemId, quantity });
            Store.dispatch('SET_CART', data.cart);
            showToast('Added to cart!', 'success');
        } catch (err) {
            Store.dispatch('SET_CART_ERROR', err.message);
            showToast(err.message, 'error');
        }
    }

    async function removeFromCart(menuItemId) {
        Store.dispatch('SET_CART_LOADING', true);
        try {
            const data = await Api.cart.remove({ menu_item_id: menuItemId });
            Store.dispatch('SET_CART', data.cart);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function clearCart() {
        try {
            await Api.cart.clear();
            Store.dispatch('SET_CART', {
                id: null, restaurant_id: null, restaurant_name: null,
                items: [], subtotal: 0, item_count: 0,
            });
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    // ── ORDER ACTIONS ────────────────────────────────────────────

    async function checkout(deliveryAddress) {
        Store.dispatch('SET_ORDERS_LOADING', true);
        try {
            const data = await Api.orders.create({ delivery_address: deliveryAddress });
            Store.dispatch('SET_CURRENT_ORDER', data.order);
            // Clear cart from state after successful order
            Store.dispatch('SET_CART', {
                restaurant_id: null, restaurant_name: null,
                items: [], subtotal: 0, item_count: 0,
            });
            Store.dispatch('NAVIGATE', { view: 'order-detail', params: { orderId: data.order.id } });
            showToast('Order placed! The vendor has been notified.', 'success');
            return data.order;
        } catch (err) {
            Store.dispatch('SET_ORDERS_LOADING', false);
            showToast(err.message, 'error');
            return null;
        }
    }

    async function loadOrders(role) {
        Store.dispatch('SET_ORDERS_LOADING', true);
        try {
            let data;
            switch (role) {
                case 'customer': data = await Api.orders.customerOrders(); break;
                case 'vendor':   data = await Api.orders.vendorOrders();   break;
                case 'driver':   data = await Api.orders.driverOrders();   break;
                default: return;
            }
            Store.dispatch('SET_ORDERS', data);
        } catch (err) {
            showToast(err.message, 'error');
            Store.dispatch('SET_ORDERS_LOADING', false);
        }
    }

    async function updateOrderStatus(orderId, newStatus) {
        try {
            const data = await Api.orders.updateStatus(orderId, newStatus);
            Store.dispatch('UPDATE_ORDER_IN_LIST', data.order);
            Store.dispatch('SET_CURRENT_ORDER', data.order);
            showToast(`Order status updated to: ${newStatus.replace(/_/g, ' ')}`, 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function setDriverStatus(isOnline) {
        try {
            await Api.drivers.setOnlineStatus(isOnline);
            showToast(isOnline ? 'You are now online' : 'You are now offline', 'info');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    // ── HELPERS ──────────────────────────────────────────────────

    function navigateByRole(role) {
        const viewMap = {
            customer: 'home',
            vendor:   'vendor-dashboard',
            driver:   'driver-dashboard',
            admin:    'admin-dashboard',
        };
        Store.dispatch('NAVIGATE', { view: viewMap[role] || 'home' });
    }

    function showToast(message, type = 'info') {
        // Suppress network connection errors in dev — they appear when
        // services restart and are not actionable by the user
        const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isDev && message.includes('Network error')) {
            console.warn('[FC] Network error suppressed in dev:', message);
            return;
        }
        Store.dispatch('SHOW_TOAST', { message, type });
        // Auto-hide after 4 seconds
        setTimeout(() => Store.dispatch('HIDE_TOAST'), 4000);
    }

    return Object.freeze({
        login,
        register,
        logout,
        loadRestaurants,
        loadRestaurant,
        loadCart,
        addToCart,
        removeFromCart,
        clearCart,
        checkout,
        loadOrders,
        updateOrderStatus,
        setDriverStatus,
        showToast,
    });

})();
