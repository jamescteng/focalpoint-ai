
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Persona } from '../types';

interface ProcessingQueueProps {
  personas: Persona[];
  currentIndex: number;
  progress: number; // 0 to 100
  statusMessage?: string;
}

export const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ personas, currentIndex, progress, statusMessage }) => {
  const { t } = useTranslation();
  const currentPersona = personas[currentIndex];
  
  const translatedRole = t(`personas.${currentPersona.id}.role`, { defaultValue: currentPersona.role });

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-12 md:py-20 lg:py-40 px-4 sm:px-8 text-center">
      <div className="mb-4 sm:mb-8 md:mb-12 lg:mb-20">
        <div className="inline-flex items-center gap-2 sm:gap-4 px-3 sm:px-6 py-1.5 sm:py-3 rounded-full bg-white border border-zinc-100 text-[8px] sm:text-[10px] text-zinc-400 uppercase tracking-[0.2em] sm:tracking-[0.4em] mb-4 sm:mb-8 md:mb-12 font-black shadow-sm">
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-black animate-ping" />
          {t('processing.activeMultiModalPass')}
        </div>
        <h2 className="text-xl sm:text-3xl md:text-5xl lg:text-6xl font-bold mb-2 sm:mb-4 md:mb-10 text-black leading-tight tracking-tight">
          {currentPersona.name} <br/> <span className="text-zinc-300 font-medium">{t('processing.isReviewingYourFilm')}</span>
        </h2>
        <p className="text-zinc-400 text-sm sm:text-base md:text-2xl max-w-lg mx-auto leading-relaxed font-light px-2">
          {t('processing.parsingCues')}
        </p>
      </div>

      <div className="relative h-1 sm:h-1.5 md:h-2 w-full bg-zinc-100 rounded-full overflow-hidden mb-2 sm:mb-3 md:mb-4">
        <div 
          className="absolute top-0 left-0 h-full bg-black transition-all duration-1000 ease-in-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {statusMessage && (
        <p className="text-slate-400 text-xs sm:text-sm uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-4 sm:mb-8 md:mb-12 lg:mb-16 animate-pulse font-black text-center">
          {statusMessage}
        </p>
      )}

      <div className="flex flex-col items-center">
        <div className="relative group">
          <div className="absolute -inset-2 sm:-inset-4 md:-inset-6 bg-zinc-50 rounded-xl sm:rounded-[2rem] md:rounded-[4rem] scale-95 animate-pulse opacity-50"></div>
          <img 
            src={currentPersona.avatar} 
            alt={currentPersona.name} 
            className="relative w-16 h-16 sm:w-28 sm:h-28 md:w-40 md:h-40 lg:w-48 lg:h-48 rounded-xl sm:rounded-[2rem] md:rounded-[3rem] lg:rounded-[3.5rem] object-cover border-2 sm:border-4 md:border-6 lg:border-8 border-white shadow-[0_8px_16px_rgba(0,0,0,0.1)] sm:shadow-[0_15px_30px_rgba(0,0,0,0.1)] md:shadow-[0_30px_60px_rgba(0,0,0,0.1)] mb-2 sm:mb-4 md:mb-6 lg:mb-8" 
          />
        </div>
        <span className="text-sm sm:text-base md:text-lg lg:text-xl font-semibold text-black">{translatedRole}</span>
      </div>
    </div>
  );
};
