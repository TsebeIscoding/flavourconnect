/**
 * FlavourConnect — Restaurant Components
 *
 * renderRestaurants() — restaurant browse grid
 * renderRestaurantDetail() — single restaurant + menu
 *
 * STATE → RENDER → UI pattern strictly followed
 */

const RestaurantComponents = (() => {

    // ── RESTAURANT LIST ──────────────────────────────────────────

    function renderRestaurants(state) {
        const { list, isLoading, error, filters } = state.restaurants;
        const container = Dom.qs('#view-content');
        if (!container) return;

        const isLoggedIn = Store.isLoggedIn();

        Dom.render(container,
            isLoggedIn ? null : renderHero(),
            isLoggedIn ? null : renderFeatureCards(),
            renderSectionHeading(isLoggedIn),
            renderFilters(filters),
            renderRestaurantGrid(list, isLoading, error)
        );
    }

    function renderHero() {
        const hero = Dom.el('div', { class: 'hero' });

        const text = Dom.el('div', { class: 'hero__text' });

        const heading = Dom.el('h1', { class: 'hero__heading' });
        heading.textContent = 'Delicious food, delivered to your door';

        const sub = Dom.el('p', { class: 'hero__sub' });
        sub.textContent = 'Order from the best local restaurants and track your delivery in real time.';

        const actions = Dom.el('div', { class: 'hero__actions' });

        const orderBtn = Dom.el('button', { class: 'btn btn--primary btn--lg' }, ['Order Now']);
        orderBtn.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'register' }));

        const signInBtn = Dom.el('button', { class: 'btn btn--ghost btn--lg' }, ['Sign In']);
        signInBtn.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'login' }));

        actions.appendChild(orderBtn);
        actions.appendChild(signInBtn);

        text.appendChild(heading);
        text.appendChild(sub);
        text.appendChild(actions);

        // Hero image — SVG food illustration using inline shapes
        const visual = Dom.el('div', { class: 'hero__visual' });
        visual.innerHTML = `
            <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <!-- Plate -->
                <ellipse cx="200" cy="220" rx="160" ry="30" fill="#e8e2da" opacity="0.6"/>
                <ellipse cx="200" cy="200" rx="140" ry="140" fill="#fff" stroke="#e8e2da" stroke-width="3"/>
                <ellipse cx="200" cy="200" rx="120" ry="120" fill="#f9f5f0"/>
                <!-- Food items -->
                <!-- Burger bun top -->
                <ellipse cx="200" cy="155" rx="65" ry="35" fill="#e8a98e"/>
                <ellipse cx="200" cy="148" rx="65" ry="28" fill="#f2c4b0"/>
                <!-- Sesame seeds -->
                <ellipse cx="185" cy="140" rx="5" ry="3" fill="#c4956a" transform="rotate(-20 185 140)"/>
                <ellipse cx="205" cy="136" rx="5" ry="3" fill="#c4956a" transform="rotate(10 205 136)"/>
                <ellipse cx="220" cy="143" rx="5" ry="3" fill="#c4956a" transform="rotate(-30 220 143)"/>
                <!-- Lettuce -->
                <path d="M135 175 Q160 165 200 168 Q240 165 265 175 Q240 185 200 182 Q160 185 135 175Z" fill="#7bc67a"/>
                <!-- Patty -->
                <ellipse cx="200" cy="178" rx="68" ry="16" fill="#8B4513"/>
                <!-- Cheese -->
                <path d="M133 168 L200 165 L267 168 L275 178 L200 181 L125 178Z" fill="#f5c842" opacity="0.85"/>
                <!-- Bun bottom -->
                <ellipse cx="200" cy="190" rx="70" ry="18" fill="#e8c99a"/>
                <!-- Fries box -->
                <rect x="290" y="160" width="60" height="70" rx="4" fill="#e8481c" opacity="0.9"/>
                <rect x="295" y="155" width="50" height="15" rx="3" fill="#c73d18"/>
                <!-- Fries -->
                <rect x="298" y="130" width="8" height="40" rx="3" fill="#f5c842"/>
                <rect x="310" y="125" width="8" height="45" rx="3" fill="#f5c842"/>
                <rect x="322" y="132" width="8" height="38" rx="3" fill="#f5c842"/>
                <rect x="334" y="128" width="8" height="42" rx="3" fill="#f5c842"/>
                <!-- Drink cup -->
                <rect x="48" y="155" width="55" height="75" rx="4" fill="#d4d0e8"/>
                <rect x="45" y="148" width="61" height="18" rx="4" fill="#b8b3d4"/>
                <!-- Straw -->
                <rect x="82" y="110" width="6" height="55" rx="3" fill="#e8481c" opacity="0.8"/>
                <!-- Stars / sparkles -->
                <text x="155" y="95" font-size="18" fill="#f2c4b0" opacity="0.7">✦</text>
                <text x="330" y="120" font-size="14" fill="#d4d0e8" opacity="0.8">✦</text>
                <text x="60" y="140" font-size="12" fill="#f2c4b0" opacity="0.6">✦</text>
            </svg>`;

        hero.appendChild(text);
        hero.appendChild(visual);
        return hero;
    }

    function renderFeatureCards() {
        const section = Dom.el('div', { class: 'feature-cards' });

        const cards = [
            {
                icon:    '🍽',
                title:   'Feed your team',
                body:    'Order from hundreds of local restaurants and have food delivered to your door.',
                cta:     'Start ordering',
                view:    'register',
                color:   'peach',
            },
            {
                icon:    '🏪',
                title:   'Your restaurant, delivered',
                body:    'List your restaurant, manage your menu, and reach more customers today.',
                cta:     'Add your restaurant',
                view:    'register',
                color:   'lavender',
                role:    'vendor',
            },
            {
                icon:    '🚴',
                title:   'Deliver with FlavourConnect',
                body:    'Earn money on your own schedule. Sign up as a driver and start delivering.',
                cta:     'Sign up to deliver',
                view:    'register',
                color:   'cream',
                role:    'driver',
            },
        ];

        cards.forEach(card => {
            const el = Dom.el('article', { class: `feature-card feature-card--${card.color}` });

            const icon = Dom.el('div', { class: 'feature-card__icon' }, [card.icon]);

            const title = Dom.el('h2', { class: 'feature-card__title' });
            title.textContent = card.title;

            const body = Dom.el('p', { class: 'feature-card__body' });
            body.textContent = card.body;

            const btn = Dom.el('button', { class: 'btn btn--primary feature-card__btn' }, [card.cta]);
            btn.addEventListener('click', () => {
                Store.dispatch('NAVIGATE', { view: card.view });
            });

            el.appendChild(icon);
            el.appendChild(title);
            el.appendChild(body);
            el.appendChild(btn);
            section.appendChild(el);
        });

        return section;
    }

    function renderSectionHeading(isLoggedIn) {
        const wrapper = Dom.el('div', { class: 'section-header' });
        const h = Dom.el('h2', { class: 'section-header__title' },
            [isLoggedIn ? 'Browse Restaurants' : 'What\'s near you']);
        wrapper.appendChild(h);
        return wrapper;
    }

    function renderFilters(filters) {
        const wrapper = Dom.el('div', { class: 'filters' });

        // Search input
        const searchInput = Dom.el('input', {
            type:        'text',
            class:       'filters__search',
            placeholder: 'Search restaurants…',
            value:       filters.search || '',
        });
        searchInput.addEventListener('input', debounce((e) => {
            const newFilters = { ...Store.get('restaurants').filters, search: e.target.value };
            Store.dispatch('SET_RESTAURANT_FILTER', { search: e.target.value });
            Actions.loadRestaurants(newFilters);
        }, 400));

        // Open now toggle
        const toggleLabel = Dom.el('label', { class: 'filters__toggle' });
        const toggleInput = Dom.el('input', {
            type:    'checkbox',
            checked: filters.open || false,
        });
        toggleInput.addEventListener('change', (e) => {
            const newFilters = { ...Store.get('restaurants').filters, open: e.target.checked };
            Store.dispatch('SET_RESTAURANT_FILTER', { open: e.target.checked });
            Actions.loadRestaurants(newFilters);
        });
        const toggleSpan = Dom.el('span', {}, ['Open Now']);
        toggleLabel.appendChild(toggleInput);
        toggleLabel.appendChild(toggleSpan);

        wrapper.appendChild(searchInput);
        wrapper.appendChild(toggleLabel);

        return wrapper;
    }

    function renderRestaurantGrid(list, isLoading, error) {
        const grid = Dom.el('div', { class: 'restaurant-grid' });

        if (isLoading) {
            for (let i = 0; i < 6; i++) {
                grid.appendChild(renderRestaurantCardSkeleton());
            }
            return grid;
        }

        if (error) {
            grid.appendChild(Dom.el('div', { class: 'state-empty' }, [error]));
            return grid;
        }

        if (list.length === 0) {
            const empty = Dom.el('div', { class: 'state-empty' });
            empty.appendChild(Dom.el('p', {}, ['No restaurants found.']));
            return grid;
        }

        list.forEach(r => grid.appendChild(renderRestaurantCard(r)));
        return grid;
    }

    function renderRestaurantCard(restaurant) {
        const card = Dom.el('article', {
            class:   'restaurant-card',
            dataset: { id: restaurant.id },
        });

        // Image
        const imgWrap = Dom.el('div', { class: 'restaurant-card__img-wrap' });
        if (restaurant.logo_url) {
            const img = Dom.el('img', {
                class: 'restaurant-card__img',
                alt:   '',  // decorative; name is in heading
            });
            img.src = restaurant.logo_url;
            img.onerror = () => { img.src = '/img/placeholder-restaurant.svg'; };
            imgWrap.appendChild(img);
        } else {
            const placeholder = Dom.el('div', { class: 'restaurant-card__img-placeholder' });
            placeholder.textContent = restaurant.name.charAt(0).toUpperCase();
            imgWrap.appendChild(placeholder);
        }

        // Status badge
        const statusBadge = Dom.el('span', {
            class: `restaurant-card__status ${restaurant.is_open ? 'restaurant-card__status--open' : 'restaurant-card__status--closed'}`
        }, [restaurant.is_open ? 'Open' : 'Closed']);
        imgWrap.appendChild(statusBadge);

        card.appendChild(imgWrap);

        // Body
        const body = Dom.el('div', { class: 'restaurant-card__body' });

        const name = Dom.el('h3', { class: 'restaurant-card__name' });
        name.textContent = restaurant.name;

        const desc = Dom.el('p', { class: 'restaurant-card__desc' });
        desc.textContent = Dom.truncate(restaurant.description || 'No description available.', 80);

        const tags = Dom.el('div', { class: 'restaurant-card__tags' });
        (restaurant.cuisine_tags || []).forEach(tag => {
            const t = Dom.el('span', { class: 'tag' });
            t.textContent = tag;
            tags.appendChild(t);
        });

        body.appendChild(name);
        body.appendChild(desc);
        body.appendChild(tags);
        card.appendChild(body);

        // Click handler — navigate to restaurant detail
        card.addEventListener('click', () => {
            if (!restaurant.is_open) {
                Actions.showToast('This restaurant is currently closed', 'info');
                return;
            }
            Actions.loadRestaurant(restaurant.id);
        });

        return card;
    }

    function renderRestaurantCardSkeleton() {
        const card = Dom.el('article', { class: 'restaurant-card restaurant-card--skeleton' });
        card.appendChild(Dom.el('div', { class: 'skeleton restaurant-card__img-wrap' }));
        const body = Dom.el('div', { class: 'restaurant-card__body' });
        body.appendChild(Dom.el('div', { class: 'skeleton skeleton--title' }));
        body.appendChild(Dom.el('div', { class: 'skeleton skeleton--text' }));
        body.appendChild(Dom.el('div', { class: 'skeleton skeleton--text skeleton--short' }));
        card.appendChild(body);
        return card;
    }

    // ── RESTAURANT DETAIL + MENU ─────────────────────────────────

    function renderRestaurantDetail(state) {
        const { current: restaurant } = state.restaurants;
        const { items, isLoading }    = state.menu;
        const container = Dom.qs('#view-content');
        if (!container) return;

        if (!restaurant && !isLoading) {
            Dom.render(container, Dom.el('div', { class: 'state-empty' }, ['Restaurant not found.']));
            return;
        }

        Dom.render(container,
            renderRestaurantHeader(restaurant),
            renderMenuSection(items, isLoading, restaurant)
        );
    }

    function renderRestaurantHeader(restaurant) {
        if (!restaurant) return Dom.skeleton(2);

        const header = Dom.el('div', { class: 'restaurant-header' });

        if (restaurant.logo_url) {
            const img = Dom.el('img', { class: 'restaurant-header__logo', alt: '' });
            img.src = restaurant.logo_url;
            header.appendChild(img);
        }

        const info = Dom.el('div', { class: 'restaurant-header__info' });

        const name = Dom.el('h1', { class: 'restaurant-header__name' });
        name.textContent = restaurant.name;

        const statusBadge = Dom.el('span', {
            class: `badge badge--${restaurant.is_open ? 'open' : 'closed'}`
        }, [restaurant.is_open ? 'Open Now' : 'Closed']);

        const addr = Dom.el('p', { class: 'restaurant-header__address' });
        addr.textContent = restaurant.address || '';

        info.appendChild(name);
        info.appendChild(statusBadge);
        info.appendChild(addr);

        const backBtn = Dom.el('button', { class: 'btn btn--ghost' }, ['← Back']);
        backBtn.addEventListener('click', () => {
            Store.dispatch('NAVIGATE', { view: 'home' });
        });

        header.appendChild(backBtn);
        header.appendChild(info);
        return header;
    }

    function renderMenuSection(items, isLoading, restaurant) {
        const section = Dom.el('section', { class: 'menu' });
        const heading = Dom.el('h2', { class: 'menu__heading' }, ['Menu']);
        section.appendChild(heading);

        if (isLoading) {
            for (let i = 0; i < 4; i++) section.appendChild(Dom.skeleton(3));
            return section;
        }

        if (items.length === 0) {
            section.appendChild(Dom.el('p', { class: 'state-empty' }, ['No menu items available.']));
            return section;
        }

        const grid = Dom.el('div', { class: 'menu-grid' });
        items.forEach(item => grid.appendChild(renderMenuItem(item, restaurant)));
        section.appendChild(grid);
        return section;
    }

    function renderMenuItem(item, restaurant) {
        const card = Dom.el('div', {
            class: `menu-item ${!item.is_available ? 'menu-item--unavailable' : ''}`,
        });

        const body = Dom.el('div', { class: 'menu-item__body' });

        const name = Dom.el('h3', { class: 'menu-item__name' });
        name.textContent = item.name;

        const desc = Dom.el('p', { class: 'menu-item__desc' });
        desc.textContent = Dom.truncate(item.description || '', 120);

        const price = Dom.el('span', { class: 'menu-item__price' });
        price.textContent = Dom.formatPrice(item.price);

        body.appendChild(name);
        body.appendChild(desc);
        body.appendChild(price);
        card.appendChild(body);

        // Add to cart button — only shown to logged-in customers
        const role = Store.userRole();
        if (Store.isLoggedIn() && role === 'customer' && item.is_available) {
            const addBtn = Dom.el('button', {
                class:   'btn btn--primary menu-item__add',
                dataset: { itemId: item.id },
            }, ['Add to Cart']);

            addBtn.addEventListener('click', () => {
                Actions.addToCart(item.id, 1);
            });
            card.appendChild(addBtn);
        } else if (!item.is_available) {
            const unavail = Dom.el('span', { class: 'menu-item__unavailable' }, ['Unavailable']);
            card.appendChild(unavail);
        } else if (!Store.isLoggedIn()) {
            const loginBtn = Dom.el('button', { class: 'btn btn--ghost menu-item__add' }, ['Log in to order']);
            loginBtn.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'login' }));
            card.appendChild(loginBtn);
        }

        return card;
    }

    // ── UTILITY ──────────────────────────────────────────────────

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    return Object.freeze({
        renderRestaurants,
        renderRestaurantDetail,
    });

})();
