// The trailer in a browser: YouTube's own player, as the site had it.

import { color, radius } from '~/theme';

// The app's web build is cross-origin isolated (its SQLite needs that), and an
// isolated page refuses a frame that does not opt in. `credentialless` is the
// opt-in for a frame we do not control: it loads without the visitor's YouTube
// cookies. Without it the player was an empty box. React does not know the
// attribute yet, hence the spread.
const ISOLATED_FRAME = { credentialless: '' } as object;

export function Trailer({ youtubeKey, title }: { youtubeKey: string; title: string }) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 768, aspectRatio: '16 / 9', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.surfaceElevated }}>
      <iframe
        {...ISOLATED_FRAME}
        src={`https://www.youtube.com/embed/${youtubeKey}?rel=0`}
        title={`Trailer: ${title}`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
