import { describe, it, expect } from '@jest/globals';
import { PERSONA_CONFIGS } from './personas';

describe('Persona Configurations', () => {
  const requiredPersonaIds = [
    'acquisitions_director',
    'cultural_editor', 
    'mass_audience_viewer',
    'social_impact_viewer'
  ];

  it('exports all required personas', () => {
    const personaIds = PERSONA_CONFIGS.map(p => p.id);
    requiredPersonaIds.forEach(id => {
      expect(personaIds).toContain(id);
    });
  });

  it('each persona has required fields', () => {
    PERSONA_CONFIGS.forEach(persona => {
      expect(persona.id).toBeDefined();
      expect(persona.name).toBeDefined();
      expect(persona.role).toBeDefined();
      expect(persona.avatar).toBeDefined();
      expect(persona.demographics).toBeDefined();
      expect(persona.highlightCategories).toBeDefined();
      expect(persona.concernCategories).toBeDefined();
      expect(typeof persona.minHighSeverityConcerns).toBe('number');
      expect(typeof persona.systemInstruction).toBe('function');
      expect(typeof persona.userPrompt).toBe('function');
    });
  });

  it('each persona includes House Style guidelines in systemInstruction', () => {
    PERSONA_CONFIGS.forEach(persona => {
      const instruction = persona.systemInstruction('English');
      expect(instruction).toContain('HOUSE STYLE');
      expect(instruction).toContain('respect');
      expect(instruction).toContain('constructively');
    });
  });

  it('each persona includes output constraints reminder in userPrompt', () => {
    PERSONA_CONFIGS.forEach(persona => {
      const prompt = persona.userPrompt({
        title: 'Test',
        synopsis: 'Test synopsis',
        srtContent: '',
        questions: [],
        langName: 'English'
      });
      expect(prompt).toContain('HOUSE STYLE REMINDER');
    });
  });

  it('each persona has non-empty highlight categories', () => {
    PERSONA_CONFIGS.forEach(persona => {
      expect(persona.highlightCategories.length).toBeGreaterThan(0);
    });
  });

  it('each persona has non-empty concern categories', () => {
    PERSONA_CONFIGS.forEach(persona => {
      expect(persona.concernCategories.length).toBeGreaterThan(0);
    });
  });

  it('each persona has valid minHighSeverityConcerns (1-5)', () => {
    PERSONA_CONFIGS.forEach(persona => {
      expect(persona.minHighSeverityConcerns).toBeGreaterThanOrEqual(1);
      expect(persona.minHighSeverityConcerns).toBeLessThanOrEqual(5);
    });
  });

  it('acquisitions_director has marketability focus', () => {
    const persona = PERSONA_CONFIGS.find(p => p.id === 'acquisitions_director');
    expect(persona).toBeDefined();
    expect(persona!.highlightCategories).toContain('marketability');
    expect(persona!.concernCategories).toContain('marketability');
  });

  it('cultural_editor has cultural relevance focus', () => {
    const persona = PERSONA_CONFIGS.find(p => p.id === 'cultural_editor');
    expect(persona).toBeDefined();
    const instruction = persona!.systemInstruction('English');
    expect(instruction.toLowerCase()).toContain('cultural');
  });

  it('mass_audience_viewer focuses on clarity and engagement', () => {
    const persona = PERSONA_CONFIGS.find(p => p.id === 'mass_audience_viewer');
    expect(persona).toBeDefined();
    expect(persona!.concernCategories).toContain('confusion');
  });

  it('social_impact_viewer has ethical storytelling focus', () => {
    const persona = PERSONA_CONFIGS.find(p => p.id === 'social_impact_viewer');
    expect(persona).toBeDefined();
    const instruction = persona!.systemInstruction('English');
    expect(instruction.toLowerCase()).toMatch(/social|impact|message|ethics/i);
  });

  it('userPrompt includes film metadata', () => {
    const persona = PERSONA_CONFIGS[0];
    const prompt = persona.userPrompt({
      title: 'My Film Title',
      synopsis: 'A story about courage',
      srtContent: '00:00:01 --> Hello',
      questions: ['Is it clear?', 'Is it engaging?'],
      langName: 'English'
    });

    expect(prompt).toContain('My Film Title');
    expect(prompt).toContain('A story about courage');
  });

  it('systemInstruction adapts to language', () => {
    const persona = PERSONA_CONFIGS[0];
    
    const englishInstruction = persona.systemInstruction('English');
    expect(englishInstruction).toContain('English');
    
    const chineseInstruction = persona.systemInstruction('繁體中文');
    expect(chineseInstruction).toContain('繁體中文');
  });
});
