import type { Flashcard, Material, QuizQuestion, TutorResult } from '../types';

export type TutorAction = 'ask' | 'summary' | 'quiz' | 'flashcards' | 'explain';
export type TutorDifficulty = 'easy' | 'medium' | 'hard';

export interface TutorResponse extends TutorResult {
  questions?: QuizQuestion[];
  flashcards?: Flashcard[];
}

export interface TutorOptions {
  selectedText?: string;
  selectedPage?: number;
  questionCount?: number;
  difficulty?: TutorDifficulty;
}

function spreadPages(material: Material, maxPages: number, charsPerPage: number) {
  const pages = material.pages.filter((page) => page.text.trim());
  if (pages.length <= maxPages) {
    return pages.map((page) => ({ page: page.page, text: page.text.slice(0, charsPerPage) }));
  }
  const selected = new Map<number, { page: number; text: string }>();
  for (let i = 0; i < maxPages; i += 1) {
    const index = Math.round(i * (pages.length - 1) / (maxPages - 1));
    const page = pages[index];
    selected.set(page.page, { page: page.page, text: page.text.slice(0, charsPerPage) });
  }
  return [...selected.values()];
}

function choosePages(material: Material, question: string, action: TutorAction, options: TutorOptions) {
  const pages = material.pages.filter((page) => page.text.trim());
  if (action === 'summary' || action === 'quiz' || action === 'flashcards') {
    return spreadPages(material, 12, 1700);
  }

  const terms = (options.selectedText || question).toLocaleLowerCase('ar')
    .split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
  const ranked = pages.map((page) => ({
    page: page.page,
    text: page.text,
    score: terms.reduce((score, term) => score + (page.text.toLocaleLowerCase('ar').includes(term) ? 1 : 0), 0)
  })).sort((a, b) => {
    if (options.selectedPage && a.page === options.selectedPage) return -1;
    if (options.selectedPage && b.page === options.selectedPage) return 1;
    return b.score - a.score;
  });
  return ranked.slice(0, 7).map(({ page, text }) => ({ page, text: text.slice(0, 2200) }));
}

export async function runTutor(
  material: Material,
  action: TutorAction,
  question = '',
  options: TutorOptions = {}
): Promise<TutorResponse> {
  const pages = choosePages(material, question, action, options);
  if (!pages.length) throw new Error('لا يوجد نص قابل للبحث داخل هذه المحاضرة.');
  const requestBody = {
    action,
    question: question.slice(0, 1500),
    materialName: material.name,
    pages,
    selectedText: options.selectedText?.slice(0, 6000),
    selectedPage: options.selectedPage,
    questionCount: Math.max(5, Math.min(15, options.questionCount ?? 5)),
    difficulty: options.difficulty ?? 'medium'
  };
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const data = await response.json() as TutorResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || 'تعذر الوصول إلى المساعد الذكي.');
  return data;
}