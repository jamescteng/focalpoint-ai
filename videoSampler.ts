
/**
 * Intelligent Video Sampler
 * Extracts a sequence of frames from a local video file using Canvas.
 * This allows processing of 1GB+ files without massive data transfers.
 */
export const captureVideoFrames = async (
  file: File, 
  frameCount: number = 40
): Promise<{ data: string; mimeType: string }[]> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const frames: { data: string; mimeType: string }[] = [];
    
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const interval = duration / frameCount;
      
      // AI standard resolution for image understanding
      canvas.width = 768; 
      canvas.height = (video.videoHeight / video.videoWidth) * canvas.width;

      for (let i = 0; i < frameCount; i++) {
        const time = i * interval;
        video.currentTime = time;
        
        await new Promise((res) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            if (context) {
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              // Use JPEG for better compression/payload size
              const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
              frames.push({ data: base64, mimeType: 'image/jpeg' });
            }
            res(true);
          };
          video.addEventListener('seeked', onSeeked);
        });
      }
      
      URL.revokeObjectURL(video.src);
      resolve(frames);
    };

    video.onerror = () => reject(new Error("Video decoding failed. Please ensure it's a valid MP4/WebM file."));
  });
};
