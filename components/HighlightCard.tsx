import React from 'react';
import { Card, Badge, Pill } from './ui';
import { ExpandableContent } from './ExpandableContent';
import { getCategoryIcon, formatCategory } from './ui/reportHelpers';

interface Highlight {
  timestamp: string;
  seconds: number;
  summary: string;
  why_it_works: string;
  category: string;
}

interface HighlightCardProps {
  highlight: Highlight;
  onSeek: (seconds: number) => void;
}

export const HighlightCard: React.FC<HighlightCardProps> = ({ highlight, onSeek }) => {
  return (
    <Card
      as="button"
      variant="highlight"
      onClick={() => onSeek(highlight.seconds)}
      className="p-5 text-left flex flex-col"
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Badge variant="dark">{highlight.timestamp}</Badge>
        <Pill icon={getCategoryIcon(highlight.category)} variant="highlight">
          {formatCategory(highlight.category)}
        </Pill>
      </div>
      <p className="text-[15px] text-slate-800 font-medium mb-2 leading-snug">{highlight.summary}</p>
      <ExpandableContent content={highlight.why_it_works} />
    </Card>
  );
};

interface HighlightsListProps {
  highlights: Highlight[];
  onSeek: (seconds: number) => void;
}

export const HighlightsList: React.FC<HighlightsListProps> = ({ highlights, onSeek }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {highlights?.map((h, i) => (
        <HighlightCard key={i} highlight={h} onSeek={onSeek} />
      ))}
    </div>
  );
};
