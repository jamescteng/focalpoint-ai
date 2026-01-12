import React, { useState } from 'react';

interface ExpandableContentProps {
  content: string;
  maxLength?: number;
}

export const ExpandableContent: React.FC<ExpandableContentProps> = ({ 
  content, 
  maxLength = 120 
}) => {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = content.length > maxLength;
  
  if (!shouldTruncate) {
    return <p className="text-[15px] text-slate-600 leading-relaxed">{content}</p>;
  }
  
  return (
    <div>
      <p className="text-[15px] text-slate-600 leading-relaxed">
        {expanded ? content : `${content.slice(0, maxLength)}...`}
      </p>
      <span 
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setExpanded(!expanded); } }}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 mt-2 cursor-pointer inline-block"
      >
        {expanded ? 'Show less' : 'Read more'}
      </span>
    </div>
  );
};
