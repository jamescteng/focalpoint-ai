import { getAllPersonas } from '../personas.js';

const INTERNATIONAL_NAMES = [
  { first: 'Amara', last: 'Okonkwo' }, { first: 'Yuki', last: 'Tanaka' },
  { first: 'Elena', last: 'Vasquez' }, { first: 'Priya', last: 'Sharma' },
  { first: 'Fatima', last: 'Al-Rashid' }, { first: 'Sofia', last: 'Andersen' },
  { first: 'Mei', last: 'Zhang' }, { first: 'Aisha', last: 'Mbeki' },
  { first: 'Isabella', last: 'Romano' }, { first: 'Nadia', last: 'Petrov' },
  { first: 'Ling', last: 'Chen' }, { first: 'Zara', last: 'Hussain' },
  { first: 'Chioma', last: 'Eze' }, { first: 'Hana', last: 'Kim' },
  { first: 'Leila', last: 'Moradi' }, { first: 'Nina', last: 'Johansson' },
  { first: 'Riya', last: 'Patel' }, { first: 'Chloe', last: 'Dubois' },
  { first: 'Ananya', last: 'Reddy' }, { first: 'Thandi', last: 'Ndlovu' },
  { first: 'Sana', last: 'Nakamura' }, { first: 'Ava', last: "O'Brien" },
  { first: 'Ingrid', last: 'Berg' }, { first: 'Carmen', last: 'Reyes' },
  { first: 'Olga', last: 'Volkov' }, { first: 'Emeka', last: 'Adeyemi' },
  { first: 'Kenji', last: 'Watanabe' }, { first: 'Marco', last: 'Silva' },
  { first: 'Raj', last: 'Gupta' }, { first: 'Omar', last: 'Farouk' },
  { first: 'Lars', last: 'Nielsen' }, { first: 'Wei', last: 'Liu' },
  { first: 'Kwame', last: 'Asante' }, { first: 'Alessandro', last: 'Bianchi' },
  { first: 'Dmitri', last: 'Kozlov' }, { first: 'Jin', last: 'Park' },
  { first: 'Hassan', last: 'Mahmoud' }, { first: 'Chidi', last: 'Okwu' },
  { first: 'Takeshi', last: 'Yamamoto' }, { first: 'Arjun', last: 'Nair' },
  { first: 'Erik', last: 'Lindqvist' }, { first: 'Vikram', last: 'Singh' },
  { first: 'Pierre', last: 'Laurent' }, { first: 'Kofi', last: 'Mensah' },
  { first: 'Andrei', last: 'Popescu' },
];

export interface PersonaAlias {
  personaId: string;
  name: string;
  role: string;
}

export function generatePersonaAliases(): PersonaAlias[] {
  const shuffled = [...INTERNATIONAL_NAMES].sort(() => Math.random() - 0.5);
  const allPersonas = getAllPersonas();
  return allPersonas.map((p, i) => ({
    personaId: p.id,
    name: `${shuffled[i % shuffled.length].first} ${shuffled[i % shuffled.length].last}`,
    role: p.role
  }));
}
