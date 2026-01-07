import React, { useState } from 'react';

interface Persona {
  id: string;
  name: string;
  role: string;
  avatar: string;
}

interface ReviewerPairPickerProps {
  availablePersonas: Persona[];
  completedPersonaIds: string[];
  language: 'en' | 'zh-TW';
  onGenerate: (personaIdA: string, personaIdB: string) => void;
  isGenerating: boolean;
}

export function ReviewerPairPicker({
  availablePersonas,
  completedPersonaIds,
  language,
  onGenerate,
  isGenerating
}: ReviewerPairPickerProps) {
  const [selectedPair, setSelectedPair] = useState<[string | null, string | null]>([null, null]);

  const eligiblePersonas = availablePersonas.filter(p => completedPersonaIds.includes(p.id));
  const hasEnoughReports = eligiblePersonas.length >= 2;

  const handleSelect = (personaId: string) => {
    if (isGenerating) return;

    const [a, b] = selectedPair;
    
    if (a === personaId) {
      setSelectedPair([null, b]);
    } else if (b === personaId) {
      setSelectedPair([a, null]);
    } else if (a === null) {
      setSelectedPair([personaId, b]);
    } else if (b === null) {
      setSelectedPair([a, personaId]);
    } else {
      setSelectedPair([b, personaId]);
    }
  };

  const handleSwap = () => {
    setSelectedPair([selectedPair[1], selectedPair[0]]);
  };

  const handleGenerate = () => {
    if (selectedPair[0] && selectedPair[1]) {
      onGenerate(selectedPair[0], selectedPair[1]);
    }
  };

  const canGenerate = selectedPair[0] !== null && selectedPair[1] !== null && !isGenerating;

  const texts = {
    en: {
      title: 'Podcast Dialogue',
      beta: 'Beta',
      description: 'Pick two reviewers to generate a post-screening conversation.',
      needMore: 'Generate at least two reviewer reports to create a dialogue.',
      selectTwo: 'Select exactly 2 reviewers',
      swap: 'Swap speakers',
      generate: 'Generate dialogue',
      generating: 'Generating...',
      reportReady: 'Report ready'
    },
    'zh-TW': {
      title: 'Podcast 對談',
      beta: 'Beta',
      description: '選擇兩位評論者來產生一段放映後對談。',
      needMore: '請先產生至少兩個評論者報告才能建立對談。',
      selectTwo: '請選擇 2 位評論者',
      swap: '交換順序',
      generate: '產生對談',
      generating: '產生中...',
      reportReady: '報告已完成'
    }
  };

  const t = texts[language];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{t.title}</h3>
        <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
          {t.beta}
        </span>
      </div>

      <p className="text-gray-600 mb-6">{t.description}</p>

      {!hasEnoughReports ? (
        <div className="text-center py-8 text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p>{t.needMore}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {eligiblePersonas.map((persona) => {
              const isSelected = selectedPair.includes(persona.id);
              const selectionOrder = selectedPair.indexOf(persona.id);
              
              return (
                <button
                  key={persona.id}
                  onClick={() => handleSelect(persona.id)}
                  disabled={isGenerating}
                  className={`relative p-4 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  } ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {isSelected && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-indigo-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                      {selectionOrder + 1}
                    </div>
                  )}
                  <img
                    src={persona.avatar}
                    alt={persona.name}
                    className="w-12 h-12 rounded-full mb-2 object-cover"
                  />
                  <p className="font-medium text-gray-900 text-sm truncate">{persona.name}</p>
                  <p className="text-xs text-gray-500 truncate">{persona.role}</p>
                  <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                    {t.reportReady}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {selectedPair[0] && selectedPair[1] && (
              <button
                onClick={handleSwap}
                disabled={isGenerating}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {t.swap}
              </button>
            )}
            
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors ${
                canGenerate
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isGenerating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t.generating}
                </span>
              ) : (
                canGenerate ? t.generate : t.selectTwo
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
