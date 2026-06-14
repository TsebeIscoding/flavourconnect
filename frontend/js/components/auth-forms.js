/**
 * FlavourConnect — Auth Form Components
 *
 * HCI principles applied:
 * - Field-level errors shown inline next to the offending field
 * - Values preserved on submit failure — user never re-types correct fields
 * - Live validation on blur (after user leaves a field)
 * - Password strength meter with character count
 * - Clear actionable error messages — tells user exactly what to fix
 * - Loading state on button prevents double-submit
 * - Server validation errors mapped back to individual fields
 * - Enter key submits form from any field
 * - First invalid field receives focus after failed submit
 */

const AuthComponents = (() => {

    // ── PASSWORD RULES (must match backend Validator::rulePassword) ──────────
    const PASSWORD_RULES = [
        { test: v => v.length >= 8,           label: 'At least 8 characters'      },
        { test: v => /[A-Z]/.test(v),         label: 'One uppercase letter'        },
        { test: v => /[a-z]/.test(v),         label: 'One lowercase letter'        },
        { test: v => /\d/.test(v),            label: 'One number'                  },
        { test: v => /[\W_]/.test(v),         label: 'One special character (!@#$…)' },
    ];

    // ── LOGIN ────────────────────────────────────────────────────────────────

    function renderLogin(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { isLoading } = state.auth;

        const wrapper = Dom.el('div', { class: 'auth-page' });
        const card    = Dom.el('div', { class: 'auth-card' });

        card.appendChild(Dom.el('h1', { class: 'auth-card__heading' }, ['Welcome back']));
        card.appendChild(Dom.el('p',  { class: 'auth-card__subtext' }, ['Sign in to your FlavourConnect account']));

        // Fields — build with refs so we can read values after failed submit
        const emailField    = buildInputField({
            id:          'login-email',
            label:       'Email address',
            type:        'email',
            autocomplete:'email',
            placeholder: 'you@example.com',
            hint:        null,
        });

        const passwordField = buildInputField({
            id:          'login-password',
            label:       'Password',
            type:        'password',
            autocomplete:'current-password',
            placeholder: '',
            hint:        null,
            showToggle:  true,
        });

        const submitBtn = Dom.el('button', {
            class:    'btn btn--primary btn--full',
            disabled: isLoading,
        }, [isLoading ? 'Signing in…' : 'Sign In']);

        const submit = async () => {
            clearAllErrors(card);

            const email    = emailField.input.value.trim();
            const password = passwordField.input.value;
            let firstError = null;

            // Client-side validation before hitting the server
            if (!email) {
                setFieldError(emailField, 'Email address is required');
                firstError = firstError || emailField.input;
            } else if (!isValidEmail(email)) {
                setFieldError(emailField, 'Enter a valid email address (e.g. you@example.com)');
                firstError = firstError || emailField.input;
            }

            if (!password) {
                setFieldError(passwordField, 'Password is required');
                firstError = firstError || passwordField.input;
            }

            if (firstError) {
                firstError.focus();
                return;
            }

            submitBtn.disabled    = true;
            submitBtn.textContent = 'Signing in…';

            try {
                const ok = await Actions.login(email, password);
                if (!ok) {
                    const authState = Store.get('auth');
                    const errorCode = authState.errorCode;
                    const fields    = authState.fieldErrors;

                    if (fields) {
                        applyFieldErrors({ email: emailField, password: passwordField }, fields);
                        const firstBad = fields.email ? emailField : passwordField;
                        firstBad.input.focus();
                    } else if (errorCode === 'AUTH_INVALID_CREDENTIALS') {
                        // Generic credential failure — backend deliberately doesn't reveal
                        // whether email or password was wrong (security). Show on password
                        // field since that's most often the mistake, but clarify in message.
                        setFieldError(passwordField, 'Email or password is incorrect. Please check both and try again.');
                        passwordField.input.focus();
                        passwordField.input.select();
                    } else if (errorCode === 'AUTH_ACCOUNT_INACTIVE') {
                        setFormError(card, 'This account has been deactivated. Contact support for help.');
                    } else {
                        setFormError(card, authState.error || 'Sign in failed. Please try again.');
                    }
                    submitBtn.disabled    = false;
                    submitBtn.textContent = 'Sign In';
                }
            } catch {
                setFormError(card, 'Could not connect to the server. Check your connection.');
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Sign In';
            }
        };

        submitBtn.addEventListener('click', submit);
        [emailField.input, passwordField.input].forEach(input => {
            input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        });

        // Live blur validation
        emailField.input.addEventListener('blur', () => {
            const v = emailField.input.value.trim();
            if (v && !isValidEmail(v)) setFieldError(emailField, 'Enter a valid email address');
            else clearFieldError(emailField);
        });

        card.appendChild(emailField.wrapper);
        card.appendChild(passwordField.wrapper);
        card.appendChild(submitBtn);

        const switchLink = Dom.el('p', { class: 'auth-card__switch' });
        switchLink.appendChild(document.createTextNode("Don't have an account? "));
        const link = Dom.el('button', { class: 'btn btn--link' }, ['Create one']);
        link.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'register' }));
        switchLink.appendChild(link);
        card.appendChild(switchLink);

        wrapper.appendChild(card);
        Dom.render(container, wrapper);
        emailField.input.focus();
    }

    // ── REGISTER ────────────────────────────────────────────────────────────

    function renderRegister(state) {
        const container = Dom.qs('#view-content');
        if (!container) return;

        const { isLoading } = state.auth;

        const wrapper = Dom.el('div', { class: 'auth-page' });
        const card    = Dom.el('div', { class: 'auth-card' });

        card.appendChild(Dom.el('h1', { class: 'auth-card__heading' }, ['Create Account']));

        const nameField  = buildInputField({
            id:          'reg-name',
            label:       'Full Name',
            type:        'text',
            autocomplete:'name',
            placeholder: 'Jane Doe',
            hint:        'Your real name as it will appear to restaurants and drivers',
        });

        const emailField = buildInputField({
            id:          'reg-email',
            label:       'Email Address',
            type:        'email',
            autocomplete:'email',
            placeholder: 'you@example.com',
            hint:        null,
        });

        const passwordField = buildInputField({
            id:          'reg-password',
            label:       'Password',
            type:        'password',
            autocomplete:'new-password',
            placeholder: '',
            hint:        null,
            showToggle:  true,
        });

        // Password strength meter
        const strengthMeter = buildPasswordStrengthMeter();
        passwordField.wrapper.appendChild(strengthMeter.el);

        passwordField.input.addEventListener('input', () => {
            strengthMeter.update(passwordField.input.value);
            // Live clear error as user types
            if (passwordField.input.value.length > 0) clearFieldError(passwordField);
        });

        const phoneField = buildInputField({
            id:          'reg-phone',
            label:       'Phone Number',
            type:        'tel',
            autocomplete:'tel',
            placeholder: '+27821234567',
            hint:        'Required for drivers. Optional for customers and vendors.',
        });

        // Role selector
        const roleField  = Dom.el('div', { class: 'form-field' });
        const roleLabel  = Dom.el('label', { class: 'form-label', for: 'role-select' }, ['I want to…']);
        const roleSelect = Dom.el('select', { id: 'role-select', class: 'form-select' });

        [
            { value: 'customer', label: 'Order food  (Customer)'         },
            { value: 'vendor',   label: 'List my restaurant  (Vendor)'   },
            { value: 'driver',   label: 'Deliver food  (Driver)'         },
        ].forEach(({ value, label }) => {
            roleSelect.appendChild(Dom.el('option', { value }, [label]));
        });

        const phoneNote = Dom.el('p', { class: 'form-note form-note--warning', hidden: true },
            ['⚠ Phone number is required for driver accounts.']);
        roleSelect.addEventListener('change', () => {
            phoneNote.hidden = roleSelect.value !== 'driver';
        });

        roleField.appendChild(roleLabel);
        roleField.appendChild(roleSelect);
        roleField.appendChild(phoneNote);

        const submitBtn = Dom.el('button', {
            class:   'btn btn--primary btn--full',
            disabled: isLoading,
        }, [isLoading ? 'Creating account…' : 'Create Account']);

        const submit = async () => {
            clearAllErrors(card);

            const formData = {
                full_name: nameField.input.value.trim(),
                email:     emailField.input.value.trim(),
                password:  passwordField.input.value,
                phone:     phoneField.input.value.trim() || null,
                role:      roleSelect.value,
            };

            let firstError = null;

            // Validate each field individually
            if (!formData.full_name) {
                setFieldError(nameField, 'Full name is required');
                firstError = firstError || nameField.input;
            } else if (formData.full_name.length < 2) {
                setFieldError(nameField, 'Name must be at least 2 characters');
                firstError = firstError || nameField.input;
            }

            if (!formData.email) {
                setFieldError(emailField, 'Email address is required');
                firstError = firstError || emailField.input;
            } else if (!isValidEmail(formData.email)) {
                setFieldError(emailField, 'Enter a valid email address (e.g. you@example.com)');
                firstError = firstError || emailField.input;
            }

            const passwordErrors = validatePassword(formData.password);
            if (passwordErrors.length > 0) {
                setFieldError(passwordField,
                    'Password must have: ' + passwordErrors.join(', '));
                firstError = firstError || passwordField.input;
            }

            if (formData.role === 'driver' && !formData.phone) {
                setFieldError(phoneField, 'Phone number is required for driver accounts');
                firstError = firstError || phoneField.input;
            }

            if (firstError) {
                firstError.focus();
                return;
            }

            submitBtn.disabled    = true;
            submitBtn.textContent = 'Creating account…';

            try {
                const ok = await Actions.register(formData);

                if (!ok) {
                    const authState = Store.get('auth');
                    const errorCode = authState.errorCode;
                    const fields    = authState.fieldErrors;

                    const fieldMap = {
                        email:     emailField,
                        password:  passwordField,
                        full_name: nameField,
                        phone:     phoneField,
                    };

                    let firstBad = null;

                    if (fields) {
                        firstBad = applyFieldErrors(fieldMap, fields);
                    }

                    if (errorCode === 'CONFLICT_EMAIL_EXISTS') {
                        setFieldError(emailField, 'An account with this email already exists. Sign in instead, or use a different email.');
                        firstBad = firstBad || emailField;
                    }

                    if (!firstBad) {
                        setFormError(card, authState.error || 'Registration failed. Please check your details and try again.');
                    } else {
                        firstBad.input.focus();
                    }

                    submitBtn.disabled    = false;
                    submitBtn.textContent = 'Create Account';
                }
            } catch {
                setFormError(card, 'Could not connect to the server. Check your connection and try again.');
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Create Account';
            }
        };

        submitBtn.addEventListener('click', submit);
        [nameField.input, emailField.input, passwordField.input, phoneField.input].forEach(input => {
            input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        });

        // Live blur validation per field
        emailField.input.addEventListener('blur', () => {
            const v = emailField.input.value.trim();
            if (v && !isValidEmail(v)) setFieldError(emailField, 'Enter a valid email address');
            else clearFieldError(emailField);
        });

        nameField.input.addEventListener('blur', () => {
            const v = nameField.input.value.trim();
            if (v && v.length < 2) setFieldError(nameField, 'Name must be at least 2 characters');
            else clearFieldError(nameField);
        });

        phoneField.input.addEventListener('blur', () => {
            const v = phoneField.input.value.trim();
            if (v && v.length > 20) setFieldError(phoneField, 'Phone number must be 20 characters or fewer');
            else clearFieldError(phoneField);
        });

        card.appendChild(nameField.wrapper);
        card.appendChild(emailField.wrapper);
        card.appendChild(passwordField.wrapper);
        card.appendChild(phoneField.wrapper);
        card.appendChild(roleField);
        card.appendChild(submitBtn);

        const switchLink = Dom.el('p', { class: 'auth-card__switch' });
        const link = Dom.el('button', { class: 'btn btn--link' }, ['Sign in instead']);
        link.addEventListener('click', () => Store.dispatch('NAVIGATE', { view: 'login' }));
        switchLink.appendChild(document.createTextNode('Already have an account? '));
        switchLink.appendChild(link);
        card.appendChild(switchLink);

        wrapper.appendChild(card);
        Dom.render(container, wrapper);
        nameField.input.focus();
    }

    // ── FIELD BUILDER ────────────────────────────────────────────────────────

    function buildInputField({ id, label, type, autocomplete, placeholder, hint, showToggle = false }) {
        const wrapper   = Dom.el('div', { class: 'form-field' });
        const labelEl   = Dom.el('label', { class: 'form-label', for: id }, [label]);

        const inputWrap = Dom.el('div', { class: 'form-input-wrap' });
        const input     = Dom.el('input', {
            type,
            id,
            class:        'form-input',
            autocomplete,
            placeholder,
            maxlength:    type === 'password' ? '128' : type === 'tel' ? '20' : '255',
        });

        inputWrap.appendChild(input);

        // Password show/hide toggle
        if (showToggle) {
            const toggle = Dom.el('button', {
                type:  'button',
                class: 'form-input__toggle',
                'aria-label': 'Show password',
            }, ['Show']);
            toggle.addEventListener('click', () => {
                const isHidden = input.type === 'password';
                input.type         = isHidden ? 'text' : 'password';
                toggle.textContent = isHidden ? 'Hide' : 'Show';
                toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
            });
            inputWrap.appendChild(toggle);
        }

        // Character counter for password
        if (type === 'password') {
            const counter = Dom.el('span', { class: 'form-input__counter', 'aria-live': 'polite' }, ['0/128']);
            input.addEventListener('input', () => {
                counter.textContent = `${input.value.length}/128`;
            });
            inputWrap.appendChild(counter);
        }

        const errorEl = Dom.el('p', {
            class:      'form-field__error',
            role:       'alert',
            'aria-live':'polite',
        });
        errorEl.hidden = true;

        wrapper.appendChild(labelEl);
        wrapper.appendChild(inputWrap);

        if (hint) {
            const hintEl = Dom.el('p', { class: 'form-field__hint' }, [hint]);
            wrapper.appendChild(hintEl);
        }

        wrapper.appendChild(errorEl);

        return { wrapper, input, errorEl, label };
    }

    // ── PASSWORD STRENGTH METER ──────────────────────────────────────────────

    function buildPasswordStrengthMeter() {
        const el        = Dom.el('div', { class: 'password-strength' });
        const bar       = Dom.el('div', { class: 'password-strength__bar' });
        const fill      = Dom.el('div', { class: 'password-strength__fill' });
        const rulesList = Dom.el('ul',  { class: 'password-strength__rules' });

        bar.appendChild(fill);
        el.appendChild(bar);

        PASSWORD_RULES.forEach(rule => {
            const li   = Dom.el('li', { class: 'password-rule password-rule--unmet' });
            const icon = Dom.el('span', { class: 'password-rule__icon' }, ['✗']);
            const text = Dom.el('span', { class: 'password-rule__text' }, [rule.label]);
            li.appendChild(icon);
            li.appendChild(text);
            rulesList.appendChild(li);
        });

        el.appendChild(rulesList);

        function update(value) {
            const items = rulesList.querySelectorAll('.password-rule');
            let passed  = 0;

            PASSWORD_RULES.forEach((rule, i) => {
                const met  = value.length > 0 && rule.test(value);
                const item = items[i];
                const icon = item.querySelector('.password-rule__icon');
                item.className = `password-rule ${met ? 'password-rule--met' : 'password-rule--unmet'}`;
                icon.textContent = met ? '✓' : '✗';
                if (met) passed++;
            });

            // Update bar width and colour
            const pct    = value.length === 0 ? 0 : Math.round((passed / PASSWORD_RULES.length) * 100);
            fill.style.width = pct + '%';

            fill.className = 'password-strength__fill';
            if (passed === 0 || value.length === 0) fill.classList.add('password-strength__fill--empty');
            else if (passed <= 2)                   fill.classList.add('password-strength__fill--weak');
            else if (passed <= 4)                   fill.classList.add('password-strength__fill--fair');
            else                                    fill.classList.add('password-strength__fill--strong');
        }

        return { el, update };
    }

    // ── ERROR HELPERS ────────────────────────────────────────────────────────

    /**
     * Applies backend validation errors to their matching fields.
     * Returns the first field object that received an error, or null.
     *
     * @param {object} fieldMap - { backendFieldName: fieldObject }
     * @param {object} fields   - { backendFieldName: ["error msg", ...] }
     */
    function applyFieldErrors(fieldMap, fields) {
        let first = null;
        for (const [name, messages] of Object.entries(fields)) {
            const field = fieldMap[name];
            if (!field || !messages || messages.length === 0) continue;

            // Rewrite backend's raw message into a friendlier, more specific one
            const friendly = friendlyFieldMessage(name, messages[0]);
            setFieldError(field, friendly);

            if (!first) first = field;
        }
        return first;
    }

    /**
     * Converts backend validation messages (e.g. "password must be at least
     * 8 characters with uppercase, lowercase, number, and special character")
     * into clearer, more actionable copy for the user.
     */
    function friendlyFieldMessage(fieldName, rawMessage) {
        const msg = rawMessage.toLowerCase();

        if (fieldName === 'password') {
            if (msg.includes('at least 8')) {
                return 'Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character (e.g. ! @ # $).';
            }
        }

        if (fieldName === 'phone') {
            if (msg.includes('exceed') || msg.includes('30')) {
                return 'Phone number is too long. Use up to 20 characters, including the country code (e.g. +27821234567).';
            }
            if (msg.includes('required')) {
                return 'Phone number is required for driver accounts.';
            }
        }

        if (fieldName === 'email') {
            if (msg.includes('valid email')) {
                return 'Enter a valid email address (e.g. you@example.com).';
            }
            if (msg.includes('required')) {
                return 'Email address is required.';
            }
        }

        if (fieldName === 'full_name') {
            if (msg.includes('at least 2')) {
                return 'Full name must be at least 2 characters.';
            }
            if (msg.includes('required')) {
                return 'Full name is required.';
            }
        }

        // Fallback — capitalize and return the raw message
        return rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);
    }

    function setFieldError(field, message) {
        field.input.classList.add('form-input--error');
        field.input.setAttribute('aria-invalid', 'true');
        field.errorEl.textContent = message;
        field.errorEl.hidden      = false;
    }

    function clearFieldError(field) {
        field.input.classList.remove('form-input--error');
        field.input.removeAttribute('aria-invalid');
        field.errorEl.textContent = '';
        field.errorEl.hidden      = true;
    }

    function clearAllErrors(card) {
        card.querySelectorAll('.form-input--error').forEach(el => {
            el.classList.remove('form-input--error');
            el.removeAttribute('aria-invalid');
        });
        card.querySelectorAll('.form-field__error').forEach(el => {
            el.textContent = '';
            el.hidden = true;
        });
        card.querySelectorAll('.form-error--form').forEach(el => el.remove());
    }

    function setFormError(card, message) {
        const existing = card.querySelector('.form-error--form');
        if (existing) existing.remove();
        const err = Dom.el('div', {
            class: 'alert alert--error form-error--form',
            role:  'alert',
        }, [message]);
        // Insert before the first field
        const firstField = card.querySelector('.form-field');
        card.insertBefore(err, firstField);
    }

    // ── VALIDATORS ───────────────────────────────────────────────────────────

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function validatePassword(password) {
        if (!password) return ['at least 8 characters', 'uppercase letter', 'lowercase letter', 'number', 'special character'];
        return PASSWORD_RULES
            .filter(rule => !rule.test(password))
            .map(rule => rule.label.toLowerCase());
    }

    return Object.freeze({ renderLogin, renderRegister });

})();
