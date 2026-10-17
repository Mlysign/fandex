// The icon for each media type, once. Typed by MediaType, so a new type fails
// the build here instead of showing a blank circle somewhere.

import type { MediaType } from '@/types';
import { BookOpen, Clapperboard, Dices, Gamepad2, Tv } from 'lucide-react-native';

export const TYPE_ICONS: Record<MediaType, typeof Gamepad2> = {
  game: Gamepad2,
  movie: Clapperboard,
  show: Tv,
  book: BookOpen,
  boardgame: Dices,
};
