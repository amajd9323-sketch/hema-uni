export interface PageText {
  page: number;
  text: string;
}

export interface Material {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  pages: PageText[];
  file: Blob;
}

export interface Citation {
  page: number;
  quote?: string;
}

export interface TutorResult {
  text: string;
  citations: Citation[];
  model?: string;
}

export interface QuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  page?: number;
}

export interface SavedQuiz {
  id: string;
  materialId: string;
  title: string;
  questions: QuizQuestion[];
  answers: number[];
  score: number;
  createdAt: number;
  durationMinutes?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  completedAt?: number;
}

export interface Flashcard {
  front: string;
  back: string;
  page?: number;
}

export interface SavedFlashcardSet {
  id: string;
  materialId: string;
  title: string;
  cards: Flashcard[];
  createdAt: number;
}