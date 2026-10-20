import type { Material, TutorResult, QuizQuestion } from '../types';

export type TutorAction = 'ask' | 'summary' | 'quiz';
export interface TutorResponse extends TutorResult {
  questions?: QuizQuestion[];
}

function choosePages(material: Material, question: string, action: TutorAction) {
  const pages = material.pages.filter((page) => page.text.trim());
  if (action !== 'ask') return pages.slice(0, 18).map((page) => ({ page: page.page, text: page.text.slice(0, 1800) }));
  const terms = question.toLocaleLowerCase('ar').split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
  return pages.map((page) => ({
    page: page.page,
    text: page.text,
    score: terms.reduce((score, term) => score + (page.text.toLocaleLowerCase('ar').includes(term) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score).slice(0, 7).map(({ page, text }) => ({ page, text: text.slice(0, 2200) }));
}

export async function runTutor(material: Material, action: TutorAction, question = ''): Promise<TutorResponse> {
  const pages = choosePages(material, question, action);
  if (!pages.length) throw new Error('لا يوجد نص قابل للبحث داخل هذه المحاضرة.');
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, question, materialName: material.name, pages })
  });
  const data = await response.json() as TutorResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || 'تعذر الوصول إلى المساعد الذكي.');
  return data;
}