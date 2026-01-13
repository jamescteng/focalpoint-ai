
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Persona } from '../types';

interface ProcessingQueueProps {
  personas: Persona[];
  currentIndex: number;
  progress: number; // 0 to 100
}

export const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ personas, currentIndex, progress }) => {
  const { t, i18n } = useTranslation();
  const currentPersona = personas[currentIndex];
  
  const translatedRole = t(`personas.${currentPersona.id}.role`, { defaultValue: currentPersona.role });

  return (
    <div className="max-w-3xl mx-auto py-40 px-8 text-center">
      <div className="mb-20">
        <div className="inline-flex items-center gap-4 px-6 py-3 rounded-full bg-white border border-zinc-100 text-[10px] text-zinc-400 uppercase tracking-[0.4em] mb-12 font-black shadow-sm">
          <span className="w-2 h-2 rounded-full bg-black animate-ping" />
          {t('processing.activeMultiModalPass')}
        </div>
        <h2 className="text-5xl md:text-6xl font-bold mb-10 text-black leading-tight tracking-tight">
          {currentPersona.name} <br/> <span className="text-zinc-300 font-medium">{t('processing.isReviewingYourFilm')}</span>
        </h2>
        <p className="text-zinc-400 text-2xl max-w-lg mx-auto leading-relaxed font-light">
          {t('processing.parsingCues')}
        </p>
      </div>

      <div className="relative h-2 w-full bg-zinc-100 rounded-full overflow-hidden mb-20">
        <div 
          className="absolute top-0 left-0 h-full bg-black transition-all duration-1000 ease-in-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex flex-col items-center">
        <div className="relative group">
          <div className="absolute -inset-6 bg-zinc-50 rounded-[4rem] scale-95 animate-pulse opacity-50"></div>
          <img 
            src={currentPersona.avatar} 
            alt={currentPersona.name} 
            className="relative w-48 h-48 rounded-[3.5rem] object-cover border-8 border-white shadow-[0_30px_60px_rgba(0,0,0,0.1)] mb-8" 
          />
        </div>
        <span className="text-xl font-semibold text-black">{translatedRole}</span>
        <span className="text-xs text-zinc-400 uppercase tracking-[0.3em] mt-3 font-black">{t('processing.statusInspecting')}</span>
      </div>
    </div>
  );
};
