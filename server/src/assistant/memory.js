import { STATUS } from './result.js';

/*
 * What this conversation has settled so far, stored as JSON on the conversation row
 * (assistant_conversations.state). Booking details live here, not only in the raw
 * chat history, so they survive page navigation, reloads, and long chats where the
 * message that said "2 people" has scrolled out of the prompt.
 *
 *   selectedTourId / selectedTourName   the tour this chat is about
 *   travelDate      { from, to }        a validated date or range, business timezone
 *   passengerCount                      1..20
 *   lastIntent / lastTool / lastStatus  what the previous turn did and how it ended
 *   pendingAction + missingFields       what we are waiting for the traveller to supply
 *
 * Rule: a new turn may add or change a value, never blank one. "Yes" or a one-word
 * reply must not wipe the date.
 */

export const emptyMemory = () => ({
  selectedTourId: null,
  selectedTourName: null,
  travelDate: null,
  passengerCount: null,
  lastIntent: null,
  lastTool: null,
  lastStatus: null,
  pendingAction: null,
  missingFields: [],
});

const PENDING = {
  tour: 'choose_tour',
  travelDate: 'provide_date',
  location: 'share_location',
  bookingId: 'provide_booking_id',
  couponCode: 'provide_coupon',
  signIn: 'sign_in',
};

/** Read stored state defensively: it is JSON from the database. */
export function readMemory(raw) {
  const base = emptyMemory();
  if (!raw || typeof raw !== 'object') return base;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const d = raw.travelDate;
  return {
    ...base,
    selectedTourId: typeof raw.selectedTourId === 'string' ? raw.selectedTourId : null,
    selectedTourName: typeof raw.selectedTourName === 'string' ? raw.selectedTourName.slice(0, 200) : null,
    travelDate: d && iso.test(d.from) && iso.test(d.to) ? { from: d.from, to: d.to } : null,
    passengerCount: Number.isInteger(raw.passengerCount) && raw.passengerCount >= 1 && raw.passengerCount <= 20 ? raw.passengerCount : null,
    lastIntent: typeof raw.lastIntent === 'string' ? raw.lastIntent : null,
    lastTool: typeof raw.lastTool === 'string' ? raw.lastTool : null,
    lastStatus: typeof raw.lastStatus === 'string' ? raw.lastStatus : null,
    pendingAction: typeof raw.pendingAction === 'string' ? raw.pendingAction : null,
    missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.filter((x) => typeof x === 'string').slice(0, 5) : [],
  };
}

/** Entities the stored state contributes, before the new message adds its own. */
export function memoryEntities(memory) {
  const out = {};
  if (memory?.passengerCount) out.seatCount = memory.passengerCount;
  if (memory?.travelDate) out.dateRange = memory.travelDate;
  return out;
}

/**
 * The state after this turn.
 * @param {{ prev: object, intent: string, entities: object, tour: object|null, toolResults: object[] }} turn
 */
export function nextMemory({ prev, intent, entities, tour, toolResults }) {
  const m = { ...prev };
  const tourChanged = Boolean(tour?.tourId) && tour.tourId !== prev.selectedTourId;

  if (tour?.tourId) {
    m.selectedTourId = tour.tourId;
    m.selectedTourName = tour.title ?? m.selectedTourName;
  }
  if (entities?.dateRange && !entities.dateProblem) m.travelDate = entities.dateRange;
  if (entities?.seatCount) m.passengerCount = entities.seatCount;

  // Small talk and "what happened?" describe the last real operation; they do not replace it.
  if (intent !== 'smalltalk' && intent !== 'followup') {
    m.lastIntent = intent;
    const last = toolResults?.at(-1);
    if (last) {
      m.lastTool = last.name;
      m.lastStatus = last.status ?? (last.ok ? STATUS.SUCCESS : STATUS.FAILED);
    }
    const waiting = toolResults?.find((r) => r.status === STATUS.NEEDS_INPUT);
    if (waiting) {
      m.missingFields = [waiting.missing].filter(Boolean);
      m.pendingAction = PENDING[waiting.missing] ?? null;
    } else if (tourChanged || toolResults?.length) {
      m.missingFields = [];
      m.pendingAction = null;
    }
  }
  return m;
}
