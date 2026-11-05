import { useCallback, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import AssistantPanel from '../AssistantPanel.jsx';
import BottomSheet from './BottomSheet.jsx';

/*
 * Phone/tablet entry to the existing "Ask the expert" assistant: a floating button
 * that opens AssistantPanel in a sheet. The button is lifted above the fixed booking
 * bar (and the app's bottom tab bar on phones) so it never covers either; the
 * panel stays mounted after the first open so the conversation survives closing.
 */

export default function MobileAssistant({ tourId, tourTitle }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the expert about this tour"
        className="fixed bottom-[9rem] right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-glow text-white shadow-lg
                   transition active:scale-95 md:bottom-[5.5rem] lg:hidden"
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
      </button>

      <BottomSheet open={open} onClose={close} title="Ask the expert">
        <div className="h-[68dvh] min-h-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <AssistantPanel tourId={tourId} tourTitle={tourTitle} />
        </div>
      </BottomSheet>
    </>
  );
}
