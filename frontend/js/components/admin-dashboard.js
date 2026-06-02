/**
 * FlavourConnect — Admin Dashboard Component
 */

const AdminComponents = (() => {

    function renderDashboard(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const wrapper = Dom.el('div', { class: 'admin-dashboard' });

        const heading = Dom.el('h1', { class: 'page-heading' }, ['Admin Dashboard']);
        wrapper.appendChild(heading);

        // Tabs
        const tabs = Dom.el('div', { class: 'admin-tabs' });
        const tabData = [
            { label: 'Stats',   id: 'stats'  },
            { label: 'Users',   id: 'users'  },
            { label: 'Orders',  id: 'orders' },
        ];

        let activeTab = 'stats';
        const contentArea = Dom.el('div', { class: 'admin-content' });

        tabData.forEach(tab => {
            const btn = Dom.el('button', {
                class: `admin-tab ${tab.id === activeTab ? 'admin-tab--active' : ''}`,
            }, [tab.label]);

            btn.addEventListener('click', async () => {
                Dom.qsa('.admin-tab', wrapper).forEach(b => b.classList.remove('admin-tab--active'));
                btn.classList.add('admin-tab--active');
                activeTab = tab.id;
                await loadTab(tab.id, contentArea);
            });

            tabs.appendChild(btn);
        });

        wrapper.appendChild(tabs);
        wrapper.appendChild(contentArea);

        Dom.render(container, wrapper);

        // Load default tab
        loadTab('stats', contentArea);
    }

    async function loadTab(tab, container) {
        Dom.render(container, Dom.skeleton(4));

        try {
            if (tab === 'stats') {
                const data = await Http.get('/admin/stats');
                Dom.render(container, renderStats(data.stats));
            } else if (tab === 'users') {
                const data = await Http.get('/admin/users');
                Dom.render(container, renderUsers(data.users));
            } else if (tab === 'orders') {
                const data = await Http.get('/admin/orders');
                Dom.render(container, renderOrders(data.orders));
            }
        } catch (err) {
            Dom.render(container, Dom.el('p', { class: 'state-error' }, [err.message]));
        }
    }

    function renderStats(stats) {
        if (!stats) return Dom.el('p', {}, ['No stats available']);

        const grid = Dom.el('div', { class: 'order-stats' });

        const items = [
            { label: 'Customers',         value: stats.total_customers    },
            { label: 'Vendors',           value: stats.total_vendors      },
            { label: 'Drivers',           value: stats.total_drivers      },
            { label: 'Open Restaurants',  value: stats.open_restaurants   },
            { label: 'Total Orders',      value: stats.total_orders       },
            { label: 'Pending Orders',    value: stats.pending_orders     },
            { label: 'Active Deliveries', value: stats.active_deliveries  },
            { label: 'Total Revenue',     value: Dom.formatPrice(stats.total_revenue || 0) },
        ];

        items.forEach(({ label, value }) => {
            const card = Dom.el('div', { class: 'stat-card stat-card--brand' });
            const num  = Dom.el('div', { class: 'stat-card__number' }, [String(value ?? 0)]);
            const lbl  = Dom.el('div', { class: 'stat-card__label' },  [label]);
            card.appendChild(num);
            card.appendChild(lbl);
            grid.appendChild(card);
        });

        return grid;
    }

    function renderUsers(users) {
        if (!users || users.length === 0) {
            return Dom.el('p', { class: 'state-empty' }, ['No users found.']);
        }

        const table = Dom.el('table', { class: 'menu-table' });
        const thead = Dom.el('thead');
        const headerRow = Dom.el('tr');

        ['Name', 'Email', 'Role', 'Active', 'Actions'].forEach(col => {
            headerRow.appendChild(Dom.el('th', {}, [col]));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = Dom.el('tbody');
        users.forEach(user => {
            const row = Dom.el('tr');

            const name = Dom.el('td');
            name.textContent = user.full_name;

            const email = Dom.el('td');
            email.textContent = user.email;

            const role = Dom.el('td');
            role.appendChild(Dom.el('span', { class: `badge badge--${user.role}` }, [user.role]));

            const active = Dom.el('td');
            active.textContent = user.is_active ? 'Yes' : 'No';

            const actions = Dom.el('td');
            const toggleBtn = Dom.el('button', { class: 'btn btn--ghost btn--sm' }, [
                user.is_active ? 'Deactivate' : 'Activate'
            ]);
            toggleBtn.addEventListener('click', async () => {
                toggleBtn.disabled = true;
                try {
                    await Http.patch(`/admin/users/${user.id}`, { is_active: !user.is_active });
                    Actions.showToast('User updated', 'success');
                    // Reload tab
                    const data = await Http.get('/admin/users');
                    Dom.render(Dom.qs('.admin-content'), renderUsers(data.users));
                } catch (err) {
                    Actions.showToast(err.message, 'error');
                    toggleBtn.disabled = false;
                }
            });
            actions.appendChild(toggleBtn);

            [name, email, role, active, actions].forEach(cell => row.appendChild(cell));
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        return table;
    }

    function renderOrders(orders) {
        if (!orders || orders.length === 0) {
            return Dom.el('p', { class: 'state-empty' }, ['No orders found.']);
        }

        const list = Dom.el('div', { class: 'orders-list' });
        orders.forEach(order => {
            const card = Dom.el('div', { class: 'order-card' });

            const header = Dom.el('div', { class: 'order-card__header' });
            const id = Dom.el('span', { class: 'order-card__id' });
            id.textContent = `#${order.id.slice(0, 8).toUpperCase()}`;
            header.appendChild(id);
            header.appendChild(Dom.statusBadge(order.status));
            card.appendChild(header);

            const rest = Dom.el('p', { class: 'order-card__restaurant' });
            rest.textContent = order.restaurant_name;
            card.appendChild(rest);

            const customer = Dom.el('p', { class: 'order-card__time' });
            customer.textContent = order.customer_email;
            card.appendChild(customer);

            const total = Dom.el('p', { class: 'order-card__total' });
            total.textContent = Dom.formatPrice(order.total);
            card.appendChild(total);

            list.appendChild(card);
        });

        return list;
    }

    return Object.freeze({ renderDashboard });

})();
