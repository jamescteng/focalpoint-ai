export const getCategoryIcon = (category: string): string => {
  const icons: Record<string, string> = {
    emotion: '💫',
    craft: '🎬',
    clarity: '💡',
    marketability: '📈',
    pacing: '⏱️',
    character: '👤',
    audio: '🔊',
    visual: '👁️',
    tone: '🎭',
    authorship: '✨',
    cultural_relevance: '🌍',
    emotional_distance: '💔',
    originality: '🎯',
    cultural_resonance: '🌐',
    emotional_pull: '❤️',
    relatability: '🤝',
    confusion: '❓',
    pacing_drag: '🐌',
    stakes_unclear: '🎯',
    message_clarity: '📢',
    emotional_authenticity: '💯',
    ethical_storytelling: '⚖️',
    impact_potential: '🚀',
    message_confusion: '🌫️',
    ethical_tension: '⚠️',
    emotional_manipulation: '🎭',
    lack_of_context: '📋',
    trust_gap: '🔓'
  };
  return icons[category] || '📌';
};

export const formatCategory = (category: string): string => {
  return category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
};

export const formatTimestamp = (seconds: number): string => {
  const totalSec = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
};
