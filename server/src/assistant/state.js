import { Annotation } from '@langchain/langgraph';

/*
 * State carried through the assistant graph for ONE user turn.
 *
 * `context` is built by the route from the authenticated request and is trusted
 * (user id, tour on screen, location the browser shared). `question` and the
 * conversation history are untrusted user text; tool results are data, never
 * instructions.
 */
export const INTENTS = ['discover', 'rag', 'live', 'booking', 'smalltalk'];

export const AssistantState = Annotation.Root({
  question: Annotation(),
  /** [{ role: 'user' | 'assistant', content }] oldest first, already trimmed. */
  history: Annotation(),
  /** { tourId: string|null, user: { id, role }|null, location: { lat, lng }|null } */
  context: Annotation(),
  intent: Annotation(),
  /** Deterministic values pulled from the question: seatCount, maxPrice, dateRange... */
  entities: Annotation(),
  /** One entry per tool run: { name, group, ok, data | error }. */
  toolResults: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  answer: Annotation(),
});
