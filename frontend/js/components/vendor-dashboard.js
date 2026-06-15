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

        const isOpen = state.restaurants.current?.is_open || false;
        const checkbox = Dom.el('input', { type: 'checkbox' });
        checkbox.checked = isOpen;
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

        // Image upload — preview + file input
        const imageField = buildModalImageField(existingItem);

        form.appendChild(nameField);
        form.appendChild(descField);
        form.appendChild(priceField);
        form.appendChild(imageField.wrapper);
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
                let itemId = existingItem?.id;

                if (existingItem) {
                    await Api.menu.update(existingItem.id, { name, description: desc, price });
                } else {
                    // Need restaurant_id — fetch from vendor's own restaurant
                    const restData = await Http.get('/restaurants/mine');
                    const created  = await Api.menu.create({
                        restaurant_id: restData.restaurant.id,
                        name, description: desc, price,
                    });
                    itemId = created?.menu_item?.id;
                }

                // Upload pending image, if one was selected
                const pendingFile = imageField.getFile();
                if (pendingFile && itemId) {
                    try {
                        await Api.menu.uploadImage(itemId, pendingFile);
                    } catch (imgErr) {
                        Actions.showToast(`Item saved, but image upload failed: ${imgErr.message}`, 'error');
                    }
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

    function buildModalImageField(existingItem) {
        const wrapper = Dom.el('div', { class: 'form-field' });
        wrapper.appendChild(Dom.el('label', { class: 'form-label' }, ['Photo']));

        let selectedFile = null;

        const row     = Dom.el('div', { class: 'modal-image-row' });
        const preview = Dom.el('div', { class: 'modal-image-preview' });

        if (existingItem?.image_url) {
            preview.appendChild(Dom.el('img', {
                src: existingItem.image_url, alt: '', class: 'modal-image-preview__img',
            }));
        } else {
            preview.appendChild(Dom.el('span', { class: 'modal-image-preview__placeholder' }, ['No photo']));
        }

        const fileInput = Dom.el('input', {
            type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'visually-hidden',
        });

        const chooseBtn = Dom.el('button', {
            type: 'button', class: 'btn btn--secondary btn--sm',
        }, [existingItem?.image_url ? 'Change Photo' : 'Add Photo']);
        chooseBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (!file) return;
            selectedFile = file;

            const reader = new FileReader();
            reader.onload = (e) => {
                Dom.render(preview, Dom.el('img', {
                    src: e.target.result, alt: '', class: 'modal-image-preview__img',
                }));
            };
            reader.readAsDataURL(file);

            // If editing an existing item, upload immediately
            if (existingItem?.id) {
                chooseBtn.disabled    = true;
                chooseBtn.textContent = 'Uploading…';
                Api.menu.uploadImage(existingItem.id, file)
                    .then(() => {
                        Actions.showToast('Photo updated', 'success');
                        selectedFile = null; // already uploaded
                    })
                    .catch(err => Actions.showToast(err.message, 'error'))
                    .finally(() => {
                        chooseBtn.disabled    = false;
                        chooseBtn.textContent = 'Change Photo';
                    });
            }
        });

        row.appendChild(preview);
        row.appendChild(chooseBtn);
        row.appendChild(fileInput);
        wrapper.appendChild(row);

        if (!existingItem) {
            wrapper.appendChild(Dom.el('p', { class: 'form-field__hint' }, [
                'The photo will be uploaded once the item is saved.',
            ]));
        }

        return {
            wrapper,
            getFile: () => existingItem ? null : selectedFile, // existing items upload immediately, new items upload on save
        };
    }

    function buildModalField(label, type, value) {
        const field  = Dom.el('div', { class: 'form-field' });
        const lbl    = Dom.el('label', { class: 'form-label' }, [label]);
        const input  = Dom.el('input', { type, class: 'form-input', value });
        field.appendChild(lbl);
        field.appendChild(input);
        return field;
    }

    // ── RESTAURANT PROFILE ───────────────────────────────────────

    function renderProfile(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const restaurant = state.restaurants.current;
        const wrapper = Dom.el('div', { class: 'vendor-profile' });

        wrapper.appendChild(Dom.el('h1', { class: 'page-heading' }, ['My Restaurant']));

        if (!restaurant) {
            wrapper.appendChild(Dom.skeleton(4));
            Dom.render(container, wrapper);
            return;
        }

        wrapper.appendChild(buildLogoSection(restaurant));
        wrapper.appendChild(buildProfileForm(restaurant));
        wrapper.appendChild(buildPhotoGallery(restaurant));

        Dom.render(container, wrapper);
    }

    // ── LOGO UPLOAD ──────────────────────────────────────────────

    function buildLogoSection(restaurant) {
        const section = Dom.el('section', { class: 'profile-section' });
        section.appendChild(Dom.el('h2', { class: 'section-heading' }, ['Restaurant Logo']));

        const row = Dom.el('div', { class: 'logo-upload-row' });

        const preview = Dom.el('div', { class: 'logo-preview' });
        if (restaurant.logo_url) {
            preview.appendChild(Dom.el('img', {
                src: restaurant.logo_url,
                alt: `${restaurant.name} logo`,
                class: 'logo-preview__img',
            }));
        } else {
            preview.appendChild(Dom.el('span', { class: 'logo-preview__placeholder' }, ['No logo']));
        }

        const controls = Dom.el('div', { class: 'logo-upload-controls' });

        const fileInput = Dom.el('input', {
            type:   'file',
            accept: 'image/jpeg,image/png,image/webp',
            class:  'visually-hidden',
            id:     'logo-file-input',
        });

        const chooseBtn = Dom.el('button', { class: 'btn btn--secondary' }, ['Choose Photo']);
        chooseBtn.addEventListener('click', () => fileInput.click());

        const hint = Dom.el('p', { class: 'form-field__hint' }, [
            'JPG, PNG, or WebP. Max 2MB. Square images look best.',
        ]);

        const statusMsg = Dom.el('p', { class: 'upload-status', hidden: true });

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;

            // Instant local preview
            const reader = new FileReader();
            reader.onload = (e) => {
                Dom.render(preview, Dom.el('img', {
                    src: e.target.result,
                    alt: 'New logo preview',
                    class: 'logo-preview__img',
                }));
            };
            reader.readAsDataURL(file);

            chooseBtn.disabled    = true;
            chooseBtn.textContent = 'Uploading…';
            statusMsg.hidden      = true;

            try {
                const result = await Api.restaurants.uploadLogo(restaurant.id, file);
                Actions.showToast('Logo updated', 'success');
                // Refresh restaurant state with new logo_url
                Store.dispatch('SET_RESTAURANT', { ...restaurant, logo_url: result.logo_url });
            } catch (err) {
                statusMsg.textContent = err.message;
                statusMsg.className   = 'upload-status upload-status--error';
                statusMsg.hidden      = false;
            }

            chooseBtn.disabled    = false;
            chooseBtn.textContent = 'Choose Photo';
        });

        controls.appendChild(chooseBtn);
        controls.appendChild(hint);
        controls.appendChild(statusMsg);

        row.appendChild(preview);
        row.appendChild(controls);
        row.appendChild(fileInput);
        section.appendChild(row);

        return section;
    }

    // ── PROFILE FORM ─────────────────────────────────────────────

    function buildProfileForm(restaurant) {
        const section = Dom.el('section', { class: 'profile-section' });
        section.appendChild(Dom.el('h2', { class: 'section-heading' }, ['Restaurant Details']));

        const form = Dom.el('div', { class: 'profile-form' });

        const nameField  = profileField('Restaurant Name', 'text', restaurant.name, 255);
        const descField  = profileTextarea('Description', restaurant.description || '', 2000);
        const addrField  = profileField('Address', 'text', restaurant.address, 500);
        const phoneField = profileField('Phone Number', 'tel', restaurant.phone, 30);
        const tagsField  = profileField(
            'Cuisine Tags',
            'text',
            (restaurant.cuisine_tags || []).join(', '),
            255
        );
        tagsField.input.placeholder = 'italian, pizza, vegan';
        const tagsHint = Dom.el('p', { class: 'form-field__hint' }, [
            'Comma-separated. Helps customers find you when searching.',
        ]);
        tagsField.wrapper.appendChild(tagsHint);

        form.appendChild(nameField.wrapper);
        form.appendChild(descField.wrapper);
        form.appendChild(addrField.wrapper);
        form.appendChild(phoneField.wrapper);
        form.appendChild(tagsField.wrapper);

        const saveBtn = Dom.el('button', { class: 'btn btn--primary' }, ['Save Changes']);
        const statusMsg = Dom.el('p', { class: 'upload-status', hidden: true });

        saveBtn.addEventListener('click', async () => {
            // Clear previous field errors
            [nameField, descField, addrField, phoneField, tagsField].forEach(clearProfileError);
            statusMsg.hidden = true;

            const name        = nameField.input.value.trim();
            const description = descField.input.value.trim();
            const address      = addrField.input.value.trim();
            const phone        = phoneField.input.value.trim();
            const cuisineTags  = tagsField.input.value
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 10);

            let firstError = null;

            if (!name || name.length < 2) {
                setProfileError(nameField, 'Restaurant name must be at least 2 characters.');
                firstError = firstError || nameField.input;
            }
            if (!address || address.length < 5) {
                setProfileError(addrField, 'Address must be at least 5 characters.');
                firstError = firstError || addrField.input;
            }
            if (!phone) {
                setProfileError(phoneField, 'Phone number is required so customers and drivers can reach you.');
                firstError = firstError || phoneField.input;
            } else if (phone.length > 30) {
                setProfileError(phoneField, 'Phone number must be 30 characters or fewer.');
                firstError = firstError || phoneField.input;
            }

            if (firstError) {
                firstError.focus();
                return;
            }

            saveBtn.disabled    = true;
            saveBtn.textContent = 'Saving…';

            try {
                const result = await Api.restaurants.update(restaurant.id, {
                    name,
                    description: description || null,
                    address,
                    phone,
                    cuisine_tags: cuisineTags,
                });
                Store.dispatch('SET_RESTAURANT', result.restaurant || { ...restaurant, name, description, address, phone, cuisine_tags: cuisineTags });
                Actions.showToast('Restaurant profile updated', 'success');
            } catch (err) {
                if (err.fields) {
                    const fieldMap = {
                        name: nameField, description: descField,
                        address: addrField, phone: phoneField,
                    };
                    for (const [key, messages] of Object.entries(err.fields)) {
                        if (fieldMap[key]) setProfileError(fieldMap[key], messages[0]);
                    }
                } else {
                    statusMsg.textContent = err.message;
                    statusMsg.className   = 'upload-status upload-status--error';
                    statusMsg.hidden      = false;
                }
            }

            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save Changes';
        });

        form.appendChild(saveBtn);
        form.appendChild(statusMsg);
        section.appendChild(form);

        return section;
    }

    function profileField(label, type, value, maxlength) {
        const wrapper = Dom.el('div', { class: 'form-field' });
        const labelEl = Dom.el('label', { class: 'form-label' }, [label]);
        const input    = Dom.el('input', {
            type, class: 'form-input', maxlength: String(maxlength),
        });
        input.value = value || '';

        const errorEl = Dom.el('p', { class: 'form-field__error', role: 'alert' });
        errorEl.hidden = true;

        wrapper.appendChild(labelEl);
        wrapper.appendChild(input);
        wrapper.appendChild(errorEl);

        return { wrapper, input, errorEl };
    }

    function profileTextarea(label, value, maxlength) {
        const wrapper = Dom.el('div', { class: 'form-field' });
        const labelEl = Dom.el('label', { class: 'form-label' }, [label]);
        const input    = Dom.el('textarea', {
            class: 'form-input form-textarea', maxlength: String(maxlength), rows: '4',
        });
        input.value = value || '';

        const errorEl = Dom.el('p', { class: 'form-field__error', role: 'alert' });
        errorEl.hidden = true;

        wrapper.appendChild(labelEl);
        wrapper.appendChild(input);
        wrapper.appendChild(errorEl);

        return { wrapper, input, errorEl };
    }

    function setProfileError(field, message) {
        field.input.classList.add('form-input--error');
        field.errorEl.textContent = message;
        field.errorEl.hidden = false;
    }

    function clearProfileError(field) {
        field.input.classList.remove('form-input--error');
        field.errorEl.textContent = '';
        field.errorEl.hidden = true;
    }

    // ── PHOTO GALLERY (max 3) ────────────────────────────────────

    function buildPhotoGallery(restaurant) {
        const section = Dom.el('section', { class: 'profile-section' });
        section.appendChild(Dom.el('h2', { class: 'section-heading' }, ['Food Photos']));
        section.appendChild(Dom.el('p', { class: 'form-field__hint' }, [
            'Show customers what your food looks like. Up to 3 photos, JPG/PNG/WebP, max 3MB each.',
        ]));

        const grid = Dom.el('div', { class: 'photo-gallery' });
        renderPhotoGrid(grid, restaurant);
        section.appendChild(grid);

        return section;
    }

    function renderPhotoGrid(grid, restaurant) {
        const photos = restaurant.photos || [];

        Dom.render(grid, ...photos.map(photo => buildPhotoTile(photo, restaurant, grid)));

        if (photos.length < 3) {
            grid.appendChild(buildAddPhotoTile(restaurant, grid));
        }
    }

    function buildPhotoTile(photo, restaurant, grid) {
        const tile = Dom.el('div', { class: 'photo-tile' });
        tile.appendChild(Dom.el('img', { src: photo.url, alt: 'Restaurant food photo', class: 'photo-tile__img' }));

        const removeBtn = Dom.el('button', { class: 'photo-tile__remove', 'aria-label': 'Remove photo' }, ['✕']);
        removeBtn.addEventListener('click', async () => {
            removeBtn.disabled = true;
            try {
                await Api.restaurants.deletePhoto(restaurant.id, photo.id);
                restaurant.photos = (restaurant.photos || []).filter(p => p.id !== photo.id);
                Store.dispatch('SET_RESTAURANT', restaurant);
                renderPhotoGrid(grid, restaurant);
                Actions.showToast('Photo removed', 'success');
            } catch (err) {
                Actions.showToast(err.message, 'error');
                removeBtn.disabled = false;
            }
        });

        tile.appendChild(removeBtn);
        return tile;
    }

    function buildAddPhotoTile(restaurant, grid) {
        const tile = Dom.el('label', { class: 'photo-tile photo-tile--add' });

        const input = Dom.el('input', {
            type: 'file',
            accept: 'image/jpeg,image/png,image/webp',
            class: 'visually-hidden',
        });

        const plus = Dom.el('span', { class: 'photo-tile__plus' }, ['+']);
        const text = Dom.el('span', { class: 'photo-tile__text' }, ['Add Photo']);

        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;

            tile.classList.add('photo-tile--loading');
            Dom.render(tile, Dom.el('span', {}, ['Uploading…']));

            try {
                const result = await Api.restaurants.uploadPhoto(restaurant.id, file);
                restaurant.photos = [...(restaurant.photos || []), result.photo];
                Store.dispatch('SET_RESTAURANT', restaurant);
                renderPhotoGrid(grid, restaurant);
                Actions.showToast('Photo added', 'success');
            } catch (err) {
                Actions.showToast(err.message, 'error');
                renderPhotoGrid(grid, restaurant);
            }
        });

        tile.appendChild(input);
        tile.appendChild(plus);
        tile.appendChild(text);

        return tile;
    }

    return Object.freeze({ renderDashboard, renderMenuManager, renderProfile });

})();
