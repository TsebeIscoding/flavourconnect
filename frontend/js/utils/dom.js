/**
 * FlavourConnect — DOM Utility
 *
 * Rules:
 * - NEVER use innerHTML with user-supplied data (XSS)
 * - All user data goes through textContent or setAttribute
 * - createElement + append is the safe pattern
 */

const Dom = (() => {

    /**
     * Create an element with optional attributes and children
     * @param {string} tag
     * @param {object} attrs  - { class, id, dataset, ... }
     * @param {Array}  children - strings or elements
     */
    function el(tag, attrs = {}, children = []) {
        const element = document.createElement(tag);

        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class' || key === 'className') {
                element.className = value;
            } else if (key === 'dataset') {
                for (const [dk, dv] of Object.entries(value)) {
                    element.dataset[dk] = dv;
                }
            } else if (key === 'style' && typeof value === 'object') {
                for (const [sk, sv] of Object.entries(value)) {
                    element.style[sk] = sv;
                }
            } else if (key.startsWith('on') && typeof value === 'function') {
                element.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (key === 'disabled') {
                element.disabled = Boolean(value);
            } else if (key === 'checked') {
                element.checked = Boolean(value);
            } else if (key === 'value') {
                element.value = value;
            } else {
                element.setAttribute(key, value);
            }
        }

        for (const child of children) {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            } else if (Array.isArray(child)) {
                child.forEach(c => {
                    if (typeof c === 'string') element.appendChild(document.createTextNode(c));
                    else if (c instanceof Node) element.appendChild(c);
                });
            }
        }

        return element;
    }

    /** Get element by selector */
    function qs(selector, root = document) {
        return root.querySelector(selector);
    }

    /** Get all elements by selector */
    function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
    }

    /**
     * Safely render into a container.
     * Clears previous content and appends new nodes.
     */
    function render(container, ...nodes) {
        if (!container) return;
        container.innerHTML = '';
        nodes.forEach(node => {
            if (typeof node === 'string') {
                container.appendChild(document.createTextNode(node));
            } else if (node instanceof Node) {
                container.appendChild(node);
            } else if (Array.isArray(node)) {
                node.forEach(n => {
                    if (typeof n === 'string') container.appendChild(document.createTextNode(n));
                    else if (n instanceof Node) container.appendChild(n);
                });
            }
        });
    }

    /** Show a skeleton loading state */
    function skeleton(lines = 3) {
        const wrapper = el('div', { class: 'skeleton-wrapper' });
        for (let i = 0; i < lines; i++) {
            wrapper.appendChild(el('div', { class: `skeleton-line skeleton-line--${i === 0 ? 'title' : 'text'}` }));
        }
        return wrapper;
    }

    /** Format price */
    function formatPrice(amount) {
        return new Intl.NumberFormat('en-US', {
            style:    'currency',
            currency: 'USD',
        }).format(amount);
    }

    /** Format date/time */
    function formatTime(isoString) {
        return new Date(isoString).toLocaleString('en-US', {
            month:  'short',
            day:    'numeric',
            hour:   'numeric',
            minute: '2-digit',
        });
    }

    /** Truncate text safely */
    function truncate(str, maxLen = 100) {
        if (!str) return '';
        return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
    }

    /**
     * Create an icon element (inline SVG via symbol reference)
     * All icons defined in /img/icons.svg sprite
     */
    function icon(name, cls = '') {
        const svg  = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use  = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        svg.setAttribute('class', `icon ${cls}`);
        svg.setAttribute('aria-hidden', 'true');
        use.setAttribute('href', `/img/icons.svg#${name}`);
        svg.appendChild(use);
        return svg;
    }

    /** Status badge */
    function statusBadge(status) {
        const badge = el('span', { class: `badge badge--${status.replace(/_/g, '-')}` });
        badge.textContent = status.replace(/_/g, ' ').toUpperCase();
        return badge;
    }

    return Object.freeze({
        el,
        qs,
        qsa,
        render,
        skeleton,
        formatPrice,
        formatTime,
        truncate,
        icon,
        statusBadge,
    });

})();
