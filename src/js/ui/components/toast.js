/**
 * @file toast.js
 * Non-blocking, accessible Toast notification system with interactive Undo action (Feature F12).
 * Designed for URL-Editor with dark-first design tokens,
 * hover pause/resume, customizable auto-dismiss timer, and smooth entrance/exit animations.
 */

const CONTAINER_ID = 'toast-container';
const STYLE_ID = 'toast-component-styles';
const DEFAULT_DURATION = 4000;
const EXIT_ANIMATION_MS = 200;

/**
 * Injects self-contained CSS rules for toast notifications if not already present in the document.
 * Adheres to URL-Editor design tokens and ensures non-blocking floating presentation.
 */
function ensureToastStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    #${CONTAINER_ID} {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
      max-width: calc(100vw - 2rem);
      width: auto;
      box-sizing: border-box;
    }

    .toast-item {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 260px;
      max-width: 440px;
      padding: 0.75rem 1rem;
      background: var(--neutral-900, #111111);
      color: var(--text-primary, #fafafa);
      border: 1px solid var(--border-strong, #2e2e2e);
      border-radius: var(--radius-md, 6px);
      box-shadow: var(--shadow-lg, 0 8px 20px rgba(0, 0, 0, 0.6));
      font-size: 0.875rem;
      line-height: 1.4;
      opacity: 0;
      transform: translateY(12px) scale(0.97);
      animation: toast-enter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transition: opacity ${EXIT_ANIMATION_MS}ms ease, transform ${EXIT_ANIMATION_MS}ms ease;
      user-select: none;
    }

    @keyframes toast-enter {
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .toast-item.toast-exit {
      opacity: 0;
      transform: translateY(8px) scale(0.96);
      pointer-events: none;
    }

    /* Semantic Variants */
    .toast-item--success {
      border-color: rgba(16, 185, 129, 0.35);
    }
    .toast-item--success .toast-icon {
      color: var(--accent, #10b981);
    }

    .toast-item--info {
      border-color: var(--border-strong, #2e2e2e);
    }
    .toast-item--info .toast-icon {
      color: var(--neutral-400, #a3a3a3);
    }

    .toast-item--warning {
      border-color: rgba(245, 158, 11, 0.35);
    }
    .toast-item--warning .toast-icon {
      color: var(--status-warn, #f59e0b);
    }

    .toast-item--error {
      border-color: rgba(239, 68, 68, 0.35);
    }
    .toast-item--error .toast-icon {
      color: var(--status-offline, #ef4444);
    }

    .toast-icon {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1rem;
      line-height: 1;
    }

    .toast-message {
      flex: 1 1 auto;
      word-break: break-word;
      color: var(--text-primary, #fafafa);
    }

    .toast-action-btn {
      flex-shrink: 0;
      background: var(--accent, #10b981);
      color: #ffffff;
      border: 1px solid rgba(16, 185, 129, 0.4);
      border-radius: var(--radius-sm, 4px);
      padding: 0.25rem 0.625rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      transition: background-color 0.15s ease, filter 0.15s ease;
    }

    .toast-action-btn:hover {
      background: var(--accent-hover, #059669);
    }

    .toast-action-btn:focus-visible {
      box-shadow: 0 0 0 2px var(--neutral-900, #111111), 0 0 0 4px var(--accent, #10b981);
    }

    .toast-dismiss-btn {
      flex-shrink: 0;
      background: transparent;
      border: none;
      color: var(--text-muted, #737373);
      padding: 0.125rem 0.25rem;
      font-size: 1.125rem;
      line-height: 1;
      cursor: pointer;
      border-radius: var(--radius-sm, 4px);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      outline: none;
      transition: color 0.15s ease;
    }

    .toast-dismiss-btn:hover {
      color: var(--text-primary, #fafafa);
    }

    .toast-dismiss-btn:focus-visible {
      color: var(--text-primary, #fafafa);
      box-shadow: 0 0 0 2px var(--accent, #10b981);
    }
  `;
  (document.head || document.body).appendChild(styleEl);
}

/**
 * Returns or lazily creates the root toast container `#toast-container`.
 * @returns {HTMLElement} The toast container element.
 */
export function getToastContainer() {
  ensureToastStyles();

  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notifications');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    // Inline fallback styles in case CSS isn't applied yet
    container.style.position = 'fixed';
    container.style.bottom = '1.5rem';
    container.style.right = '1.5rem';
    container.style.zIndex = '10000';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '0.5rem';
    container.style.pointerEvents = 'none';

    document.body.appendChild(container);
  }
  return container;
}

/**
 * Programmatically dismisses a toast with exit animation.
 * @param {HTMLElement} toastElement - The toast DOM element to dismiss.
 * @param {boolean} [immediate=false] - If true, bypass exit animation.
 */
export function dismissToast(toastElement, immediate = false) {
  if (!toastElement || !toastElement.parentNode) return;

  // Prevent multiple dismiss calls
  if (toastElement.dataset.dismissing === 'true') return;
  toastElement.dataset.dismissing = 'true';

  if (typeof toastElement._cleanupTimer === 'function') {
    toastElement._cleanupTimer();
  }

  if (immediate) {
    toastElement.parentNode.removeChild(toastElement);
    return;
  }

  toastElement.classList.add('toast-exit');

  // Fallback timer to guarantee DOM cleanup
  const cleanupTimeout = setTimeout(() => {
    if (toastElement.parentNode) {
      toastElement.parentNode.removeChild(toastElement);
    }
  }, EXIT_ANIMATION_MS + 50);

  const onTransitionEnd = (e) => {
    if (e.target !== toastElement) return;
    clearTimeout(cleanupTimeout);
    toastElement.removeEventListener('transitionend', onTransitionEnd);
    if (toastElement.parentNode) {
      toastElement.parentNode.removeChild(toastElement);
    }
  };

  toastElement.addEventListener('transitionend', onTransitionEnd);
}

/**
 * Removes all active toasts immediately from the container.
 */
export function clearAllToasts() {
  const container =
    typeof document !== 'undefined'
      ? document.getElementById(CONTAINER_ID)
      : null;
  if (!container) return;

  const toasts = Array.from(container.querySelectorAll('.toast-item'));
  toasts.forEach((toast) => dismissToast(toast, true));
}

/**
 * Type-specific default icons
 */
const ICONS = {
  success: '✓',
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
};

/**
 * Displays a non-blocking floating Toast notification.
 *
 * @param {string} message - Message text to display.
 * @param {object} [options] - Optional toast configurations.
 * @param {string} [options.actionLabel] - Interactive button text (e.g. "復原" / "Undo").
 * @param {() => void} [options.onAction] - Callback triggered when action button is clicked.
 * @param {number} [options.duration=4000] - Duration in ms before auto-dismissal. 0 or Infinity for persistent.
 * @param {'success'|'info'|'warning'|'error'} [options.type='info'] - Semantic variant type.
 * @param {boolean} [options.dismissible=true] - Whether to show the close dismiss button (×).
 * @returns {HTMLElement} The created toast HTMLElement.
 */
export function showToast(message, options = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }

  const {
    actionLabel,
    onAction,
    duration = DEFAULT_DURATION,
    type = 'info',
    dismissible = true,
  } = options || {};

  const container = getToastContainer();

  // Create toast card element
  const toast = document.createElement('div');
  toast.className = `toast-item toast-item--${type}`;
  toast.dataset.type = type;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  toast.tabIndex = 0;

  // Icon element
  const iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = ICONS[type] || ICONS.info;
  toast.appendChild(iconEl);

  // Message element (textContent avoids XSS)
  const messageEl = document.createElement('span');
  messageEl.className = 'toast-message';
  messageEl.textContent =
    typeof message === 'string' ? message : String(message ?? '');
  toast.appendChild(messageEl);

  // Optional Action Button (e.g., "復原" / "Undo")
  if (actionLabel && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action-btn';
    actionBtn.textContent = actionLabel;
    actionBtn.setAttribute('aria-label', actionLabel);

    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        onAction();
      } catch (err) {
        console.error('[Toast onAction error]:', err);
      } finally {
        dismissToast(toast, true);
      }
    });

    toast.appendChild(actionBtn);
  }

  // Dismiss button (×)
  if (dismissible) {
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'toast-dismiss-btn';
    dismissBtn.textContent = '×';
    dismissBtn.setAttribute('aria-label', 'Close notification');

    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissToast(toast, true);
    });

    toast.appendChild(dismissBtn);
  }

  // Auto-dismiss and Hover/Focus Pause Timer Management
  const hasAutoDismiss =
    typeof duration === 'number' && duration > 0 && Number.isFinite(duration);

  if (hasAutoDismiss) {
    let timerId = null;
    let remainingTime = duration;
    let timerStartTime = 0;
    let isPaused = false;

    const startTimer = () => {
      if (isPaused) return;
      timerStartTime = Date.now();
      timerId = setTimeout(() => {
        dismissToast(toast, false);
      }, remainingTime);
    };

    const pauseTimer = () => {
      if (isPaused || !timerId) return;
      clearTimeout(timerId);
      timerId = null;
      const elapsed = Date.now() - timerStartTime;
      remainingTime = Math.max(remainingTime - elapsed, 500);
      isPaused = true;
    };

    const resumeTimer = () => {
      if (!isPaused) return;
      isPaused = false;
      startTimer();
    };

    // Event listeners for hover and focus pause/resume
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', resumeTimer);
    toast.addEventListener('focusin', pauseTimer);
    toast.addEventListener('focusout', resumeTimer);

    toast._cleanupTimer = () => {
      if (timerId) clearTimeout(timerId);
      toast.removeEventListener('mouseenter', pauseTimer);
      toast.removeEventListener('mouseleave', resumeTimer);
      toast.removeEventListener('focusin', pauseTimer);
      toast.removeEventListener('focusout', resumeTimer);
    };

    startTimer();
  }

  container.appendChild(toast);
  return toast;
}

export default {
  showToast,
  dismissToast,
  clearAllToasts,
  getToastContainer,
};
