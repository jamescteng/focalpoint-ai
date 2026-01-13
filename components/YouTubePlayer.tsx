import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface YTPlayer {
  destroy(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
}

interface YTPlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: {
    autoplay?: 0 | 1;
    modestbranding?: 0 | 1;
    rel?: 0 | 1;
    enablejsapi?: 0 | 1;
    origin?: string;
  };
  events?: {
    onReady?: (event: { target: YTPlayer }) => void;
    onError?: (event: { data: number }) => void;
  };
}

interface YTNamespace {
  Player: new (elementId: string, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePlayerProps {
  youtubeUrl: string;
  onReady?: (player: YTPlayer) => void;
  className?: string;
  embeddable?: boolean | null;
}

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

let ytApiLoaded = false;
let ytApiLoading = false;
const ytApiReadyCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiLoaded && window.YT?.Player) {
      resolve();
      return;
    }

    ytApiReadyCallbacks.push(resolve);

    if (ytApiLoading) {
      return;
    }

    ytApiLoading = true;

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      ytApiLoading = false;
      ytApiReadyCallbacks.forEach((cb) => cb());
      ytApiReadyCallbacks.length = 0;
    };
  });
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  youtubeUrl,
  onReady,
  className = '',
  embeddable = true,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoId = extractYoutubeVideoId(youtubeUrl);
  const youtubeDirectUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : youtubeUrl;

  // If we know embedding is disabled upfront, show the message immediately
  const embeddingDisabled = embeddable === false;

  useEffect(() => {
    if (!videoId) {
      setError('invalidUrl');
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const initPlayer = async () => {
      try {
        await loadYouTubeAPI();
        
        if (!mounted || !containerRef.current) return;

        if (playerRef.current) {
          playerRef.current.destroy();
        }

        const playerId = `youtube-player-${videoId}`;
        containerRef.current.innerHTML = `<div id="${playerId}"></div>`;

        playerRef.current = new window.YT.Player(playerId, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            modestbranding: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: { target: YTPlayer }) => {
              if (mounted) {
                setIsLoading(false);
                onReady?.(event.target);
              }
            },
            onError: (event: { data: number }) => {
              if (mounted) {
                const errorKeys: Record<number, string> = {
                  2: 'invalidVideoId',
                  5: 'html5Error',
                  100: 'videoNotFound',
                  101: 'cannotEmbed',
                  150: 'cannotEmbed',
                };
                setError(errorKeys[event.data] || 'loadFailed');
                setIsLoading(false);
              }
            },
          },
        });
      } catch (err) {
        if (mounted) {
          setError('playerLoadFailed');
          setIsLoading(false);
        }
      }
    };

    initPlayer();

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId, onReady]);

  if (!videoId) {
    return (
      <div className={`flex items-center justify-center bg-slate-900 text-white ${className}`}>
        <p className="text-sm text-slate-400">{t('youtubePlayer.invalidUrl')}</p>
      </div>
    );
  }

  return (
    <div className={`relative bg-black ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-sm text-slate-400">{t('youtubePlayer.loading')}</p>
          </div>
        </div>
      )}
      {(error || embeddingDisabled) && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <div className="text-center px-6 max-w-md">
            {(error === 'cannotEmbed' || embeddingDisabled) ? (
              <>
                <div className="w-14 h-14 bg-slate-700 rounded-2xl flex items-center justify-center mb-4 mx-auto">
                  <svg className="w-7 h-7 text-slate-300" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                  </svg>
                </div>
                <h3 className="text-white font-medium text-lg mb-2">{t('youtubePlayer.playbackUnavailable')}</h3>
                <p className="text-slate-400 text-sm leading-relaxed mb-4">
                  {t('youtubePlayer.embeddingDisabled')}
                </p>
                <a
                  href={youtubeDirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                  </svg>
                  {t('youtubePlayer.watchOnYoutube')}
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center mb-3 mx-auto">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-sm text-slate-400">{t(`youtubePlayer.${error}`)}</p>
              </>
            )}
          </div>
        </div>
      )}
      <div 
        ref={containerRef}
        className="w-full h-full"
        style={{ aspectRatio: '16/9' }}
      />
    </div>
  );
};

export { useYouTubePlayer } from './hooks/useYouTubePlayer';

export default YouTubePlayer;
