/**
 * FlavourConnect — Auth Form Components
 *
 * renderLogin()    — login form
 * renderRegister() — registration form
 */

const AuthComponents = (() => {

    // ── LOGIN ────────────────────────────────────────────────────

    function renderLogin(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { isLoading, error } = state.auth;

        const wrapper = Dom.el('div', { class: 'auth-page' });
        const card    = Dom.el('div', { class: 'auth-card' });

        const heading = Dom.el('h1', { class: 'auth-card__heading' }, ['Welcome back']);
        const subtext = Dom.el('p',  { class: 'auth-card__subtext' }, ['Sign in to your FlavourConnect account']);

        card.appendChild(heading);
        card.appendChild(subtext);

        // Error message
        if (error) {
            const errDiv = Dom.el('div', { class: 'alert alert--error', role: 'alert' });
            errDiv.textContent = error;
            card.appendChild(errDiv);
        }

        // Form fields
        const emailField    = buildField('email',    'Email address', 'email',    'email', 'you@example.com');
        const passwordField = buildField('password', 'Password',      'password', 'current-password');

        const emailInput    = Dom.qs('input', emailField);
        const passwordInput = Dom.qs('input', passwordField);

        // Submit
        const submitBtn = Dom.el('button', {
            class:    'btn btn--primary btn--full',
            disabled: isLoading,
        }, [isLoading ? 'Signing in…' : 'Sign In']);

        submitBtn.addEventListener('click', async () => {
            clearFieldErrors(card);
            const email    = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                showInlineError(submitBtn, 'Please fill in all fields.');
                return;
            }

            submitBtn.disabled    = true;
            submitBtn.textContent = 'Signing in…';

            const ok = await Actions.login(email, password);

            if (!ok) {
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Sign In';
            }
        });

        // Enter key support
        [emailInput, passwordInput].forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitBtn.click();
            });
        });

        card.appendChild(emailField);
        card.appendChild(passwordField);
        card.appendChild(submitBtn);

        // Register link
        const switchLink = Dom.el('p', { class: 'auth-card__switch' });
        const linkText   = document.createTextNode("Don't have an account? ");
        const link       = Dom.el('button', { class: 'btn btn--link' }, ['Create one']);
        link.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'register' }));
        switchLink.appendChild(linkText);
        switchLink.appendChild(link);
        card.appendChild(switchLink);

        wrapper.appendChild(card);
        Dom.render(container, wrapper);

        // Focus first field
        emailInput.focus();
    }

    // ── REGISTER ────────────────────────────────────────────────

    function renderRegister(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { isLoading, error } = state.auth;

        const wrapper = Dom.el('div', { class: 'auth-page' });
        const card    = Dom.el('div', { class: 'auth-card' });

        const heading = Dom.el('h1', { class: 'auth-card__heading' }, ['Create Account']);
        card.appendChild(heading);

        if (error) {
            const errDiv = Dom.el('div', { class: 'alert alert--error', role: 'alert' });
            errDiv.textContent = error;
            card.appendChild(errDiv);
        }

        const nameField     = buildField('full_name', 'Full Name',      'text',     'name',             'Jane Doe');
        const emailField    = buildField('email',     'Email Address',  'email',    'email',             'you@example.com');
        const passwordField = buildField('password',  'Password',       'password', 'new-password');
        const phoneField    = buildField('phone',     'Phone Number',   'tel',      'tel',               '+1234567890');

        // Role selector
        const roleField    = Dom.el('div', { class: 'form-field' });
        const roleLabel    = Dom.el('label', { class: 'form-label', for: 'role-select' }, ['I want to…']);
        const roleSelect   = Dom.el('select', { id: 'role-select', class: 'form-select' });

        const roleOptions = [
            { value: 'customer', label: 'Order food (Customer)' },
            { value: 'vendor',   label: 'List my restaurant (Vendor)' },
            { value: 'driver',   label: 'Deliver food (Driver)' },
        ];
        roleOptions.forEach(({ value, label }) => {
            const opt = Dom.el('option', { value }, [label]);
            roleSelect.appendChild(opt);
        });

        // Show/hide phone requirement note for drivers
        const phoneNote = Dom.el('p', { class: 'form-note', hidden: true }, ['Phone number is required for drivers.']);
        roleSelect.addEventListener('change', () => {
            phoneNote.hidden = roleSelect.value !== 'driver';
        });

        roleField.appendChild(roleLabel);
        roleField.appendChild(roleSelect);
        roleField.appendChild(phoneNote);

        const submitBtn = Dom.el('button', {
            class:    'btn btn--primary btn--full',
            disabled: isLoading,
        }, [isLoading ? 'Creating account…' : 'Create Account']);

        submitBtn.addEventListener('click', async () => {
            clearFieldErrors(card);

            const formData = {
                full_name: Dom.qs('input', nameField).value.trim(),
                email:     Dom.qs('input', emailField).value.trim(),
                password:  Dom.qs('input', passwordField).value,
                phone:     Dom.qs('input', phoneField).value.trim() || null,
                role:      roleSelect.value,
            };

            if (!formData.full_name || !formData.email || !formData.password) {
                showInlineError(submitBtn, 'Please fill in all required fields.');
                return;
            }

            submitBtn.disabled    = true;
            submitBtn.textContent = 'Creating account…';

            const ok = await Actions.register(formData);

            if (!ok) {
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Create Account';
            }
        });

        card.appendChild(nameField);
        card.appendChild(emailField);
        card.appendChild(passwordField);
        card.appendChild(phoneField);
        card.appendChild(roleField);
        card.appendChild(submitBtn);

        const switchLink = Dom.el('p', { class: 'auth-card__switch' });
        const link       = Dom.el('button', { class: 'btn btn--link' }, ['Sign in instead']);
        link.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'login' }));
        switchLink.appendChild(document.createTextNode('Already have an account? '));
        switchLink.appendChild(link);
        card.appendChild(switchLink);

        wrapper.appendChild(card);
        Dom.render(container, wrapper);

        Dom.qs('input', nameField).focus();
    }

    // ── HELPERS ──────────────────────────────────────────────────

    function buildField(name, labelText, type, autocomplete, placeholder = '') {
        const field = Dom.el('div', { class: 'form-field' });
        const label = Dom.el('label', { class: 'form-label', for: `field-${name}` }, [labelText]);
        const input = Dom.el('input', {
            type,
            id:           `field-${name}`,
            class:        'form-input',
            autocomplete,
            placeholder,
            maxlength:    type === 'password' ? '128' : '255',
        });
        field.appendChild(label);
        field.appendChild(input);
        return field;
    }

    function showInlineError(insertBefore, message) {
        const existing = insertBefore.parentNode.querySelector('.form-error--inline');
        if (existing) existing.remove();
        const err = Dom.el('p', { class: 'form-error form-error--inline', role: 'alert' }, [message]);
        insertBefore.parentNode.insertBefore(err, insertBefore);
    }

    function clearFieldErrors(container) {
        Dom.qsa('.form-error--inline', container).forEach(e => e.remove());
    }

    return Object.freeze({ renderLogin, renderRegister });

})();
