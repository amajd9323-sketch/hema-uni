import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText } from '../types';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdf(file: File): Promise<PageText[]> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('ارفع ملف PDF فقط.');
  }
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: PageText[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
    pages.push({ page: pageNumber, text });
  }
  if (!pages.some((page) => page.text.length > 0)) {
    throw new Error('الملف لا يحتوي نصًا قابلًا للاستخراج. قد يكون ملفًا ممسوحًا ضوئيًا.');
  }
  return pages;
}