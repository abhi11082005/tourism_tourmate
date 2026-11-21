/*
 * An answer built straight from the tool data, with no model involved.
 *
 * Used when the model returns nothing (it ran out of tokens, rate-limited, timed out)
 * so the traveller never sees a blank bubble. It is plain, but every figure in it comes
 * from the database, and the cards under the message carry the detail anyway.
 */

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const list = (names) => names.join(', ');

export function fallbackAnswer(state) {
  for (const r of state.toolResults.filter((t) => t.ok)) {
    const d = r.data ?? {};

    if (d.needsLocation) return 'Tap “Use my location” below and I will look for places near you.';
    if (d.requiresAuth) return 'Please sign in so I can look up your booking.';
    if (d.needsBookingId) return 'Which booking? Send me the booking reference or id.';
    if (d.noDeparture) return `There is no open departure on ${d.noDeparture}. Pick another date on the tour page.`;
    if (d.needsTour) return 'Which tour do you mean? Name it, or open its page and ask there.';

    if (d.chooseTour && d.tours?.length) {
      return `Which tour would you like? Pick one below: ${list(d.tours.slice(0, 3).map((t) => t.title))}.`;
    }
    if (d.noMatchForTerm && d.tours?.length) {
      return `I could not find tours for “${d.noMatchForTerm}”. These are popular right now: ${list(d.tours.slice(0, 3).map((t) => t.title))}.`;
    }
    if (d.totalAmount != null) {
      const seats = `${d.seatCount} seat${d.seatCount === 1 ? '' : 's'}`;
      return (
        `${d.tour ? `${d.tour}: ` : ''}${seats}${d.date ? ` on ${d.date}` : ''} comes to about ${inr(d.totalAmount)}. ` +
        'Change the date or seats on the card below, then tap Hold seats when you are ready.'
      );
    }
    if (d.status && d.reference) {
      return `Booking ${d.reference}: ${String(d.status).toLowerCase()}${d.holdActive ? ', seats are currently held' : ''}.`;
    }
    if (d.dates) {
      return d.dates.length
        ? `Open dates: ${list(d.dates.slice(0, 5).map((x) => `${x.date} (${x.seatsLeft} left)`))}.`
        : 'There are no open dates in that window.';
    }
    if (d.offers) {
      return d.offers.length
        ? `Running now: ${list(d.offers.map((o) => `${o.name} (${o.discountPercent}% off)`))}.`
        : 'There are no offers running right now.';
    }
    if (d.nearCity !== undefined && !d.tours?.length) {
      return d.nearCity
        ? `I could not find tours in ${d.nearCity} right now.`
        : 'I could not tell which city you are in, so I cannot list tours near you.';
    }
    if (d.tours?.length) {
      return `Here ${d.tours.length === 1 ? 'is a tour' : 'are some tours'}: ${list(d.tours.slice(0, 3).map((t) => `${t.title} (${inr(t.basePrice)}/seat)`))}.`;
    }
    if (d.attractions?.length) {
      return `Nearby: ${list(d.attractions.slice(0, 3).map((a) => `${a.name} (${a.distanceMeters < 1000 ? `${a.distanceMeters} m` : `${(a.distanceMeters / 1000).toFixed(1)} km`})`))}.`;
    }
    if (d.passages?.length) return d.passages[0].text;
    if (d.refundPolicy || d.inclusions) return 'The refund policy and inclusions are on the tour page.';
  }
  return 'Sorry, I could not put an answer together just now. Please try asking in a different way.';
}
