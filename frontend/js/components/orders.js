/**
 * FlavourConnect — Orders Component
 *
 * renderOrders()      — list view (adapts per role)
 * renderOrderDetail() — single order with status controls
 */

const OrderComponents = (() => {

    const STATUS_LABELS = {
        pending:          'Pending',
        accepted:         'Accepted',
        preparing:        'Preparing',
        ready:            'Ready for Pickup',
        out_for_delivery: 'Out for Delivery',
        delivered:        'Delivered',
        cancelled:        'Cancelled',
    };

    // Next allowed status per role
    const NEXT_STATUS = {
        customer: { pending: 'cancelled' },
        vendor:   { pending: 'accepted', accepted: 'preparing', preparing: 'ready' },
        driver:   { ready: 'out_for_delivery', out_for_delivery: 'delivered' },
    };

    const STATUS_BTN_LABEL = {
        accepted:         'Accept Order',
        preparing:        'Start Preparing',
        ready:            'Mark Ready',
        out_for_delivery: 'Pick Up & Start Delivery',
        delivered:        'Mark Delivered',
        cancelled:        'Cancel Order',
    };

    // ── ORDER LIST ───────────────────────────────────────────────

    function renderOrders(state) {
        const { list, isLoading, error, pagination } = state.orders;
        const role      = state.auth.user?.role;
        const container = Dom.qs('#view-content');
        if (!container) return;

        const wrapper = Dom.el('div', { class: 'orders-page' });

        // Heading
        const headingText = {
            customer: 'My Orders',
            vendor:   'Restaurant Orders',
            driver:   'Available Deliveries',
            admin:    'All Orders',
        };
        const heading = Dom.el('h1', { class: 'page-heading' }, [headingText[role] || 'Orders']);
        wrapper.appendChild(heading);

        // Driver online toggle
        if (role === 'driver') {
            wrapper.appendChild(renderDriverToggle(state));
        }

        if (isLoading) {
            for (let i = 0; i < 4; i++) wrapper.appendChild(Dom.skeleton(4));
            Dom.render(container, wrapper);
            return;
        }

        if (error) {
            wrapper.appendChild(Dom.el('p', { class: 'state-error' }, [error]));
            Dom.render(container, wrapper);
            return;
        }

        if (!list || list.length === 0) {
            wrapper.appendChild(Dom.el('p', { class: 'state-empty' }, ['No orders found.']));
            Dom.render(container, wrapper);
            return;
        }

        const ordersList = Dom.el('div', { class: 'orders-list' });
        list.forEach(order => ordersList.appendChild(renderOrderCard(order, role)));
        wrapper.appendChild(ordersList);

        // Pagination
        if (pagination && pagination.total > pagination.limit) {
            wrapper.appendChild(renderPagination(pagination, role));
        }

        Dom.render(container, wrapper);
    }

    function renderOrderCard(order, role) {
        const card = Dom.el('article', {
            class:   'order-card',
            dataset: { orderId: order.id },
        });

        const header = Dom.el('div', { class: 'order-card__header' });

        const idSpan = Dom.el('span', { class: 'order-card__id' });
        idSpan.textContent = `Order #${order.id.slice(0, 8).toUpperCase()}`;

        const statusBadge = Dom.statusBadge(order.status);
        header.appendChild(idSpan);
        header.appendChild(statusBadge);
        card.appendChild(header);

        const body = Dom.el('div', { class: 'order-card__body' });

        const restaurant = Dom.el('p', { class: 'order-card__restaurant' });
        restaurant.textContent = order.restaurant_name || '';
        body.appendChild(restaurant);

        const total = Dom.el('p', { class: 'order-card__total' });
        total.textContent = `Total: ${Dom.formatPrice(order.total)}`;
        body.appendChild(total);

        const time = Dom.el('p', { class: 'order-card__time' });
        time.textContent = Dom.formatTime(order.created_at);
        body.appendChild(time);

        card.appendChild(body);

        // Action buttons
        const actions = Dom.el('div', { class: 'order-card__actions' });

        const viewBtn = Dom.el('button', { class: 'btn btn--ghost btn--sm' }, ['View Details']);
        viewBtn.addEventListener('click', async () => {
            Store.dispatch('SET_ORDERS_LOADING', true);
            try {
                const data = await Http.get(`/orders/${order.id}`);
                Store.dispatch('SET_CURRENT_ORDER', data.order);
                Store.dispatch('NAVIGATE', { view: 'order-detail', params: { orderId: order.id } });
            } catch (err) {
                Actions.showToast(err.message, 'error');
                Store.dispatch('SET_ORDERS_LOADING', false);
            }
        });
        actions.appendChild(viewBtn);

        // Quick status action
        const nextStatus = NEXT_STATUS[role]?.[order.status];
        if (nextStatus) {
            const actionBtn = Dom.el('button', {
                class: `btn btn--primary btn--sm btn--status-${nextStatus}`,
            }, [STATUS_BTN_LABEL[nextStatus] || nextStatus]);

            actionBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                actionBtn.disabled = true;
                await Actions.updateOrderStatus(order.id, nextStatus);
                actionBtn.disabled = false;
            });
            actions.appendChild(actionBtn);
        }

        card.appendChild(actions);
        return card;
    }

    // ── ORDER DETAIL ─────────────────────────────────────────────

    function renderOrderDetail(state) {
        const { current: order, isLoading } = state.orders;
        const role      = state.auth.user?.role;
        const container = Dom.qs('#view-content');
        if (!container) return;

        if (isLoading || !order) {
            Dom.render(container, Dom.skeleton(6));
            return;
        }

        const wrapper = Dom.el('div', { class: 'order-detail' });

        // Back button
        const backBtn = Dom.el('button', { class: 'btn btn--ghost' }, ['← Back to Orders']);
        backBtn.addEventListener('click', () => {
            Store.dispatch('NAVIGATE', { view: 'orders' });
        });
        wrapper.appendChild(backBtn);

        // Heading
        const heading = Dom.el('h1', { class: 'page-heading' });
        heading.textContent = `Order #${order.id.slice(0, 8).toUpperCase()}`;
        wrapper.appendChild(heading);

        // Status timeline
        wrapper.appendChild(renderStatusTimeline(order.status));

        // Order info grid
        const infoGrid = Dom.el('div', { class: 'order-detail__grid' });

        const infoCard = Dom.el('div', { class: 'order-detail__info-card' });

        const restaurantRow = buildInfoRow('Restaurant', order.restaurant_name);
        const addressRow    = buildInfoRow('Delivery Address', order.delivery_address);
        const timeRow       = buildInfoRow('Placed', Dom.formatTime(order.created_at));

        infoCard.appendChild(restaurantRow);
        infoCard.appendChild(addressRow);
        infoCard.appendChild(timeRow);

        // Driver info — shown once a driver has been assigned
        if (order.driver_name && ['out_for_delivery', 'delivered'].includes(order.status)) {
            infoCard.appendChild(buildDriverInfo(order));
        }

        // Items
        const itemsCard = Dom.el('div', { class: 'order-detail__items-card' });
        const itemsHeading = Dom.el('h2', {}, ['Items']);
        itemsCard.appendChild(itemsHeading);

        if (order.items) {
            const itemsList = Dom.el('ul', { class: 'order-detail__items' });
            order.items.forEach(item => {
                const li = Dom.el('li', { class: 'order-detail__item' });
                const nameQty = Dom.el('span', {});
                nameQty.textContent = `${item.name} × ${item.quantity}`;
                const price = Dom.el('span', {});
                price.textContent = Dom.formatPrice(item.line_total);
                li.appendChild(nameQty);
                li.appendChild(price);
                itemsList.appendChild(li);
            });
            itemsCard.appendChild(itemsList);
        }

        // Totals
        const totalsDiv = Dom.el('div', { class: 'order-detail__totals' });
        totalsDiv.appendChild(buildTotalRow('Subtotal',     Dom.formatPrice(order.subtotal)));
        totalsDiv.appendChild(buildTotalRow('Delivery Fee', Dom.formatPrice(order.delivery_fee)));
        const totalRow = buildTotalRow('Total', Dom.formatPrice(order.total));
        totalRow.classList.add('order-detail__total--final');
        totalsDiv.appendChild(totalRow);
        itemsCard.appendChild(totalsDiv);

        infoGrid.appendChild(infoCard);
        infoGrid.appendChild(itemsCard);
        wrapper.appendChild(infoGrid);

        // Status action buttons
        wrapper.appendChild(renderStatusActions(order, role));

        Dom.render(container, wrapper);
    }

    function renderStatusTimeline(currentStatus) {
        const statuses = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
        const isCancelled = currentStatus === 'cancelled';

        const timeline = Dom.el('div', { class: 'status-timeline' });

        if (isCancelled) {
            const cancelled = Dom.el('div', { class: 'status-timeline__cancelled' }, ['Order Cancelled']);
            timeline.appendChild(cancelled);
            return timeline;
        }

        const currentIdx = statuses.indexOf(currentStatus);

        statuses.forEach((status, idx) => {
            const step = Dom.el('div', {
                class: `timeline-step ${idx <= currentIdx ? 'timeline-step--done' : ''} ${idx === currentIdx ? 'timeline-step--current' : ''}`,
            });
            const dot   = Dom.el('div', { class: 'timeline-step__dot' });
            const label = Dom.el('span', { class: 'timeline-step__label' });
            label.textContent = STATUS_LABELS[status] || status;
            step.appendChild(dot);
            step.appendChild(label);
            timeline.appendChild(step);

            if (idx < statuses.length - 1) {
                const connector = Dom.el('div', {
                    class: `timeline-connector ${idx < currentIdx ? 'timeline-connector--done' : ''}`,
                });
                timeline.appendChild(connector);
            }
        });

        return timeline;
    }

    function renderStatusActions(order, role) {
        const nextStatus = NEXT_STATUS[role]?.[order.status];
        if (!nextStatus) return Dom.el('div'); // empty fragment

        const actions = Dom.el('div', { class: 'order-detail__actions' });
        const btn = Dom.el('button', {
            class: 'btn btn--primary',
        }, [STATUS_BTN_LABEL[nextStatus] || nextStatus]);

        btn.addEventListener('click', async () => {
            btn.disabled    = true;
            btn.textContent = 'Updating…';
            await Actions.updateOrderStatus(order.id, nextStatus);
            btn.disabled    = false;
            btn.textContent = STATUS_BTN_LABEL[nextStatus];
        });

        actions.appendChild(btn);
        return actions;
    }

    function renderDriverToggle(state) {
        const wrapper = Dom.el('div', { class: 'driver-toggle' });
        const label   = Dom.el('label', { class: 'driver-toggle__label' });
        const input   = Dom.el('input', { type: 'checkbox' });
        // Reflect actual online state from user object
        input.checked = state.auth.user?.is_online || false;

        input.addEventListener('change', async (e) => {
            input.disabled = true;
            await Actions.setDriverStatus(e.target.checked);
            input.disabled = false;
        });

        const text = Dom.el('span', {}, ['Available for deliveries']);
        label.appendChild(input);
        label.appendChild(text);
        wrapper.appendChild(label);
        return wrapper;
    }

    function renderPagination(pagination, role) {
        const { page, limit, total } = pagination;
        const totalPages = Math.ceil(total / limit);

        const pag = Dom.el('div', { class: 'pagination' });

        if (page > 1) {
            const prev = Dom.el('button', { class: 'btn btn--ghost btn--sm' }, ['← Prev']);
            prev.addEventListener('click', () => Actions.loadOrders(role, { page: page - 1 }));
            pag.appendChild(prev);
        }

        const info = Dom.el('span', { class: 'pagination__info' });
        info.textContent = `Page ${page} of ${totalPages}`;
        pag.appendChild(info);

        if (page < totalPages) {
            const next = Dom.el('button', { class: 'btn btn--ghost btn--sm' }, ['Next →']);
            next.addEventListener('click', () => Actions.loadOrders(role, { page: page + 1 }));
            pag.appendChild(next);
        }

        return pag;
    }

    function buildDriverInfo(order) {
        const row = Dom.el('div', { class: 'info-row driver-info-row' });

        const avatar = Dom.el('div', { class: 'driver-info-avatar' });
        if (order.driver_avatar_url) {
            avatar.appendChild(Dom.el('img', {
                src: order.driver_avatar_url, alt: order.driver_name, class: 'driver-info-avatar__img',
            }));
        } else {
            const initials = (order.driver_name || '?')
                .split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
            avatar.appendChild(Dom.el('span', { class: 'driver-info-avatar__initials' }, [initials]));
        }

        const text = Dom.el('div', {});
        text.appendChild(Dom.el('span', { class: 'info-row__label' }, ['Your Driver']));
        text.appendChild(Dom.el('p', { class: 'driver-info-name' }, [order.driver_name]));

        row.appendChild(avatar);
        row.appendChild(text);
        return row;
    }

    function buildInfoRow(label, value) {
        const row = Dom.el('div', { class: 'info-row' });
        const lbl = Dom.el('span', { class: 'info-row__label' }, [label]);
        const val = Dom.el('span', { class: 'info-row__value' });
        val.textContent = value || '—';
        row.appendChild(lbl);
        row.appendChild(val);
        return row;
    }

    function buildTotalRow(label, value) {
        const row = Dom.el('div', { class: 'order-total-row' });
        const lbl = Dom.el('span', {}, [label]);
        const val = Dom.el('span', {});
        val.textContent = value;
        row.appendChild(lbl);
        row.appendChild(val);
        return row;
    }

    return Object.freeze({
        renderOrders,
        renderOrderDetail,
    });

})();
