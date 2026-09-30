import type { SoundChoice } from '../services/audio/soundEffects';

/** A single narration segment (one or a few sentences grouped together). */
export interface Segment {
  id: string;
  text: string;
  /** Generated narration audio for this segment, stored as a Blob once rendered. */
  audioBlob?: Blob;
  /** Duration of the generated audio, in seconds. */
  duration?: number;
  /** Word-level (approximate) caption timings within this segment, relative to segment start. */
  captionWords?: CaptionWord[];
  order: number;
  /** Fake commenter name shown above this segment's captions, for "post + answers" style videos. */
  commenterName?: string;
}

export interface CaptionWord {
  text: string;
  /** Seconds from the start of the segment's audio. */
  start: number;
  end: number;
}

export interface BackgroundClip {
  blob: Blob;
  name: string;
}

export interface StoryProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Raw pasted/imported text before cleaning. */
  rawText: string;
  /** Cleaned narration text (what actually gets read). */
  cleanedText: string;
  preserveOriginalWording: boolean;
  segments: Segment[];
  /** Background video, stored as a Blob (uploaded by the user). */
  backgroundVideo?: Blob;
  backgroundVideoName?: string;
  /** Full duration of the background video, in seconds (probed on selection). */
  backgroundVideoDuration?: number;
  /** Where the selected clip starts within the background video, in seconds. */
  backgroundClipStart?: number;
  /** Background video playback speed (1 = normal). */
  backgroundPlaybackRate?: number;
  /** Mirror the background horizontally (helps reused clips avoid content matching). */
  backgroundFlip?: boolean;
  /** Background music track, mixed under the narration at a low volume. */
  backgroundMusic?: Blob;
  backgroundMusicName?: string;
  /** 0 (silent) to 1 (full volume); mixed under narration, so this typically stays low. */
  backgroundMusicVolume?: number;
  /** Extra clips added to the background rotation pool (beyond the primary backgroundVideo). */
  additionalBackgroundClips?: BackgroundClip[];
  /** When true (and 2+ total clips are available), the background switches clips periodically instead of staying on one. */
  backgroundRotationEnabled?: boolean;
  /** How often the background switches to a different clip, in seconds. */
  backgroundSwitchSeconds?: number;
  voiceId: string;
  /** Narration speaking speed (1 = normal). */
  voiceSpeed?: number;
  captionStyle: CaptionStyle;
  /** 'draft' renders smaller/faster (720x1280, ultrafast); 'final' renders full 1080x1920. */
  renderQuality: 'draft' | 'final';
  /** Fake post card shown at the start of the video, for AskReddit-style compilation videos. */
  redditCard?: RedditPostCard;
  /** Synthesized or custom-uploaded sound effect at the very start of the video. */
  introSound?: SoundChoice;
  /** Synthesized or custom-uploaded sound effect right as the intro title card ends and cuts to the answers (needs the Reddit card's title to have been read aloud). */
  titleTransitionSound?: SoundChoice;
  /** How the background cuts between clips when rotation is on. */
  backgroundTransition?: 'cut' | 'fade';
  /** Sound effect played at each clip switch when rotation is on. */
  backgroundTransitionSound?: SoundChoice;
  /** Final rendered output, if any. */
  renderedVideo?: Blob;
}

export interface CaptionStyle {
  fontSize: number;
  color: string;
  highlightColor: string;
  position: 'top' | 'center' | 'bottom';
  /** 'pill' = solid rounded background (default look); 'outline' = stroked text, no fill box; 'none' = plain text with a soft shadow for legibility. */
  backgroundStyle: 'pill' | 'outline' | 'none';
  /** Color of the pill/outline background. */
  backgroundColor: string;
  /** How each word/card appears on screen. */
  animation: 'none' | 'pop' | 'fade' | 'slide';
}

/** A fake "post" card shown as the opening few seconds of an AskReddit-style compilation video. */
export interface RedditPostCard {
  enabled: boolean;
  subreddit: string;
  author: string;
  title: string;
  upvotes: string;
  timeAgo: string;
  /** Generated narration audio for the title, played while the card is shown. */
  titleAudioBlob?: Blob;
  titleAudioDuration?: number;
}

export const DEFAULT_REDDIT_CARD: RedditPostCard = {
  enabled: false,
  subreddit: 'AskReddit',
  author: '',
  title: '',
  upvotes: '1.2K',
  timeAgo: '2d ago',
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 64,
  color: '#ffffff',
  highlightColor: '#22d3ee',
  position: 'bottom',
  backgroundStyle: 'pill',
  backgroundColor: '#000000',
  animation: 'pop',
};
