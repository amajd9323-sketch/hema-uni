import { openDB } from 'idb';
import type { Material, SavedQuiz } from '../types';

const dbPromise = openDB('hema-uni-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('materials')) db.createObjectStore('materials', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('quizzes')) db.createObjectStore('quizzes', { keyPath: 'id' });
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
  const tx = db.transaction(['materials', 'quizzes'], 'readwrite');
  await tx.objectStore('materials').delete(id);
  const quizzes = await tx.objectStore('quizzes').getAll() as SavedQuiz[];
  for (const quiz of quizzes) if (quiz.materialId === id) await tx.objectStore('quizzes').delete(quiz.id);
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