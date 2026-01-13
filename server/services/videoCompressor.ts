import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CompressionOptions {
  targetWidth?: number;
  targetHeight?: number;
  targetFps?: number;
  videoBitrate?: string;
  audioBitrate?: string;
  crf?: number;
}

export interface CompressionResult {
  outputPath: string;
  outputSize: number;
  duration: number;
  compressionRatio: number;
}

export interface CompressionProgress {
  percent: number;
  timemark: string;
}

const DEFAULT_OPTIONS: CompressionOptions = {
  targetWidth: 1280,
  targetHeight: 720,
  targetFps: 10,
  crf: 28,
  audioBitrate: '64k',
};

export async function compressVideoForAnalysis(
  inputPath: string,
  onProgress?: (progress: CompressionProgress) => void,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const outputDir = path.join(os.tmpdir(), 'focalpoint-proxies');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const inputBasename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${inputBasename}_proxy_${Date.now()}.mp4`);
  
  const inputStats = fs.statSync(inputPath);
  const inputSize = inputStats.size;
  
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        `-crf ${opts.crf}`,
        '-preset veryfast',
        `-vf scale=${opts.targetWidth}:${opts.targetHeight}:force_original_aspect_ratio=decrease,pad=${opts.targetWidth}:${opts.targetHeight}:(ow-iw)/2:(oh-ih)/2,fps=${opts.targetFps}`,
        '-movflags +faststart',
        '-c:a aac',
        `-b:a ${opts.audioBitrate}`,
        '-ac 1',
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`[VideoCompressor] Starting compression: ${cmd}`);
      })
      .on('progress', (progress) => {
        if (onProgress && progress.percent) {
          onProgress({
            percent: Math.min(99, Math.round(progress.percent)),
            timemark: progress.timemark || '00:00:00',
          });
        }
      })
      .on('end', () => {
        const outputStats = fs.statSync(outputPath);
        const outputSize = outputStats.size;
        const duration = (Date.now() - startTime) / 1000;
        const compressionRatio = inputSize / outputSize;
        
        console.log(`[VideoCompressor] Compression complete:`);
        console.log(`  Input: ${(inputSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Output: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Ratio: ${compressionRatio.toFixed(1)}x`);
        console.log(`  Duration: ${duration.toFixed(1)}s`);
        
        resolve({
          outputPath,
          outputSize,
          duration,
          compressionRatio,
        });
      })
      .on('error', (err) => {
        console.error(`[VideoCompressor] Compression failed:`, err);
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        reject(err);
      })
      .run();
  });
}

export async function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration || 0);
    });
  });
}

export function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[VideoCompressor] Cleaned up temp file: ${filePath}`);
    }
  } catch (err) {
    console.error(`[VideoCompressor] Failed to cleanup temp file: ${filePath}`, err);
  }
}
