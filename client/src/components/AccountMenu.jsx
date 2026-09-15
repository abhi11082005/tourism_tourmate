import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/*
 * The signed-in navbar menu. This is the only place the Personal Dashboard is
 * reachable from on desktop, so it has to work without a mouse:
 *
 *   * the trigger is a real <button> with aria-haspopup / aria-expanded;
 *   * ArrowDown / ArrowUp move a roving focus through the items, Home / End jump
 *     to the ends, Escape closes and returns focus to the trigger;
 *   * a pointerdown listener on the document closes it on an outside click —
 *     pointerdown rather than click, so it also closes when a drag starts.
 *
 * The items are plain links, so middle-click and "open in new tab" keep working.
 */

const ITEM_CLASS =
  'block rounded-lg px-3 py-2 text-left text-sm hover:bg-sand-100 dark:hover:bg-ink-800';

export default function AccountMenu() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const triggerRef = useRef(null);
  const itemsRef = useRef([]);

  const close = useCallback(({ restoreFocus = false } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!boxRef.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Opening with the keyboard should land on the first item.
  useEffect(() => {
    if (open) itemsRef.current[0]?.focus();
  }, [open]);

  const focusItem = (index) => {
    const items = itemsRef.current.filter(Boolean);
    if (!items.length) return;
    const next = (index + items.length) % items.length;
    items[next].focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close({ restoreFocus: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = itemsRef.current.filter(Boolean);
    const current = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') focusItem(current + 1);
    else if (e.key === 'ArrowUp') focusItem(current - 1);
    else if (e.key === 'Home') focusItem(0);
    else focusItem(items.length - 1);
  };

  const links = [
    ['/dashboard', 'Personal dashboard'],
    ['/dashboard/trips', 'My trips'],
    ['/dashboard/saved', 'Saved trips'],
    ['/dashboard/documents', 'Tickets & invoices'],
    ['/dashboard/support', 'Help & support'],
    ...(isAdmin ? [['/admin', 'Admin console']] : []),
  ];

  const register = (index) => (el) => {
    itemsRef.current[index] = el;
  };

  return (
    <div className="relative" ref={boxRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-ghost gap-2 px-2 sm:px-3"
      >
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full bg-ink-800 text-xs font-bold text-sand-50 dark:bg-sand-300 dark:text-ink-900"
        >
          {(user.fullName ?? user.email).trim().charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.fullName ?? 'Account'}</span>
        <span aria-hidden className="faint text-[10px]">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="card absolute right-0 z-30 mt-2 w-60 p-2 shadow-lg"
        >
          <p className="px-3 pb-2 pt-1">
            <span className="block truncate text-sm font-semibold">{user.fullName}</span>
            <span className="faint block truncate text-xs">{user.email}</span>
          </p>
          <hr className="my-1 border-sand-100 dark:border-ink-600" />

          {links.map(([to, label], i) => (
            <Link
              key={to}
              to={to}
              role="menuitem"
              ref={register(i)}
              className={ITEM_CLASS}
              onClick={() => close()}
            >
              {label}
            </Link>
          ))}

          <hr className="my-1 border-sand-100 dark:border-ink-600" />
          <button
            type="button"
            role="menuitem"
            ref={register(links.length)}
            className={`${ITEM_CLASS} w-full text-red-700 dark:text-red-300`}
            onClick={() => {
              close();
              logout();
              navigate('/', { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
