/**
 * FlavourConnect — WebSocket Client
 *
 * Features:
 * - JWT authentication via query param on connect
 * - Auto-reconnect with exponential backoff
 * - Heartbeat / ping-pong to detect stale connections
 * - Event routing → Store dispatches
 * - Clean disconnect on logout
 */

const WsClient = (() => {

    const WS_URL         = window.FC_CONFIG?.wsUrl || 'wss://ws.flavourconnect.com';
    const PING_INTERVAL  = 30_000;  // 30 seconds
    const MAX_BACKOFF    = 30_000;  // 30 seconds max retry delay
    const MAX_RETRIES    = 10;

    let socket       = null;
    let pingTimer    = null;
    let retryTimer   = null;
    let retryCount   = 0;
    let _connected   = false;
    let _intentional = false; // true when we deliberately disconnect (logout)

    // ── PUBLIC API ───────────────────────────────────────────────

    function connect() {
        const token = Store.accessToken();
        if (!token || socket?.readyState === WebSocket.OPEN) return;

        _intentional = false;

        const url = `${WS_URL}?token=${encodeURIComponent(token)}`;

        try {
            socket = new WebSocket(url);
        } catch (err) {
            console.error('[WS] Failed to create WebSocket:', err);
            scheduleReconnect();
            return;
        }

        socket.onopen = handleOpen;
        socket.onmessage = handleMessage;
        socket.onclose = handleClose;
        socket.onerror = handleError;
    }

    function disconnect() {
        _intentional = true;
        cleanup();
    }

    function isConnected() {
        return _connected && socket?.readyState === WebSocket.OPEN;
    }

    /** Subscribe to a specific topic (e.g. order tracking) */
    function subscribeTo(topic) {
        if (!isConnected()) return;
        send({ event: 'subscribe', topic });
    }

    // ── HANDLERS ─────────────────────────────────────────────────

    function handleOpen() {
        _connected = true;
        retryCount = 0;
        console.log('[WS] Connected');

        // Start heartbeat
        pingTimer = setInterval(() => {
            if (isConnected()) {
                send({ event: 'ping' });
            }
        }, PING_INTERVAL);
    }

    function handleMessage(ev) {
        let event;
        try {
            event = JSON.parse(ev.data);
        } catch {
            console.warn('[WS] Could not parse message');
            return;
        }

        routeEvent(event);
    }

    function handleClose(ev) {
        _connected = false;
        cleanup(false); // keep socket ref until reconnect decision

        if (ev.code === 1000 || _intentional) {
            // Clean close — don't reconnect
            console.log('[WS] Connection closed cleanly');
            return;
        }

        console.warn(`[WS] Connection lost (code ${ev.code}). Reconnecting…`);
        scheduleReconnect();
    }

    function handleError(err) {
        console.error('[WS] Error:', err);
        // onclose will fire after onerror — reconnect happens there
    }

    // ── EVENT ROUTER ─────────────────────────────────────────────

    function routeEvent(event) {
        const { event: name, payload } = event;

        switch (name) {
            case 'pong':
                // Heartbeat response — connection alive
                break;

            case 'connected':
                console.log('[WS] Authenticated as:', payload);
                break;

            case 'order.created':
                // Vendor receives new order
                handleOrderCreated(payload);
                break;

            case 'order.updated':
                // Customer / vendor / driver receive status change
                handleOrderUpdated(payload);
                break;

            case 'order.ready':
                // All drivers notified a new order is ready for pickup
                handleOrderReady(payload);
                break;

            case 'order.assigned':
                handleOrderAssigned(payload);
                break;

            case 'order.delivered':
                handleOrderDelivered(payload);
                break;

            case 'notification.new':
                handleNewNotification(payload);
                break;

            case 'subscribed':
                console.log('[WS] Subscribed to topic:', payload.topic);
                break;

            case 'error':
                console.error('[WS] Server error:', payload);
                if (payload.code === 'AUTH_FAILED') {
                    // Token expired — attempt refresh then reconnect
                    handleAuthError();
                }
                break;

            default:
                console.debug('[WS] Unknown event:', name, payload);
        }
    }

    // ── EVENT HANDLERS → STATE ────────────────────────────────────

    function handleOrderCreated(payload) {
        const role = Store.userRole();

        // Vendor sees new incoming order
        if (role === 'vendor') {
            Store.dispatch('ADD_NOTIFICATION', {
                type:    'order.created',
                title:   'New Order!',
                message: `Order #${payload.order_id?.slice(0, 8).toUpperCase()} received`,
                payload,
            });

            // Refresh vendor order list if currently viewing orders
            if (Store.currentView() === 'orders' || Store.currentView() === 'vendor-dashboard') {
                Actions.loadOrders('vendor');
            }

            Actions.showToast('🛎 New order received!', 'success');
        }
    }

    function handleOrderUpdated(payload) {
        const role    = Store.userRole();
        const orderId = payload.order_id;
        const status  = payload.status;

        // Update order in list if present
        Store.dispatch('UPDATE_ORDER_IN_LIST', {
            id:     orderId,
            status: status,
            ...payload,
        });

        // If viewing this specific order, refresh it
        const currentOrder = Store.get('orders').current;
        if (currentOrder?.id === orderId) {
            refreshCurrentOrder(orderId);
        }

        // Notify customer
        if (role === 'customer') {
            const statusMessages = {
                accepted:         '✅ Your order has been accepted!',
                preparing:        '👨‍🍳 Your order is being prepared',
                ready:            '📦 Your order is ready for pickup',
                out_for_delivery: '🚗 Your order is on its way!',
                delivered:        '🎉 Your order has been delivered!',
                cancelled:        '❌ Your order was cancelled',
            };
            const msg = statusMessages[status];
            if (msg) {
                Actions.showToast(msg, status === 'cancelled' ? 'error' : 'success');
                Store.dispatch('ADD_NOTIFICATION', {
                    type:    'order.updated',
                    message: msg,
                    payload,
                });
            }
        }

        // Notify driver
        if (role === 'driver' && status === 'delivered') {
            Actions.showToast('Delivery completed!', 'success');
            Actions.loadOrders('driver');
        }
    }

    function handleOrderReady(payload) {
        const role = Store.userRole();
        if (role !== 'driver') return;

        Store.dispatch('ADD_NOTIFICATION', {
            type:    'order.ready',
            title:   'New Pickup Available',
            message: `Order #${payload.order_id?.slice(0, 8).toUpperCase()} is ready for pickup`,
            payload,
        });

        Actions.showToast('📦 New order ready for pickup!', 'info');

        // Refresh driver's available orders
        if (Store.currentView() === 'orders' || Store.currentView() === 'driver-dashboard') {
            Actions.loadOrders('driver');
        }
    }

    function handleOrderAssigned(payload) {
        const role = Store.userRole();
        if (role !== 'driver') return;

        Store.dispatch('ADD_NOTIFICATION', {
            type:    'order.assigned',
            message: `You've been assigned order #${payload.order_id?.slice(0, 8).toUpperCase()}`,
            payload,
        });

        Actions.showToast('Order assigned to you!', 'success');
    }

    function handleOrderDelivered(payload) {
        Store.dispatch('ADD_NOTIFICATION', {
            type:    'order.delivered',
            message: 'Order delivered successfully',
            payload,
        });
    }

    function handleNewNotification(payload) {
        Store.dispatch('ADD_NOTIFICATION', {
            type:    'notification.new',
            message: payload.message || 'New notification',
            payload,
        });
    }

    // ── HELPERS ──────────────────────────────────────────────────

    async function refreshCurrentOrder(orderId) {
        try {
            const data = await Http.get(`/orders/${orderId}`);
            Store.dispatch('SET_CURRENT_ORDER', data.order);
        } catch { /* non-critical */ }
    }

    async function handleAuthError() {
        // Try to refresh the access token, then reconnect
        const rt = Auth.getRefreshToken();
        if (!rt) return;

        try {
            const apiUrl = window.FC_CONFIG?.apiUrl || 'https://api.flavourconnect.com/v1';
            const res  = await fetch(apiUrl + '/auth/refresh', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ refresh_token: rt }),
            });
            const json = await res.json();

            if (res.ok && json.success) {
                Auth.setTokens(json.data.access_token, json.data.refresh_token);
                Store.dispatch('SET_USER', {
                    user:        Store.currentUser(),
                    accessToken: json.data.access_token,
                });
                // Reconnect with new token
                setTimeout(connect, 1000);
            }
        } catch { /* ignore */ }
    }

    function send(data) {
        if (isConnected()) {
            socket.send(JSON.stringify(data));
        }
    }

    function scheduleReconnect() {
        if (retryTimer) clearTimeout(retryTimer);
        if (retryCount >= MAX_RETRIES) {
            console.error('[WS] Max reconnect attempts reached');
            return;
        }

        // Exponential backoff with jitter
        const base  = Math.min(1000 * Math.pow(2, retryCount), MAX_BACKOFF);
        const jitter = Math.random() * 1000;
        const delay  = base + jitter;

        retryCount++;
        console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${retryCount})`);

        retryTimer = setTimeout(() => {
            if (!_intentional && Store.isLoggedIn()) {
                connect();
            }
        }, delay);
    }

    function cleanup(clearSocket = true) {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (retryTimer){ clearTimeout(retryTimer);  retryTimer = null; }

        if (clearSocket && socket) {
            socket.onopen    = null;
            socket.onmessage = null;
            socket.onclose   = null;
            socket.onerror   = null;
            if (socket.readyState === WebSocket.OPEN) {
                socket.close(1000, 'Client disconnect');
            }
            socket = null;
        }

        _connected = false;
    }

    // ── VISIBILITY API ────────────────────────────────────────────
    // Reconnect when tab becomes visible after being hidden

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !_intentional && Store.isLoggedIn()) {
            if (!isConnected()) {
                retryCount = 0; // Reset backoff on user returning to tab
                connect();
            }
        }
    });

    return Object.freeze({ connect, disconnect, isConnected, subscribeTo });

})();
