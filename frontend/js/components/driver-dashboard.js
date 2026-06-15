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

        // Profile photo upload
        wrapper.appendChild(buildAvatarSection(auth.user));

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

    // ── PROFILE PHOTO ────────────────────────────────────────────

    function buildAvatarSection(user) {
        const section = Dom.el('div', { class: 'driver-avatar-section' });

        const preview = Dom.el('div', { class: 'avatar-preview' });
        if (user?.avatar_url) {
            preview.appendChild(Dom.el('img', {
                src: user.avatar_url, alt: 'Your profile photo', class: 'avatar-preview__img',
            }));
        } else {
            const initials = (user?.full_name || '?')
                .split(' ')
                .map(p => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();
            preview.appendChild(Dom.el('span', { class: 'avatar-preview__initials' }, [initials]));
        }

        const info = Dom.el('div', { class: 'driver-avatar-info' });
        info.appendChild(Dom.el('p', { class: 'driver-avatar-name' }, [user?.full_name || '']));

        const fileInput = Dom.el('input', {
            type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'visually-hidden',
        });

        const chooseBtn = Dom.el('button', { class: 'btn btn--secondary btn--sm' }, [
            user?.avatar_url ? 'Change Photo' : 'Add Profile Photo'
        ]);
        chooseBtn.addEventListener('click', () => fileInput.click());

        const hint = Dom.el('p', { class: 'form-field__hint' }, [
            'Customers see this photo during delivery tracking. JPG/PNG/WebP, max 2MB.',
        ]);

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                Dom.render(preview, Dom.el('img', {
                    src: e.target.result, alt: 'Your profile photo', class: 'avatar-preview__img',
                }));
            };
            reader.readAsDataURL(file);

            chooseBtn.disabled    = true;
            chooseBtn.textContent = 'Uploading…';

            try {
                const result = await Api.users.uploadAvatar(file);
                Store.dispatch('SET_USER', {
                    user: { ...user, avatar_url: result.avatar_url },
                    accessToken: Store.accessToken(),
                });
                Actions.showToast('Profile photo updated', 'success');
                chooseBtn.textContent = 'Change Photo';
            } catch (err) {
                Actions.showToast(err.message, 'error');
                chooseBtn.textContent = user?.avatar_url ? 'Change Photo' : 'Add Profile Photo';
            }

            chooseBtn.disabled = false;
        });

        info.appendChild(chooseBtn);
        info.appendChild(hint);
        info.appendChild(fileInput);

        section.appendChild(preview);
        section.appendChild(info);

        return section;
    }

    return Object.freeze({ renderDashboard });

})();
