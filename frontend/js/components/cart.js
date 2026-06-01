/**
 * FlavourConnect — Cart Component
 *
 * renderCart() — slide-in cart panel
 * renderCheckout() — checkout form view
 *
 * NOTE: Server computes totals. We display what server sends back.
 * The checkout form only collects delivery_address — nothing price-related.
 */

const CartComponents = (() => {

    // ── CART PANEL ───────────────────────────────────────────────

    function renderCart(state) {
        const { cart, ui } = state;

        // Update cart count badge in nav
        const badge = Dom.qs('.nav__cart-badge');
        if (badge) {
            const count = cart.items.reduce((sum, i) => sum + i.quantity, 0);
            badge.textContent = count;
            badge.hidden      = count === 0;
        }

        // Render or update the cart panel
        let panel = Dom.qs('#cart-panel');
        if (!panel) {
            panel = Dom.el('div', { id: 'cart-panel', class: 'cart-panel', 'aria-label': 'Shopping cart' });
            document.body.appendChild(panel);
        }

        panel.className = `cart-panel ${ui.cartOpen ? 'cart-panel--open' : ''}`;
        Dom.render(panel, buildCartPanel(cart));

        // Overlay
        let overlay = Dom.qs('#cart-overlay');
        if (!overlay) {
            overlay = Dom.el('div', { id: 'cart-overlay', class: 'cart-overlay' });
            overlay.addEventListener('click', () => Store.dispatch('TOGGLE_CART'));
            document.body.appendChild(overlay);
        }
        overlay.className = `cart-overlay ${ui.cartOpen ? 'cart-overlay--visible' : ''}`;
    }

    function buildCartPanel(cart) {
        const panel = document.createDocumentFragment();

        // Header
        const header = Dom.el('div', { class: 'cart-panel__header' });
        const title  = Dom.el('h2', { class: 'cart-panel__title' }, ['Your Cart']);
        const closeBtn = Dom.el('button', {
            class:      'cart-panel__close',
            'aria-label': 'Close cart',
        }, ['✕']);
        closeBtn.addEventListener('click', () => Store.dispatch('TOGGLE_CART'));
        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Loading state
        if (cart.isLoading) {
            panel.appendChild(Dom.skeleton(3));
            return panel;
        }

        // Restaurant name
        if (cart.restaurant_name) {
            const restName = Dom.el('p', { class: 'cart-panel__restaurant' });
            restName.textContent = `From: ${cart.restaurant_name}`;
            panel.appendChild(restName);
        }

        // Items
        if (cart.items.length === 0) {
            const empty = Dom.el('div', { class: 'cart-panel__empty' });
            const msg   = Dom.el('p', {}, ['Your cart is empty']);
            const hint  = Dom.el('p', { class: 'cart-panel__hint' }, ['Add items from a restaurant to get started.']);
            empty.appendChild(msg);
            empty.appendChild(hint);
            panel.appendChild(empty);
            return panel;
        }

        const itemsList = Dom.el('ul', { class: 'cart-panel__items' });
        cart.items.forEach(item => {
            itemsList.appendChild(renderCartItem(item));
        });
        panel.appendChild(itemsList);

        // Totals (server-computed values only)
        const totals = Dom.el('div', { class: 'cart-panel__totals' });

        const subtotalRow = Dom.el('div', { class: 'cart-panel__total-row' });
        const subtotalLabel = Dom.el('span', {}, ['Subtotal']);
        const subtotalAmt   = Dom.el('span', {});
        subtotalAmt.textContent = Dom.formatPrice(cart.subtotal);
        subtotalRow.appendChild(subtotalLabel);
        subtotalRow.appendChild(subtotalAmt);

        totals.appendChild(subtotalRow);
        panel.appendChild(totals);

        // Clear cart
        const clearBtn = Dom.el('button', { class: 'btn btn--ghost btn--sm cart-panel__clear' }, ['Clear Cart']);
        clearBtn.addEventListener('click', async () => {
            if (confirm('Clear your entire cart?')) {
                await Actions.clearCart();
            }
        });
        panel.appendChild(clearBtn);

        // Checkout button
        const checkoutBtn = Dom.el('button', {
            class: 'btn btn--primary btn--full cart-panel__checkout',
        }, ['Proceed to Checkout']);
        checkoutBtn.addEventListener('click', () => {
            Store.dispatch('TOGGLE_CART');
            Store.dispatch('NAVIGATE', { view: 'checkout' });
        });
        panel.appendChild(checkoutBtn);

        return panel;
    }

    function renderCartItem(item) {
        const li = Dom.el('li', { class: 'cart-item' });

        const info = Dom.el('div', { class: 'cart-item__info' });

        const name = Dom.el('span', { class: 'cart-item__name' });
        name.textContent = item.name;

        const price = Dom.el('span', { class: 'cart-item__price' });
        price.textContent = Dom.formatPrice(item.price);

        info.appendChild(name);
        info.appendChild(price);

        // Quantity controls
        const controls = Dom.el('div', { class: 'cart-item__controls' });

        const minusBtn = Dom.el('button', {
            class:      'cart-item__qty-btn',
            'aria-label': `Remove one ${item.name}`,
        }, ['−']);
        minusBtn.addEventListener('click', () => Actions.removeFromCart(item.menu_item_id));

        const qty = Dom.el('span', { class: 'cart-item__qty' });
        qty.textContent = item.quantity;

        const plusBtn = Dom.el('button', {
            class:      'cart-item__qty-btn',
            'aria-label': `Add one more ${item.name}`,
        }, ['+']);
        plusBtn.addEventListener('click', () => Actions.addToCart(item.menu_item_id, 1));

        const lineTotal = Dom.el('span', { class: 'cart-item__line-total' });
        lineTotal.textContent = Dom.formatPrice(item.line_total);

        controls.appendChild(minusBtn);
        controls.appendChild(qty);
        controls.appendChild(plusBtn);
        controls.appendChild(lineTotal);

        li.appendChild(info);
        li.appendChild(controls);

        return li;
    }

    // ── CHECKOUT VIEW ────────────────────────────────────────────

    function renderCheckout(state) {
        const { cart, orders } = state;
        const container = Dom.qs('#view-content');
        if (!container) return;

        // Redirect if cart empty
        if (cart.items.length === 0) {
            Store.dispatch('NAVIGATE', { view: 'home' });
            return;
        }

        const wrapper = Dom.el('div', { class: 'checkout' });

        const heading = Dom.el('h1', { class: 'checkout__heading' }, ['Checkout']);

        // Order summary
        const summary = Dom.el('div', { class: 'checkout__summary' });
        const summaryHeading = Dom.el('h2', { class: 'checkout__section-title' }, ['Order Summary']);
        summary.appendChild(summaryHeading);

        if (cart.restaurant_name) {
            const restName = Dom.el('p', { class: 'checkout__restaurant' });
            restName.textContent = cart.restaurant_name;
            summary.appendChild(restName);
        }

        const itemList = Dom.el('ul', { class: 'checkout__items' });
        cart.items.forEach(item => {
            const li = Dom.el('li', { class: 'checkout__item' });
            const nameQty = Dom.el('span', {});
            nameQty.textContent = `${item.name} × ${item.quantity}`;
            const lineTotal = Dom.el('span', {});
            lineTotal.textContent = Dom.formatPrice(item.line_total);
            li.appendChild(nameQty);
            li.appendChild(lineTotal);
            itemList.appendChild(li);
        });
        summary.appendChild(itemList);

        // Totals — server-computed only, displayed as-is
        const totalsDiv = Dom.el('div', { class: 'checkout__totals' });
        const subtotalRow = buildTotalRow('Subtotal', Dom.formatPrice(cart.subtotal));
        totalsDiv.appendChild(subtotalRow);
        summary.appendChild(totalsDiv);

        wrapper.appendChild(heading);
        wrapper.appendChild(summary);

        // Delivery form — ONLY collects delivery_address
        const form = Dom.el('div', { class: 'checkout__form' });
        const formHeading = Dom.el('h2', { class: 'checkout__section-title' }, ['Delivery Details']);
        form.appendChild(formHeading);

        const addressLabel = Dom.el('label', { class: 'form-label', for: 'delivery-address' }, ['Delivery Address']);
        const addressInput = Dom.el('input', {
            type:        'text',
            id:          'delivery-address',
            class:       'form-input',
            placeholder: '123 Main St, City, Country',
            maxlength:   '500',
        });

        const paymentNote = Dom.el('p', { class: 'checkout__payment-note' }, ['Payment: Cash on delivery']);

        const errorMsg = Dom.el('p', { class: 'form-error', id: 'checkout-error' });
        errorMsg.hidden = true;

        const submitBtn = Dom.el('button', {
            class:    'btn btn--primary btn--full',
            disabled: orders.isLoading,
        }, [orders.isLoading ? 'Placing Order…' : 'Place Order']);

        submitBtn.addEventListener('click', async () => {
            const address = addressInput.value.trim();
            if (address.length < 10) {
                errorMsg.textContent = 'Please enter a complete delivery address (at least 10 characters).';
                errorMsg.hidden = false;
                addressInput.focus();
                return;
            }
            errorMsg.hidden = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Placing Order…';
            await Actions.checkout(address);
            submitBtn.disabled   = false;
            submitBtn.textContent = 'Place Order';
        });

        form.appendChild(addressLabel);
        form.appendChild(addressInput);
        form.appendChild(paymentNote);
        form.appendChild(errorMsg);
        form.appendChild(submitBtn);

        wrapper.appendChild(form);

        Dom.render(container, wrapper);
    }

    function buildTotalRow(label, value) {
        const row = Dom.el('div', { class: 'checkout__total-row' });
        const lbl = Dom.el('span', {}, [label]);
        const val = Dom.el('span', {}, [value]);
        row.appendChild(lbl);
        row.appendChild(val);
        return row;
    }

    return Object.freeze({
        renderCart,
        renderCheckout,
    });

})();
