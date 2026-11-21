/*
 * A tool that ran without throwing has not necessarily done its job: "which tour?" is
 * a question, not an answer. Every tool result therefore carries a business status:
 *
 *   success      useful data was found
 *   needs_input  the traveller must supply something first (see `missing`)
 *   empty        the lookup worked and nothing matches
 *   failed       the tool hit a real error
 *   unavailable  a data source (database, Redis, timeout) could not be reached
 *
 * Tools only return data; this one function derives the status from the flags they
 * set, so the rules live in one place and the graph, the stored conversation state
 * and the fallback answer all agree.
 */

export const STATUS = Object.freeze({
  SUCCESS: 'success',
  NEEDS_INPUT: 'needs_input',
  EMPTY: 'empty',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
});

const LIST_KEYS = ['tours', 'attractions', 'offers', 'dates', 'passages'];

/** @returns {{ status: string, missing: string|null }} */
export function classifyData(data = {}) {
  if (data.needsTour || data.chooseTour) return { status: STATUS.NEEDS_INPUT, missing: 'tour' };
  if (data.needsLocation) return { status: STATUS.NEEDS_INPUT, missing: 'location' };
  if (data.needsDay || data.dateProblem) return { status: STATUS.NEEDS_INPUT, missing: 'travelDate' };
  if (data.needsBookingId) return { status: STATUS.NEEDS_INPUT, missing: 'bookingId' };
  if (data.needsCoupon) return { status: STATUS.NEEDS_INPUT, missing: 'couponCode' };
  if (data.requiresAuth) return { status: STATUS.NEEDS_INPUT, missing: 'signIn' };

  if (data.noDeparture || data.couponProblem) return { status: STATUS.EMPTY, missing: null };
  if (data.nearCity === null) return { status: STATUS.NEEDS_INPUT, missing: 'location' };

  const lists = LIST_KEYS.filter((k) => Array.isArray(data[k]));
  if (lists.length && lists.every((k) => data[k].length === 0)) return { status: STATUS.EMPTY, missing: null };
  return { status: STATUS.SUCCESS, missing: null };
}

const UNREACHABLE = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed out|Connection terminated|connection|LLM|fetch failed/i;

/**
 * A thrown error as a status and a message that is safe to hand to the model.
 * Raw messages (SQL, hosts, ports) stay in the server log.
 */
export function classifyError(err) {
  const httpStatus = Number(err?.status ?? err?.statusCode);
  if (httpStatus >= 400 && httpStatus < 500) {
    return { status: STATUS.FAILED, publicMessage: String(err.message || 'request refused').slice(0, 160) };
  }
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  if (UNREACHABLE.test(text)) {
    return { status: STATUS.UNAVAILABLE, publicMessage: 'the service is temporarily unreachable' };
  }
  return { status: STATUS.FAILED, publicMessage: 'the lookup failed' };
}
