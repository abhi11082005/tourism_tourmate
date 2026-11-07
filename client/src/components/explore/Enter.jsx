import { useEffect, useState } from 'react';

/*
 * Fade/slide-in on mount, CSS transition only. Give it a `key` to replay the entrance
 * when its content changes identity (a new destination, a new route). Reduced-motion
 * users get the global near-zero transition from index.css.
 */
export default function Enter({ as: Tag = 'div', className = '', children, ...rest }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Tag
      {...rest}
      className={`transition duration-300 ease-out ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
