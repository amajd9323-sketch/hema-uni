import { openDB } from 'idb';
import type { Material, SavedQuiz, SavedFlashcardSet } from '../types';

const dbPromise = openDB('hema-uni-db', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('materials')) db.createObjectStore('materials', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('quizzes')) db.createObjectStore('quizzes', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('flashcards')) db.createObjectStore('flashcards', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
  }
});

export async function listMaterials(): Promise<Material[]> {
  const db = await dbPromise;
  return (await db.getAll('materials')).sort((a, b) => b.addedAt - a.addedAt) as Material[];
}

export async function saveMaterial(material: Material): Promise<void> {
  const db = await dbPromise;
  await db.put('materials', material);
}

export async function removeMaterial(id: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(['materials', 'quizzes', 'flashcards', 'notes'], 'readwrite');
  await tx.objectStore('materials').delete(id);
  const quizzes = await tx.objectStore('quizzes').getAll() as SavedQuiz[];
  const flashcardSets = await tx.objectStore('flashcards').getAll() as SavedFlashcardSet[];
  const notes = await tx.objectStore('notes').getAll() as import('../types').StudyNote[];
  for (const quiz of quizzes) if (quiz.materialId === id) await tx.objectStore('quizzes').delete(quiz.id);
  for (const set of flashcardSets) if (set.materialId === id) await tx.objectStore('flashcards').delete(set.id);
  for (const note of notes) if (note.materialId === id) await tx.objectStore('notes').delete(note.id);
  await tx.done;
}

export async function saveQuiz(quiz: SavedQuiz): Promise<void> {
  const db = await dbPromise;
  await db.put('quizzes', quiz);
}

export async function listQuizzes(): Promise<SavedQuiz[]> {
  const db = await dbPromise;
  return (await db.getAll('quizzes')).sort((a, b) => b.createdAt - a.createdAt) as SavedQuiz[];
}

export async function saveFlashcardSet(set: SavedFlashcardSet): Promise<void> {
  const db = await dbPromise;
  await db.put('flashcards', set);
}

export async function listFlashcardSets(): Promise<SavedFlashcardSet[]> {
  const db = await dbPromise;
  return (await db.getAll('flashcards')).sort((a, b) => b.createdAt - a.createdAt) as SavedFlashcardSet[];
}

export async function removeFlashcardSet(id: string): Promise<void> {
  const db = await dbPromise;
  await db.delete('flashcards', id);
}


export async function saveStudyNote(note: import('../types').StudyNote): Promise<void> {
  const db = await dbPromise;
  await db.put('notes', note);
}

export async function listStudyNotes(): Promise<import('../types').StudyNote[]> {
  const db = await dbPromise;
  return (await db.getAll('notes')).sort((a, b) => b.createdAt - a.createdAt) as import('../types').StudyNote[];
}

export async function removeStudyNote(id: string): Promise<void> {
  const db = await dbPromise;
  await db.delete('notes', id);
}
