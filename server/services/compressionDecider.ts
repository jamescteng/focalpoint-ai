import ffmpeg from 'fluent-ffmpeg';

export interface VideoMetadata {
  fileSizeBytes: number;
  width: number;
  height: number;
  fps: number;
}

export interface CompressionDecision {
  shouldCompress: boolean;
  reasons: string[];
}

export interface CompressionThresholds {
  maxFileSizeMB: number;
  maxHeight: number;
  maxFps: number;
}

const DEFAULT_THRESHOLDS: CompressionThresholds = {
  maxFileSizeMB: 100,
  maxHeight: 720,
  maxFps: 10,
};

export function shouldCompress(
  metadata: VideoMetadata,
  thresholds: CompressionThresholds = DEFAULT_THRESHOLDS
): CompressionDecision {
  console.log(`[CompressionDecider] Compression disabled - uploading original file directly to Gemini`);
  console.log(`  File: ${(metadata.fileSizeBytes / 1024 / 1024).toFixed(1)}MB, ${metadata.width}x${metadata.height}, ${metadata.fps.toFixed(1)}fps`);
  
  return {
    shouldCompress: false,
    reasons: ['Compression disabled - direct upload to Gemini'],
  };
}

export async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found in file'));
        return;
      }

      const width = videoStream.width || 0;
      const height = videoStream.height || 0;
      
      let fps = 30;
      if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (den && den > 0) {
          fps = num / den;
        } else {
          fps = num || 30;
        }
      } else if (videoStream.avg_frame_rate) {
        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
        if (den && den > 0) {
          fps = num / den;
        } else {
          fps = num || 30;
        }
      }

      const fileSizeBytes = metadata.format.size || 0;

      console.log(`[CompressionDecider] Video metadata extracted:`);
      console.log(`  Size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Resolution: ${width}x${height}`);
      console.log(`  FPS: ${fps.toFixed(2)}`);

      resolve({
        fileSizeBytes,
        width,
        height,
        fps,
      });
    });
  });
}
