import { useRef, useCallback } from 'react';

interface YTPlayer {
  destroy(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
}

export function useYouTubePlayer() {
  const playerRef = useRef<YTPlayer | null>(null);

  const setPlayer = useCallback((player: YTPlayer) => {
    playerRef.current = player;
  }, []);

  const seekTo = useCallback((seconds: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds, true);
      playerRef.current.playVideo();
    }
  }, []);

  const getCurrentTime = useCallback((): number => {
    return playerRef.current?.getCurrentTime() ?? 0;
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const play = useCallback(() => {
    playerRef.current?.playVideo();
  }, []);

  return {
    setPlayer,
    seekTo,
    getCurrentTime,
    pause,
    play,
    player: playerRef,
  };
}
