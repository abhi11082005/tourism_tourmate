import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/*
 * Reviews with nested comment threads.
 *
 * The server returns comments already ordered by their materialised `path` and
 * tagged with `depth`, so this component only indents — it never builds a tree.
 * That keeps a 200-comment thread at one pass with no recursion on the main
 * thread, which matters on a mid-range phone.
 */

const MAX_INDENT = 5;

function Stars({ value }) {
  return (
    <span aria-label={`${value} out of 5`} className="text-glow">
      {'★'.repeat(value)}
      <span className="text-sand-300">{'★'.repeat(5 - value)}</span>
    </span>
  );
}

function CommentComposer({ reviewId, parentId, onDone }) {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const { isGuest } = useAuth();

  const mutation = useMutation({
    mutationFn: () => api.addComment(reviewId, { parentId, content: text.trim() }),
    onSuccess: () => {
      setText('');
      onDone?.();
      qc.invalidateQueries({ queryKey: ['comments', reviewId] });
    },
  });

  if (isGuest) {
    return (
      <p className="text-xs text-sand-500">
        <Link className="underline" to="/login">
          Sign in
        </Link>{' '}
        to join the conversation.
      </p>
    );
  }

  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) mutation.mutate();
      }}
    >
      <input
        className="field flex-1 text-sm"
        placeholder={parentId ? 'Reply…' : 'Add a comment…'}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn-primary" disabled={!text.trim() || mutation.isPending}>
        {mutation.isPending ? '…' : 'Post'}
      </button>
    </form>
  );
}

function CommentList({ reviewId }) {
  const [replyTo, setReplyTo] = useState(null);
  const qc = useQueryClient();
  const { user, isGuest } = useAuth();

  const { data, isPending } = useQuery({
    queryKey: ['comments', reviewId],
    queryFn: ({ signal }) => api.comments(reviewId, signal),
    staleTime: 30_000,
  });

  const like = useMutation({
    mutationFn: (id) => api.likeComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', reviewId] }),
  });

  const remove = useMutation({
    mutationFn: (id) => api.deleteComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', reviewId] }),
  });

  if (isPending) return <p className="text-xs text-sand-500">Loading replies…</p>;

  return (
    <div className="mt-3 space-y-2">
      {(data?.items ?? []).map((c) => (
        <div
          key={c.id}
          // Indent caps out so a deep thread never runs off a phone screen.
          style={{ marginInlineStart: `${Math.min(c.depth, MAX_INDENT) * 14}px` }}
          className="border-l-2 border-sand-100 pl-3"
        >
          <p className="text-xs font-semibold">{c.author?.name ?? 'Removed'}</p>
          <p className="text-sm">{c.content}</p>
          <div className="mt-1 flex items-center gap-3 text-xs text-sand-500">
            <button
              type="button"
              className="hover:text-ink-800 disabled:opacity-50"
              disabled={isGuest || like.isPending}
              onClick={() => like.mutate(c.id)}
              aria-pressed={c.likedByMe}
            >
              {c.likedByMe ? '♥' : '♡'} {c.likeCount}
            </button>
            {!isGuest && c.depth < 6 && (
              <button
                type="button"
                className="hover:text-ink-800"
                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
              >
                Reply
              </button>
            )}
            {c.author?.id === user?.id && (
              <button
                type="button"
                className="hover:text-red-700"
                onClick={() => remove.mutate(c.id)}
              >
                Delete
              </button>
            )}
          </div>
          {replyTo === c.id && (
            <CommentComposer reviewId={reviewId} parentId={c.id} onDone={() => setReplyTo(null)} />
          )}
        </div>
      ))}
      <CommentComposer reviewId={reviewId} />
    </div>
  );
}

export default function ReviewThread({ tourId }) {
  const [openThread, setOpenThread] = useState(null);
  const qc = useQueryClient();
  const { isGuest } = useAuth();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['reviews', tourId],
    queryFn: ({ signal }) => api.reviews(tourId, { limit: 10, offset: 0 }, signal),
    staleTime: 60_000,
  });

  const like = useMutation({
    mutationFn: (id) => api.likeReview(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews', tourId] }),
  });

  if (isPending) return <p className="text-sm text-sand-500">Loading reviews…</p>;
  if (isError) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data.items.length) {
    return <p className="text-sm text-sand-500">No reviews yet — be the first after your trip.</p>;
  }

  return (
    <div className="space-y-4">
      {data.items.map((r) => (
        <article key={r.id} className="card p-4">
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{r.author_name}</p>
              <Stars value={r.rating} />
            </div>
            <button
              type="button"
              className="text-sm text-sand-500 hover:text-ink-800 disabled:opacity-50"
              disabled={isGuest || like.isPending}
              onClick={() => like.mutate(r.id)}
              aria-pressed={r.liked_by_me}
            >
              {r.liked_by_me ? '♥' : '♡'} {r.like_count}
            </button>
          </header>

          {r.content && <p className="mt-2 text-sm">{r.content}</p>}

          {r.media_urls?.length > 0 && (
            <ul className="mt-3 flex gap-2 overflow-x-auto">
              {r.media_urls.map((url) => (
                <li key={url} className="shrink-0">
                  {/* Media lives in Cloudinary/S3; the DB only stores the URL. */}
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-24 w-32 rounded-xl object-cover"
                  />
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="mt-3 text-xs font-semibold text-ink-700 underline"
            onClick={() => setOpenThread(openThread === r.id ? null : r.id)}
          >
            {openThread === r.id ? 'Hide' : `Show ${r.comment_count} replies`}
          </button>

          {openThread === r.id && <CommentList reviewId={r.id} />}
        </article>
      ))}
    </div>
  );
}
