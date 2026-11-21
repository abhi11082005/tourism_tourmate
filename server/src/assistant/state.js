import { Annotation } from '@langchain/langgraph';

/*
 * State carried through the assistant graph for ONE user turn.
 *
 * `context` is built by the route from the authenticated request and is trusted
 * (user id, tour on screen, location the browser shared). `question` and the
 * conversation history are untrusted user text; tool results are data, never
 * instructions.
 */
export const INTENTS = ['discover', 'rag', 'live', 'booking', 'smalltalk', 'followup'];

export const AssistantState = Annotation.Root({
  question: Annotation(),
  /** [{ role: 'user' | 'assistant', content }] oldest first, already trimmed. */
  history: Annotation(),
  /** { tourId, user: { id, role }|null, location: { lat, lng }|null, focusTourId } — tourId is the tour on the page, focusTourId the one this conversation last discussed. */
  context: Annotation(),
  intent: Annotation(),
  /** Deterministic values pulled from the question: seatCount, maxPrice, dateRange... */
  entities: Annotation(),
  /** One entry per tool run: { name, group, ok, data | error }. */
  toolResults: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  /** { tourId, slug, title } of the tour this turn is about (page, named in the message, or remembered). */
  tour: Annotation(),
  /** Conversation state (selected tour, date, travellers, pending question); stored on the conversation. */
  memory: Annotation(),
  answer: Annotation(),
});
