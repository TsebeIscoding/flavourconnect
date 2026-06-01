/**
 * FlavourConnect — Navigation + Toast Components
 *
 * renderNav()   — top navigation bar (adapts per auth state + role)
 * renderToast() — notification toast
 */

const NavComponents = (() => {

    function renderNav(state) {
        const { auth, nav, cart } = state;
        const isLoggedIn = !!auth.user;
        const role       = auth.user?.role;

        let navEl = Dom.qs('#main-nav');
        if (!navEl) {
            navEl = Dom.el('nav', { id: 'main-nav', class: 'main-nav', 'aria-label': 'Main navigation' });
            document.body.insertBefore(navEl, document.body.firstChild);
        }

        Dom.render(navEl,
            buildNavBrand(),
            buildNavLinks(isLoggedIn, role, nav.currentView),
            buildNavActions(isLoggedIn, role, cart)
        );
    }

    function buildNavBrand() {
        const brand = Dom.el('div', { class: 'nav__brand' });
        const logo  = Dom.el('button', { class: 'nav__logo' });
        logo.textContent = 'FlavourConnect';
        logo.addEventListener('click', () => {
            const role = Store.userRole();
            if (role === 'vendor') {
                Store.dispatch('NAVIGATE', { view: 'vendor-dashboard' });
            } else if (role === 'driver') {
                Store.dispatch('NAVIGATE', { view: 'driver-dashboard' });
            } else {
                Store.dispatch('NAVIGATE', { view: 'home' });
            }
        });
        brand.appendChild(logo);
        return brand;
    }

    function buildNavLinks(isLoggedIn, role, currentView) {
        const links = Dom.el('div', { class: 'nav__links' });

        if (!isLoggedIn || role === 'customer') {
            const homeLink = navLink('Browse Restaurants', 'home', currentView);
            links.appendChild(homeLink);
        }

        if (isLoggedIn && role === 'customer') {
            const ordersLink = navLink('My Orders', 'orders', currentView);
            links.appendChild(ordersLink);
        }

        if (isLoggedIn && role === 'vendor') {
            const dashLink  = navLink('Dashboard',  'vendor-dashboard', currentView);
            const menuLink  = navLink('My Menu',    'vendor-menu',      currentView);
            const ordLink   = navLink('Orders',     'orders',           currentView);
            links.appendChild(dashLink);
            links.appendChild(menuLink);
            links.appendChild(ordLink);
        }

        if (isLoggedIn && role === 'driver') {
            const delivLink = navLink('Deliveries', 'orders',           currentView);
            links.appendChild(delivLink);
        }

        if (isLoggedIn && role === 'admin') {
            const adminLink = navLink('Admin Panel', 'admin-dashboard', currentView);
            links.appendChild(adminLink);
        }

        return links;
    }

    function navLink(text, view, currentView) {
        const btn = Dom.el('button', {
            class: `nav__link ${currentView === view ? 'nav__link--active' : ''}`,
        }, [text]);
        btn.addEventListener('click', () => {
            Store.dispatch('NAVIGATE', { view });
        });
        return btn;
    }

    function buildNavActions(isLoggedIn, role, cart) {
        const actions = Dom.el('div', { class: 'nav__actions' });

        if (isLoggedIn) {
            // Cart button — only for customers
            if (role === 'customer') {
                const cartBtn = Dom.el('button', {
                    class:      'nav__cart-btn',
                    'aria-label': 'Open cart',
                }, ['🛒']);

                const count = cart.items.reduce((s, i) => s + i.quantity, 0);
                const badge = Dom.el('span', {
                    class:  'nav__cart-badge',
                    hidden: count === 0,
                }, [String(count)]);

                cartBtn.appendChild(badge);
                cartBtn.addEventListener('click', () => {
                    Store.dispatch('TOGGLE_CART');
                });
                actions.appendChild(cartBtn);
            }

            // User menu
            const userBtn = Dom.el('button', { class: 'nav__user-btn' });
            const state   = Store.getState();
            userBtn.textContent = state.auth.user?.full_name?.split(' ')[0] || 'Account';

            userBtn.addEventListener('click', () => {
                // Toggle simple dropdown
                let dropdown = Dom.qs('.nav__dropdown');
                if (dropdown) {
                    dropdown.remove();
                } else {
                    dropdown = buildUserDropdown(role);
                    actions.appendChild(dropdown);
                    // Close on outside click
                    const closeHandler = (e) => {
                        if (!dropdown.contains(e.target) && e.target !== userBtn) {
                            dropdown.remove();
                            document.removeEventListener('click', closeHandler);
                        }
                    };
                    setTimeout(() => document.addEventListener('click', closeHandler), 0);
                }
            });

            actions.appendChild(userBtn);
        } else {
            const loginBtn    = Dom.el('button', { class: 'btn btn--ghost btn--sm' }, ['Sign In']);
            const registerBtn = Dom.el('button', { class: 'btn btn--primary btn--sm' }, ['Get Started']);

            loginBtn.addEventListener('click',    () => Store.dispatch('NAVIGATE', { view: 'login' }));
            registerBtn.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'register' }));

            actions.appendChild(loginBtn);
            actions.appendChild(registerBtn);
        }

        return actions;
    }

    function buildUserDropdown(role) {
        const dropdown = Dom.el('div', { class: 'nav__dropdown' });

        if (role === 'customer') {
            const profileBtn = Dom.el('button', { class: 'nav__dropdown-item' }, ['Profile']);
            profileBtn.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'profile' }));
            dropdown.appendChild(profileBtn);
        }

        const logoutBtn = Dom.el('button', { class: 'nav__dropdown-item nav__dropdown-item--danger' }, ['Sign Out']);
        logoutBtn.addEventListener('click', () => Actions.logout());
        dropdown.appendChild(logoutBtn);

        return dropdown;
    }

    // ── TOAST ────────────────────────────────────────────────────

    function renderToast(state) {
        const { toast } = state.ui;

        let toastEl = Dom.qs('#toast');
        if (!toastEl) {
            toastEl = Dom.el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
            document.body.appendChild(toastEl);
        }

        if (!toast) {
            toastEl.className = 'toast';
            toastEl.textContent = '';
            return;
        }

        toastEl.className = `toast toast--${toast.type} toast--visible`;
        toastEl.textContent = toast.message;
    }

    return Object.freeze({ renderNav, renderToast });

})();
