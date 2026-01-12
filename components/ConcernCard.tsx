import React from 'react';
import { Card, Badge, Pill, SeverityPill } from './ui';
import { getCategoryIcon, formatCategory } from './ui/reportHelpers';

interface Concern {
  timestamp: string;
  seconds: number;
  issue: string;
  impact: string;
  severity: number;
  category: string;
  suggested_fix: string;
}

interface ConcernCardProps {
  concern: Concern;
  onSeek: (seconds: number) => void;
}

export const ConcernCard: React.FC<ConcernCardProps> = ({ concern, onSeek }) => {
  return (
    <Card
      as="button"
      variant="concern"
      onClick={() => onSeek(concern.seconds)}
      className="p-5 text-left flex flex-col"
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Badge variant="dark">{concern.timestamp}</Badge>
        <Pill icon={getCategoryIcon(concern.category)} variant="default">
          {formatCategory(concern.category)}
        </Pill>
        <SeverityPill severity={concern.severity} />
      </div>
      <p className="text-[15px] text-slate-800 font-semibold mb-2 leading-snug">{concern.issue}</p>
      <p className="text-sm text-rose-600 font-medium mb-3">Impact: {concern.impact}</p>
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Suggested Fix</p>
        <p className="text-sm text-slate-600 leading-relaxed">{concern.suggested_fix}</p>
      </div>
    </Card>
  );
};

interface ConcernsListProps {
  concerns: Concern[];
  onSeek: (seconds: number) => void;
}

export const ConcernsList: React.FC<ConcernsListProps> = ({ concerns, onSeek }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {concerns?.map((c, i) => (
        <ConcernCard key={i} concern={c} onSeek={onSeek} />
      ))}
    </div>
  );
};
