/**
 * FlavourConnect — Driver Dashboard Component
 */

const DriverComponents = (() => {

    function renderDashboard(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { orders, auth } = state;
        const wrapper = Dom.el('div', { class: 'driver-dashboard' });

        const heading = Dom.el('h1', { class: 'page-heading' }, ['Driver Dashboard']);
        wrapper.appendChild(heading);

        // Online/offline toggle
        const toggle = Dom.el('div', { class: 'driver-toggle' });
        const label  = Dom.el('label', { class: 'driver-toggle__label' });
        const input  = Dom.el('input', { type: 'checkbox' });
        input.checked = auth.user?.is_online || false;

        input.addEventListener('change', async (e) => {
            input.disabled = true;
            await Actions.setDriverStatus(e.target.checked);
            input.disabled = false;
        });

        const text = Dom.el('span', {}, [
            input.checked ? 'You are online — accepting deliveries' : 'You are offline'
        ]);
        label.appendChild(input);
        label.appendChild(text);
        toggle.appendChild(label);
        wrapper.appendChild(toggle);

        // Available orders (status = ready)
        const availableHeading = Dom.el('h2', { class: 'section-heading' }, ['Available Pickups']);
        wrapper.appendChild(availableHeading);

        if (orders.isLoading) {
            wrapper.appendChild(Dom.skeleton(3));
        } else {
            const available = (orders.list || []).filter(o => o.status === 'ready');

            if (available.length === 0) {
                wrapper.appendChild(Dom.el('p', { class: 'state-empty' }, ['No orders ready for pickup right now.']));
            } else {
                const list = Dom.el('div', { class: 'orders-list' });
                available.forEach(order => {
                    list.appendChild(buildDriverOrderCard(order));
                });
                wrapper.appendChild(list);
            }
        }

        // Active delivery
        const active = (orders.list || []).find(o => o.status === 'out_for_delivery');
        if (active) {
            const activeHeading = Dom.el('h2', { class: 'section-heading' }, ['Active Delivery']);
            wrapper.appendChild(activeHeading);
            wrapper.appendChild(buildActiveDeliveryCard(active));
        }

        Dom.render(container, wrapper);
    }

    function buildDriverOrderCard(order) {
        const card = Dom.el('div', { class: 'order-card' });

        const header = Dom.el('div', { class: 'order-card__header' });
        const id = Dom.el('span', { class: 'order-card__id' });
        id.textContent = `#${order.id.slice(0, 8).toUpperCase()}`;
        header.appendChild(id);
        header.appendChild(Dom.statusBadge(order.status));
        card.appendChild(header);

        const restaurant = Dom.el('p', { class: 'order-card__restaurant' });
        restaurant.textContent = order.restaurant_name || '';
        card.appendChild(restaurant);

        const total = Dom.el('p', { class: 'order-card__total' });
        total.textContent = `Total: ${Dom.formatPrice(order.total)}`;
        card.appendChild(total);

        const addr = Dom.el('p', { class: 'order-card__time' });
        addr.textContent = order.delivery_address || '';
        card.appendChild(addr);

        const pickupBtn = Dom.el('button', { class: 'btn btn--primary' }, ['Pick Up & Start Delivery']);
        pickupBtn.addEventListener('click', async () => {
            pickupBtn.disabled    = true;
            pickupBtn.textContent = 'Updating…';
            await Actions.updateOrderStatus(order.id, 'out_for_delivery');
            await Actions.loadOrders('driver');
            pickupBtn.disabled    = false;
            pickupBtn.textContent = 'Pick Up & Start Delivery';
        });
        card.appendChild(pickupBtn);

        return card;
    }

    function buildActiveDeliveryCard(order) {
        const card = Dom.el('div', { class: 'order-card order-card--active' });

        const id = Dom.el('p', { class: 'order-card__id' });
        id.textContent = `#${order.id.slice(0, 8).toUpperCase()}`;
        card.appendChild(id);

        const addr = Dom.el('p', { class: 'order-card__restaurant' });
        addr.textContent = `Delivering to: ${order.delivery_address}`;
        card.appendChild(addr);

        const deliveredBtn = Dom.el('button', { class: 'btn btn--primary' }, ['Mark as Delivered']);
        deliveredBtn.addEventListener('click', async () => {
            deliveredBtn.disabled    = true;
            deliveredBtn.textContent = 'Updating…';
            await Actions.updateOrderStatus(order.id, 'delivered');
            await Actions.loadOrders('driver');
        });
        card.appendChild(deliveredBtn);

        return card;
    }

    return Object.freeze({ renderDashboard });

})();
