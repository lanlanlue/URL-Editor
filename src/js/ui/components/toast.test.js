/**
 * @file toast.test.js
 * Comprehensive unit tests for Toast Notification & Undo Component (Feature F12).
 * Verifies container creation, positioning, non-blocking behavior,
 * interactive action button and callback execution, auto-dismiss with fake timers,
 * hover pause/resume, dismiss button, stacking of multiple toasts, and a11y attributes.
 */

import {
  showToast,
  dismissToast,
  clearAllToasts,
  getToastContainer,
} from './toast.js';

describe('ui/components/toast (Feature F12: Toast & Undo Action)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    clearAllToasts();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  /* ========================================================================
     1. Toast Container Initialization & Placement
     ======================================================================== */
  describe('Toast Container Initialization', () => {
    test('TC-T1-F12-01A: creates #toast-container lazily and appends to document.body', () => {
      expect(document.getElementById('toast-container')).toBeNull();

      const container = getToastContainer();

      expect(container).not.toBeNull();
      expect(document.getElementById('toast-container')).toBe(container);
      expect(container.parentNode).toBe(document.body);
    });

    test('TC-T1-F12-01B: reuses existing #toast-container on subsequent calls', () => {
      const container1 = getToastContainer();
      const container2 = getToastContainer();

      expect(container1).toBe(container2);
      expect(document.querySelectorAll('#toast-container')).toHaveLength(1);
    });

    test('TC-T1-F12-01C: container has high z-index (>= 10000) and non-blocking pointer-events', () => {
      const container = getToastContainer();

      expect(parseInt(container.style.zIndex, 10)).toBeGreaterThanOrEqual(
        10000
      );
      expect(container.style.pointerEvents).toBe('none');
      expect(container.style.position).toBe('fixed');
    });

    test('TC-T1-F12-01D: container includes accessibility attributes', () => {
      const container = getToastContainer();

      expect(container.getAttribute('role')).toBe('region');
      expect(container.getAttribute('aria-live')).toBe('polite');
      expect(container.getAttribute('aria-atomic')).toBe('true');
    });
  });

  /* ========================================================================
     2. Rendering Message, Variants & Accessibility
     ======================================================================== */
  describe('Message Rendering & Semantic Variants', () => {
    test('TC-T1-F12-01E: renders toast element with message text and appends to container', () => {
      const toast = showToast('已成功整理 3 筆網址');

      expect(toast).not.toBeNull();
      expect(toast.classList.contains('toast-item')).toBe(true);
      expect(toast.querySelector('.toast-message').textContent).toBe(
        '已成功整理 3 筆網址'
      );
      expect(toast.getAttribute('role')).toBe('status');
      expect(toast.getAttribute('aria-live')).toBe('polite');
    });

    test('TC-T1-F12-01F: safely escapes HTML content in message to prevent XSS injection', () => {
      const maliciousPayload = '<img src=x onerror="alert(1)"><b>Danger</b>';
      const toast = showToast(maliciousPayload);

      const messageEl = toast.querySelector('.toast-message');
      expect(messageEl.textContent).toBe(maliciousPayload);
      expect(messageEl.querySelector('img')).toBeNull();
      expect(messageEl.querySelector('b')).toBeNull();
    });

    test('TC-T1-F12-01G: applies semantic type classes and icons correctly', () => {
      const successToast = showToast('Success msg', { type: 'success' });
      expect(successToast.classList.contains('toast-item--success')).toBe(true);
      expect(successToast.querySelector('.toast-icon').textContent).toBe('✓');

      const errorToast = showToast('Error msg', { type: 'error' });
      expect(errorToast.classList.contains('toast-item--error')).toBe(true);
      expect(errorToast.querySelector('.toast-icon').textContent).toBe('✕');

      const warningToast = showToast('Warning msg', { type: 'warning' });
      expect(warningToast.classList.contains('toast-item--warning')).toBe(true);
      expect(warningToast.querySelector('.toast-icon').textContent).toBe('⚠');

      const infoToast = showToast('Info msg', { type: 'info' });
      expect(infoToast.classList.contains('toast-item--info')).toBe(true);
      expect(infoToast.querySelector('.toast-icon').textContent).toBe('ℹ');
    });
  });

  /* ========================================================================
     3. Action Button & Undo Execution
     ======================================================================== */
  describe('Action Button & Undo Interaction', () => {
    test('TC-T1-F12-02: renders interactive action button when actionLabel and onAction are provided', () => {
      const onActionMock = jest.fn();
      const toast = showToast('已儲存 5 筆網址', {
        actionLabel: '復原',
        onAction: onActionMock,
      });

      const actionBtn = toast.querySelector('.toast-action-btn');
      expect(actionBtn).not.toBeNull();
      expect(actionBtn.textContent).toBe('復原');
      expect(actionBtn.tagName).toBe('BUTTON');
    });

    test('TC-T1-F12-02B: does NOT render action button when actionLabel is missing', () => {
      const onActionMock = jest.fn();
      const toast = showToast('單純通知訊息', { onAction: onActionMock });

      const actionBtn = toast.querySelector('.toast-action-btn');
      expect(actionBtn).toBeNull();
    });

    test('TC-T1-F12-03: clicking action button invokes callback and immediately dismisses toast', () => {
      const onActionMock = jest.fn();
      const toast = showToast('已匯入資料', {
        actionLabel: 'Undo',
        onAction: onActionMock,
      });

      const actionBtn = toast.querySelector('.toast-action-btn');
      expect(onActionMock).not.toHaveBeenCalled();

      actionBtn.click();

      expect(onActionMock).toHaveBeenCalledTimes(1);
      // Immediately removed from DOM
      expect(document.body.contains(toast)).toBe(false);
    });

    test('TC-T1-F12-03B: dismisses toast safely even if onAction callback throws an error', () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const throwingAction = jest.fn(() => {
        throw new Error('Action failed');
      });

      const toast = showToast('已匯入資料', {
        actionLabel: 'Undo',
        onAction: throwingAction,
      });

      const actionBtn = toast.querySelector('.toast-action-btn');
      expect(() => actionBtn.click()).not.toThrow();
      expect(document.body.contains(toast)).toBe(false);
      expect(throwingAction).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  /* ========================================================================
     4. Dismiss Button (×)
     ======================================================================== */
  describe('Dismiss Button (×)', () => {
    test('TC-T1-F12-DISMISS-01: renders close button by default and dismisses upon click', () => {
      const onActionMock = jest.fn();
      const toast = showToast('可手動關閉的訊息', {
        actionLabel: 'Undo',
        onAction: onActionMock,
      });

      const dismissBtn = toast.querySelector('.toast-dismiss-btn');
      expect(dismissBtn).not.toBeNull();
      expect(dismissBtn.textContent).toBe('×');

      dismissBtn.click();

      // Toast dismissed immediately without invoking onAction
      expect(document.body.contains(toast)).toBe(false);
      expect(onActionMock).not.toHaveBeenCalled();
    });

    test('TC-T1-F12-DISMISS-02: omits close button when dismissible is false', () => {
      const toast = showToast('不可關閉通知', { dismissible: false });
      expect(toast.querySelector('.toast-dismiss-btn')).toBeNull();
    });
  });

  /* ========================================================================
     5. Auto-Dismiss Lifecycle & Fake Timers
     ======================================================================== */
  describe('Auto-Dismiss Lifecycle', () => {
    test('TC-T1-F12-04: automatically dismisses toast after default 4000ms duration', () => {
      const toast = showToast('自動倒數關閉訊息');

      expect(document.body.contains(toast)).toBe(true);

      // Advance 3999ms: toast still present
      jest.advanceTimersByTime(3999);
      expect(document.body.contains(toast)).toBe(true);

      // Advance past 4000ms: exit animation triggers
      jest.advanceTimersByTime(1);
      expect(toast.classList.contains('toast-exit')).toBe(true);

      // Advance past transition timeout (250ms)
      jest.advanceTimersByTime(250);
      expect(document.body.contains(toast)).toBe(false);
    });

    test('TC-T1-F12-04B: respects custom duration option', () => {
      const toast = showToast('2 秒快顯', { duration: 2000 });

      jest.advanceTimersByTime(1999);
      expect(document.body.contains(toast)).toBe(true);

      jest.advanceTimersByTime(1);
      expect(toast.classList.contains('toast-exit')).toBe(true);

      jest.advanceTimersByTime(250);
      expect(document.body.contains(toast)).toBe(false);
    });

    test('TC-T1-F12-04C: does not auto-dismiss when duration is 0 or Infinity', () => {
      const toastPersistent = showToast('常駐提示', { duration: 0 });
      const toastInfinity = showToast('無限提示', { duration: Infinity });

      jest.advanceTimersByTime(60000); // 1 minute

      expect(document.body.contains(toastPersistent)).toBe(true);
      expect(document.body.contains(toastInfinity)).toBe(true);
    });
  });

  /* ========================================================================
     6. Hover & Focus Pause/Resume
     ======================================================================== */
  describe('Hover & Focus Pause / Resume', () => {
    test('TC-T1-F12-HOVER-01: pauses timer on mouseenter and resumes on mouseleave', () => {
      const toast = showToast('懸停暫停訊息', { duration: 4000 });

      // Run 2000ms (halfway)
      jest.advanceTimersByTime(2000);

      // Hover over toast -> pause
      toast.dispatchEvent(new MouseEvent('mouseenter'));

      // Wait 5000ms while hovering -> should NOT dismiss
      jest.advanceTimersByTime(5000);
      expect(document.body.contains(toast)).toBe(true);
      expect(toast.classList.contains('toast-exit')).toBe(false);

      // Mouse leaves toast -> resume remaining countdown (~2000ms)
      toast.dispatchEvent(new MouseEvent('mouseleave'));

      // Advance 1500ms -> still there
      jest.advanceTimersByTime(1500);
      expect(document.body.contains(toast)).toBe(true);

      // Advance remaining time (~1000ms)
      jest.advanceTimersByTime(1000);
      expect(toast.classList.contains('toast-exit')).toBe(true);

      jest.advanceTimersByTime(250);
      expect(document.body.contains(toast)).toBe(false);
    });

    test('TC-T1-F12-FOCUS-01: pauses timer on focusin and resumes on focusout', () => {
      const toast = showToast('焦點暫停訊息', { duration: 3000 });

      jest.advanceTimersByTime(1000);

      // Focus enters toast
      toast.dispatchEvent(new FocusEvent('focusin'));

      jest.advanceTimersByTime(5000);
      expect(document.body.contains(toast)).toBe(true);

      // Focus leaves toast
      toast.dispatchEvent(new FocusEvent('focusout'));

      jest.advanceTimersByTime(2500);
      expect(toast.classList.contains('toast-exit')).toBe(true);
    });
  });

  /* ========================================================================
     7. Stacking & Concurrency
     ======================================================================== */
  describe('Multiple Toast Stacking & Concurrency', () => {
    test('TC-T1-F12-STACK-01: stacks multiple toasts in container without collision', () => {
      const toast1 = showToast('Message 1', { duration: 3000 });
      const toast2 = showToast('Message 2', { duration: 5000 });
      const toast3 = showToast('Message 3', { duration: 7000 });

      const container = getToastContainer();
      expect(container.querySelectorAll('.toast-item')).toHaveLength(3);

      // Advance 3250ms -> toast1 dismissed, toast2 and toast3 remain
      jest.advanceTimersByTime(3250);
      expect(document.body.contains(toast1)).toBe(false);
      expect(document.body.contains(toast2)).toBe(true);
      expect(document.body.contains(toast3)).toBe(true);

      // Advance another 2000ms -> toast2 dismissed, toast3 remains
      jest.advanceTimersByTime(2000);
      expect(document.body.contains(toast2)).toBe(false);
      expect(document.body.contains(toast3)).toBe(true);

      // Advance to end -> all dismissed
      jest.advanceTimersByTime(2500);
      expect(document.body.contains(toast3)).toBe(false);
      expect(container.querySelectorAll('.toast-item')).toHaveLength(0);
    });

    test('TC-T1-F12-STACK-02: dismissing an intermediate toast does not disturb others', () => {
      const toast1 = showToast('Item A');
      const toast2 = showToast('Item B');
      const toast3 = showToast('Item C');

      dismissToast(toast2, true);

      const container = getToastContainer();
      const currentToasts = container.querySelectorAll('.toast-item');
      expect(currentToasts).toHaveLength(2);
      expect(currentToasts[0]).toBe(toast1);
      expect(currentToasts[1]).toBe(toast3);
    });
  });

  /* ========================================================================
     8. Programmatic Controls & Edge Cases
     ======================================================================== */
  describe('Programmatic Controls & Edge Cases', () => {
    test('TC-T1-F12-PROG-01: clearAllToasts removes all toasts immediately', () => {
      showToast('T1');
      showToast('T2');
      showToast('T3');

      const container = getToastContainer();
      expect(container.querySelectorAll('.toast-item')).toHaveLength(3);

      clearAllToasts();

      expect(container.querySelectorAll('.toast-item')).toHaveLength(0);
    });

    test('TC-T1-F12-EDGE-01: safely handles non-string or null messages', () => {
      const nullToast = showToast(null);
      expect(nullToast.querySelector('.toast-message').textContent).toBe('');

      const numToast = showToast(404);
      expect(numToast.querySelector('.toast-message').textContent).toBe('404');
    });

    test('TC-T1-F12-EDGE-02: dismissToast ignores invalid or already removed elements without throwing', () => {
      expect(() => dismissToast(null)).not.toThrow();
      expect(() => dismissToast(document.createElement('div'))).not.toThrow();
    });
  });
});
