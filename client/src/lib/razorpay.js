/*
 * Razorpay checkout loader.
 *
 * The script is fetched on demand rather than from index.html: it is ~100KB and
 * only a traveller who actually reaches checkout needs it, so browsing tours
 * stays cheap on a phone.
 *
 * It must come from Razorpay's own CDN — bundling or self-hosting a copy breaks
 * PCI-DSS SAQ-A, because the script that touches card fields has to be served
 * and controlled by the gateway, not by us.
 */

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';

// A stalled CDN must not leave the Pay button reading "Opening secure checkout…"
// forever, so the load gives up and the traveller gets a retry.
const TIMEOUT_MS = 15_000;

// One in-flight promise for the whole app: React 18 double-mounts effects and a
// traveller can click Pay twice, and neither should append a second <script>.
let pending = null;

export function loadRazorpay() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    // A previous attempt may have left the tag in place with its handlers spent.
    const existing = document.querySelector(`script[src="${SRC}"]`);
    const el = existing ?? document.createElement('script');
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener('load', done);
      el.removeEventListener('error', fail);
    };
    const done = () => {
      cleanup();
      if (window.Razorpay) resolve(window.Razorpay);
      else fail();
    };
    const fail = () => {
      cleanup();
      el.remove();
      pending = null; // let a later click retry rather than failing forever
      reject(
        new Error(
          'Could not reach the payment gateway. Check your connection — an ad or ' +
            'script blocker will also block checkout.razorpay.com.'
        )
      );
    };

    el.addEventListener('load', done);
    el.addEventListener('error', fail);

    if (!existing) {
      el.src = SRC;
      el.async = true;
      document.head.appendChild(el);
    }
    // Whichever branch we took, the load event will fire and settle this promise.
    timer = setTimeout(fail, TIMEOUT_MS);
  });

  return pending;
}
