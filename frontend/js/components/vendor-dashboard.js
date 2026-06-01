/**
 * FlavourConnect — Vendor Dashboard Component
 *
 * renderDashboard()   — overview: incoming orders + restaurant status
 * renderMenuManager() — add/edit menu items
 */

const VendorComponents = (() => {

    // ── DASHBOARD ────────────────────────────────────────────────

    function renderDashboard(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { orders, auth } = state;
        const wrapper = Dom.el('div', { class: 'vendor-dashboard' });

        // Header + restaurant toggle
        const header = Dom.el('div', { class: 'vendor-dashboard__header' });
        const heading = Dom.el('h1', { class: 'page-heading' }, ['Vendor Dashboard']);
        header.appendChild(heading);

        // Restaurant open/close toggle
        const restaurantToggle = buildRestaurantToggle(state);
        header.appendChild(restaurantToggle);
        wrapper.appendChild(header);

        // Active order stats
        wrapper.appendChild(buildOrderStats(orders.list));

        // Order columns by status
        wrapper.appendChild(buildOrderKanban(orders.list));

        Dom.render(container, wrapper);
    }

    function buildRestaurantToggle(state) {
        const toggle = Dom.el('div', { class: 'restaurant-toggle' });
        const label  = Dom.el('label', { class: 'restaurant-toggle__label' });

        const checkbox = Dom.el('input', { type: 'checkbox' });
        // Reflect current is_open from restaurant data
        // In a full implementation this would come from state.restaurants.current
        checkbox.addEventListener('change', async (e) => {
            checkbox.disabled = true;
            try {
                // Fetch vendor's restaurant ID first
                const restData = await Http.get('/restaurants/mine');
                if (restData?.restaurant?.id) {
                    await Api.restaurants.update(restData.restaurant.id, { is_open: e.target.checked });
                    Actions.showToast(
                        e.target.checked ? 'Restaurant is now open' : 'Restaurant is now closed',
                        'success'
                    );
                }
            } catch (err) {
                Actions.showToast(err.message, 'error');
                checkbox.checked = !e.target.checked; // revert
            }
            checkbox.disabled = false;
        });

        const text = Dom.el('span', {}, ['Restaurant Open']);
        label.appendChild(checkbox);
        label.appendChild(text);
        toggle.appendChild(label);
        return toggle;
    }

    function buildOrderStats(orders) {
        const stats = Dom.el('div', { class: 'order-stats' });

        const counts = {
            pending:    0,
            preparing:  0,
            ready:      0,
            total:      orders.length,
        };

        orders.forEach(o => {
            if (o.status in counts) counts[o.status]++;
        });

        const cards = [
            { label: 'Pending',   value: counts.pending,   color: 'warning' },
            { label: 'Preparing', value: counts.preparing, color: 'info' },
            { label: 'Ready',     value: counts.ready,     color: 'success' },
            { label: 'Total Today', value: counts.total,   color: 'brand' },
        ];

        cards.forEach(({ label, value, color }) => {
            const card = Dom.el('div', { class: `stat-card stat-card--${color}` });
            const num  = Dom.el('div', { class: 'stat-card__number' }, [String(value)]);
            const lbl  = Dom.el('div', { class: 'stat-card__label' }, [label]);
            card.appendChild(num);
            card.appendChild(lbl);
            stats.appendChild(card);
        });

        return stats;
    }

    function buildOrderKanban(orders) {
        const kanban = Dom.el('div', { class: 'kanban' });

        const columns = [
            { status: 'pending',   label: 'Incoming',   nextStatus: 'accepted',  btnLabel: 'Accept' },
            { status: 'accepted',  label: 'Accepted',   nextStatus: 'preparing', btnLabel: 'Start Preparing' },
            { status: 'preparing', label: 'Preparing',  nextStatus: 'ready',     btnLabel: 'Mark Ready' },
            { status: 'ready',     label: 'Ready for Pickup', nextStatus: null,  btnLabel: null },
        ];

        columns.forEach(col => {
            const colOrders = orders.filter(o => o.status === col.status);
            const column    = Dom.el('div', { class: 'kanban__column' });

            const colHeader = Dom.el('div', { class: 'kanban__column-header' });
            const colTitle  = Dom.el('h3', { class: 'kanban__column-title' }, [col.label]);
            const colBadge  = Dom.el('span', { class: 'kanban__column-count' }, [String(colOrders.length)]);
            colHeader.appendChild(colTitle);
            colHeader.appendChild(colBadge);
            column.appendChild(colHeader);

            const cards = Dom.el('div', { class: 'kanban__cards' });

            if (colOrders.length === 0) {
                const empty = Dom.el('div', { class: 'kanban__empty' }, ['No orders']);
                cards.appendChild(empty);
            } else {
                colOrders.forEach(order => {
                    cards.appendChild(buildKanbanCard(order, col.nextStatus, col.btnLabel));
                });
            }

            column.appendChild(cards);
            kanban.appendChild(column);
        });

        return kanban;
    }

    function buildKanbanCard(order, nextStatus, btnLabel) {
        const card = Dom.el('div', { class: 'kanban-card' });

        const idEl = Dom.el('div', { class: 'kanban-card__id' });
        idEl.textContent = `#${order.id.slice(0, 8).toUpperCase()}`;

        const totalEl = Dom.el('div', { class: 'kanban-card__total' });
        totalEl.textContent = Dom.formatPrice(order.total);

        const timeEl = Dom.el('div', { class: 'kanban-card__time' });
        timeEl.textContent = Dom.formatTime(order.created_at);

        card.appendChild(idEl);
        card.appendChild(totalEl);
        card.appendChild(timeEl);

        if (nextStatus && btnLabel) {
            const btn = Dom.el('button', {
                class: 'btn btn--primary btn--sm btn--full',
            }, [btnLabel]);

            btn.addEventListener('click', async () => {
                btn.disabled    = true;
                btn.textContent = 'Updating…';
                await Actions.updateOrderStatus(order.id, nextStatus);
                btn.disabled    = false;
                btn.textContent = btnLabel;
            });
            card.appendChild(btn);
        }

        return card;
    }

    // ── MENU MANAGER ─────────────────────────────────────────────

    function renderMenuManager(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { items, isLoading } = state.menu;
        const wrapper = Dom.el('div', { class: 'menu-manager' });

        const header = Dom.el('div', { class: 'menu-manager__header' });
        const heading = Dom.el('h1', { class: 'page-heading' }, ['My Menu']);

        const addBtn = Dom.el('button', { class: 'btn btn--primary' }, ['+ Add Item']);
        addBtn.addEventListener('click', () => showAddItemModal(state));

        header.appendChild(heading);
        header.appendChild(addBtn);
        wrapper.appendChild(header);

        if (isLoading) {
            wrapper.appendChild(Dom.skeleton(4));
        } else if (items.length === 0) {
            wrapper.appendChild(Dom.el('p', { class: 'state-empty' }, ['No menu items yet. Add your first item!']));
        } else {
            const table = buildMenuTable(items);
            wrapper.appendChild(table);
        }

        Dom.render(container, wrapper);
    }

    function buildMenuTable(items) {
        const table = Dom.el('table', { class: 'menu-table' });

        const thead = Dom.el('thead');
        const headerRow = Dom.el('tr');
        ['Name', 'Price', 'Status', 'Actions'].forEach(col => {
            const th = Dom.el('th', {}, [col]);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = Dom.el('tbody');
        items.forEach(item => {
            const row = Dom.el('tr', {
                class: !item.is_available ? 'menu-table__row--unavailable' : '',
            });

            const nameCell  = Dom.el('td', { class: 'menu-table__name' });
            nameCell.textContent = item.name;

            const priceCell = Dom.el('td');
            priceCell.textContent = Dom.formatPrice(item.price);

            const statusCell = Dom.el('td');
            statusCell.appendChild(Dom.el('span', {
                class: `badge badge--${item.is_available ? 'open' : 'closed'}`,
            }, [item.is_available ? 'Available' : 'Unavailable']));

            const actionsCell = Dom.el('td', { class: 'menu-table__actions' });

            const toggleBtn = Dom.el('button', {
                class: 'btn btn--ghost btn--sm',
            }, [item.is_available ? 'Disable' : 'Enable']);

            toggleBtn.addEventListener('click', async () => {
                toggleBtn.disabled = true;
                try {
                    await Api.menu.update(item.id, { is_available: !item.is_available });
                    // Reload menu
                    const role = Store.userRole();
                    const restData = await Http.get('/restaurants/mine');
                    if (restData?.restaurant?.id) {
                        const menuData = await Api.menu.list(restData.restaurant.id);
                        Store.dispatch('SET_MENU', menuData.menu_items);
                    }
                } catch (err) {
                    Actions.showToast(err.message, 'error');
                }
                toggleBtn.disabled = false;
            });

            const editBtn = Dom.el('button', { class: 'btn btn--ghost btn--sm' }, ['Edit']);
            editBtn.addEventListener('click', () => showEditItemModal(item));

            actionsCell.appendChild(toggleBtn);
            actionsCell.appendChild(editBtn);

            row.appendChild(nameCell);
            row.appendChild(priceCell);
            row.appendChild(statusCell);
            row.appendChild(actionsCell);
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        return table;
    }

    function showAddItemModal(state) {
        const modal = buildItemModal(null);
        document.body.appendChild(modal);
        modal.querySelector('input')?.focus();
    }

    function showEditItemModal(item) {
        const modal = buildItemModal(item);
        document.body.appendChild(modal);
        modal.querySelector('input')?.focus();
    }

    function buildItemModal(existingItem) {
        const overlay = Dom.el('div', { class: 'modal-overlay' });
        const modal   = Dom.el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });

        const title = Dom.el('h2', { class: 'modal__title' }, [existingItem ? 'Edit Item' : 'Add Menu Item']);
        modal.appendChild(title);

        const form = Dom.el('div', { class: 'modal__form' });

        const nameField  = buildModalField('Name', 'text', existingItem?.name || '');
        const descField  = buildModalField('Description', 'text', existingItem?.description || '');
        const priceField = buildModalField('Price', 'number', existingItem ? String(existingItem.price) : '');
        priceField.querySelector('input').setAttribute('step', '0.01');
        priceField.querySelector('input').setAttribute('min', '0.01');

        form.appendChild(nameField);
        form.appendChild(descField);
        form.appendChild(priceField);
        modal.appendChild(form);

        const actions = Dom.el('div', { class: 'modal__actions' });

        const cancelBtn = Dom.el('button', { class: 'btn btn--ghost' }, ['Cancel']);
        cancelBtn.addEventListener('click', () => overlay.remove());

        const saveBtn = Dom.el('button', { class: 'btn btn--primary' }, [existingItem ? 'Save Changes' : 'Add Item']);

        saveBtn.addEventListener('click', async () => {
            const name  = nameField.querySelector('input').value.trim();
            const desc  = descField.querySelector('input').value.trim();
            const price = parseFloat(priceField.querySelector('input').value);

            if (!name || isNaN(price) || price <= 0) {
                Actions.showToast('Please fill in name and a valid price', 'error');
                return;
            }

            saveBtn.disabled    = true;
            saveBtn.textContent = 'Saving…';

            try {
                if (existingItem) {
                    await Api.menu.update(existingItem.id, { name, description: desc, price });
                } else {
                    // Need restaurant_id — fetch from vendor's own restaurant
                    const restData = await Http.get('/restaurants/mine');
                    await Api.menu.create({
                        restaurant_id: restData.restaurant.id,
                        name, description: desc, price,
                    });
                }

                // Reload menu
                const restData = await Http.get('/restaurants/mine');
                if (restData?.restaurant?.id) {
                    const menuData = await Api.menu.list(restData.restaurant.id);
                    Store.dispatch('SET_MENU', menuData.menu_items);
                }

                Actions.showToast(existingItem ? 'Item updated!' : 'Item added!', 'success');
                overlay.remove();
            } catch (err) {
                Actions.showToast(err.message, 'error');
                saveBtn.disabled    = false;
                saveBtn.textContent = existingItem ? 'Save Changes' : 'Add Item';
            }
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        modal.appendChild(actions);

        overlay.appendChild(modal);

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        return overlay;
    }

    function buildModalField(label, type, value) {
        const field  = Dom.el('div', { class: 'form-field' });
        const lbl    = Dom.el('label', { class: 'form-label' }, [label]);
        const input  = Dom.el('input', { type, class: 'form-input', value });
        field.appendChild(lbl);
        field.appendChild(input);
        return field;
    }

    return Object.freeze({ renderDashboard, renderMenuManager });

})();
